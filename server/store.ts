import Database from 'better-sqlite3';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { DEMO_RATE, formatMicro, principal } from './money.js';

export type EventInput = { id: string; merchant: string; amount: string; currency: 'USD' | 'EUR'; timestamp: string };
// received -> classifying -> skipped   the model found no listed company
//                         -> buying -> bought
//                                   -> blocked    refused before signing (paused, budget, unresolved purchase)
//                                   -> uncertain  signed, outcome not yet known
//                         -> failed    the model's output was unusable, or a restart interrupted the event
export type EventStatus = 'received' | 'classifying' | 'skipped' | 'buying' | 'bought' | 'blocked' | 'uncertain' | 'failed';
export type EventDetail = { company?: string | null; explanation?: string; classifySeconds?: number;
  transaction?: string; shares?: string; purchaseStatus?: string };
export type SavedEvent = EventInput & { source: 'simulation' | 'apple_wallet'; status: EventStatus; reason: string;
  principal: string; detail: EventDetail };
export const INTERRUPTED = 'Interrupted by a restart. Nothing is retried automatically.';
export const SHORTCUT_TOKEN_PREFIX = 'turtle_shortcut_';
// Single-user local demo: the Shortcut credential belongs to this one owner.
export const OWNER = 'local';

export class EventConflict extends Error {}

const TABLES = ['events', 'apple_wallet_notifications'] as const;
// The column keeps its original name; it holds the planned buy in payment-token units.
const SELECT = `SELECT activity.id, merchant, amount, currency, timestamp, source, status, reason,
  principal_usdc AS principal, detail FROM (
    SELECT * FROM events UNION ALL SELECT * FROM apple_wallet_notifications
  ) AS activity JOIN event_order ON activity.id = event_order.event_id`;
type Row = Omit<SavedEvent, 'detail'> & { detail: string };
const parse = (row: Row): SavedEvent => ({ ...row, detail: JSON.parse(row.detail) });

export class EventStore {
  readonly database: Database.Database;

  constructor(path: string) {
    this.database = new Database(path);
    this.database.pragma('journal_mode = WAL');
    this.database.pragma('synchronous = FULL');
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY, payload TEXT NOT NULL, merchant TEXT NOT NULL,
        amount TEXT NOT NULL, currency TEXT NOT NULL, timestamp TEXT NOT NULL,
        source TEXT NOT NULL CHECK(source = 'simulation'), status TEXT NOT NULL,
        reason TEXT NOT NULL, principal_usdc TEXT NOT NULL, rate_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT OR IGNORE INTO settings VALUES ('paused', 'false');
      CREATE TABLE IF NOT EXISTS apple_wallet_notifications (
        id TEXT PRIMARY KEY, payload TEXT NOT NULL, merchant TEXT NOT NULL,
        amount TEXT NOT NULL, currency TEXT NOT NULL, timestamp TEXT NOT NULL,
        source TEXT NOT NULL CHECK(source = 'apple_wallet'), status TEXT NOT NULL,
        reason TEXT NOT NULL, principal_usdc TEXT NOT NULL, rate_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS event_order (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE
      );
      INSERT OR IGNORE INTO event_order (event_id) SELECT id FROM events ORDER BY rowid;
      CREATE TABLE IF NOT EXISTS shortcut_credential (
        slot INTEGER PRIMARY KEY CHECK(slot = 1), user_id TEXT NOT NULL, token_hash TEXT NOT NULL
      );
    `);
    for (const table of TABLES) {
      // Added for the classifier and purchase outcome. Existing tables are altered, never replaced.
      const columns = this.database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
      if (!columns.some(column => column.name === 'detail')) {
        this.database.exec(`ALTER TABLE ${table} ADD COLUMN detail TEXT NOT NULL DEFAULT '{}'`);
      }
      // An event caught mid-flight by a restart is closed, never silently re-run.
      this.database.prepare(`UPDATE ${table} SET status = 'failed', reason = ? WHERE status IN ('received', 'classifying')`).run(INTERRUPTED);
      this.database.prepare(`UPDATE ${table} SET status = 'uncertain', reason = ? WHERE status = 'buying'`).run(INTERRUPTED);
    }
  }

  paused(): boolean {
    return (this.database.prepare("SELECT value FROM settings WHERE key = 'paused'").get() as { value: string }).value === 'true';
  }

  setPaused(paused: boolean): void {
    this.database.prepare("UPDATE settings SET value = ? WHERE key = 'paused'").run(String(paused));
  }

  get(id: string): SavedEvent | undefined {
    const row = this.database.prepare(`${SELECT} WHERE activity.id = ?`).get(id) as Row | undefined;
    return row && parse(row);
  }

  list(): SavedEvent[] {
    return (this.database.prepare(`${SELECT} ORDER BY event_order.sequence DESC LIMIT 200`).all() as Row[]).map(parse);
  }

  update(id: string, change: { status: EventStatus; reason?: string; detail?: EventDetail }): SavedEvent {
    return this.database.transaction(() => {
      const current = this.get(id);
      if (!current) throw new Error('Unknown event');
      const table = current.source === 'simulation' ? 'events' : 'apple_wallet_notifications';
      this.database.prepare(`UPDATE ${table} SET status = ?, reason = ?, detail = ? WHERE id = ?`).run(
        change.status, change.reason ?? '', JSON.stringify({ ...current.detail, ...change.detail }), id);
      return this.get(id)!;
    }).immediate();
  }

  shortcutEnabled(): boolean {
    return !!this.database.prepare('SELECT 1 FROM shortcut_credential WHERE user_id = ?').get(OWNER);
  }

  rotateShortcutToken(): string {
    const token = SHORTCUT_TOKEN_PREFIX + randomBytes(32).toString('base64url');
    this.database.prepare(`INSERT INTO shortcut_credential VALUES (1, ?, ?)
      ON CONFLICT(slot) DO UPDATE SET user_id = excluded.user_id, token_hash = excluded.token_hash`)
      .run(OWNER, createHash('sha256').update(token).digest('hex'));
    return token;
  }

  revokeShortcutToken(): void {
    this.database.prepare('DELETE FROM shortcut_credential').run();
  }

  acceptsShortcutToken(token: string): boolean {
    if (!/^turtle_shortcut_[A-Za-z0-9_-]{43}$/.test(token)) return false;
    const saved = this.database.prepare('SELECT token_hash FROM shortcut_credential WHERE user_id = ?')
      .get(OWNER) as { token_hash: string } | undefined;
    if (!saved) return false;
    const expected = Buffer.from(saved.token_hash, 'hex');
    const actual = createHash('sha256').update(token).digest();
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  intake(input: EventInput, source: SavedEvent['source'] = 'simulation'): { event: SavedEvent; created: boolean } {
    const table = source === 'simulation' ? 'events' : 'apple_wallet_notifications';
    const payload = JSON.stringify([input.merchant, input.amount, input.currency, input.timestamp]);
    return this.database.transaction(() => {
      const existing = this.database.prepare(`SELECT payload, source FROM events WHERE id = ?
        UNION ALL SELECT payload, source FROM apple_wallet_notifications WHERE id = ?`)
        .get(input.id, input.id) as { payload: string; source: SavedEvent['source'] } | undefined;
      if (existing) {
        if (existing.source !== source) throw new EventConflict('Event ID already belongs to another source');
        if (existing.payload !== payload) throw new EventConflict('Event ID already has a different payload');
        return { event: this.get(input.id)!, created: false };
      }
      const planned = formatMicro(principal(input.amount, input.currency));
      this.database.prepare(`INSERT INTO ${table}
        (id, payload, merchant, amount, currency, timestamp, source, status, reason, principal_usdc, rate_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'received', '', ?, ?)`).run(
        input.id, payload, input.merchant, input.amount, input.currency, input.timestamp, source, planned,
        JSON.stringify(input.currency === 'EUR' ? DEMO_RATE : { value: '1', demo: false }),
      );
      this.database.prepare('INSERT INTO event_order (event_id) VALUES (?)').run(input.id);
      return { event: this.get(input.id)!, created: true };
    }).immediate();
  }

  close(): void { this.database.close(); }
}

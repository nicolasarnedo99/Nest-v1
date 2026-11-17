import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { chmodSync } from 'node:fs';
import type { Hex } from 'viem';
import type { Order } from './authorization.js';
import { checkBudget, madridDay } from './money.js';

// One purchase per card event. `amount` is in the payment token's 6-decimal units.
export type PurchaseIntent = { id: string; company: number; amount: bigint };
export type Prepared = { order: Order; balance: bigint; fromBlock: bigint };
// 'expired' means the signature's validity window closed with no purchase on
// chain: that signature can never move money, so it no longer counts.
export type PurchaseStatus = 'preparing' | 'signed' | 'submitted' | 'confirmed' | 'expired' | 'uncertain';
export type Purchase = {
  intent: PurchaseIntent; prepared: Prepared; status: PurchaseStatus; budgetDay: string;
  signature?: Hex; transaction?: Hex; shares?: bigint; evidence?: Record<string, unknown>; reason?: string;
};
export type Inspection =
  | { status: 'confirmed'; shares: bigint; evidence: Record<string, unknown> }
  | { status: 'expired' | 'pending' };

// The buyer signs a message, not a transaction. A relayer submits it.
export interface PaymentAdapter {
  prepare(intent: PurchaseIntent): Promise<Prepared>;
  sign(prepared: Prepared): Promise<Hex>;
  verify(prepared: Prepared, signature: Hex): Promise<void>;
  submit(prepared: Prepared, signature: Hex): Promise<Hex>;
  inspect(purchase: Purchase): Promise<Inspection>;
}

const encode = (value: unknown) => JSON.stringify(value, (_, item) =>
  typeof item === 'bigint' ? { $bigint: item.toString() } : item);
const decode = <T>(value: string): T => JSON.parse(value, (_, item) =>
  item && typeof item === 'object' && Object.keys(item).length === 1 && typeof item.$bigint === 'string'
    ? BigInt(item.$bigint) : item);
const outstanding = (purchase: Purchase) => ['preparing', 'signed', 'submitted', 'uncertain'].includes(purchase.status);

export class ExecutionStore {
  readonly database: Database.Database;
  private readonly owner = randomUUID();
  constructor(path: string) {
    this.database = new Database(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.database.pragma('journal_mode = WAL');
    this.database.pragma('synchronous = FULL');
    this.database.pragma('busy_timeout = 5000');
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS purchases (id TEXT PRIMARY KEY, record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS purchase_lock (
        singleton INTEGER PRIMARY KEY CHECK(singleton = 1), owner TEXT NOT NULL, pid INTEGER NOT NULL
      );
    `);
  }
  get(id: string): Purchase | undefined {
    const row = this.database.prepare('SELECT record FROM purchases WHERE id = ?').get(id) as { record: string } | undefined;
    return row ? decode<Purchase>(row.record) : undefined;
  }
  list(): Purchase[] {
    return (this.database.prepare('SELECT record FROM purchases ORDER BY rowid').all() as { record: string }[])
      .map(row => decode<Purchase>(row.record));
  }
  save(purchase: Purchase, insert = false): void {
    if (insert) this.database.prepare('INSERT INTO purchases VALUES (?, ?)').run(purchase.intent.id, encode(purchase));
    else this.database.prepare('UPDATE purchases SET record = ? WHERE id = ?').run(encode(purchase), purchase.intent.id);
  }
  acquire(): void {
    this.database.transaction(() => {
      const lock = this.database.prepare('SELECT owner, pid FROM purchase_lock').get() as { owner: string; pid: number } | undefined;
      if (lock) {
        // A dead process can no longer sign or submit. PID reuse fails closed.
        try { process.kill(lock.pid, 0); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
            this.database.prepare('DELETE FROM purchase_lock WHERE owner = ?').run(lock.owner);
          } else throw new Error('Execution lock owner cannot be verified');
        }
        if (this.database.prepare('SELECT 1 FROM purchase_lock').get()) throw new Error('Another execution worker holds the wallet lock');
      }
      this.database.prepare('INSERT INTO purchase_lock VALUES (1, ?, ?)').run(this.owner, process.pid);
    }).immediate();
  }
  release(): void { this.database.prepare('DELETE FROM purchase_lock WHERE owner = ?').run(this.owner); }
  close(): void { this.database.close(); }
}

export class Execution {
  constructor(private readonly store: ExecutionStore, private readonly adapter: PaymentAdapter,
    private readonly now: () => Date = () => new Date()) {}

  async execute(intent: PurchaseIntent): Promise<Purchase> {
    this.store.acquire();
    try {
      const existing = this.store.get(intent.id);
      if (existing) {
        if (encode(existing.intent) !== encode(intent)) throw new Error('Purchase ID already has a different intent');
        return existing;
      }
      if (!intent.id || !Number.isInteger(intent.company) || intent.company < 0 || intent.amount <= 0n) throw new Error('Invalid purchase intent');
      const purchases = this.store.list();
      if (purchases.some(outstanding)) throw new Error('Unresolved purchase blocks new execution');
      const prepared = await this.adapter.prepare(intent);
      if (prepared.order.value !== intent.amount || prepared.order.company !== intent.company || prepared.balance < 0n) {
        throw new Error('Prepared order does not match the intent');
      }
      const budgetDay = madridDay(this.now());
      const spentTodayMicro = purchases.filter(item => item.status === 'confirmed' && item.budgetDay === budgetDay)
        .reduce((sum, item) => sum + item.intent.amount, 0n);
      // Refuses before anything is signed. Nothing above this line can move money.
      checkBudget({ principalMicro: intent.amount, balanceMicro: prepared.balance, spentTodayMicro, reservations: [] });
      const purchase: Purchase = { intent, prepared, status: 'preparing', budgetDay };
      this.store.save(purchase, true);
      let phase = 'Signing';
      try {
        // Persist the signature before checking it, so a crash can never lose
        // track of a signature that exists.
        purchase.signature = await this.adapter.sign(prepared);
        purchase.status = 'signed';
        this.store.save(purchase);
        phase = 'Signature verification';
        await this.adapter.verify(prepared, purchase.signature);
        phase = 'Submission';
        purchase.transaction = await this.adapter.submit(prepared, purchase.signature);
        purchase.status = 'submitted';
        this.store.save(purchase);
        phase = 'Confirmation';
        return await this.settle(purchase);
      } catch {
        purchase.status = 'uncertain';
        purchase.reason = `${phase} did not complete; reconcile before any new purchase`;
        this.store.save(purchase);
        return purchase;
      }
    } finally { this.store.release(); }
  }

  // Asks the chain what became of an unresolved purchase. Never signs or submits.
  async reconcile(id: string): Promise<Purchase> {
    this.store.acquire();
    try {
      const purchase = this.store.get(id);
      if (!purchase) throw new Error('Unknown purchase');
      if (!outstanding(purchase)) return purchase;
      try { return await this.settle(purchase); }
      catch {
        purchase.status = 'uncertain';
        purchase.reason = 'Chain state could not be read; reconcile again';
        this.store.save(purchase);
        return purchase;
      }
    } finally { this.store.release(); }
  }

  private async settle(purchase: Purchase): Promise<Purchase> {
    const result = await this.adapter.inspect(purchase);
    if (result.status === 'confirmed') {
      if (result.shares <= 0n) throw new Error('Confirmed purchase reported no shares');
      Object.assign(purchase, { status: 'confirmed', shares: result.shares, evidence: result.evidence });
      delete purchase.reason;
    } else if (result.status === 'expired') {
      purchase.status = 'expired';
      purchase.reason = 'The signed authorisation expired unused; no money moved';
    } else {
      purchase.status = 'uncertain';
      purchase.reason = 'Not on chain yet and the authorisation is still valid; no automatic resubmission';
    }
    this.store.save(purchase);
    return purchase;
  }
}

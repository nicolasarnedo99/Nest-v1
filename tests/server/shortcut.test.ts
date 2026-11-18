import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventStore, type SavedEvent } from '../../server/store.js';
import { normaliseTap } from '../../server/app.js';
import { serve } from './harness.js';

const endpoint = '/api/notifications/apple-wallet';
const event = () => ({ id: randomUUID(), merchant: 'Apple', amount: '5.00', currency: 'USD' as const, timestamp: '2026-09-12T10:00:00Z' });

describe('Apple Wallet Shortcut intake', () => {
  let store: EventStore;
  let api: Awaited<ReturnType<typeof serve>>;
  let directory: string;
  let time: number;
  let seen: SavedEvent[];
  const start = async () => {
    store = new EventStore(join(directory, 'events.sqlite'));
    api = await serve({ store, now: () => time, onEvent: item => { seen.push(item); } });
  };
  const stop = async () => { await api.stop(); store.close(); };
  const rotate = async () => {
    const result = await (await api.request('/api/shortcut/token', {})).json();
    expect(result.endpointPath).toBe(endpoint);
    expect(result.token).toMatch(/^turtle_shortcut_[A-Za-z0-9_-]{43}$/);
    return result.token as string;
  };
  beforeEach(async () => { directory = mkdtempSync(join(tmpdir(), 'turtle-shortcut-')); time = 0; seen = []; await start(); });
  afterEach(async () => { await stop(); rmSync(directory, { recursive: true }); });

  it('stores only a hash of the token', async () => {
    expect(await (await api.request('/api/shortcut')).json()).toEqual({ enabled: false, endpointPath: endpoint });
    const token = await rotate();
    expect(await (await api.request('/api/shortcut')).json()).toEqual({ enabled: true, endpointPath: endpoint });
    const saved = store.database.prepare('SELECT * FROM shortcut_credential').all();
    expect(saved).toEqual([{ slot: 1, user_id: 'local', token_hash: expect.stringMatching(/^[0-9a-f]{64}$/) }]);
    expect(JSON.stringify(saved)).not.toContain(token);
  });

  it('refuses intake without the exact token', async () => {
    const token = await rotate();
    expect((await api.request(endpoint, event())).status).toBe(401);
    expect((await api.request(endpoint, event(), 'something-else')).status).toBe(401);
    expect((await api.request(endpoint, event(), token + 'x')).status).toBe(401);
    expect(store.list()).toEqual([]);
    expect(seen).toEqual([]);
  });

  it('keeps the token across restart and invalidates it on rotation and revocation', async () => {
    const first = await rotate();
    await stop(); await start();
    expect((await api.request(endpoint, event(), first)).status).toBe(202);
    const second = await rotate();
    expect((await api.request(endpoint, event(), first)).status).toBe(401);
    expect((await api.request(endpoint, event(), second)).status).toBe(202);
    expect(await (await api.request('/api/shortcut/revoke', {})).json()).toEqual({ enabled: false });
    expect((await api.request(endpoint, event(), second)).status).toBe(401);
  });

  it('stores a duplicate tap once, hands it on once, and keeps IDs separate across sources', async () => {
    const token = await rotate();
    const input = event();
    const replies = await Promise.all([api.request(endpoint, input, token), api.request(endpoint, input, token)]);
    expect(replies.map(reply => reply.status).sort()).toEqual([200, 202]);
    for (const reply of replies) expect(await reply.json()).toEqual({ id: input.id, received: true, status: 'received' });
    expect(seen.map(item => [item.id, item.source])).toEqual([[input.id, 'apple_wallet']]);
    expect((await api.request(endpoint, { ...input, merchant: 'Microsoft' }, token)).status).toBe(409);
    expect((await api.request('/api/events', input)).status).toBe(409);
    const simulation = event();
    expect((await api.request('/api/events', simulation)).status).toBe(202);
    expect((await api.request(endpoint, simulation, token)).status).toBe(409);
    const rows = await (await api.request('/api/events')).json();
    expect(rows.events.map((row: SavedEvent) => [row.id, row.source])).toEqual([
      [simulation.id, 'simulation'], [input.id, 'apple_wallet']]);
  });

  it('bounds body size and malformed JSON', async () => {
    const token = await rotate();
    expect((await api.request(endpoint, { ...event(), merchant: 'x'.repeat(5000) }, token)).status).toBe(413);
    expect((await api.request(endpoint, '{not json', token)).status).toBe(400);
    expect(store.list()).toEqual([]);
  });

  it('limits intake to 30 requests a minute', async () => {
    const token = await rotate();
    const input = event();
    for (let count = 0; count < 30; count++) await api.request(endpoint, input, token);
    expect((await api.request(endpoint, input, token)).status).toBe(429);
    time = 60_000;
    expect((await api.request(endpoint, input, token)).status).toBe(200);
  });
});

describe('what a Wallet tap sends', () => {
  it.each([
    ['4,50 €', '4.50', 'EUR'], ['€4.50', '4.50', 'EUR'], ['$12.00', '12.00', 'USD'], ['1.234,56 €', '1234.56', 'EUR'],
    ['1,234.5 USD', '1234.5', 'USD'], ['23', '23', 'EUR'], ['0,99 €', '0.99', 'EUR'], [7.2, '7.2', 'EUR'],
  ])('reads %j as %s %s', (amount, expected, currency) => {
    const tap = normaliseTap({ merchant: ' CARREFOUR EXPRESS ', amount }, 0) as Record<string, string>;
    expect(tap).toMatchObject({ amount: expected, currency, merchant: 'CARREFOUR EXPRESS', timestamp: '1970-01-01T00:00:00.000Z' });
    expect(tap.id).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('keeps an id, timestamp and currency the phone did send', () => {
    expect(normaliseTap({ id: 'abc', timestamp: 't', merchant: 'x', amount: '5.00', currency: 'USD' }, 0))
      .toEqual({ id: 'abc', timestamp: 't', merchant: 'x', amount: '5.00', currency: 'USD' });
  });
});

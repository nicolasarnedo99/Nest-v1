import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventStore, INTERRUPTED, type SavedEvent } from '../../server/store.js';
import { serve, WALLET } from './harness.js';

describe('local API', () => {
  let store: EventStore;
  let api: Awaited<ReturnType<typeof serve>>;
  let directory: string;
  let chainFails: boolean;
  let time: number;
  let seen: SavedEvent[];
  const event = () => ({ id: randomUUID(), merchant: 'Apple', amount: '5.00', currency: 'USD', timestamp: '2026-09-12T10:00:00Z' });
  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'turtle-test-'));
    store = new EventStore(join(directory, 'events.sqlite'));
    chainFails = false; time = 0; seen = [];
    api = await serve({ store, now: () => time, onEvent: item => { seen.push(item); },
      readWallet: async () => { if (chainFails) throw new Error('private RPC detail'); return WALLET; } });
  });
  afterEach(async () => { await api.stop(); store.close(); rmSync(directory, { recursive: true }); });

  it('stores an event once under concurrent duplicates, hands it on once, and rejects a changed payload', async () => {
    const input = event();
    const responses = await Promise.all([api.request('/api/events', input), api.request('/api/events', input)]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 202]);
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]).toMatchObject({ status: 'received', principal: '0.5', source: 'simulation', detail: {} });
    expect(seen.map(item => item.id)).toEqual([input.id]);
    expect((await api.request('/api/events', { ...input, amount: '6.00' })).status).toBe(409);
    expect(store.list()[0]!.amount).toBe('5.00');
    expect((await api.request('/api/events', { ...input, id: input.id.toUpperCase() })).status).toBe(200);
    expect(seen).toHaveLength(1);
  });

  it.each([{ amount: '0' }, { amount: '-1' }, { amount: '1e2' }, { amount: 2 }, { currency: 'GBP' },
    { source: 'card' }, { merchant: '  ' }, { timestamp: 'yesterday' }, { timestamp: '2026-02-30T00:00:00Z' }, { id: 'not-uuid' }])('rejects invalid fields %j without persistence', async fields => {
    expect((await api.request('/api/events', { ...event(), ...fields })).status).toBe(400);
    expect(store.list()).toHaveLength(0);
    expect(seen).toHaveLength(0);
  });

  it('reports the wallet, limits and pause state, and lets pause be switched both ways', async () => {
    const status = await (await api.request('/api/status')).json();
    expect(status).toMatchObject({ wallet: WALLET, execution: { paused: false },
      limits: { dailyCap: '5', minimumBuy: '0.10', maximumBuy: '1' } });
    expect(await (await api.request('/api/pause', { paused: true })).json()).toEqual({ paused: true });
    expect((await (await api.request('/api/status')).json()).execution).toEqual({ paused: true });
    expect(await (await api.request('/api/pause', { paused: false })).json()).toEqual({ paused: false });
    expect((await api.request('/api/pause', { paused: 'yes' })).status).toBe(400);
  });

  it('closes events interrupted by a restart instead of re-running them', async () => {
    const [first, second] = [event(), event()];
    await api.request('/api/events', first); await api.request('/api/events', second);
    store.update(second.id, { status: 'buying' });
    const reopened = new EventStore(join(directory, 'events.sqlite'));
    expect(reopened.get(first.id)).toMatchObject({ status: 'failed', reason: INTERRUPTED });
    expect(reopened.get(second.id)).toMatchObject({ status: 'uncertain', reason: INTERRUPTED });
    reopened.close();
  });

  it('surfaces RPC failure instead of inventing a zero balance', async () => {
    chainFails = true;
    const response = await api.request('/api/status');
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Wallet state unavailable; retry the read later' });
  });

  it('bounds intake and resumes after a minute', async () => {
    const input = event();
    for (let count = 0; count < 30; count++) await api.request('/api/events', input);
    expect((await api.request('/api/events', input)).status).toBe(429);
    time = 60_000;
    expect((await api.request('/api/events', input)).status).toBe(200);
  });
});

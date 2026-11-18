import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignatureRejected } from '../../server/authorization.js';
import type { PhoneRelay } from '../../server/app.js';
import { EventStore } from '../../server/store.js';
import { serve } from './harness.js';

const BUYER = '0x1111111111111111111111111111111111111111';
const order = (value: string) => ({ company: 0, orderId: `0x${'ab'.repeat(32)}`, buyer: BUYER, value,
  validAfter: '0', validBefore: '1900000000' });
const SIGNATURE = `0x${'cd'.repeat(65)}`;

describe('phone relay', () => {
  let store: EventStore; let api: Awaited<ReturnType<typeof serve>>; let directory: string; let token: string;
  const relay: PhoneRelay = {
    order: vi.fn(async input => ({ order: { company: input.company, orderId: `0x${'ab'.repeat(32)}` as const, buyer: input.buyer,
      value: input.amount, validAfter: 0n, validBefore: 1_900_000_000n }, typed: { primaryType: 'ReceiveWithAuthorization', value: input.amount } })),
    buy: vi.fn(async () => ({ transaction: `0x${'ef'.repeat(32)}` as const, confirmed: true })),
  };
  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'turtle-phone-'));
    store = new EventStore(join(directory, 'events.sqlite'));
    api = await serve({ store, relay, now: () => Date.parse('2026-11-20T10:00:00Z') });
    token = (await (await api.request('/api/shortcut/token', {})).json()).token;
    vi.mocked(relay.buy).mockClear();
  });
  afterEach(async () => { await api.stop(); store.close(); rmSync(directory, { recursive: true }); });

  it('refuses without the Shortcut token', async () => {
    expect((await api.request('/api/phone/order', { buyer: BUYER, company: 0, eventId: 'e1', amount: '500000' })).status).toBe(401);
    expect((await api.request('/api/phone/buy', { order: order('500000'), signature: SIGNATURE })).status).toBe(401);
  });

  it('returns the order to sign with amounts as strings', async () => {
    const response = await api.request('/api/phone/order', { buyer: BUYER, company: 3, eventId: 'e1', amount: '500000' }, token);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ order: { company: 3, buyer: BUYER, value: '500000', validBefore: '1900000000' },
      typed: { value: '500000' } });
  });

  it('refuses a buy outside 0.10 to 1.00 without paying gas', async () => {
    expect((await api.request('/api/phone/buy', { order: order('1500000'), signature: SIGNATURE }, token)).status).toBe(400);
    expect((await api.request('/api/phone/buy', { order: order('50000'), signature: SIGNATURE }, token)).status).toBe(400);
    expect(relay.buy).not.toHaveBeenCalled();
  });

  it('stops at the daily cap of 5.00', async () => {
    for (let i = 0; i < 5; i++) expect((await api.request('/api/phone/buy', { order: order('1000000'), signature: SIGNATURE }, token)).status).toBe(200);
    expect((await api.request('/api/phone/buy', { order: order('100000'), signature: SIGNATURE }, token)).status).toBe(409);
    expect(relay.buy).toHaveBeenCalledTimes(5);
  });

  it('passes a valid buy to the relayer', async () => {
    const response = await api.request('/api/phone/buy', { order: order('500000'), signature: SIGNATURE }, token);
    expect(await response.json()).toEqual({ transaction: `0x${'ef'.repeat(32)}`, confirmed: true });
    expect(relay.buy).toHaveBeenCalledWith(expect.objectContaining({ value: 500000n, validBefore: 1_900_000_000n }), SIGNATURE);
  });

  const buy = (value: string) => api.request('/api/phone/buy', { order: order(value), signature: SIGNATURE }, token);

  it('answers 502 with a fixed message and releases the budget when the relayer fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(relay.buy).mockRejectedValueOnce(new Error('rpc https://sepolia.example/v3/SECRETKEY down'));
    const failed = await buy('1000000');
    expect(failed.status).toBe(502);
    expect(JSON.stringify(await failed.json())).not.toContain('SECRETKEY');
    error.mockRestore();
    for (let i = 0; i < 5; i++) expect((await buy('1000000')).status).toBe(200);
  });

  it('keeps counting a buy that succeeds while an earlier one fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    let fail!: () => void;
    const held = new Promise<void>((_resolve, reject) => { fail = () => reject(new Error('down')); });
    vi.mocked(relay.buy).mockImplementationOnce(() => held as never);
    const first = buy('1000000');
    await vi.waitFor(() => expect(relay.buy).toHaveBeenCalledTimes(1));
    expect((await buy('1000000')).status).toBe(200);
    fail();
    expect((await first).status).toBe(502);
    // 1.00 is spent by the second buy; only four more fit under 5.00.
    for (let i = 0; i < 4; i++) expect((await buy('1000000')).status).toBe(200);
    expect((await buy('100000')).status).toBe(409);
    error.mockRestore();
  });

  it('answers 400, not 502, when the signature does not match the order', async () => {
    vi.mocked(relay.buy).mockRejectedValueOnce(new SignatureRejected('Signature does not match the prepared order'));
    expect((await buy('500000')).status).toBe(400);
    expect((await buy('1000000')).status).toBe(200);
  });

  it('refuses malformed bodies', async () => {
    const bad = [
      ['/api/phone/order', { buyer: '0x12', company: 0, eventId: 'e1', amount: '500000' }],
      ['/api/phone/order', { buyer: BUYER, company: 0, eventId: 'e1', amount: '5.5' }],
      ['/api/phone/buy', { order: { ...order('500000'), buyer: '0x12' }, signature: SIGNATURE }],
      ['/api/phone/buy', { order: order('abc'), signature: SIGNATURE }],
      ['/api/phone/buy', { order: order('500000'), signature: '0xcd' }],
    ] as const;
    for (const [path, body] of bad) expect((await api.request(path, body, token)).status).toBe(400);
    expect(relay.buy).not.toHaveBeenCalled();
  });
});

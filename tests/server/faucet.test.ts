import { once } from 'node:events';
import type { Server } from 'node:http';
import { getAddress } from 'viem';
import { afterEach, describe, expect, it } from 'vitest';
import { createFaucetApp, serial, type FaucetOptions } from '../../server/faucet.js';

const A = '0xfb6916095ca1df60bb79ce92ce3ea74c37c5d359';
const B = '0x2222222222222222222222222222222222222222';
const HASH = `0x${'ab'.repeat(32)}` as const;

let stop: (() => Promise<void>) | undefined;
afterEach(async () => { await stop?.(); stop = undefined; });

async function start(options: Partial<FaucetOptions> = {}) {
  const calls: [string, bigint][] = [];
  const app = createFaucetApp({ mint: async (to, amount) => { calls.push([to, amount]); return HASH; }, ...options });
  const server: Server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const { port } = server.address() as { port: number };
  stop = () => new Promise(done => { server.closeAllConnections(); server.close(() => done()); });
  const post = (body: unknown) => fetch(`http://127.0.0.1:${port}/faucet`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { calls, post };
}

describe('POST /faucet', () => {
  it('mints exactly 1,000 test USD₮0 (6 decimals) once and answers the transaction', async () => {
    const { calls, post } = await start();
    const response = await post({ address: A });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ amount: '1000', transaction: HASH });
    expect(calls).toEqual([[A, 1_000_000_000n]]);
  });

  it.each([
    ['no address', {}],
    ['a non-string address', { address: 42 }],
    ['a short address', { address: '0x1234' }],
    ['the zero address', { address: '0x0000000000000000000000000000000000000000' }],
    ['a bad checksum', { address: '0x52908400098527886E0F7030069857D2E4169Ee7' }],
    ['bad JSON', '{not json'],
    ['an oversized body', { address: A, padding: 'x'.repeat(4000) }],
  ])('rejects %s with 400 and mints nothing', async (_name, body) => {
    const { calls, post } = await start();
    const response = await post(body);
    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('allows one mint per address per 24 h, whatever the case of the address', async () => {
    let time = 0;
    const { calls, post } = await start({ now: () => time });
    expect((await post({ address: A })).status).toBe(200);
    const again = await post({ address: getAddress(A) });
    expect(again.status).toBe(429);
    expect((await again.json()).error).toMatch(/24 hours/);
    time += 24 * 60 * 60_000;
    expect((await post({ address: A })).status).toBe(200);
    expect(calls).toHaveLength(2);
  });

  it('stops at the global hourly cap', async () => {
    let time = 0;
    const { calls, post } = await start({ now: () => time, perHour: 1 });
    expect((await post({ address: A })).status).toBe(200);
    const capped = await post({ address: B });
    expect(capped.status).toBe(429);
    expect((await capped.json()).error).toMatch(/hour/);
    time += 60 * 60_000;
    expect((await post({ address: B })).status).toBe(200);
    expect(calls).toHaveLength(2);
  });

  it('answers 502 without a transaction or the error detail when the mint fails, and frees the address', async () => {
    let fail = true;
    const { post } = await start({ mint: async () => { if (fail) throw new Error('nonce too low, key 0xsecret'); return HASH; } });
    const response = await post({ address: A });
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body).not.toHaveProperty('transaction');
    expect(JSON.stringify(body)).not.toMatch(/nonce|secret/);
    fail = false;
    expect((await post({ address: A })).status).toBe(200);
  });

  it('allows one mint in flight: a second address gets 429 until it finishes', async () => {
    let release: (() => void) | undefined, mints = 0;
    const { post } = await start({ mint: async () => { mints++; await new Promise<void>(r => { release = r; }); return HASH; } });
    const mintStarted = async () => { while (!release) await new Promise(r => setTimeout(r, 5)); };
    const finishMint = () => { const done = release!; release = undefined; done(); };
    const first = post({ address: A });
    await mintStarted();
    const second = await post({ address: B });
    expect(second.status).toBe(429);
    expect((await second.json()).error).toBe('Test funds are busy right now; try again in a minute');
    finishMint();
    expect((await first).status).toBe(200);
    expect(mints).toBe(1);
    const third = post({ address: B }); // the flag clears once the mint finishes
    await mintStarted();
    finishMint();
    expect((await third).status).toBe(200);
  });

  it('waits for a settlement holding the shared queue before minting', async () => {
    const exclusive = serial();
    const order: string[] = [];
    const { post } = await start({ exclusive, mint: async () => { order.push('mint'); return HASH; } });
    const settle = exclusive(async () => { await new Promise(r => setTimeout(r, 30)); order.push('settle'); });
    const [response] = await Promise.all([post({ address: A }), settle]);
    expect(response.status).toBe(200);
    expect(order).toEqual(['settle', 'mint']);
  });
});

describe('serial', () => {
  it('keeps going after a failed task', async () => {
    const run = serial();
    await expect(run(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(run(async () => 1)).resolves.toBe(1);
  });
});

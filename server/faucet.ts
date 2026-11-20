// Demo stand-in for an onramp: POST /faucet { address } mints 1,000 test USD₮0 (the demo's Sepolia copy) to that address.
// Limits live in memory (a restart resets them): one mint per address per 24 h, and a global cap per hour.
import express, { type ErrorRequestHandler } from 'express';
import { isAddress, zeroAddress, type Address, type Hex } from 'viem';

export const FAUCET_AMOUNT = 1_000_000_000n; // 1,000 of a 6-decimal token
const DAY = 24 * 60 * 60_000, HOUR = 60 * 60_000;

// Runs tasks one after another; a failed task does not block the next.
export function serial() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task);
    tail = run.catch(() => undefined);
    return run;
  };
}

export type FaucetOptions = {
  // Sends the mint and resolves with its hash once the receipt succeeded; throws otherwise.
  mint: (to: Address, amount: bigint) => Promise<Hex>;
  // Shared with every other sender of the same key, so nonces never collide.
  exclusive?: <T>(task: () => Promise<T>) => Promise<T>;
  now?: () => number; perHour?: number;
};

export function createFaucetApp(options: FaucetOptions) {
  const app = express();
  const now = options.now ?? Date.now;
  const perHour = options.perHour ?? 20;
  const exclusive = options.exclusive ?? serial();
  const lastMint = new Map<string, number>(); // lowercased address → time of its mint
  let recent: number[] = []; // times of mints in the last hour, failed ones included (they may have spent gas)
  // One mint in flight at most, so a queue of mints can never hold a paid x402 settlement past the phone's timeout.
  let minting = false;
  app.post('/faucet', express.json({ limit: '1kb' }), async (request, response) => {
    const address = (request.body as { address?: unknown } | undefined)?.address;
    if (typeof address !== 'string' || !isAddress(address) || address.toLowerCase() === zeroAddress) {
      response.status(400).json({ error: 'address must be an EVM address' }); return;
    }
    const time = now(), key = address.toLowerCase();
    for (const [known, at] of lastMint) if (time - at >= DAY) lastMint.delete(known);
    recent = recent.filter(at => time - at < HOUR);
    if (lastMint.has(key)) { response.status(429).json({ error: 'This wallet already got test funds today; try again in 24 hours' }); return; }
    if (recent.length >= perHour) { response.status(429).json({ error: 'Test funds are busy right now; try again in an hour' }); return; }
    if (minting) { response.status(429).json({ error: 'Test funds are busy right now; try again in a minute' }); return; }
    minting = true;
    lastMint.set(key, time);
    recent.push(time);
    try {
      const transaction = await exclusive(() => options.mint(address, FAUCET_AMOUNT));
      response.json({ amount: (FAUCET_AMOUNT / 1_000_000n).toString(), transaction }); // whole tokens, as the app shows them
    } catch (error) {
      // shortcut: a receipt timeout frees the address though the mint may still land, so a retry can mint twice (test token only); upgrade by tracking the pending tx hash.
      lastMint.delete(key);
      console.error('Faucet mint failed:', (error as { shortMessage?: string }).shortMessage ?? (error instanceof Error ? error.message : String(error)));
      response.status(502).json({ error: 'Could not add test funds; try again later' });
    } finally { minting = false; }
  });
  // Bad JSON or an oversized body.
  const failed: ErrorRequestHandler = (error, _request, response, _next) => {
    const status = (error as { status?: number }).status;
    response.status(status && status >= 400 && status < 500 ? 400 : 500).json({ error: status && status < 500 ? 'Body must be small JSON: { "address": "0x…" }' : 'Request failed' });
  };
  app.use(failed);
  return app;
}

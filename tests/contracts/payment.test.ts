// The purchase engine with the real WDK payment adapter, on a local chain.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseUnits } from 'viem';
import { Execution, ExecutionStore } from '../../server/execution.js';
import { WdkPayment } from '../../server/wdk-payment.js';
import { RELAYER_KEY, startChain } from './chain.js';

let local: Awaited<ReturnType<typeof startChain>>;
let store: ExecutionStore;
let engine: Execution;
beforeAll(async () => {
  local = await startChain(8548);
  store = new ExecutionStore(':memory:');
  engine = new Execution(store, new WdkPayment(local.agent, local.deployment,
    { rpc: local.rpc, chain: local.chain, relayerKey: RELAYER_KEY }));
}, 60_000);
afterAll(() => { store?.close(); local?.stop(); });

describe('engine with the WDK payment adapter', () => {
  it('buys with one signature, the agent paying no gas', async () => {
    const result = await engine.execute({ id: 'event-a', company: 3, amount: parseUnits('0.7', 6) });
    expect(result.status).toBe('confirmed');
    // 0.7 paid at a placeholder price of 350 per share is 0.002 shares.
    expect(result.shares).toBe(parseUnits('0.002', 18));
    expect(await local.agent.getTokenBalance(local.deployment.token)).toBe(parseUnits('9.3', 6));
    expect(await local.agent.getTokenBalance(local.deployment.stocks[3]!.address)).toBe(parseUnits('0.002', 18));
    expect(await local.agent.getBalance()).toBe(0n);
  });

  it('does not buy twice for the same event', async () => {
    const again = await engine.execute({ id: 'event-a', company: 3, amount: parseUnits('0.7', 6) });
    expect(again.status).toBe('confirmed');
    expect(await local.agent.getTokenBalance(local.deployment.token)).toBe(parseUnits('9.3', 6));
  });

  it('refuses an over-cap buy without touching the chain', async () => {
    await expect(engine.execute({ id: 'event-b', company: 0, amount: parseUnits('1.5', 6) })).rejects.toThrow('Invalid budget input');
    expect(store.get('event-b')).toBeUndefined();
    expect(await local.agent.getTokenBalance(local.deployment.token)).toBe(parseUnits('9.3', 6));
  });

  it('finds a purchase on chain by its order even when the transaction hash was lost', async () => {
    const purchase = await engine.execute({ id: 'event-c', company: 1, amount: parseUnits('0.2', 6) });
    store.save({ ...purchase, status: 'uncertain', transaction: undefined, shares: undefined, evidence: undefined });
    expect(await engine.reconcile('event-c')).toMatchObject({ status: 'confirmed', shares: purchase.shares });
  });
});

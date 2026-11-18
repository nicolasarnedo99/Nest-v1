import { describe, expect, it } from 'vitest';
import { openWallet } from '../../mobile/lib/wallet.js';

const manager = (create: () => Promise<unknown> = async () => {}) => {
  const calls: string[] = [];
  return { calls, createWallet: async (id: string) => { calls.push(`create ${id}`); return create(); }, unlock: async (id: string) => { calls.push(`unlock ${id}`); } };
};

describe('openWallet', () => {
  it('creates a new wallet when there is none, then unlocks it', async () => {
    const wdk = manager();
    expect(await openWallet('turtle', true, wdk)).toEqual({ existed: false });
    expect(wdk.calls).toEqual(['create turtle', 'unlock turtle']);
  });

  it('unlocks the key a reinstall left in the Keychain instead of failing', async () => {
    const wdk = manager(async () => { throw new Error('Wallet with walletId "turtle" already exists'); });
    expect(await openWallet('turtle', true, wdk)).toEqual({ existed: true });
    expect(wdk.calls).toEqual(['create turtle', 'unlock turtle']);
  });

  it("keeps the Keychain's own \"already exists\" an error, and unlocks nothing", async () => {
    const wdk = manager(async () => { throw new Error('The specified item already exists in the keychain.'); });
    await expect(openWallet('turtle', true, wdk)).rejects.toThrow('The specified item already exists in the keychain.');
    expect(wdk.calls).toEqual(['create turtle']);
  });

  it('shows any other create failure and unlocks nothing', async () => {
    const wdk = manager(async () => { throw new Error('Keychain write failed'); });
    await expect(openWallet('turtle', true, wdk)).rejects.toThrow('Keychain write failed');
    expect(wdk.calls).toEqual(['create turtle']);
  });

  it('only unlocks a wallet WDK already lists', async () => {
    const wdk = manager();
    expect(await openWallet('turtle', false, wdk)).toEqual({ existed: true });
    expect(wdk.calls).toEqual(['unlock turtle']);
  });
});

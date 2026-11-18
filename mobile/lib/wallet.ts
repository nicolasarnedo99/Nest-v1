// Opens the phone's one wallet. Deleting the app wipes WDK's list of wallets but
// keeps the key in the Keychain, so `createWallet` then fails with "already exists".
// That key is unlocked, never deleted or replaced: it holds the funds.
type Manager = { createWallet(id: string): Promise<unknown>; unlock(id: string): Promise<unknown>; hasWallet(id: string): Promise<boolean> };

// `create` is true when WDK listed no wallet (status NO_WALLET).
export async function openWallet(id: string, create: boolean, wdk: Manager): Promise<{ existed: boolean }> {
  let existed = !create;
  // WDK's own check swallows Keychain read errors and reports "no wallet"; this one throws, so a failed read never reaches createWallet.
  if (create && await wdk.hasWallet(id)) existed = true;
  else if (create) {
    try { await wdk.createWallet(id); }
    catch (error) {
      // Exactly what WDK's createWallet throws after it finds the key in the Keychain; any other
      // "already exists" (the Keychain's own, for one) is a real failure.
      if (!(error instanceof Error && error.message === `Wallet with walletId "${id}" already exists`)) throw error;
      existed = true;
    }
  }
  await wdk.unlock(id);
  return { existed };
}

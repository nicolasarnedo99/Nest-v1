import { once } from 'node:events';
import type { Server } from 'node:http';
import { createApp, type AppDependencies } from '../../server/app.js';
import type { WalletSnapshot } from '../../server/wallet.js';

export const WALLET: WalletSnapshot = { address: '0x123', chainId: 11155111, balance: '10', ethBalance: '0', token: '0xabc', holdings: [] };

// Starts the API on a free local port and returns a small JSON client for it.
export async function serve(dependencies: Omit<AppDependencies, 'readWallet'> & Partial<Pick<AppDependencies, 'readWallet'>>) {
  const server: Server = createApp({ readWallet: async () => WALLET, ...dependencies }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing listener');
  const base = `http://127.0.0.1:${address.port}`;
  const request = (path: string, body?: unknown, token?: string) => fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
  const stop = async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  };
  return { request, stop };
}

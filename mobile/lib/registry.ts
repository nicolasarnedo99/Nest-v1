// Finds the paid lookup through the ERC-8004 Identity Registry: its x402 endpoint from the
// agent's registration, and the wallet it may be paid at from the registry itself.
import { parseAbi, zeroAddress, type Address, type PublicClient } from 'viem';

const PREFIX = 'data:application/json;base64,';
const abi = parseAbi(['function tokenURI(uint256 tokenId) view returns (string)', 'function getAgentWallet(uint256 agentId) view returns (address)']);

// atob gives one char per byte; percent-decoding those bytes reads them as UTF-8, so USD₮0 survives (and bad UTF-8 throws).
function decodeCard(uri: string): any {
  if (!uri.startsWith(PREFIX)) throw new Error('Registration is not a data:application/json;base64 URI');
  const text = decodeURIComponent(Array.from(atob(uri.slice(PREFIX.length)), c => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''));
  try { return JSON.parse(text); } catch { throw new Error('Registration is not JSON'); }
}

export function parseRegistration(uri: string): { endpoint: string } {
  const card = decodeCard(uri);
  if (card?.active === false) throw new Error('Registration is inactive');
  const service = Array.isArray(card?.services) ? card.services.find((s: any) => s?.name === 'x402') : undefined;
  if (!service) throw new Error('Registration has no x402 service');
  if (typeof service.endpoint !== 'string' || !service.endpoint.startsWith('https://')) throw new Error('x402 endpoint is not https');
  return { endpoint: service.endpoint };
}

export async function resolveAgent(client: { readContract: PublicClient['readContract'] }, agent: { registry: Address; agentId: bigint }): Promise<{ endpoint: string; wallet: Address }> {
  const read = { address: agent.registry, abi, args: [agent.agentId] } as const;
  const [uri, wallet] = await Promise.all([client.readContract({ ...read, functionName: 'tokenURI' }), client.readContract({ ...read, functionName: 'getAgentWallet' })]);
  const { endpoint } = parseRegistration(uri);
  if (wallet === zeroAddress) throw new Error('Agent has no wallet');
  return { endpoint, wallet };
}

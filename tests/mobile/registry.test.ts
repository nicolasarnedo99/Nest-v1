import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseRegistration, resolveAgent } from '../../mobile/lib/registry.js';

// The real tokenURI of agent #11438, read from the Sepolia Identity Registry after Task 8.
const FIXTURE = readFileSync(new URL('./fixtures/lookup-agent-uri.txt', import.meta.url), 'utf8');
const PREFIX = 'data:application/json;base64,';
const card = (over: Record<string, unknown> = {}) => ({
  type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1', name: 'Nest merchant lookup',
  services: [{ name: 'x402', endpoint: 'https://morty.tail73d5db.ts.net/lookup', version: '2' }], active: true, ...over });
const uri = (json: unknown) => PREFIX + Buffer.from(typeof json === 'string' ? json : JSON.stringify(json)).toString('base64');

describe('parseRegistration', () => {
  it('reads the real registration of agent #11438 to the morty endpoint', () => {
    expect(parseRegistration(FIXTURE)).toEqual({ endpoint: 'https://morty.tail73d5db.ts.net/lookup' });
  });

  it('decodes the card as UTF-8, so USD₮0 survives', () => {
    expect(parseRegistration(uri(card({ services: [{ name: 'x402', endpoint: 'https://x.test/₮' }] })))).toEqual({ endpoint: 'https://x.test/₮' });
  });

  it.each([
    ['a URI that is not base64 JSON data', 'https://example.com/agent.json', /not a data:application\/json;base64/],
    ['bad JSON', uri('{not json'), /not JSON/],
    ['invalid base64', PREFIX + '%%%', /./],
    ['invalid UTF-8', PREFIX + Buffer.from([0xff]).toString('base64'), /./],
    ['no x402 service', uri(card({ services: [{ name: 'web', endpoint: 'https://x.test' }] })), /no x402 service/],
    ['no services at all', uri(card({ services: undefined })), /no x402 service/],
    ['an endpoint that is not https', uri(card({ services: [{ name: 'x402', endpoint: 'http://x.test/lookup' }] })), /not https/],
    ['an inactive registration', uri(card({ active: false })), /inactive/],
  ])('throws on %s', (_, input, reason) => {
    expect(() => parseRegistration(input)).toThrow(reason);
  });
});

describe('resolveAgent', () => {
  it('reads tokenURI and getAgentWallet for the agent, and returns its endpoint and wallet', async () => {
    const calls: any[] = [];
    const wallet = '0x30ABfbE1Ae448515d2671D9E3C02f5Bf437d8048';
    const readContract = (async (args: any) => { calls.push(args); return args.functionName === 'tokenURI' ? FIXTURE : wallet; }) as any;
    const registry = '0x8004A818BFB912233c491871b3d84c89A494BD9e';
    expect(await resolveAgent({ readContract }, { registry, agentId: 11438n })).toEqual({ endpoint: 'https://morty.tail73d5db.ts.net/lookup', wallet });
    expect(calls.map(c => [c.address, c.functionName, c.args])).toEqual([[registry, 'tokenURI', [11438n]], [registry, 'getAgentWallet', [11438n]]]);
  });

  it('refuses an agent whose wallet is the zero address', async () => {
    const readContract = (async (args: any) => args.functionName === 'tokenURI' ? FIXTURE : '0x0000000000000000000000000000000000000000') as any;
    await expect(resolveAgent({ readContract }, { registry: '0x8004A818BFB912233c491871b3d84c89A494BD9e', agentId: 11438n })).rejects.toThrow('Agent has no wallet');
  });
});

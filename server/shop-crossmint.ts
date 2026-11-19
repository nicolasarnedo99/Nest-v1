// Price source that reads the live total from a Crossmint agent checkout: add to cart, stop at the payment step, cancel.
// shortcut: never run against the live API in this build; first live run needs Nico's key and a check that it cancels.
//
// Where each detail came from (all under ~/.claude/plans/turtle-research/):
//  - base https://www.crossmint.com/api: crossmint-rest-js-0.2.0/dist/index.js, the "production" entry (Agent Checkouts is production-only:
//    crossmint-docs/agents_checkouts_test-agent-checkouts.md, "Common Gotchas").
//  - POST /unstable/agent-checkouts (202, body {request:{startUrl,task}, constraints:{maxCost:{amount,currency}}}), GET /unstable/agent-checkouts/{id},
//    POST /unstable/agent-checkouts/{id}/cancel: crossmint-rest-js-0.2.0/dist/index.d.ts (CreateAgentCheckoutDto, AgentCheckoutResponseDto, AgentCheckoutsCancelData).
//  - header X-API-KEY, and the stop-at-payment-then-cancel recipe: test-agent-checkouts.md, "Stop at the Payment Step".
//  - x-crossmint-user-id: the same doc says to send it with a server key.
//  - statuses queued|running|awaiting_input|succeeded|blocked|failed|cancelled: agents_checkouts_how-it-works.md, "Statuses".
//  - the total: requiredAction.request.interaction {kind:'payment', amount:{currency,kind:'exact'|'maximum',value}} in index.d.ts.
// Unverified: the currency of maxCost and of the reported total (the docs do not say; AED is assumed for both), the decimal format of
// amount.value, and which user id to send. Anything but an exact AED total with up to 2 decimals falls back to the recorded price.
import { aedToMicro, RecordedPriceSource, type PriceQuote, type PriceSource, type Product } from './shop.js';

export type CrossmintOptions = {
  key: string; fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; now?: () => number; log?: (line: string) => void;
  baseUrl?: string; timeoutMs?: number; cancelTimeoutMs?: number; pollMs?: number; fallback?: PriceSource; cacheMs?: number;
};

const TASK = 'Add this product, quantity 1, to the cart and go to checkout. Do not pay.';
const AED = /^\d+(\.\d{1,2})?$/;

// maxCost = recorded price + 20%, rounded up to the fil.
function maxCost(priceAed: string) {
  const [whole, fraction = ''] = priceAed.split('.');
  const fils = (BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'))) * 12n;
  const up = (fils + 9n) / 10n;
  return `${up / 100n}.${String(up % 100n).padStart(2, '0')}`;
}

export class CrossmintPriceSource implements PriceSource {
  private readonly fetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private readonly base: string;
  private readonly timeoutMs: number;
  private readonly pollMs: number;
  private readonly cancelTimeoutMs: number;
  private readonly fallback: PriceSource;
  private readonly key: string;
  private readonly cacheMs: number;
  // One check per product per window: each check is a paid Crossmint run, and /shop/quote needs no sign-in.
  // shortcut: in memory and unbounded per product id, fine for a fixed catalog of ~20; a restart checks again.
  private readonly cache = new Map<string, { at: number; result: Promise<PriceQuote> }>();
  constructor(options: CrossmintOptions) {
    if (!options.key) throw new Error('crossmint: missing key');
    this.key = options.key;
    this.fetch = options.fetch ?? fetch;
    this.sleep = options.sleep ?? (ms => new Promise(done => setTimeout(done, ms)));
    this.now = options.now ?? Date.now;
    this.log = options.log ?? console.warn;
    this.base = options.baseUrl ?? 'https://www.crossmint.com/api';
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.pollMs = options.pollMs ?? 4_000;
    this.cancelTimeoutMs = options.cancelTimeoutMs ?? 10_000;
    this.fallback = options.fallback ?? new RecordedPriceSource();
    this.cacheMs = options.cacheMs ?? 5 * 60_000;
  }

  // A fallback is cached too, so a product Crossmint blocks does not start a paid run on every quote. Quotes that arrive
  // while a check is still running share it.
  quote(product: Product): Promise<PriceQuote> {
    const cached = this.cache.get(product.id);
    if (cached && this.now() - cached.at < this.cacheMs) return cached.result;
    const result = this.check(product);
    this.cache.set(product.id, { at: this.now(), result });
    return result;
  }

  private async check(product: Product): Promise<PriceQuote> {
    try {
      return { priceAed: await this.liveTotal(product), source: 'live', checkedAt: new Date(this.now()).toISOString() };
    } catch (error) {
      this.log(`crossmint price check for ${product.id} failed, using the recorded price: ${String((error as Error)?.message ?? error).split(this.key).join('[key]')}`);
      return this.fallback.quote(product);
    }
  }

  private async call(path: string, method: 'GET' | 'POST', timeoutMs: number, body?: unknown): Promise<Record<string, any>> {
    const response = await this.fetch(`${this.base}${path}`, { method, signal: AbortSignal.timeout(Math.max(1, timeoutMs)), body: body === undefined ? undefined : JSON.stringify(body),
      headers: { 'X-API-KEY': this.key, 'x-crossmint-user-id': 'nest-price-check', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) } });
    if (!response.ok) throw new Error(`crossmint ${method} ${path.replace(/\/[0-9a-f-]{8,}/gi, '/{id}')}: HTTP ${response.status}`);
    const json = await response.json();
    if (!json || typeof json !== 'object') throw new Error('crossmint: unparseable response');
    return json as Record<string, any>;
  }

  private async liveTotal(product: Product): Promise<string> {
    const deadline = this.now() + this.timeoutMs;
    // Each request is aborted when the overall deadline passes, so one hung call can't stall the quote.
    const created = await this.call('/unstable/agent-checkouts', 'POST', this.timeoutMs, { request: { startUrl: product.url, task: TASK },
      constraints: { maxCost: { amount: maxCost(product.priceAed), currency: 'AED' } } });
    const id = created.runId;
    if (typeof id !== 'string' || !id) throw new Error('crossmint: no runId in the create response');
    let run = created, done = false;
    try {
      for (;;) {
        const interaction = run.requiredAction?.request?.interaction;
        if (run.status === 'awaiting_input' && interaction?.kind === 'payment') return this.total(interaction);
        if (['succeeded', 'blocked', 'failed', 'cancelled'].includes(run.status)) {
          done = true;
          throw new Error(`run ended as ${run.status}${run.result?.code ? ` (${run.result.code})` : ''} before the payment step`);
        }
        if (this.now() >= deadline) throw new Error('timed out before the payment step');
        await this.sleep(this.pollMs);
        run = await this.call(`/unstable/agent-checkouts/${encodeURIComponent(id)}`, 'GET', deadline - this.now());
      }
    } finally {
      // Never answer the payment request: cancel every run that is still open, also after a timeout or a poll error.
      if (!done) await this.call(`/unstable/agent-checkouts/${encodeURIComponent(id)}/cancel`, 'POST', this.cancelTimeoutMs)
        .catch(error => this.log(`crossmint cancel of run ${id} failed: ${String((error as Error)?.message ?? error).split(this.key).join('[key]')}`));
    }
  }

  private total(interaction: { amount?: { currency?: unknown; kind?: unknown; value?: unknown } }): string {
    const { currency, kind, value } = interaction.amount ?? {};
    if (currency !== 'AED' || kind !== 'exact' || typeof value !== 'string' || !AED.test(value)) throw new Error('payment total is not an exact AED amount');
    aedToMicro(value); // throws on zero
    return value;
  }
}

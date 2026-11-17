import type { Classifier } from './classifier.js';
import type { Execution } from './execution.js';
import { principal } from './money.js';
import type { EventStore, SavedEvent } from './store.js';

// The whole agent in one place: the model makes exactly one decision (which
// listed company, or none), and everything after it is plain code.
export class Pipeline {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly store: EventStore, private readonly classifier: Classifier,
    private readonly execution: Execution, private readonly companies: readonly string[]) {}

  // Events are handled one at a time, in arrival order.
  enqueue(event: SavedEvent): Promise<SavedEvent> {
    const run = this.queue.then(() => this.process(event));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async process(event: SavedEvent): Promise<SavedEvent> {
    this.store.update(event.id, { status: 'classifying' });
    let decision;
    try { decision = await this.classifier.classify(event.merchant); }
    catch {
      // Unusable model output is never read as "skip" and never as "buy".
      return this.store.update(event.id, { status: 'failed', reason: 'The model did not return a usable decision. Nothing was bought.' });
    }
    const detail = { company: decision.company, explanation: decision.explanation, classifySeconds: decision.seconds };
    if (decision.company === null) {
      return this.store.update(event.id, { status: 'skipped', reason: decision.explanation, detail });
    }
    if (this.store.paused()) {
      return this.store.update(event.id, { status: 'blocked', reason: 'Purchases are paused.', detail });
    }
    this.store.update(event.id, { status: 'buying', detail });
    let purchase;
    try {
      purchase = await this.execution.execute({ id: event.id, company: this.companies.indexOf(decision.company),
        amount: principal(event.amount, event.currency) });
    } catch (error) {
      // Thrown before anything was signed: budget, balance, or an unresolved earlier purchase.
      return this.store.update(event.id, { status: 'blocked', reason: error instanceof Error ? error.message : 'Refused before signing.' });
    }
    if (purchase.status === 'confirmed') {
      return this.store.update(event.id, { status: 'bought', detail: { transaction: String(purchase.evidence?.transaction ?? purchase.transaction),
        shares: purchase.shares!.toString(), purchaseStatus: purchase.status } });
    }
    return this.store.update(event.id, { status: 'uncertain', reason: purchase.reason ?? 'Outcome unknown.',
      detail: { transaction: purchase.transaction, purchaseStatus: purchase.status } });
  }
}

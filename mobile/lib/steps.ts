// Where an entry is in its run: decide on the phone, look up the merchant (only when the model said none), then buy.
// Drives the step bar in the entry sheet, so you can see which step the agent is on while it works.
import type { Entry } from './log';

export type StepState = 'done' | 'active' | 'pending' | 'failed' | 'skipped';
export type Steps = { decide: StepState; lookup: StepState; buy: StepState };

export function steps(entry: Entry): Steps {
  if ('order' in entry) return { decide: 'skipped', lookup: 'skipped', buy: entry.order.error !== undefined ? 'failed' : entry.order.state === 'done' ? 'done' : 'active' };
  if ('error' in entry) return { decide: 'failed', lookup: 'skipped', buy: 'skipped' };
  const { lookup, pay } = entry;
  const lookupState: StepState = entry.company !== null ? 'skipped'
    : !lookup ? (pay ? 'skipped' : 'active')
    : lookup.error !== undefined ? (lookup.error.startsWith('Not looked up') ? 'skipped' : 'failed')
    : lookup.state === 'done' ? 'done' : 'active';
  const buy: StepState = pay
    ? pay.error !== undefined ? (pay.error.startsWith('Nothing bought') ? 'skipped' : 'failed')
      : pay.state === 'bought' ? (pay.confirmed === false ? 'failed' : 'done') : 'active'
    : lookupState === 'active' ? 'pending'
    : lookupState === 'failed' || lookupState === 'skipped' && entry.company === null ? 'skipped'
    : 'active'; // decided or looked up, not yet signing: matching a category or about to buy
  return { decide: 'done', lookup: lookupState, buy };
}

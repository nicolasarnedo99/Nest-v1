// What a decision entry bought, for the entry sheet: the same company App.tsx paid (model, else lookup's listed parent, else category leader), and why.
import { shown } from './holdings';
import type { Lookup, Entry } from './log';

type Decision = Extract<Entry, { explanation: string }>;

export function boughtLine(entry: Decision): { title: string; reason: string } | null {
  const { pay, lookup, category } = entry;
  if (pay?.state !== 'bought' || pay.confirmed !== true) return null;
  const [company, reason] = entry.company ? [entry.company, 'named by the on-phone model']
    : lookup?.listedParent ? [lookup.listedParent, `owner of ${lookup.operator || entry.merchant}`]
    : category ? [category.leader, `leader of ${category.name}`]
    : [null, ''];
  if (!company) return null;
  return { title: `Bought ${pay.value !== undefined ? `${shown(pay.value)} of ` : ''}${company}`, reason };
}

// The lookup named the operator, so the small model's quoted guess (it misreads names) is noise.
export const showExplanation = (lookup?: Lookup) => !(lookup?.state === 'done' && !lookup.error && !!lookup.operator);

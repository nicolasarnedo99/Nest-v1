// When a merchant has no listed owner, Nest invests in the listed leader of the merchant's category instead.
// The category is found on the phone by meaning: the merchant (and the operator the paid lookup named) is embedded
// with a small model and compared with these descriptions. The match names no merchant; each leader must be listed
// on the seller contract (contracts/companies.json).

import type { InvestTarget } from './log';

export type Category = { name: string; leader: string; text: string };
export type CategoryMatch = { name: string; leader: string; score: number };

export const CATEGORIES: readonly Category[] = [
  { name: 'Groceries', leader: 'Walmart', text: 'A supermarket, hypermarket, grocery store or convenience shop selling food, snacks, drinks and household goods.' },
  { name: 'Food delivery and rides', leader: 'Uber', text: 'A food delivery app, restaurant delivery, ride hailing, taxi or courier service.' },
  { name: 'Online shopping', leader: 'Amazon', text: 'An online marketplace or e-commerce store selling many kinds of products shipped to your door.' },
  { name: 'Coffee', leader: 'Starbucks', text: 'A coffee shop, café or bakery serving coffee, tea and pastries.' },
  { name: 'Phones and computers', leader: 'Apple', text: 'An electronics store selling phones, laptops, tablets, headphones and accessories.' },
  { name: 'Search and online services', leader: 'Alphabet', text: 'Online advertising, web search, cloud storage, maps or video streaming subscriptions.' },
  { name: 'Software and games', leader: 'Microsoft', text: 'Software subscriptions, office apps, cloud computing, video game consoles and games.' },
  { name: 'Cars and charging', leader: 'Tesla', text: 'Electric car charging, a car dealer, car service or fuel station.' },
  { name: 'Graphics and AI hardware', leader: 'NVIDIA', text: 'Graphics cards, gaming PCs, AI computing hardware and GPU cloud services.' },
];

// shortcut: one threshold and margin for every category, tuned with EmbeddingGemma 300M on about 15 UAE and Spanish
// merchants (scores 0.42–0.59 when right, wrong guesses closer together); tune per category if matches drift.
export const MIN_SCORE = 0.4;
export const MIN_MARGIN = 0.05;

// EmbeddingGemma's prompt formats. What the paid lookup knows about the merchant outranks the on-phone model's guess:
// the small classifier's explanation is often wrong about regional brands (it called Careem a care home operator).
export const categoryDocument = (category: Category) => `title: ${category.name} | text: ${category.text}`;
export const categoryQuery = (merchant: string, lookup: { operator?: string | null; note?: string } | null, explanation: string) =>
  `task: classification | query: ${merchant}. ${lookup?.operator ? `Run by ${lookup.operator}.${lookup.note ? ` ${lookup.note}` : ''}` : explanation.replace(/^Unrelated\s+/i, '')}`;

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) throw new Error('categories: embeddings of different sizes');
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]!; }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

// The closest category, when it is close enough and clearly ahead of the next one; otherwise null and nothing is bought.
export function closestCategory(query: number[], texts: number[][], listed: readonly string[], min = MIN_SCORE, margin = MIN_MARGIN): CategoryMatch | null {
  if (texts.length !== CATEGORIES.length) throw new Error('categories: one embedding per category is needed');
  const ranked = CATEGORIES.map((category, i) => ({ category, score: cosine(query, texts[i]!) }))
    .filter(r => listed.includes(r.category.leader)).sort((a, b) => b.score - a.score);
  const [best, next] = ranked;
  if (!best || best.score < min || (next && best.score - next.score < margin)) return null;
  return { name: best.category.name, leader: best.category.leader, score: Math.round(best.score * 100) / 100 };
}

// What a Chat order invests in. The category model is unloaded while Chat is open, so it goes by fixed rule: a demo shop order → the online
// shopping leader; for Bitrefill, a gift card naming a listed company or its brand → that company; eSIM and top-up → the phones leader; any other card → the online shopping leader.
const leaderOf = (name: string): InvestTarget => ({ company: CATEGORIES.find(c => c.name === name)!.leader, reason: 'leader', of: name });
export const SHOP_TARGET: InvestTarget = leaderOf('Online shopping'); // the demo shop is not Amazon, so not 'owner'
const BRANDS: readonly [string, string][] = [['Apple', 'Apple'], ['iTunes', 'Apple'], ['Amazon', 'Amazon'], ['Google Play', 'Alphabet'], ['YouTube', 'Alphabet'],
  ['Xbox', 'Microsoft'], ['Microsoft', 'Microsoft'], ['Uber Eats', 'Uber'], ['Uber', 'Uber'], ['Starbucks', 'Starbucks'], ['Walmart', 'Walmart'],
  ['NVIDIA', 'NVIDIA'], ['GeForce', 'NVIDIA'], ['Tesla', 'Tesla']];

export function bitrefillTarget(item: { kind: 'giftcard' | 'esim' | 'topup'; name: string }): InvestTarget {
  if (item.kind !== 'giftcard') return leaderOf('Phones and computers');
  const brand = BRANDS.find(([b]) => new RegExp(`(^|[^\\p{L}\\p{N}])${b}(?![\\p{L}\\p{N}])`, 'iu').test(item.name)); // whole words: Applebee's is not Apple
  return brand ? { company: brand[1], reason: 'owner', of: brand[0] } : leaderOf('Online shopping');
}

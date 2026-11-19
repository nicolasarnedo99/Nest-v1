// The chat history: every message in the Chat tab, kept in a JSON file on the phone so it survives closing the app.
// It is a record only: the chat model does not read it back, and nothing here can pay.
import { parseProduct, type ShopProduct } from './shop';

export type ChatMessage = { id: number; from: 'you' | 'nest'; text: string; products?: ShopProduct[]; error?: boolean; voice?: boolean };

export const CHAT_LIMIT = 200; // shortcut: the file is rewritten whole and the oldest messages fall off, move to SQLite for a long history.
const UNREADABLE = 'The chat history was unreadable and was ignored';

// Rebuilds a message from only the fields it knows; anything malformed drops the message.
function clean(raw: unknown): ChatMessage | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'number' || !Number.isInteger(r.id) || (r.from !== 'you' && r.from !== 'nest') || typeof r.text !== 'string') return null;
  if ((r.error !== undefined && typeof r.error !== 'boolean') || (r.voice !== undefined && typeof r.voice !== 'boolean')) return null;
  let products: ShopProduct[] | undefined;
  if (r.products !== undefined) {
    if (!Array.isArray(r.products)) return null;
    try { products = r.products.map(parseProduct); } catch { return null; }
  }
  return { id: r.id, from: r.from, text: r.text, ...(products ? { products } : {}),
    ...(r.error !== undefined ? { error: r.error as boolean } : {}), ...(r.voice !== undefined ? { voice: r.voice as boolean } : {}) };
}

// A missing file is an empty chat. A corrupt one is also empty, but says so in `problem`.
export function parseChat(text: string | null): { messages: ChatMessage[]; problem?: string } {
  if (text === null) return { messages: [] };
  let list: unknown;
  try { list = JSON.parse(text); } catch { return { messages: [], problem: UNREADABLE }; }
  if (!Array.isArray(list)) return { messages: [], problem: UNREADABLE };
  const messages = list.map(clean).filter((m): m is ChatMessage => m !== null).slice(-CHAT_LIMIT);
  const dropped = Math.min(list.length, CHAT_LIMIT) - messages.length;
  return dropped > 0 ? { messages, problem: `${dropped} unreadable chat messages were dropped` } : { messages };
}

// Oldest first, as the chat shows them; only the newest CHAT_LIMIT are written.
export const saveChat = (messages: ChatMessage[]) => JSON.stringify(messages.slice(-CHAT_LIMIT));

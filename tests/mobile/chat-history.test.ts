import { describe, expect, it } from 'vitest';
import { CHAT_LIMIT, parseChat, saveChat, type ChatMessage } from '../../mobile/lib/chat-history.js';

const product = { id: 'airpods-4', title: 'Apple AirPods 4', url: 'https://www.amazon.ae/dp/B0DGHYPFGK', priceAed: '429.00', approxUsdt: '116.81416', verified: false, recordedAt: '2026-11-19' };
const said = (id: number, extra: Partial<ChatMessage> = {}): ChatMessage => ({ id, from: 'you', text: `message ${id}`, ...extra });

describe('chat history: kept on the phone, read back strictly', () => {
  it('round-trips typed and voice messages, replies, errors and product cards', () => {
    const messages: ChatMessage[] = [said(0, { voice: true }), { id: 1, from: 'nest', text: 'Here you go' }, { id: 2, from: 'nest', text: '', products: [product] },
      { id: 3, from: 'nest', text: 'Shop unavailable', error: true }];
    expect(parseChat(saveChat(messages))).toEqual({ messages });
  });

  it('treats a missing file as an empty chat', () => {
    expect(parseChat(null)).toEqual({ messages: [] });
  });

  it('ignores an unreadable file and says so', () => {
    expect(parseChat('{not json')).toEqual({ messages: [], problem: 'The chat history was unreadable and was ignored' });
    expect(parseChat('{"a":1}')).toEqual({ messages: [], problem: 'The chat history was unreadable and was ignored' });
  });

  it('drops malformed messages, including a bad product card, and counts them', () => {
    const text = JSON.stringify([said(0), { id: 1, from: 'stranger', text: 'x' }, { id: 2, from: 'nest', text: '', products: [{ ...product, verified: 'yes' }] }, said(3)]);
    expect(parseChat(text)).toEqual({ messages: [said(0), said(3)], problem: '2 unreadable chat messages were dropped' });
  });

  it('rebuilds messages from known fields only', () => {
    const text = JSON.stringify([{ ...said(0), secret: 'carried along?' }, { id: 1, from: 'nest', text: '', products: [{ ...product, extra: 1 }] }]);
    expect(JSON.stringify(parseChat(text).messages)).not.toMatch(/secret|extra/);
  });

  it(`keeps only the newest ${CHAT_LIMIT} messages`, () => {
    const many = Array.from({ length: CHAT_LIMIT + 7 }, (_, i) => said(i));
    const kept = parseChat(saveChat(many)).messages;
    expect(kept).toHaveLength(CHAT_LIMIT);
    expect(kept[0].id).toBe(7);
    expect(kept.at(-1)!.id).toBe(CHAT_LIMIT + 6);
  });
});

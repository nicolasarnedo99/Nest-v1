import { describe, expect, it } from 'vitest';
import { RECEIPT_LIMIT, cleanReceipt, receiptMessage, receiptPath } from '../../mobile/lib/receipt.js';
import { honest, type Intent } from '../../mobile/lib/chat.js';

describe('cleanReceipt: OCR text is untrusted, so it is bounded and plain before it reaches the prompt', () => {
  it('collapses whitespace and line breaks into single spaces', () => {
    expect(cleanReceipt('  Careem\n\n  Total\tAED  45.00 \r\n')).toBe('Careem Total AED 45.00');
  });

  it('strips control characters, which could break out of the prompt or the log', () => {
    expect(cleanReceipt('Care\u0000em\u001b[31m Total\u007f 45\u0085')).toBe('Care em [31m Total 45');
  });

  it(`keeps at most ${RECEIPT_LIMIT} characters, so a long receipt cannot fill the model's 1,024-token context`, () => {
    expect(cleanReceipt('x'.repeat(RECEIPT_LIMIT + 500))).toHaveLength(RECEIPT_LIMIT);
    const exact = 'y'.repeat(RECEIPT_LIMIT);
    expect(cleanReceipt(exact)).toBe(exact); // at the limit nothing is cut
  });

  it('keeps the top (the merchant) and the bottom (the total) of a long receipt, cutting the middle', () => {
    const cleaned = cleanReceipt(`CAREEM ${'item 1.00 '.repeat(200)}Total AED 45.00`);
    expect(cleaned.length).toBeLessThanOrEqual(RECEIPT_LIMIT);
    expect(cleaned.startsWith('CAREEM item')).toBe(true);
    expect(cleaned.endsWith('Total AED 45.00')).toBe(true);
    expect(cleaned).toContain(' … ');
  });

  it('turns nothing readable into an empty string', () => {
    expect(cleanReceipt(' \n\u0000\t ')).toBe('');
  });
});

describe('receiptMessage: the receipt goes through the chat model like a typed payment', () => {
  it('prefixes the cleaned text', () => {
    expect(receiptMessage('Careem\nTotal AED 45.00')).toBe('I paid this receipt:\nCareem Total AED 45.00');
  });

  it("lets honest() keep a merchant and amount that are on the receipt, and drop ones the model made up", () => {
    const message = receiptMessage('CAREEM\nRide to Marina\nTotal AED 45.00\nPaid with Apple Pay');
    const paid: Intent = { intent: 'paid', query: '', maxPrice: null, currency: null, merchant: 'Careem', amount: '45.00 AED', reply: '' };
    expect(honest(paid, message)).toMatchObject({ intent: 'paid', merchant: 'Careem', amount: '45.00 AED' });
    expect(honest({ ...paid, amount: '54 AED' }, message).intent).toBe('other'); // a misread amount not on the receipt
    expect(honest({ ...paid, merchant: 'NVIDIA' }, message).intent).toBe('other'); // a merchant not on the receipt
  });

  it('documents a limit: honest() accepts any number printed on the receipt as the amount, an order number included', () => {
    // honest() checks the amount is on the receipt, not that it is the total; the Confirm card is where the user catches it.
    const message = receiptMessage('CAREEM\nOrder 8812\nTotal AED 45.00');
    const paid: Intent = { intent: 'paid', query: '', maxPrice: null, currency: null, merchant: 'Careem', amount: '8812 AED', reply: '' };
    expect(honest(paid, message)).toMatchObject({ intent: 'paid', amount: '8812 AED' });
  });
});

describe('receiptPath: only images QVAC OCR can read reach it, as a plain file path', () => {
  it('drops file:// and decodes the path', () => {
    expect(receiptPath('file:///var/mobile/Containers/Data/My%20App/ImagePicker/A1.jpg')).toBe('/var/mobile/Containers/Data/My App/ImagePicker/A1.jpg');
    expect(receiptPath('/tmp/r.PNG')).toBe('/tmp/r.PNG');
    expect(receiptPath('file:///tmp/r.jpeg')).toBe('/tmp/r.jpeg');
    expect(receiptPath('file:///tmp/r.bmp')).toBe('/tmp/r.bmp');
  });

  it('refuses a format the OCR cannot decode, with a message the chat can show', () => {
    expect(() => receiptPath('file:///tmp/r.heic')).toThrow('That image is HEIC; Nest reads JPEG, PNG or BMP');
    expect(() => receiptPath('file:///tmp/receipt')).toThrow('That image has no file type; Nest reads JPEG, PNG or BMP');
  });
});

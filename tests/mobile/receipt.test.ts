import { describe, expect, it } from 'vitest';
import { RECEIPT_LIMIT, cleanReceipt, receiptIntent, receiptMessage, receiptPath } from '../../mobile/lib/receipt.js';
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

// QVAC OCR's text of a Wio bank transaction screenshot (20 Nov 2026): the minus of "-96.60 AED" reads as "~".
const WIO = "8:35\n28\nRestaurant\n:areem\nCareem\n~96.60 AED\nDate\n20 November; 11.39.03\nTransaction status\nCompleted\nReference number\nP4110059647\nCard number\n531780******4461\nCategory\nRESTAURANT\nCountry of payment\nUnited Arab Emirates\nMerchant name\nCareem\nSettlement date\n20 November, 20.05.21\nSource of funds\nMy money\nAED account\nWallet type\nApple\nPay\nReport an issue";
// A screenshot of Nest's own chat: a price on screen, but no payment.
const NEST_CHAT = "8:35\nSpalding Triple Threat\nrubber basketball \nsize 7\nAED 41.14 ~ 11.20 USDFO\nrecorded price, Amazon.ae,\n2026-11-19\nBuy\nBitrefill (live)\nMajor League Baseball AE\nGift card\nAE\nlive price on\nBuy\nBuy\nReceipt photo\nCould not read the receipt:\nStepDetectionlnference:\nggml_gallocr_alloc_graph failed\nReceipt photo\nCould not read the receipt:\nStepDetectionlnference:\nggml_gallocr_alloc_graph failed\nNothing bought\nCarrefour Market\n1 h ago\nFind me\nor hold the mic t";

describe('receiptIntent: code reads a labelled payment, because the 2B drops cents (96.60 comes back 96)', () => {
  it('reads the Wio screenshot as 96.60 AED at Careem, the labelled merchant, not Apple from "Apple Pay"', () => {
    expect(receiptIntent(WIO)).toMatchObject({ intent: 'paid', merchant: 'Careem', amount: '96.60 AED', reply: 'Note 96.60 AED at Careem?' });
  });

  it('reads the currency on either side and a minus read as a dash', () => {
    expect(receiptIntent('Merchant name\nCareem\n\u2014 AED 1,096.60')).toMatchObject({ merchant: 'Careem', amount: '1,096.60 AED' });
  });

  it('leaves anything without a labelled merchant or an amount-only line to the model', () => {
    expect(receiptIntent(NEST_CHAT)).toBeNull(); // "AED 41.14 ~ 11.20 USDFO" is not a lone amount, and no merchant label
    expect(receiptIntent(WIO.replace('Merchant name', 'Name'))).toBeNull();
    expect(receiptIntent('Merchant name\nCareem\n96.60')).toBeNull(); // no currency
    expect(receiptIntent('Merchant name\nCareem\nAED 96.60 USD')).toBeNull(); // two currencies
  });

  it('keeps the trust-boundary checks: a merchant line too long for parseIntent is refused', () => {
    expect(receiptIntent(`Merchant name\n${'x'.repeat(81)}\n96.60 AED`)).toBeNull();
  });
});

describe('receiptPath: only images the receipt reader takes reach it, as a plain file path', () => {
  it('drops file:// and decodes the path', () => {
    expect(receiptPath('file:///var/mobile/Containers/Data/My%20App/ImagePicker/A1.jpg')).toBe('/var/mobile/Containers/Data/My App/ImagePicker/A1.jpg');
    expect(receiptPath('/tmp/r.PNG')).toBe('/tmp/r.PNG');
    expect(receiptPath('file:///tmp/r.jpeg')).toBe('/tmp/r.jpeg');
  });

  it('refuses a format the OCR cannot decode, with a message the chat can show', () => {
    expect(() => receiptPath('file:///tmp/r.heic')).toThrow('That image is HEIC; Nest reads JPEG or PNG');
    expect(() => receiptPath('file:///tmp/r.bmp')).toThrow('That image is BMP; Nest reads JPEG or PNG'); // the reader takes JPEG and PNG only
    expect(() => receiptPath('file:///tmp/receipt')).toThrow('That image has no file type; Nest reads JPEG or PNG');
  });
});

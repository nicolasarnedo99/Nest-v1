// The receipt button next to the mic: a screenshot of an in-app receipt (Apple Pay inside apps never fires the Wallet
// automation) or a photo of a paper one, read by QVAC OCR on Nest's server. A labelled payment is read by code, anything
// else by the chat model like a typed "I paid 45 AED at Careem"; honest() checks both and only Confirm on the card notes it.
// The chat history keeps "Receipt photo" and the reply; never the image or the receipt's text.
import { ActionSheetIOS, Pressable, StyleSheet } from 'react-native';
import { launchCameraAsync, launchImageLibraryAsync, requestCameraPermissionsAsync, UIImagePickerPreferredAssetRepresentationMode } from 'expo-image-picker';
import { ReceiptIcon } from '../ui/icons';
import { color } from '../ui/theme';
import { cleanReceipt, receiptIntent, receiptMessage, receiptPath } from '../lib/receipt';
import { receiptContentType } from '../lib/ocr-remote';
import type { Intent } from '../lib/chat';
import type { ChatMessage } from '../lib/chat-history';

export const READING_RECEIPT = 'Reading the receipt…';
const WHERE_READ = "The image is read by Nest's receipt reader (QVAC OCR on Nest's server) and not stored.";
const NOT_FOUND = "I couldn't find a merchant and amount on that receipt. You can type it instead.";
const text = (error: unknown) => error instanceof Error ? error.message : String(error);

export function ReceiptButton({ disabled, read, ask, add, setBusy, note }: {
  disabled: boolean;
  read(uri: string, contentType: string): Promise<string>; // the image's bytes go to the receipt reader, its text comes back
  ask(message: string): Promise<Intent>;
  add(message: Omit<ChatMessage, 'id'>): void;
  setBusy(busy: boolean): void; // holds the chat (send, mic) and shows READING_RECEIPT
  note(payment: { merchant: string; amount: string } | null): void; // the Confirm card
}) {
  const fromPicker = async (camera: boolean) => {
    let uri: string;
    try {
      if (camera && !(await requestCameraPermissionsAsync()).granted) {
        add({ from: 'nest', text: 'Camera access is off. Turn it on in Settings, or choose a photo instead.', error: true }); return;
      }
      // Compatible: Photos hands over a JPEG instead of a HEIC, which the OCR cannot decode.
      const picked = await (camera ? launchCameraAsync : launchImageLibraryAsync)({ mediaTypes: ['images'], quality: 1,
        preferredAssetRepresentationMode: UIImagePickerPreferredAssetRepresentationMode.Compatible });
      if (picked.canceled || !picked.assets[0]) return; // cancelled: nothing happens
      uri = picked.assets[0].uri;
    } catch (error) { add({ from: 'nest', text: `Could not open the ${camera ? 'camera' : 'photos'}: ${text(error)}`, error: true }); return; }
    note(null);
    add({ from: 'you', text: 'Receipt photo' });
    setBusy(true);
    try {
      let found: string;
      try { found = await read(uri, receiptContentType(receiptPath(uri))); }
      catch (error) { add({ from: 'nest', text: `Could not read the receipt: ${text(error)}`, error: true }); return; }
      if (!cleanReceipt(found)) { add({ from: 'nest', text: NOT_FOUND }); return; } // no text on the image
      const intent = receiptIntent(found) ?? await ask(receiptMessage(found));
      if (intent.intent !== 'paid') { add({ from: 'nest', text: NOT_FOUND }); return; }
      add({ from: 'nest', text: intent.reply });
      note({ merchant: intent.merchant, amount: intent.amount });
    } catch (error) { add({ from: 'nest', text: `The model failed: ${text(error)}`, error: true }); }
    finally { setBusy(false); }
  };

  // Nest is an iPhone app, so the two choices are the system action sheet.
  const choose = () => ActionSheetIOS.showActionSheetWithOptions(
    { options: ['Choose from Photos', 'Take a photo', 'Cancel'], cancelButtonIndex: 2, message: WHERE_READ },
    index => { if (index === 0 || index === 1) void fromPicker(index === 1); });

  return (
    <Pressable style={[s.button, disabled && s.off]} disabled={disabled} onPress={choose}
      accessibilityRole="button" accessibilityLabel="Read a receipt">
      <ReceiptIcon size={22} tint={color.primary} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  button: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: color.hairline, backgroundColor: color.panel },
  off: { opacity: 0.4 },
});

// A receipt, from a double tap on the chat: a screenshot of an in-app receipt (Apple Pay inside apps never fires the Wallet
// automation) or a photo of a paper one, read by QVAC OCR on Nest's server. A labelled payment is read by code, anything
// else by the chat model like a typed "I paid 45 AED at Careem"; honest() checks both and only Confirm on the card notes it.
// The chat history keeps "Receipt photo" and the reply; never the image or the receipt's text.
import { useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { DIM, tourText } from './Tour'; // the first-run walkthrough's hint
import { launchCameraAsync, launchImageLibraryAsync, requestCameraPermissionsAsync, UIImagePickerPreferredAssetRepresentationMode } from 'expo-image-picker';
import { cleanReceipt, receiptIntent, receiptMessage, receiptPath } from '../lib/receipt';
import { receiptContentType } from '../lib/ocr-remote';
import type { Intent } from '../lib/chat';
import type { ChatMessage } from '../lib/chat-history';
import { color, radius, space, type } from '../ui/theme';

export const READING_RECEIPT = 'Reading the receipt…';
const NOT_FOUND = "I couldn't find a merchant and amount on that receipt. You can type it instead.";
const text = (error: unknown) => error instanceof Error ? error.message : String(error);

// Returns what a double tap calls, and the sheet it opens (render it once in the chat): choose a photo or take one, then
// reading it into the invest question. Our own sheet, not the system one, because iOS closes an action sheet on a tap outside
// only when it has a Cancel button.
export function useReceipt({ read, ask, add, setBusy, note, hint, onOpenChange }: {
  read(uri: string, contentType: string): Promise<string>; // the image's bytes go to the receipt reader, its text comes back
  ask(message: string): Promise<Intent>;
  add(message: Omit<ChatMessage, 'id'>): void;
  setBusy(busy: boolean): void; // holds the chat (send, mic) and shows READING_RECEIPT
  note(payment: { merchant: string; amount: string } | null): void; // the Confirm card
  hint?: string; onOpenChange?(open: boolean): void; // the first-run walkthrough
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
      note({ merchant: intent.merchant, amount: intent.amount }); // the invest question is the only reply
    } catch (error) { add({ from: 'nest', text: `The model failed: ${text(error)}`, error: true }); }
    finally { setBusy(false); }
  };

  const [open, setOpenState] = useState(false);
  const setOpen = (next: boolean) => { setOpenState(next); onOpenChange?.(next); };
  const picked = useRef<boolean | null>(null); // camera or photos, opened once the sheet has gone: iOS will not present over a closing sheet
  const pick = (camera: boolean) => { picked.current = camera; setOpen(false); };
  const sheet = (
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}
      onDismiss={() => { const camera = picked.current; picked.current = null; if (camera !== null) void fromPicker(camera); }}>
      <Pressable style={[s.backdrop, hint ? { backgroundColor: DIM } : null]} onPress={() => setOpen(false)} accessibilityLabel="Close">
        {hint && <View style={s.hintLayer} pointerEvents="none"><Text style={tourText}>{hint}</Text></View>}
        <Pressable style={s.card} onPress={() => undefined}>{/* a tap on the card itself does not close it */}
          <Text style={s.title}>Upload your receipt</Text>
          <Pressable accessibilityRole="button" style={s.option} onPress={() => pick(false)}><Text style={s.optionText}>Choose from Photos</Text></Pressable>
          <Pressable accessibilityRole="button" style={s.option} onPress={() => pick(true)}><Text style={s.optionText}>Take a photo</Text></Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
  return [() => setOpen(true), sheet] as const;
}

const s = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', padding: space.screen, paddingBottom: 40, backgroundColor: 'rgba(0,0,0,0.25)' },
  hintLayer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, justifyContent: 'center', alignItems: 'center' },
  card: { borderRadius: radius.card, backgroundColor: color.bg, overflow: 'hidden' },
  title: { fontSize: type.small, color: color.muted, textAlign: 'center', paddingVertical: 14 },
  option: { paddingVertical: 16, borderTopWidth: 1, borderTopColor: color.hairline },
  optionText: { fontSize: 17, color: color.text, textAlign: 'center' },
});

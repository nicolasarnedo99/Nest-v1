// The Chat tab: type what you want, the chat model reads it into a search, and the demo shop's products show as cards.
// The model only reads the message: a payment starts only from Buy, then Confirm in the order sheet.
import { useEffect, useRef, useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type ScrollViewInstance } from 'react-native';
import { AudioQuality, IOSOutputFormat, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, type RecordingOptions } from 'expo-audio';
import { Button, Card, Title } from '../ui/kit';
import { color, radius, space, type } from '../ui/theme';
import { money } from '../lib/holdings';
import { quoteShop, searchShop, type ShopProduct, type ShopQuote } from '../lib/shop';
import { maxAedFor, type Intent } from '../lib/chat';
import type { ChatMessage as Message } from '../lib/chat-history';

export type ChatModel = { state: 'loading' } | { state: 'ready' } | { state: 'error'; message: string };
export type Voice = { state: 'loading'; percent: number | null } | { state: 'ready' } | { state: 'error'; message: string };

// 16 kHz mono 16-bit WAV, the input Whisper expects.
const WAV: RecordingOptions = { extension: '.wav', sampleRate: 16000, numberOfChannels: 1, bitRate: 256000,
  ios: { outputFormat: IOSOutputFormat.LINEARPCM, audioQuality: AudioQuality.MAX, linearPCMBitDepth: 16, linearPCMIsBigEndian: false, linearPCMIsFloat: false },
  android: { outputFormat: 'default', audioEncoder: 'default' }, web: {} };
const MAX_VOICE_MS = 60_000;
const MIN_VOICE_MS = 600;
export type ShopAgent = { endpoint: string; wallet: string };
export type Ordered = { amount: string; transaction: string | null } | { error: string; expired: boolean; mayBePaid?: boolean };
export const EXPIRED = 'That price expired, get a new quote';

type Sheet = { product: ShopProduct; notice?: string } & (
  { state: 'quoting' } | { state: 'confirm' | 'ordering'; agent: ShopAgent; quote: ShopQuote } |
  { state: 'done'; quote: ShopQuote; amount: string; transaction: string | null } | { state: 'error'; error: string; mayBePaid?: boolean });

const text = (error: unknown) => error instanceof Error ? error.message : String(error);
const voiceHint = (voice: Voice) => voice.state === 'ready' ? 'Find me… or hold 🎙 to talk'
  : voice.state === 'loading' ? `Find me…  (voice ${voice.percent === null ? 'loading' : `downloading ${voice.percent}%`})`
  : 'Find me…  (voice unavailable)';

export function Chat({ model, loadHistory, saveHistory, ask, voice, hear, shop, order, shopped }: {
  model: ChatModel; loadHistory(): Message[]; saveHistory(messages: Message[]): void; ask(message: string): Promise<Intent>; voice: Voice; hear(path: string): Promise<string>; shop(): Promise<ShopAgent>;
  order(agent: ShopAgent, title: string, quote: ShopQuote): Promise<Ordered>; shopped: bigint | null;
}) {
  const [messages, setMessages] = useState<Message[]>(loadHistory);
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const nextId = useRef(messages.reduce((top, m) => Math.max(top, m.id + 1), 0));
  const confirming = useRef(false); // two quick taps can both pass the state check before the re-render
  const list = useRef<ScrollViewInstance>(null);
  const add = (message: Omit<Message, 'id'>) => setMessages(all => [...all, { id: nextId.current++, ...message }]);
  useEffect(() => saveHistory(messages), [messages]); // every change is written, so a force-quit keeps the conversation

  const send = async (spoken?: string) => {
    const message = (spoken ?? draft).trim();
    if (!message || thinking || model.state !== 'ready') return;
    if (spoken === undefined) setDraft('');
    add({ from: 'you', text: message, voice: spoken !== undefined }); setThinking(true);
    try {
      const intent = await ask(message);
      add({ from: 'nest', text: intent.reply });
      if (intent.intent === 'search' && intent.query.trim()) {
        try {
          const agent = await shop();
          const products = (await searchShop(agent.endpoint, intent.query, maxAedFor(intent))).slice(0, 5);
          add(products.length ? { from: 'nest', text: '', products } : { from: 'nest', text: 'Nothing in the demo shop matches that.' });
        } catch (error) { add({ from: 'nest', text: `Shop unavailable: ${text(error)}. Nothing was paid.`, error: true }); }
      }
    } catch (error) { add({ from: 'nest', text: `The chat model failed: ${text(error)}`, error: true }); }
    finally { setThinking(false); }
  };

  // A voice message: hold to record, release to send. Whisper turns it into text on the phone, and the text goes through `send`
  // like a typed message, so a voice message can never pay either.
  const recorder = useAudioRecorder(WAV);
  const [recording, setRecording] = useState<number | null>(null); // when recording started
  const [hearingNow, setHearingNow] = useState(false);
  const held = useRef(false);
  const voiceBusy = useRef(false); // one voice message at a time, from the first press until it is sent or dropped
  const startedAt = useRef<number | null>(null); // a ref, so the 60 s timer's stop sees it
  const limit = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idle = () => setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
  // Leaving the tab mid-recording: stop the timer and give the microphone back.
  useEffect(() => () => { if (limit.current) clearTimeout(limit.current); void idle(); }, []);
  const startVoice = async () => {
    if (voice.state !== 'ready' || thinking || voiceBusy.current) return;
    voiceBusy.current = true; held.current = true;
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) { add({ from: 'nest', text: "Microphone access is off. Turn it on in Settings, or use the keyboard's dictation.", error: true }); voiceBusy.current = false; return; }
      if (!held.current) { voiceBusy.current = false; return; } // released while the permission prompt was up
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      if (!held.current) { await idle(); voiceBusy.current = false; return; } // released while preparing
      recorder.record();
      startedAt.current = Date.now();
      setRecording(startedAt.current);
      limit.current = setTimeout(() => void stopVoice(), MAX_VOICE_MS);
    } catch (error) { await idle(); voiceBusy.current = false; add({ from: 'nest', text: `Recording failed: ${text(error)}`, error: true }); }
  };
  const stopVoice = async () => {
    held.current = false;
    if (limit.current) { clearTimeout(limit.current); limit.current = null; }
    const started = startedAt.current;
    if (started === null) return;
    startedAt.current = null;
    setHearingNow(true); // before the stop, so the mic stays off until this message is done
    setRecording(null);
    try {
      try { await recorder.stop(); } finally { await idle(); }
      if (Date.now() - started < MIN_VOICE_MS) { add({ from: 'nest', text: 'Hold the mic while you talk, then let go to send.' }); return; }
      if (!recorder.uri) throw new Error('no recording file');
      const heard = await hear(recorder.uri);
      if (!heard) { add({ from: 'nest', text: "Didn't catch that, hold and try again." }); return; }
      setHearingNow(false);
      await send(heard);
    } catch (error) { add({ from: 'nest', text: `Voice message failed: ${text(error)}`, error: true }); }
    finally { setHearingNow(false); voiceBusy.current = false; }
  };

  // A fresh quote each time: the price may have changed, and a quote can be used once.
  const getQuote = async (product: ShopProduct, notice?: string) => {
    setSheet({ product, notice, state: 'quoting' });
    try {
      const agent = await shop();
      const quote = await quoteShop(agent.endpoint, product.id);
      setSheet({ product, notice, state: 'confirm', agent, quote });
    } catch (error) {
      setSheet({ product, state: 'error', error: text(error) === 'Shop answered 409' ? EXPIRED : `Could not get a price: ${text(error)}. Nothing was paid.` });
    }
  };

  const confirm = async () => {
    if (sheet?.state !== 'confirm' || confirming.current) return;
    confirming.current = true;
    const { product, agent, quote } = sheet;
    setSheet({ product, state: 'ordering', agent, quote });
    try {
      const result = await order(agent, product.title, quote);
      if ('error' in result) {
        if (result.expired) await getQuote(product, EXPIRED);
        else setSheet({ product, state: 'error', error: result.error, mayBePaid: result.mayBePaid });
      } else setSheet({ product, state: 'done', quote, ...result });
    } finally { confirming.current = false; }
  };

  if (model.state !== 'ready') return (
    <View style={s.screen}>
      <Title>Chat</Title>
      {model.state === 'loading'
        ? <Text style={s.muted}>Loading the chat model…</Text>
        : <>
            <Text style={s.error}>Could not load the chat model: {model.message}</Text>
          </>}
    </View>
  );

  return (
    <View style={s.screen}>
      <Title>Chat</Title>
      <ScrollView ref={list} style={s.list} contentContainerStyle={s.messages} keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}>
        {messages.length === 0 && <Text style={s.muted}>Hold 🎙 and ask for something, or type it, for example "find me headphones under 300 dirhams". Your voice is turned into text on this iPhone. Orders are demo orders, not shipped.</Text>}
        {messages.map(m => m.products
          ? m.products.map(p => <ProductCard key={`${m.id}-${p.id}`} product={p} onBuy={() => void getQuote(p)} disabled={sheet !== null} />)
          : <View key={m.id} style={[s.bubble, m.from === 'you' ? s.you : s.nest]}>
              {m.voice && <Text style={s.voiceLabel}>🎙 Voice message</Text>}
              <Text style={[s.bubbleText, m.from === 'you' && s.youText, m.error && s.error]}>{m.text}</Text>
            </View>)}
        {hearingNow && <Text style={s.muted}>Turning your voice message into text…</Text>}
        {thinking && <Text style={s.muted}>Reading your message…</Text>}
      </ScrollView>
      <View style={s.compose}>
        {recording !== null
          ? <Text style={[s.input, s.recording]}>Recording… let go to send</Text>
          : <TextInput style={s.input} value={draft} onChangeText={setDraft} placeholder={voiceHint(voice)} placeholderTextColor={color.tabOff}
              editable={!thinking && !hearingNow} returnKeyType="send" onSubmitEditing={() => void send()} />}
        {draft.trim()
          ? <View style={s.send}><Button title="Send" disabled={thinking} onPress={() => void send()} /></View>
          : <Pressable style={[s.mic, recording !== null && s.micOn, (voice.state !== 'ready' || thinking || hearingNow) && s.off]}
              disabled={voice.state !== 'ready' || thinking || hearingNow} onPressIn={() => void startVoice()} onPressOut={() => void stopVoice()}
              accessibilityRole="button" accessibilityLabel="Hold to record a voice message">
              <Text style={s.micText}>🎙</Text>
            </Pressable>}
      </View>
      {sheet && <OrderSheet sheet={sheet} shopped={shopped} onConfirm={() => void confirm()} onRequote={() => void getQuote(sheet.product)}
        onClose={() => setSheet(null)} />}
    </View>
  );
}

function ProductCard({ product, onBuy, disabled }: { product: ShopProduct; onBuy(): void; disabled: boolean }) {
  return (
    <Card style={s.product}>
      <Text style={s.title}>{product.title}</Text>
      <Text style={s.price}>AED {product.priceAed} <Text style={s.muted}>≈ {Number(product.approxUsdt).toFixed(2)} USD₮0</Text></Text>
      <Text style={s.muted}>{product.verified ? `recorded price, Amazon.ae, ${product.recordedAt}` : 'sample price'}</Text>
      <Button kind="secondary" title="Buy" disabled={disabled} onPress={onBuy} />
    </Card>
  );
}

const source = ({ source, checkedAt }: ShopQuote['quote']) =>
  source === 'live' ? 'checked at Amazon.ae in the last 5 minutes' : source === 'sample' ? 'sample price' : `recorded price, Amazon.ae, ${checkedAt}`;

function OrderSheet({ sheet, shopped, onConfirm, onRequote, onClose }: {
  sheet: Sheet; shopped: bigint | null; onConfirm(): void; onRequote(): void; onClose(): void;
}) {
  const ordering = sheet.state === 'ordering';
  const quote = 'quote' in sheet ? sheet.quote.quote : null;
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={() => { if (!ordering) onClose(); }}>
      <ScrollView style={s.sheet} contentContainerStyle={s.sheetBody}>
        <Text style={s.label}>{sheet.state === 'done' ? 'ORDERED' : 'CONFIRM ORDER'}</Text>
        <Text style={s.heading}>{sheet.product.title}</Text>
        {sheet.notice && <Text style={s.error}>{sheet.notice}</Text>}
        {sheet.state === 'quoting' && <Text style={s.muted}>Getting the price…</Text>}
        {quote && <Card style={s.step}>
          <Text style={s.total}>{money(BigInt(quote.amount))} USD₮0</Text>
          <Text style={s.muted}>AED {quote.priceAed} at 3.6725 AED = 1 USD₮0</Text>
          <Text style={s.muted}>{source(quote)}</Text>
          <Text style={s.muted}>Demo order, not shipped</Text>
          {sheet.state !== 'done' && <Text style={s.muted}>Today: {shopped === null ? 'unavailable' : money(shopped)} of 200 shopping limit</Text>}
        </Card>}
        {sheet.state === 'done' && (sheet.transaction
          ? <Text style={s.link} onPress={() => void Linking.openURL(`https://sepolia.etherscan.io/tx/${sheet.transaction}`)}>
              Paid {money(BigInt(sheet.amount))} USD₮0 over x402 · view on Etherscan</Text>
          : <Text style={s.muted}>Paid {money(BigInt(sheet.amount))} USD₮0 over x402</Text>)}
        {sheet.state === 'error' && <Text style={s.error}>{sheet.error}</Text>}
        {(sheet.state === 'confirm' || ordering) && <>
          <Button title={ordering ? 'Paying…' : 'Confirm'} disabled={ordering} onPress={onConfirm} />
          <Button kind="secondary" title="Cancel" disabled={ordering} onPress={onClose} />
        </>}
        {sheet.state === 'error' && <>
          {!sheet.mayBePaid && <Button title="Get a new quote" onPress={onRequote} />}
          <Button kind="secondary" title="Close" onPress={onClose} />
        </>}
        {(sheet.state === 'done' || sheet.state === 'quoting') && <Button kind="secondary" title={sheet.state === 'done' ? 'Done' : 'Cancel'} onPress={onClose} />}
      </ScrollView>
    </Modal>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg, paddingTop: 60, paddingHorizontal: space.screen, gap: space.gap },
  list: { flex: 1 },
  messages: { gap: 10, paddingBottom: 12 },
  bubble: { maxWidth: '85%', borderRadius: radius.card, paddingVertical: 10, paddingHorizontal: 14 },
  you: { alignSelf: 'flex-end', backgroundColor: color.primary },
  nest: { alignSelf: 'flex-start', backgroundColor: color.panel },
  bubbleText: { fontSize: type.body, color: color.text },
  youText: { color: color.onPrimary },
  product: { padding: 16, gap: 6 },
  title: { fontSize: type.body, fontWeight: '600', color: color.text },
  price: { fontSize: 17, fontWeight: '700', color: color.text },
  compose: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 12 },
  input: { flex: 1, borderWidth: 1, borderColor: color.hairline, borderRadius: 12, padding: 12, fontSize: 16, color: color.text, backgroundColor: color.panel },
  send: { width: 88 },
  mic: { width: 52, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: color.primary },
  micOn: { backgroundColor: color.error },
  micText: { fontSize: 22 },
  off: { opacity: 0.4 },
  recording: { color: color.error, fontWeight: '600' },
  voiceLabel: { fontSize: type.tiny, color: color.onPrimary, opacity: 0.8, marginBottom: 2 },
  sheet: { flex: 1, backgroundColor: color.bg },
  sheetBody: { padding: space.screen, paddingBottom: 30, gap: space.gap },
  label: { fontSize: type.tiny, fontWeight: '600', color: color.muted, letterSpacing: 0.4 },
  heading: { fontSize: type.heading, fontWeight: '800', letterSpacing: -0.4, color: color.text },
  step: { padding: 16, gap: 4 },
  total: { fontSize: 28, fontWeight: '800', color: color.text },
  muted: { fontSize: type.small, color: color.muted },
  error: { fontSize: type.small, color: color.error },
  link: { fontSize: type.small, fontWeight: '600', color: color.text, textDecorationLine: 'underline' },
});

// The chat, Nest's one screen: type what you want, the on-device model reads it into a search, and the demo shop's products and Bitrefill's show as cards.
// The model only reads the message: a payment starts only from Buy, then Confirm in the order sheet,
// and a payment the user already made ("I paid 45 AED at Careem") is noted only from Yes on its question.
// After Confirm or Yes the payment runs in a message with a ring around it, read from its activity entry.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type ScrollViewInstance } from 'react-native';
import { AudioQuality, IOSOutputFormat, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, type RecordingOptions } from 'expo-audio';
import { Button, Card } from '../ui/kit';
import { MicIcon } from '../ui/icons';
import { color, radius, space, type } from '../ui/theme';
import { money } from '../lib/holdings';
import { quoteShop, searchShop, type ShopProduct, type ShopQuote } from '../lib/shop';
import { maxAedFor, type Intent } from '../lib/chat';
import { bitrefillKind, type BitrefillItem, type BitrefillSession } from '../lib/bitrefill';
import { bitrefillSearches, packageLabel, quoteMirror, type MirrorQuote } from '../lib/mirror';
import type { ChatMessage as Message } from '../lib/chat-history';
import type { Entry } from '../lib/log';
import type { Strategies } from '../lib/settings';
import { amountFor } from '../lib/strategy';
import { askLine, ring, shareLine } from '../lib/ring';
import { wouldPayLine, type Paying } from '../lib/steps';
import { RunMessage } from './RunMessage';
import { READING_RECEIPT, useReceipt } from './Receipt'; // receipt OCR

// The on-device chat model: the chat waits for it to load.
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
  { state: 'quoting' } | { state: 'confirm'; agent: ShopAgent; quote: ShopQuote } | { state: 'error'; error: string });

// A Bitrefill item: packages from detail on Buy, a quote from the mirror, then the mirror order.
type Package = BitrefillItem['packages'][number];
type BSheet = { item: BitrefillItem; packages: Package[]; chosen: number; notice?: string } & (
  { state: 'loading' | 'pick' | 'quoting' } | { state: 'confirm'; agent: ShopAgent; quote: MirrorQuote } | { state: 'error'; error: string });
const KIND = { giftcard: 'Gift card', esim: 'eSIM', topup: 'Top-up' } as const;
const NOT_ISSUED = 'Demo purchase on Sepolia · the card is not issued';
const NOT_REGISTERED = 'Bitrefill seller not registered yet';

const text = (error: unknown) => error instanceof Error ? error.message : String(error);
const voiceHint = (voice: Voice) => voice.state === 'ready' ? 'Ask Nest…'
  : voice.state === 'loading' ? `Ask Nest…  (voice ${voice.percent === null ? 'loading' : `${voice.percent}%`})`
  : 'Ask Nest…  (no voice)';
const DOUBLE_TAP_MS = 300;

type Started = (at: number) => void; // the `at` of the activity entry a payment wrote
const ignore = (_paying: Paying) => undefined; // the ring reads the entry, not the live x402 steps

export function Chat({ model, loadHistory, saveHistory, ask, voice, hear, shop, order, bitrefill, mirror, orderMirror, notePayment, readReceipt, header,
  entries, strategies, retryBuy, openEntry }: { // receipt OCR: readReceipt
  model: ChatModel; loadHistory(): Message[]; saveHistory(messages: Message[]): void; ask(message: string): Promise<Intent>; voice: Voice; hear(path: string): Promise<string>; shop(): Promise<ShopAgent>;
  order(agent: ShopAgent, title: string, quote: ShopQuote, progress: (paying: Paying) => void, onStart: Started): Promise<Ordered>;
  bitrefill: (() => BitrefillSession) | null; mirror(): Promise<ShopAgent>; orderMirror(agent: ShopAgent, quote: MirrorQuote, progress: (paying: Paying) => void, onStart: Started): Promise<Ordered>;
  notePayment(merchant: string, amount: string, onStart: Started): boolean;
  entries: Entry[]; strategies: Strategies; retryBuy(at: number): boolean; openEntry(at: number): void;
  readReceipt(uri: string, contentType: string): Promise<string>; // receipt OCR: read by the receipt reader on Nest's server
  header: ReactNode; // the screen's top: the mark and the wheel
}) {
  // A payment that never started before the app closed has no entry to follow: it is shown as interrupted, without a ring.
  const [messages, setMessages] = useState<Message[]>(() => loadHistory().map(m => m.run && m.run.at === undefined
    ? { id: m.id, from: m.from, text: `${m.text} · interrupted`, error: true } : m));
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const [receipt, setReceipt] = useState(false); // receipt OCR: the thinking line reads READING_RECEIPT
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [bsheet, setBsheet] = useState<BSheet | null>(null);
  const [noting, setNoting] = useState<{ merchant: string; amount: string } | null>(null); // a payment the user said they made, until Confirm or Cancel
  const live = useRef(new Set<number>()); // payment messages started in this launch: until their entry is written they spin
  const requote = useRef(new Map<number, () => void>()); // an order's Try again opens a fresh quote; kept for this launch only
  const nextId = useRef(messages.reduce((top, m) => Math.max(top, m.id + 1), 0));
  const confirming = useRef(false); // two quick taps can both pass the state check before the re-render
  const list = useRef<ScrollViewInstance>(null);
  const add = (message: Omit<Message, 'id'>) => setMessages(all => [...all, { id: nextId.current++, ...message }]);
  const patch = (id: number, change: (m: Message) => Message) => setMessages(all => all.map(m => m.id === id ? change(m) : m));
  // A payment message, spinning from now on; `onStart` links it to its entry once the run writes one.
  const startRun = (text: string): [number, Started] => {
    const id = nextId.current++;
    live.current.add(id);
    setMessages(all => [...all, { id, from: 'nest', text, run: {} }]);
    return [id, at => patch(id, m => ({ ...m, run: { ...m.run, at } }))];
  };
  // A run that ended before writing an entry (the wallet was not open, Nest was busy) becomes a plain error line.
  const stopRun = (id: number, error: string) => { live.current.delete(id); patch(id, m => ({ id: m.id, from: m.from, text: `${m.text} · ${error}`, error: true })); };
  useEffect(() => saveHistory(messages), [messages]); // every change is written, so a force-quit keeps the conversation

  const send = async (spoken?: string) => {
    const message = (spoken ?? draft).trim();
    if (!message || thinking || model.state !== 'ready') return;
    if (spoken === undefined) setDraft('');
    add({ from: 'you', text: message, voice: spoken !== undefined }); setThinking(true); setNoting(null);
    try {
      const intent = await ask(message);
      // A payment gets one message, the invest question, instead of the model's reply and then the question.
      if (intent.intent === 'paid') setNoting({ merchant: intent.merchant, amount: intent.amount });
      else add({ from: 'nest', text: intent.reply });
      if (intent.intent === 'search' && intent.query.trim()) {
        // Both sources at once; each failure is its own line, and the shop's answer always shows first.
        const fromShop = (async (): Promise<Omit<Message, 'id'>> => {
          try {
            const agent = await shop();
            const products = (await searchShop(agent.endpoint, intent.query, maxAedFor(intent))).slice(0, 5);
            return products.length ? { from: 'nest', text: '', products } : { from: 'nest', text: 'Nothing in the demo shop matches that.' };
          } catch (error) { return { from: 'nest', text: `Shop unavailable: ${text(error)}. Nothing was paid.`, error: true }; }
        })();
        const fromBitrefill = (async (): Promise<Omit<Message, 'id'>> => {
          if (!bitrefill) return { from: 'nest', text: NOT_REGISTERED };
          try {
            const session = bitrefill();
            const found = (await Promise.all(bitrefillSearches(intent, bitrefillKind(intent.query)).map(q => session.search(q.kind, q.query, q.country)))).flat().slice(0, 5);
            return found.length ? { from: 'nest', text: '', bitrefill: found } : { from: 'nest', text: 'Nothing on Bitrefill matches that.' };
          } catch (error) { return { from: 'nest', text: `Bitrefill unavailable: ${text(error)}. Nothing was paid.`, error: true }; }
        })();
        for (const message of await Promise.all([fromShop, fromBitrefill])) add(message);
      }
    } catch (error) { add({ from: 'nest', text: `The model failed: ${text(error)}`, error: true }); }
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
  // Unmounting mid-recording (Replay setup, or a cleared history): stop the timer and give the microphone back.
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

  // Confirm closes the sheet; the order runs in a chat message with a ring, and its Try again opens a fresh quote.
  const confirm = async () => {
    if (sheet?.state !== 'confirm' || confirming.current) return;
    confirming.current = true;
    const { product, agent, quote } = sheet;
    setSheet(null);
    const [id, started] = startRun(`Buy ${product.title} · ${money(BigInt(quote.quote.amount))} USD₮0`);
    requote.current.set(id, () => void getQuote(product));
    let entered = false;
    try {
      const result = await order(agent, product.title, quote, ignore, at => { entered = true; started(at); });
      if ('error' in result && !entered) stopRun(id, result.error);
    } finally { confirming.current = false; }
  };

  // Buy on a Bitrefill card: its packages and prices, the cheapest picked first.
  const openBitrefill = async (item: BitrefillItem) => {
    setBsheet({ item, packages: [], chosen: 0, state: 'loading' });
    try {
      if (!bitrefill) throw new Error(NOT_REGISTERED);
      const { packages, fromUsd } = await bitrefill().detail(item.slug);
      if (!packages.length) throw new Error('Bitrefill lists no packages for it');
      setBsheet({ item, packages, chosen: Math.max(0, packages.findIndex(p => p.priceUsd === fromUsd)), state: 'pick' });
    } catch (error) { setBsheet({ item, packages: [], chosen: 0, state: 'error', error: `Could not read Bitrefill: ${text(error)}. Nothing was paid.` }); }
  };

  // A fresh mirror quote each time, like the shop's: the mirror checks the price with Bitrefill, and a quote can be used once.
  const quoteBitrefill = async (b: BSheet, notice?: string) => {
    const { item, packages, chosen } = b;
    setBsheet({ item, packages, chosen, notice, state: 'quoting' });
    try {
      const agent = await mirror();
      const quote = await quoteMirror(agent.endpoint, item.slug, packages[chosen].value);
      setBsheet({ item, packages, chosen, notice, state: 'confirm', agent, quote });
    } catch (error) { setBsheet({ item, packages, chosen, state: 'error', error: `Could not get a price: ${text(error)}. Nothing was paid.` }); }
  };

  const confirmBitrefill = async () => {
    if (bsheet?.state !== 'confirm' || confirming.current) return;
    confirming.current = true;
    const { item, packages, chosen, agent, quote } = bsheet;
    setBsheet(null);
    const [id, started] = startRun(`Buy ${item.name} · ${money(BigInt(quote.quote.amount))} USD₮0`);
    requote.current.set(id, () => void quoteBitrefill({ item, packages, chosen, state: 'pick' }));
    let entered = false;
    try {
      const result = await orderMirror(agent, quote, ignore, at => { entered = true; started(at); });
      if ('error' in result && !entered) stopRun(id, result.error);
    } finally { confirming.current = false; }
  };

  // Yes hands the payment to App, which decides it like a card tap; the message with the ring follows its entry.
  const notePaid = () => {
    if (!noting) return;
    const { merchant, amount } = noting;
    const [id, started] = startRun(askLine(merchant, amountFor(strategies, amount)).replace(/\?$/, ''));
    if (!notePayment(merchant, amount, started)) { // the question stays for a retry
      live.current.delete(id);
      setMessages(all => all.filter(m => m.id !== id));
      add({ from: 'nest', text: 'Nest is still noting the last payment, try again in a moment.', error: true }); return;
    }
    setNoting(null);
  };

  // Try again, once: the buy alone when the lookup was paid, the whole decision when it never got that far, a fresh quote for an order.
  const retry = (m: Message, entry: Entry | undefined, kind: 'decide' | 'buy' | 'order') => {
    const at = m.run?.at;
    if (kind === 'order') { requote.current.get(m.id)?.(); patch(m.id, x => ({ ...x, run: { ...x.run, retried: true } })); return; }
    if (kind === 'buy') {
      if (at === undefined || !retryBuy(at)) { add({ from: 'nest', text: 'Nest is busy with another payment, try again in a moment.', error: true }); return; }
      patch(m.id, x => ({ ...x, run: { ...x.run, retried: true } })); return;
    }
    if (!entry) return;
    if (!notePayment(entry.merchant, entry.amount ?? '', next => patch(m.id, x => ({ ...x, run: { at: next, retried: true } })))) {
      add({ from: 'nest', text: 'Nest is still noting the last payment, try again in a moment.', error: true }); return;
    }
    live.current.add(m.id);
    patch(m.id, x => ({ ...x, run: { retried: true } })); // spins until the new decision writes its entry
  };

  // A payment message: the ring while its entry runs; a run from an earlier launch whose entry is gone is plain text.
  const runLine = (m: Message) => {
    const at = m.run?.at;
    const entry = at === undefined ? undefined : entries.find(e => e.at === at);
    if (!entry && !live.current.has(m.id)) return <View key={m.id} style={[s.bubble, s.nest]}><Text style={s.bubbleText}>{m.text}</Text></View>;
    const r = ring(entry, m.text);
    const canRetry = r.state === 'failed' && r.retry !== null && !m.run?.retried && (r.retry !== 'order' || requote.current.has(m.id));
    const note = entry && 'order' in entry && entry.order.seller === 'bitrefill' ? NOT_ISSUED : undefined;
    return <RunMessage key={m.id} ring={r} note={note} canRetry={canRetry} onRetry={() => { if (r.state === 'failed' && r.retry) retry(m, entry, r.retry); }}
      onOpen={entry ? () => openEntry(entry.at) : undefined} />;
  };

  const open = sheet !== null || bsheet !== null;
  // A double tap on the chat reads a receipt (receipt OCR); single taps on messages and buttons still go to them.
  const [pickReceipt, receiptSheet] = useReceipt({ read: readReceipt, ask, add, note: setNoting, setBusy: busy => { setThinking(busy); setReceipt(busy); } });
  const lastTap = useRef(0);
  const receiptOff = () => model.state !== 'ready' || thinking || hearingNow || recording !== null || open;
  const tapped = () => {
    const now = Date.now();
    if (now - lastTap.current > DOUBLE_TAP_MS) { lastTap.current = now; return; }
    lastTap.current = 0;
    if (!receiptOff()) pickReceipt();
  };

  if (model.state !== 'ready') return (
    <View style={s.screen}>
      {header}
      <View style={s.list}>
        {model.state === 'loading'
          ? <Text style={s.muted}>Loading the model…</Text>
          : <Text style={s.error}>Could not load the model: {model.message}</Text>}
      </View>
    </View>
  );

  return (
    <View style={s.screen}>
      {header}
      <ScrollView ref={list} style={s.list} contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}>
        <Pressable style={s.messages} onPress={tapped} accessibilityLabel="Messages" accessibilityHint="Opens a receipt to read"
          onAccessibilityTap={() => { if (!receiptOff()) pickReceipt(); }}>
        {messages.length === 0 && <Text style={s.muted}>Hold the mic and ask for something, or type it, for example "find me headphones under 300 dirhams". Double-tap here to read a receipt. Orders are demo orders, not shipped.</Text>}
        {messages.map(m => m.products
          ? <View key={m.id} style={s.group}>
              <Text style={s.label}>Demo shop (Amazon.ae prices)</Text>
              {m.products.map(p => <ProductCard key={p.id} product={p} onBuy={() => void getQuote(p)} disabled={open} />)}
            </View>
          : m.bitrefill
          ? <View key={m.id} style={s.group}>
              <Text style={s.label}>Bitrefill (live)</Text>
              {m.bitrefill.map(i => <BitrefillCard key={i.slug} item={i} onBuy={() => void openBitrefill(i)} disabled={open} />)}
            </View>
          : m.run ? runLine(m)
          : <View key={m.id} style={[s.bubble, m.from === 'you' ? s.you : s.nest]}>
              {m.voice && <Text style={s.voiceLabel}>Voice message</Text>}
              <Text style={[s.bubbleText, m.from === 'you' && s.youText, m.error && s.error]}>{m.text}</Text>
            </View>)}
        {noting && <View style={[s.bubble, s.nest, s.ask]}>
          <Text style={s.bubbleText}>{askLine(noting.merchant, amountFor(strategies, noting.amount))}</Text>
          <Text style={s.muted}>{shareLine(strategies, noting.amount)}</Text>
          <View style={s.yes}><Button title="Yes" disabled={open} onPress={notePaid} /></View>
        </View>}
        {hearingNow && <Text style={s.muted}>Turning your voice message into text…</Text>}
        {thinking && <Text style={s.muted}>{receipt ? READING_RECEIPT : 'Reading your message…'}</Text>}{/* receipt OCR */}
        </Pressable>
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
              <MicIcon size={22} tint={recording !== null ? color.onPrimary : color.text} />
            </Pressable>}
      </View>
      {receiptSheet}
      {sheet && <OrderSheet sheet={sheet} onConfirm={() => void confirm()} onRequote={() => void getQuote(sheet.product)}
        onClose={() => setSheet(null)} />}
      {bsheet && <BitrefillSheet sheet={bsheet} onPick={chosen => setBsheet({ ...bsheet, chosen } as BSheet)}
        onQuote={() => void quoteBitrefill(bsheet)} onConfirm={() => void confirmBitrefill()} onClose={() => setBsheet(null)} />}
    </View>
  );
}

function BitrefillCard({ item, onBuy, disabled }: { item: BitrefillItem; onBuy(): void; disabled: boolean }) {
  return (
    <Card style={s.product}>
      <Text style={s.title}>{item.name}</Text>
      <Text style={s.muted}>{KIND[item.kind]}{item.country ? ` · ${item.country}` : ''} · live price on Buy</Text>
      <Button kind="secondary" title="Buy" disabled={disabled} onPress={onBuy} />
    </Card>
  );
}

function BitrefillSheet({ sheet, onPick, onQuote, onConfirm, onClose }: {
  sheet: BSheet; onPick(chosen: number): void; onQuote(): void; onConfirm(): void; onClose(): void;
}) {
  const quoted = 'quote' in sheet ? sheet.quote : null;
  const q = quoted?.quote ?? null;
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ScrollView style={s.sheet} contentContainerStyle={s.sheetBody}>
        <Text style={s.label}>CONFIRM ORDER</Text>
        <Text style={s.heading}>{sheet.item.name}</Text>
        <Text style={s.muted}>{KIND[sheet.item.kind]}{sheet.item.country ? ` · ${sheet.item.country}` : ''} · found on Bitrefill</Text>
        {sheet.notice && <Text style={s.error}>{sheet.notice}</Text>}
        {sheet.state === 'loading' && <Text style={s.muted}>Getting the packages from Bitrefill…</Text>}
        {sheet.state === 'pick' && <>
          {sheet.packages.map((p, i) => (
            <Pressable key={p.value} accessibilityRole="radio" accessibilityState={{ selected: i === sheet.chosen }} onPress={() => onPick(i)}
              style={[s.package, i === sheet.chosen && s.packageOn]}>
              <Text style={s.title}>{p.value}</Text>
              <Text style={s.muted}>{p.priceUsd} USD at Bitrefill</Text>
            </Pressable>))}
          <Button title="Get the price" onPress={onQuote} />
          <Button kind="secondary" title="Cancel" onPress={onClose} />
        </>}
        {sheet.state === 'quoting' && <Text style={s.muted}>Checking the price with Bitrefill…</Text>}
        {q && <Card style={s.step}>
          <Text style={s.total}>{money(BigInt(q.amount))} USD₮0</Text>
          <Text style={s.muted}>{packageLabel(q.packageValue, q.packageCurrency)} · {q.priceUsd} USD at Bitrefill</Text>
          <Text style={s.muted}>Price checked with Bitrefill just now</Text>
          <Text style={s.muted}>{quoted && wouldPayLine(quoted.wouldPay)}; here it is a demo purchase on Sepolia · the card is not issued</Text>
        </Card>}
        {sheet.state === 'error' && <Text style={s.error}>{sheet.error}</Text>}
        {sheet.state === 'confirm' && <>
          <Button title="Confirm" onPress={onConfirm} />
          <Button kind="secondary" title="Cancel" onPress={onClose} />
        </>}
        {sheet.state === 'error' && <>
          {sheet.packages.length > 0 && <Button title="Get a new quote" onPress={onQuote} />}
          <Button kind="secondary" title="Close" onPress={onClose} />
        </>}
        {(sheet.state === 'quoting' || sheet.state === 'loading') && <Button kind="secondary" title="Cancel" onPress={onClose} />}
      </ScrollView>
    </Modal>
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

function OrderSheet({ sheet, onConfirm, onRequote, onClose }: {
  sheet: Sheet; onConfirm(): void; onRequote(): void; onClose(): void;
}) {
  const quote = 'quote' in sheet ? sheet.quote.quote : null;
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ScrollView style={s.sheet} contentContainerStyle={s.sheetBody}>
        <Text style={s.label}>CONFIRM ORDER</Text>
        <Text style={s.heading}>{sheet.product.title}</Text>
        {sheet.notice && <Text style={s.error}>{sheet.notice}</Text>}
        {sheet.state === 'quoting' && <Text style={s.muted}>Getting the price…</Text>}
        {quote && <Card style={s.step}>
          <Text style={s.total}>{money(BigInt(quote.amount))} USD₮0</Text>
          <Text style={s.muted}>AED {quote.priceAed} at 3.6725 AED = 1 USD₮0</Text>
          <Text style={s.muted}>{source(quote)}</Text>
          <Text style={s.muted}>Demo order, not shipped</Text>
        </Card>}
        {sheet.state === 'error' && <Text style={s.error}>{sheet.error}</Text>}
        {sheet.state === 'confirm' && <>
          <Button title="Confirm" onPress={onConfirm} />
          <Button kind="secondary" title="Cancel" onPress={onClose} />
        </>}
        {sheet.state === 'error' && <>
          <Button title="Get a new quote" onPress={onRequote} />
          <Button kind="secondary" title="Close" onPress={onClose} />
        </>}
        {sheet.state === 'quoting' && <Button kind="secondary" title="Cancel" onPress={onClose} />}
      </ScrollView>
    </Modal>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg, paddingTop: 60, paddingHorizontal: space.screen, gap: space.gap },
  list: { flex: 1 },
  scroll: { flexGrow: 1 },
  messages: { flexGrow: 1, gap: 10, paddingBottom: 12 },
  bubble: { maxWidth: '85%', borderRadius: radius.card, paddingVertical: 10, paddingHorizontal: 14 },
  you: { alignSelf: 'flex-end', backgroundColor: color.off },
  nest: { alignSelf: 'flex-start', backgroundColor: color.panel },
  bubbleText: { fontSize: type.body, color: color.text },
  youText: { color: color.text },
  product: { padding: 16, gap: 6 },
  group: { gap: 10 },
  package: { padding: 14, borderRadius: 12, borderWidth: 1, borderColor: color.hairline, backgroundColor: color.panel, gap: 2 },
  packageOn: { borderColor: color.primary, borderWidth: 2 },
  title: { fontSize: type.body, fontWeight: '600', color: color.text },
  price: { fontSize: 17, fontWeight: '700', color: color.text },
  compose: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 28 },
  input: { flex: 1, borderWidth: 1, borderColor: color.hairline, borderRadius: radius.pill, paddingVertical: 12, paddingHorizontal: 18, fontSize: 16, color: color.text, backgroundColor: color.panel },
  send: { width: 88 },
  mic: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: color.hairline, backgroundColor: color.panel },
  micOn: { backgroundColor: color.error },
  off: { opacity: 0.4 },
  recording: { color: color.error, fontWeight: '600' },
  voiceLabel: { fontSize: type.tiny, color: color.muted, marginBottom: 2 },
  sheet: { flex: 1, backgroundColor: color.bg },
  sheetBody: { padding: space.screen, paddingBottom: 30, gap: space.gap },
  label: { fontSize: type.tiny, fontWeight: '600', color: color.muted, letterSpacing: 0.4 },
  heading: { fontSize: type.heading, fontWeight: '800', letterSpacing: -0.4, color: color.text },
  step: { padding: 16, gap: 4 },
  total: { fontSize: 28, fontWeight: '800', color: color.text },
  muted: { fontSize: type.small, color: color.muted },
  error: { fontSize: type.small, color: color.error },
  ask: { gap: 6 },
  yes: { alignSelf: 'flex-start', minWidth: 96, marginTop: 4 },
});

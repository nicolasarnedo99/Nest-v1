// The Chat tab: type what you want, the chat model reads it into a search, and the demo shop's products show as cards.
// The model only reads the message: a payment starts only from Buy, then Confirm in the order sheet.
import { useRef, useState } from 'react';
import { Linking, Modal, ScrollView, StyleSheet, Text, TextInput, View, type ScrollViewInstance } from 'react-native';
import { Button, Card, Title } from '../ui/kit';
import { color, radius, space, type } from '../ui/theme';
import { money } from '../lib/holdings';
import { quoteShop, searchShop, type ShopProduct, type ShopQuote } from '../lib/shop';
import { maxAedFor, type Intent } from '../lib/chat';

export type ChatModel = { state: 'loading' } | { state: 'ready' } | { state: 'error'; message: string; memory: boolean };
export type ShopAgent = { endpoint: string; wallet: string };
export type Ordered = { amount: string; transaction: string | null } | { error: string; expired: boolean; mayBePaid?: boolean };
export const EXPIRED = 'That price expired, get a new quote';

type Message = { id: number; from: 'you' | 'nest'; text: string; products?: ShopProduct[]; error?: boolean };
type Sheet = { product: ShopProduct; notice?: string } & (
  { state: 'quoting' } | { state: 'confirm' | 'ordering'; agent: ShopAgent; quote: ShopQuote } |
  { state: 'done'; quote: ShopQuote; amount: string; transaction: string | null } | { state: 'error'; error: string; mayBePaid?: boolean });

const text = (error: unknown) => error instanceof Error ? error.message : String(error);

export function Chat({ model, onUnloadSavings, ask, shop, order, shopped }: {
  model: ChatModel; onUnloadSavings(): void; ask(message: string): Promise<Intent>; shop(): Promise<ShopAgent>;
  order(agent: ShopAgent, title: string, quote: ShopQuote): Promise<Ordered>; shopped: bigint | null;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const nextId = useRef(0);
  const confirming = useRef(false); // two quick taps can both pass the state check before the re-render
  const list = useRef<ScrollViewInstance>(null);
  const add = (message: Omit<Message, 'id'>) => setMessages(all => [...all, { id: nextId.current++, ...message }]);

  const send = async () => {
    const message = draft.trim();
    if (!message || thinking || model.state !== 'ready') return;
    setDraft(''); add({ from: 'you', text: message }); setThinking(true);
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
            {model.memory && <Button kind="secondary" title="Unload the savings model while chatting" onPress={onUnloadSavings} />}
          </>}
    </View>
  );

  return (
    <View style={s.screen}>
      <Title>Chat</Title>
      <ScrollView ref={list} style={s.list} contentContainerStyle={s.messages} keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}>
        {messages.length === 0 && <Text style={s.muted}>Ask for something, for example "find me headphones under 300 dirhams". Orders are demo orders, not shipped.</Text>}
        {messages.map(m => m.products
          ? m.products.map(p => <ProductCard key={`${m.id}-${p.id}`} product={p} onBuy={() => void getQuote(p)} disabled={sheet !== null} />)
          : <View key={m.id} style={[s.bubble, m.from === 'you' ? s.you : s.nest]}>
              <Text style={[s.bubbleText, m.from === 'you' && s.youText, m.error && s.error]}>{m.text}</Text>
            </View>)}
        {thinking && <Text style={s.muted}>Reading your message…</Text>}
      </ScrollView>
      <View style={s.compose}>
        <TextInput style={s.input} value={draft} onChangeText={setDraft} placeholder="Find me…" placeholderTextColor={color.tabOff}
          editable={!thinking} returnKeyType="send" onSubmitEditing={() => void send()} />
        <View style={s.send}><Button title="Send" disabled={thinking || !draft.trim()} onPress={() => void send()} /></View>
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
  source === 'live' ? 'checked at Amazon.ae just now' : source === 'sample' ? 'sample price' : `recorded price, Amazon.ae, ${checkedAt}`;

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

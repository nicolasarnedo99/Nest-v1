// Turtle on the phone, step 1: the same decision the Mac build makes, made on
// this device by a model run through Tether's QVAC SDK. Type a merchant, get a
// company or none, and see how long it took. The switch reloads the model with
// or without the fine-tuned adapter, so before and after can be compared here.
// When it names a company, the phone asks the Mac for an order, checks it,
// signs it with its own WDK wallet and the Mac relays it on Sepolia.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Asset } from 'expo-asset';
import { completion, loadModel, unloadModel, QWEN3_1_7B_INST_Q4 } from '@qvac/sdk';
import { useAccount, useWalletManager } from '@tetherto/wdk-react-native-core';
import adapterAsset from './assets/turtle-adapter.gguf';
import config from './turtle.config.json';
import { checkOrder, type Typed } from './lib/pay';

// Each pay step leaves its mark, so a result reads: decided, signed on this phone, bought.
type Payment = { state: 'ordering' | 'signing' | 'relaying' | 'bought'; transaction?: string; confirmed?: boolean; error?: string };
type Decision = { id: number; merchant: string; company: string | null; explanation: string; seconds: number; tuned: boolean; pay?: Payment };
type Failure = { id: number; merchant: string; error: string; tuned: boolean };

// Plain HTTP to the Mac over Tailscale, for a testnet demo only. Read as whole
// expressions so Expo inlines them into the Release bundle.
const SERVER = process.env.EXPO_PUBLIC_TURTLE_SERVER;
const TOKEN = process.env.EXPO_PUBLIC_TURTLE_TOKEN;
const AMOUNT = 500000n; // a fixed 0.50 until the buying strategies exist

async function post<T>(path: string, body: unknown): Promise<T> {
  if (!SERVER || !TOKEN) throw new Error('This build has no Mac address or token (mobile/.env.local)');
  const response = await fetch(`${SERVER}${path}`, { method: 'POST', body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` } });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`The Mac refused ${path} (${response.status}): ${data?.error ?? 'no reason given'}`);
  return data as T;
}

// The same strict rule as the evaluation on the Mac: anything that is not
// exactly a listed company or null, with a short explanation, is an error. It
// is never read as "skip" and never as "buy".
function parseDecision(text: string): { company: string | null; explanation: string } {
  const parsed = JSON.parse(text);
  const valid = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) &&
    Object.keys(parsed).sort().join(',') === 'company,explanation' &&
    (parsed.company === null || config.companies.includes(parsed.company)) &&
    typeof parsed.explanation === 'string' && parsed.explanation.length >= 1 && parsed.explanation.length <= 80;
  if (!valid) throw new Error('The model returned something that is not a valid decision');
  return parsed;
}

// The phone's own wallet, kept by WDK in the Keychain under one fixed id:
// created on the first launch, unlocked on every launch after that.
function useWallet() {
  const { status, createWallet, unlock } = useWalletManager();
  const { address, extension } = useAccount<{ signTypedData(data: object): Promise<string> }>({ network: 'ethereum', accountIndex: 0 });
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  useEffect(() => {
    if (started.current || status === 'LOADING') return;
    started.current = true;
    (async () => {
      if (status === 'NO_WALLET') await createWallet('turtle');
      await unlock('turtle');
    })().catch(e => setError(e instanceof Error ? e.message : String(e)));
  }, [status, createWallet, unlock]);
  return { address, extension, error };
}

const EXAMPLES = ['CARREFOUR EXPRESS DUBAI', 'APPLE.COM/BILL', "APPLEBEE'S GRILL 1123 ORLANDO FL", 'TESLA SUPERCHARGER ES MADRID'];

export default function App() {
  const [tuned, setTuned] = useState(true);
  const [status, setStatus] = useState('Starting');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [merchant, setMerchant] = useState('');
  const [results, setResults] = useState<Array<Decision | Failure>>([]);
  const modelId = useRef<string | null>(null);
  const nextId = useRef(0);
  const wallet = useWallet();
  const setPay = (id: number, pay: Payment) =>
    setResults(list => list.map(item => item.id === id ? { ...item, pay } : item));

  // One attempt, never retried: any step that fails becomes the result's error line.
  const pay = async (id: number, company: string, eventId: string) => {
    setPay(id, { state: 'ordering' });
    try {
      const buyer = wallet.address;
      if (!buyer) throw new Error('The wallet is not open yet');
      const { order, typed } = await post<{ order: unknown; typed: Typed & { types: object } }>('/api/phone/order',
        { buyer, company: config.companies.indexOf(company), eventId, amount: AMOUNT.toString() });
      checkOrder(typed, { buyer, value: AMOUNT, chain: config.chain, nowSeconds: Math.floor(Date.now() / 1000) });
      setPay(id, { state: 'signing' });
      const signature = await wallet.extension().signTypedData({ domain: typed.domain, types: typed.types, message: typed.message });
      if (typeof signature !== 'string') throw new Error('The wallet returned no signature');
      setPay(id, { state: 'relaying' });
      const { transaction, confirmed } = await post<{ transaction: string; confirmed: boolean }>('/api/phone/buy', { order, signature });
      setPay(id, { state: 'bought', transaction, confirmed });
    } catch (error) {
      setResults(list => list.map(item => item.id === id && 'pay' in item && item.pay
        ? { ...item, pay: { ...item.pay, error: error instanceof Error ? error.message : String(error) } } : item));
    }
  };

  // Loads the base model, with the adapter when `tuned` is on. Switching the
  // toggle unloads and loads again, because an adapter is applied at load time.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setReady(false);
      try {
        if (modelId.current) { await unloadModel({ modelId: modelId.current, clearStorage: false }); modelId.current = null; }
        let lora: string | undefined;
        if (tuned) {
          setStatus('Preparing the fine-tuned adapter');
          const asset = Asset.fromModule(adapterAsset);
          await asset.downloadAsync();
          if (!asset.localUri) throw new Error('The adapter file is not available on this device');
          lora = decodeURI(asset.localUri.replace(/^file:\/\//, ''));
        }
        setStatus('Loading Qwen3 1.7B (the first run downloads about 1 GB)');
        const started = Date.now();
        const id = await loadModel({ modelSrc: QWEN3_1_7B_INST_Q4, modelType: 'llamacpp-completion',
          modelConfig: { device: 'gpu', ctx_size: 1024, ...(lora ? { lora } : {}) },
          onProgress: progress => { if (!cancelled) setStatus(`Downloading the model: ${Math.round(progress.percentage)}%`); } });
        if (cancelled) { await unloadModel({ modelId: id, clearStorage: false }); return; }
        modelId.current = id;
        setStatus(`${tuned ? 'Fine-tuned' : 'Untuned'} model ready, loaded in ${((Date.now() - started) / 1000).toFixed(1)} s`);
        setReady(true);
      } catch (error) {
        if (!cancelled) setStatus(`Could not load the model: ${error instanceof Error ? error.message : String(error)}`);
      }
    })();
    return () => { cancelled = true; };
  }, [tuned]);

  const decide = useCallback(async (text: string) => {
    const name = text.trim();
    if (!name || !modelId.current || busy) return;
    setBusy(true);
    const started = Date.now();
    const id = nextId.current++;
    try {
      const final = await completion({ modelId: modelId.current, kvCache: false, stream: false,
        history: [{ role: 'system', content: config.system }, { role: 'user', content: JSON.stringify({ merchant: name }) }],
        generationParams: config.generationParams, responseFormat: config.responseFormat as never }).final;
      const decision = parseDecision(final.contentText);
      setResults(list => [{ id, merchant: name, ...decision, seconds: (Date.now() - started) / 1000, tuned }, ...list]);
      setMerchant('');
      if (decision.company) await pay(id, decision.company, `phone-${started}-${id}`);
    } catch (error) {
      setResults(list => [{ id, merchant: name, error: error instanceof Error ? error.message : String(error), tuned }, ...list]);
    } finally { setBusy(false); }
  }, [busy, tuned, pay]);

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.brand}>turtle.</Text>
        <Text style={styles.lede}>A model on this phone decides which listed company a merchant belongs to, or none. A wallet on this phone signs the purchase; your Mac only relays it.</Text>

        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.grow}>
              <Text style={styles.label}>FINE-TUNED ADAPTER</Text>
              <Text style={styles.small}>Off runs Qwen3 1.7B as it comes. On adds the adapter trained with QVAC.</Text>
            </View>
            <Switch value={tuned} onValueChange={setTuned} disabled={busy} trackColor={{ true: '#2f6b3a' }} />
          </View>
          <View style={styles.statusRow}>
            {!ready && <ActivityIndicator color="#2f6b3a" />}
            <Text style={styles.status}>{status}</Text>
          </View>
        </View>

        <Text style={wallet.error ? styles.error : styles.small} selectable>
          {wallet.error ? `Wallet error: ${wallet.error}` : wallet.address ? `Wallet ${wallet.address}` : 'Opening the wallet…'}
        </Text>

        <View style={styles.card}>
          <Text style={styles.label}>MERCHANT ON THE CARD STATEMENT</Text>
          <TextInput style={styles.input} value={merchant} onChangeText={setMerchant} placeholder="e.g. Apple Store Madrid"
            placeholderTextColor="#8a9a84" autoCapitalize="characters" autoCorrect={false} editable={ready && !busy}
            returnKeyType="go" onSubmitEditing={() => void decide(merchant)} />
          <Pressable style={[styles.button, (!ready || busy || !merchant.trim()) && styles.buttonOff]}
            disabled={!ready || busy || !merchant.trim()} onPress={() => void decide(merchant)}>
            <Text style={styles.buttonText}>{busy ? 'Deciding…' : 'Decide'}</Text>
          </Pressable>
          <View style={styles.examples}>
            {EXAMPLES.map(example => (
              <Pressable key={example} style={styles.chip} disabled={!ready || busy} onPress={() => void decide(example)}>
                <Text style={styles.chipText}>{example}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {results.map(item => (
          <View key={item.id} style={styles.result}>
            <Text style={styles.merchant}>{item.merchant}</Text>
            {'error' in item
              ? <Text style={styles.error}>{item.error}</Text>
              : <>
                  <Text style={styles.decision}>{item.company ?? 'No listed company'}<Text style={styles.outcome}>{item.company ? '  ·  would buy' : '  ·  nothing bought'}</Text></Text>
                  <Text style={styles.small}>“{item.explanation}”</Text>
                  <Text style={styles.meta}>{item.seconds.toFixed(2)} s  ·  {item.tuned ? 'fine-tuned' : 'untuned'}  ·  on this device</Text>
                  {item.pay && <PayLines pay={item.pay} />}
                </>}
          </View>
        ))}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function PayLines({ pay }: { pay: Payment }) {
  const signed = pay.state === 'relaying' || pay.state === 'bought';
  const waiting = { ordering: 'Asking the Mac for the order…', signing: 'Signing on this phone…', relaying: 'Sending the signature to the Mac…', bought: '' }[pay.state];
  return (
    <>
      {signed && <Text style={styles.step}>Signed on this phone</Text>}
      {pay.state === 'bought'
        ? <Text style={styles.link} onPress={() => void Linking.openURL(`https://sepolia.etherscan.io/tx/${pay.transaction}`)}>
            {pay.confirmed ? 'Bought on Sepolia' : 'Sent to Sepolia, not confirmed yet'}  ·  view on Etherscan</Text>
        : pay.error ? <Text style={styles.error}>{pay.error}</Text> : <Text style={styles.small}>{waiting}</Text>}
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fbfcf8' },
  content: { padding: 20, paddingTop: 72, gap: 16 },
  brand: { fontSize: 34, fontWeight: '700', color: '#193d2d', letterSpacing: -1 },
  lede: { fontSize: 15, lineHeight: 22, color: '#5f7359' },
  card: { backgroundColor: '#edf3e8', borderRadius: 14, padding: 16, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  grow: { flex: 1, gap: 4 },
  label: { fontSize: 11, letterSpacing: 1.4, color: '#5f7359', fontWeight: '600' },
  small: { fontSize: 13, lineHeight: 18, color: '#5f7359' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  status: { flex: 1, fontSize: 13, color: '#193d2d' },
  input: { backgroundColor: '#fbfcf8', borderWidth: 1, borderColor: '#d6e2cb', borderRadius: 10, padding: 12, fontSize: 16, color: '#193d2d' },
  button: { backgroundColor: '#1a4d38', borderRadius: 10, padding: 14, alignItems: 'center' },
  buttonOff: { opacity: 0.4 },
  buttonText: { color: '#fbfcf8', fontSize: 16, fontWeight: '600' },
  examples: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: '#c5d6b8', borderRadius: 20, paddingVertical: 6, paddingHorizontal: 10 },
  chipText: { fontSize: 11, color: '#2f6b3a' },
  result: { borderTopWidth: 1, borderTopColor: '#d6e2cb', paddingTop: 14, gap: 4 },
  merchant: { fontSize: 13, color: '#5f7359', fontWeight: '600' },
  decision: { fontSize: 20, fontWeight: '700', color: '#193d2d' },
  outcome: { fontSize: 13, fontWeight: '400', color: '#5f7359' },
  meta: { fontSize: 12, color: '#8a9a84', fontVariant: ['tabular-nums'] },
  error: { fontSize: 14, color: '#9a3a2c' },
  step: { fontSize: 14, color: '#193d2d', fontWeight: '600' },
  link: { fontSize: 14, color: '#2f6b3a', fontWeight: '600', textDecorationLine: 'underline' },
});

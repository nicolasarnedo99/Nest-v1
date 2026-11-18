// Turtle on the phone, step 1: the same decision the Mac build makes, made on
// this device by a model run through Tether's QVAC SDK. Type a merchant, get a
// company or none, and see how long it took. The owner picks which model decides:
// Qwen3 1.7B with the fine-tuned adapter, or Qwen3.5 2B as it comes.
// When it names a company, the phone builds the order, checks it against the
// daily cap, signs it with its own WDK wallet and sends the buy on Sepolia
// itself, as a UserOperation whose gas Candide's paymaster pays.
// Card taps noted in the background by the "Note Payment" Shortcuts action
// wait in a queue and are decided here, one by one, when the app is open.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Asset } from 'expo-asset';
import { completion, loadModel, unloadModel, QWEN3_1_7B_INST_Q4, QWEN3_5_2B_MULTIMODAL_Q4_K_M } from '@qvac/sdk';
import { useAccount, useWalletManager } from '@tetherto/wdk-react-native-core';
import adapterAsset from './assets/turtle-adapter.gguf';
import config from './turtle.config.json';
import { File, Paths } from 'expo-file-system';
import { checkOrder } from './lib/pay';
import { buildOrder, buyCall } from './lib/order';
import { spend, type Store } from './lib/budget';
import { parseLog, record, type Entry, type Pay } from './lib/log';
import { MODELS, parseSettings, type ModelId, type Strategies } from './lib/settings';
import { amountFor } from './lib/strategy';
import { tapFromIntent } from './lib/tap';
import { removePendingInvocationAsync, useAppIntents, type AppIntentInvocation } from 'expo-app-intents';

// Each pay step leaves its mark, so a result reads: decided, signed on this phone, bought.
type Payment = Pay;
type Item = Entry & { id: number };

// What was spent today, for the daily cap: a small JSON file in Documents.
const spentFile = new File(Paths.document, 'turtle-spent.json');
const budget: Store = { read: () => spentFile.exists ? spentFile.textSync() : null, write: text => spentFile.writeSync(text) };

// What the results list showed, so it survives closing the app: a record only, never read to decide or pay.
const logFile = new File(Paths.document, 'activity.json');

// Which model decides and which saving strategies are on, kept so the choice survives closing the app.
const settingsFile = new File(Paths.document, 'settings.json');
const SDK_MODELS = { QWEN3_1_7B_INST_Q4, QWEN3_5_2B_MULTIMODAL_Q4_K_M };

type Wallet7702 = {
  signTypedData(data: object): Promise<string>;
  sendTransaction(tx: { to: string; value: string; data: string }): Promise<{ hash: string }>;
  getUserOperationReceipt(hash: string): Promise<{ success: boolean; receipt: { transactionHash: string } } | null>;
};

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
  const { address, extension } = useAccount<Wallet7702>({ network: 'ethereum', accountIndex: 0 });
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
  const [settings] = useState(() => {
    try { return parseSettings(settingsFile.exists ? settingsFile.textSync() : null); }
    catch (error) { return { ...parseSettings('unreadable'), problem: `Could not read the settings: ${error instanceof Error ? error.message : String(error)}` }; }
  });
  const [modelChoice, setModelChoice] = useState<ModelId>(settings.model);
  const choice = MODELS.find(m => m.id === modelChoice)!;
  const [queued, setQueued] = useState(0);
  const [loading, setLoading] = useState(true); // true from a choice until its load has finished or failed
  const loadChain = useRef(Promise.resolve());
  const [strategies, setStrategies] = useState<Strategies>(settings.strategies);
  const save = (model: ModelId, next: Strategies) => {
    try { settingsFile.writeSync(JSON.stringify({ model, strategies: next })); }
    catch (error) { setLogNote(`Could not save the settings: ${error instanceof Error ? error.message : String(error)}`); }
  };
  const choose = (id: ModelId) => { setModelChoice(id); save(id, strategies); };
  const toggle = (key: keyof Strategies) => { const next = { ...strategies, [key]: !strategies[key] }; setStrategies(next); save(modelChoice, next); };
  const [status, setStatus] = useState('Starting');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [merchant, setMerchant] = useState('');
  const [typedAmount, setTypedAmount] = useState('4,50 €'); // the amount for typed and chip decisions; queued taps bring their own
  const [results, setResults] = useState<Item[]>([]);
  const modelId = useRef<string | null>(null);
  const nextId = useRef(0);
  const busyRef = useRef(false);
  const [logNote, setLogNote] = useState<string | null>(settings.problem ?? null);
  const kept = useRef(new Map<number, Entry>());
  const wallet = useWallet();
  const active = useForeground();
  const setPay = (id: number, pay: Payment) => { lastPay.current.set(id, pay); setResults(list => list.map(item => item.id === id ? { ...item, pay } : item)); keepPay(id, pay); }

  // A failing log is shown, and never stops a decision or a payment.
  const keep = (id: number, entry: Entry) => {
    kept.current.set(id, entry);
    try { logFile.writeSync(JSON.stringify(record(parseLog(logFile.exists ? logFile.textSync() : null).entries, entry))); }
    catch (error) { setLogNote(`Could not write the activity log: ${error instanceof Error ? error.message : String(error)}`); }
  };
  // Every payment step is written before the next one starts, so a kill mid-buy is still on disk.
  const keepPay = (id: number, pay: Payment) => {
    const entry = kept.current.get(id);
    if (entry && !('error' in entry)) keep(id, { ...entry, pay });
  };
  const lastPay = useRef(new Map<number, Payment>());
  useEffect(() => {
    try {
      const { entries, problem } = parseLog(logFile.exists ? logFile.textSync() : null);
      if (problem) setLogNote(problem);
      const first = nextId.current; nextId.current += entries.length;
      setResults(list => [...list, ...entries.map((entry, i) => ({ ...entry, id: first + i }))]);
    } catch (error) { setLogNote(`Could not read the activity log: ${error instanceof Error ? error.message : String(error)}`); }
  }, []);

  // One attempt, never retried: any step that fails becomes the result's error line.
  // The buy counts against today's cap before signing, and is given back only if
  // it failed before it was handed to the bundler.
  const pay = async (id: number, company: string, eventId: string, amount: bigint) => {
    setPay(id, { state: 'signing' });
    let spent: ReturnType<typeof spend> | undefined;
    try {
      const buyer = wallet.address;
      if (!buyer) throw new Error('The wallet is not open yet');
      const nowSeconds = Math.floor(Date.now() / 1000);
      const { order, typed } = buildOrder({ chain: config.chain, buyer, company: config.companies.indexOf(company), eventId, value: amount, nowSeconds });
      checkOrder(typed, { buyer, value: amount, chain: config.chain, nowSeconds });
      spent = spend(budget, amount);
      const signature = await wallet.extension().signTypedData({ domain: typed.domain, types: typed.types, message: typed.message });
      if (typeof signature !== 'string') throw new Error('The wallet returned no signature');
      setPay(id, { state: 'sending' });
      spent.submit();
      const sent = await wallet.extension().sendTransaction(buyCall(config.chain, order, signature as `0x${string}`));
      if (typeof sent?.hash !== 'string') throw new Error('The wallet returned no UserOperation hash');
      const userOperation = sent.hash;
      setPay(id, { state: 'mining', userOperation });
      // Inclusion took about 15 to 30 s on Sepolia; give up showing it after two minutes.
      for (let attempt = 0; attempt < 40; attempt++) {
        const included = await wallet.extension().getUserOperationReceipt(userOperation);
        if (included) {
          const bought: Payment = { state: 'bought', transaction: included.receipt.transactionHash, confirmed: included.success };
          setPay(id, bought); return;
        }
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      throw new Error(`Sent as UserOperation ${userOperation}, but not mined after two minutes`);
    } catch (error) {
      spent?.release();
      keepPay(id, { state: 'signing', ...lastPay.current.get(id), error: error instanceof Error ? error.message : String(error) });
      setResults(list => list.map(item => item.id === id && 'pay' in item && item.pay
        ? { ...item, pay: { ...item.pay, error: error instanceof Error ? error.message : String(error) } } : item));
    }
  };

  // Loads the chosen model, with the adapter only for the one it was trained on.
  // Choosing another unloads and loads again, because an adapter is applied at load time.
  useEffect(() => {
    let cancelled = false;
    // Each run waits for the previous one to finish, so two loads are never in flight together.
    loadChain.current = loadChain.current.then(async () => {
      if (cancelled) return; // superseded before it started
      setReady(false); setLoading(true);
      try {
        if (modelId.current) { await unloadModel({ modelId: modelId.current, clearStorage: false }); modelId.current = null; }
        let lora: string | undefined;
        if (choice.adapter) {
          setStatus('Preparing the fine-tuned adapter');
          const asset = Asset.fromModule(adapterAsset);
          await asset.downloadAsync();
          if (!asset.localUri) throw new Error('The adapter file is not available on this device');
          lora = decodeURI(asset.localUri.replace(/^file:\/\//, ''));
        }
        setStatus(`Loading ${choice.label}`);
        const started = Date.now();
        const id = await loadModel({ modelSrc: SDK_MODELS[choice.sdk], modelType: 'llamacpp-completion',
          modelConfig: { device: 'gpu', ctx_size: 1024, ...(lora ? { lora } : {}) } });
        if (cancelled) { await unloadModel({ modelId: id, clearStorage: false }); return; }
        modelId.current = id;
        setStatus(`${choice.label} ready, loaded in ${((Date.now() - started) / 1000).toFixed(1)} s`);
        setReady(true);
      } catch (error) {
        if (!cancelled) setStatus(`Could not load the model: ${error instanceof Error ? error.message : String(error)}`);
      } finally { if (!cancelled) setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [choice]);

  // A ref, not the `busy` state, guards it: queued taps call it from an older render.
  const decide = useCallback(async (text: string, amount?: string): Promise<boolean> => {
    const name = text.trim();
    if (!name || !modelId.current || busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    const started = Date.now();
    const id = nextId.current++;
    try {
      const final = await completion({ modelId: modelId.current, kvCache: false, stream: false,
        history: [{ role: 'system', content: config.system }, { role: 'user', content: JSON.stringify({ merchant: name }) }],
        generationParams: config.generationParams, responseFormat: config.responseFormat as never }).final;
      const decision = parseDecision(final.contentText);
      const entry: Entry = { at: started, merchant: name, amount, ...decision, seconds: (Date.now() - started) / 1000, model: choice.label };
      setResults(list => [{ id, ...entry }, ...list]);
      keep(id, entry);
      setMerchant('');
      if (decision.company) {
        const invest = amountFor(strategies, amount ?? '');
        if (invest === null) setPay(id, { state: 'signing', error: 'Nothing bought: no amount to invest (unreadable or missing amount, a whole amount under round-up, or no strategy on)' });
        else await pay(id, decision.company, `phone-${started}-${id}`, invest);
      }
    } catch (error) {
      const entry: Entry = { at: started, merchant: name, amount, error: error instanceof Error ? error.message : String(error), model: choice.label };
      setResults(list => [{ id, ...entry }, ...list]);
      keep(id, entry);
    } finally { busyRef.current = false; setBusy(false); }
    return true;
  }, [choice, pay, strategies]);

  // Each tap leaves the queue before it is decided, so it is never paid twice, even
  // if Turtle is opened again or killed mid-way; a tap cut short that way is lost, not repeated.
  const seenTaps = useRef(new Set<string>());
  const tapChain = useRef(Promise.resolve());
  const fail = (merchant: string, amount: string | undefined, error: string) => {
    const id = nextId.current++, entry: Entry = { at: Date.now(), merchant, amount, error, model: choice.label };
    setResults(list => [{ id, ...entry }, ...list]);
    keep(id, entry);
  };
  const decideTaps = (pending: AppIntentInvocation[]) => { setQueued(n => n + 1); return tapChain.current = tapChain.current.then(async () => {
    for (const invocation of pending) {
      if (invocation.name !== 'notePayment' || seenTaps.current.has(invocation.id)) continue;
      seenTaps.current.add(invocation.id);
      try { await removePendingInvocationAsync(invocation.id); }
      catch (error) { fail('Card tap', undefined, `Could not take the tap off the queue: ${error instanceof Error ? error.message : String(error)}`); continue; }
      const tap = tapFromIntent(invocation.params);
      if (!tap) { fail('Card tap', undefined, 'Note Payment sent no usable merchant and amount'); continue; }
      while (busyRef.current) await new Promise(resolve => setTimeout(resolve, 250));
      if (!(await decide(tap.merchant, tap.amount))) fail(tap.merchant, tap.amount, 'Turtle was not ready to decide this tap');
    }
  }).finally(() => setQueued(n => n - 1)); };


  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="dark" />
      {ready && wallet.address && active && <IntentTaps onTaps={decideTaps} />}
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.brand}>turtle.</Text>
        <Text style={styles.lede}>A model on this phone decides which listed company a merchant belongs to, or none. A wallet on this phone signs the purchase and sends it to Sepolia; a paymaster pays the gas.</Text>

        <View style={styles.card}>
          <Text style={styles.label}>MODEL THAT DECIDES</Text>
          {MODELS.map(m => (
            <Pressable key={m.id} style={[styles.option, m.id === modelChoice && styles.optionOn, (busy || queued > 0 || loading) && styles.buttonOff]}
              disabled={busy || queued > 0 || loading} onPress={() => choose(m.id)}>
              <Text style={styles.optionName}>{m.id === modelChoice ? '● ' : '○ '}{m.name}</Text>
              <Text style={styles.small}>Blind-set score {m.score}.{m.id === modelChoice ? ' In use.' : ''}</Text>
            </Pressable>
          ))}
          <View style={styles.statusRow}>
            {!ready && <ActivityIndicator color="#2f6b3a" />}
            <Text style={styles.status}>{status}</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>SAVING STRATEGIES</Text>
          {([['invest', 'Invest in what I buy', '10% of the purchase, from 0.10 to 1.00'], ['roundUp', 'Round up', 'The difference to the next whole unit, from 0.10 to 1.00']] as const).map(([key, name, hint]) => (
            <View key={key} style={styles.statusRow}>
              <Switch value={strategies[key]} onValueChange={() => toggle(key)} />
              <Text style={styles.small}>{name}. {hint}.</Text>
            </View>
          ))}
          <Text style={styles.small}>Only purchases at a listed company buy. Amounts are read as USD whatever the currency. With both on, the larger amount is bought.</Text>
        </View>

        <Text style={wallet.error ? styles.error : styles.small} selectable>
          {wallet.error ? `Wallet error: ${wallet.error}` : wallet.address ? `Wallet ${wallet.address}` : 'Opening the wallet…'}
        </Text>

        <View style={styles.card}>
          <Text style={styles.label}>MERCHANT ON THE CARD STATEMENT</Text>
          <TextInput style={styles.input} value={merchant} onChangeText={setMerchant} placeholder="e.g. Apple Store Madrid"
            placeholderTextColor="#8a9a84" autoCapitalize="characters" autoCorrect={false} editable={ready && !busy}
            returnKeyType="go" onSubmitEditing={() => void decide(merchant, typedAmount)} />
          <TextInput style={styles.input} value={typedAmount} onChangeText={setTypedAmount} placeholder="Amount, e.g. 4,50 €"
            placeholderTextColor="#8a9a84" autoCorrect={false} editable={ready && !busy} />
          <Pressable style={[styles.button, (!ready || busy || !merchant.trim()) && styles.buttonOff]}
            disabled={!ready || busy || !merchant.trim()} onPress={() => void decide(merchant, typedAmount)}>
            <Text style={styles.buttonText}>{busy ? 'Deciding…' : 'Decide'}</Text>
          </Pressable>
          <View style={styles.examples}>
            {EXAMPLES.map(example => (
              <Pressable key={example} style={styles.chip} disabled={!ready || busy} onPress={() => void decide(example, typedAmount)}>
                <Text style={styles.chipText}>{example}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {logNote && <Text style={styles.error}>{logNote}</Text>}

        {results.map(item => (
          <View key={item.id} style={styles.result}>
            <Text style={styles.merchant}>{item.merchant}{item.amount ? `  ·  ${item.amount}` : ''}</Text>
            {'error' in item
              ? <Text style={styles.error}>{item.error}</Text>
              : <>
                  <Text style={styles.decision}>{item.company ?? 'No listed company'}<Text style={styles.outcome}>{item.company ? '  ·  would buy' : '  ·  nothing bought'}</Text></Text>
                  <Text style={styles.small}>“{item.explanation}”</Text>
                  <Text style={styles.meta}>{item.seconds.toFixed(2)} s  ·  {item.model}  ·  on this device</Text>
                  {item.pay && <PayLines pay={item.pay} />}
                </>}
          </View>
        ))}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// Mounted only while the app is on screen with the model and wallet ready, so taps
// are decided in the foreground: mounting drains the queue, and so does every
// return to the foreground, since leaving it unmounts this.
function IntentTaps({ onTaps }: { onTaps: (pending: AppIntentInvocation[]) => Promise<void> }) {
  useAppIntents(pending => onTaps(pending));
  return null;
}

function useForeground() {
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => setActive(state === 'active'));
    return () => subscription.remove();
  }, []);
  return active;
}

function PayLines({ pay }: { pay: Payment }) {
  const signed = pay.state !== 'signing';
  const waiting = { signing: 'Signing on this phone…', sending: 'Sending the buy, gas paid by the paymaster…', mining: 'Waiting for Sepolia to include it…', bought: '' }[pay.state];
  return (
    <>
      {signed && <Text style={styles.step}>Signed on this phone</Text>}
      {pay.state === 'bought'
        ? <Text style={styles.link} onPress={() => void Linking.openURL(`https://sepolia.etherscan.io/tx/${pay.transaction}`)}>
            {pay.confirmed ? 'Bought on Sepolia' : 'The buy failed on Sepolia'}  ·  view on Etherscan</Text>
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
  option: { borderWidth: 1, borderColor: '#c5d6b8', borderRadius: 10, padding: 12, gap: 2 },
  optionOn: { borderColor: '#2f6b3a', backgroundColor: '#e2ecd8' },
  optionName: { fontSize: 15, fontWeight: '600', color: '#193d2d' },
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

// Turtle on the phone, step 1: the same decision the Mac build makes, made on
// this device by a model run through Tether's QVAC SDK. Type a merchant, get a
// company or none, and see how long it took. The owner picks which model decides:
// Qwen3 1.7B with the fine-tuned adapter, or Qwen3.5 2B as it comes.
// When it names a company, the phone builds the order, checks it against the
// daily cap, signs it with its own WDK wallet and sends the buy on Sepolia
// itself, as a UserOperation whose gas Candide's paymaster pays.
// When the model says none, the phone pays 0.01 USD₮0 over x402 for a merchant
// lookup, and buys the same way if the lookup finds a listed parent.
// Card taps noted in the background by the "Note Payment" Shortcuts action
// wait in a queue and are decided here, one by one, when the app is open.
// The Chat tab reads a request with a second model into a demo shop search; only Buy, then Confirm, pays.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, KeyboardAvoidingView, Linking, Platform, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Asset } from 'expo-asset';
import { completion, embed, loadModel, transcribe, unloadModel, EMBEDDINGGEMMA_300M_Q4_0, QWEN3_1_7B_INST_Q4, QWEN3_5_2B_MULTIMODAL_Q4_K_M, WHISPER_EN_TINY_Q8_0 } from '@qvac/sdk';
import { createSecureStorage, useAccount, useWalletManager } from '@tetherto/wdk-react-native-core';
import adapterAsset from './assets/turtle-adapter.gguf';
import config from './turtle.config.json';
import { File, Paths } from 'expo-file-system';
import { checkOrder } from './lib/pay';
import { buildOrder, buyCall } from './lib/order';
import { MAX_FEE, shoppedToday, spend, spentToday, type Store } from './lib/budget';
import { parseLog, record, type CategoryPick, type Entry, type Lookup, type Order, type Pay } from './lib/log';
import { LookupFailed, OrderFailed, paidLookup, paidOrder, walletSigner } from './lib/x402';
import { orderUrl, type ShopQuote } from './lib/shop';
import { CHAT_SYSTEM, chatResponseFormat, parseIntent, type Intent } from './lib/chat';
import { resolveAgent } from './lib/registry';
import { formatMicro } from '../server/money';
import { MODELS, onboardedFor, parseSettings, type ModelId, type Strategies } from './lib/settings';
import { amountFor } from './lib/strategy';
import { tapFromIntent } from './lib/tap';
import { removePendingInvocationAsync, useAppIntents, type AppIntentInvocation } from 'expo-app-intents';
import { createPublicClient, erc20Abi, http, type Address } from 'viem';
import { sepolia } from 'viem/chains';
import { holdings } from './lib/holdings';
import { openWallet } from './lib/wallet';
import { color } from './ui/theme';
import { TabBar, type Tab } from './screens/TabBar';
import { Home, type Balance } from './screens/Home';
import { Activity } from './screens/Activity';
import { EntrySheet } from './screens/EntrySheet';
import { Agent } from './screens/Agent';
import { Setup } from './screens/Setup';
import { parseChat, saveChat, type ChatMessage } from './lib/chat-history';
import { CATEGORIES, categoryDocument, categoryQuery, closestCategory } from './lib/categories';
import { Chat, EXPIRED, type ChatModel, type Ordered, type ShopAgent, type Voice } from './screens/Chat';

// Each pay step leaves its mark, so a result reads: decided, signed on this phone, bought.
type Payment = Pay;
export type Item = Entry & { id: number };

// What was spent today, for the daily cap: a small JSON file in Documents.
const spentFile = new File(Paths.document, 'turtle-spent.json');
const budget: Store = { read: () => spentFile.exists ? spentFile.textSync() : null, write: text => spentFile.writeSync(text) };

// What the demo shop orders spent today, against the shopping limit: its own file, apart from the savings cap.
const shoppingFile = new File(Paths.document, 'turtle-shopping.json');
const shopping: Store = { read: () => shoppingFile.exists ? shoppingFile.textSync() : null, write: text => shoppingFile.writeSync(text) };

// What the results list showed, so it survives closing the app: a record only, never read to decide or pay.
const logFile = new File(Paths.document, 'activity.json');
// The chat history: every Chat message, so the conversation is still there after closing the app.
const chatFile = new File(Paths.document, 'chat.json');
const loadChat = () => { const { messages, problem } = parseChat(chatFile.exists ? chatFile.textSync() : null); if (problem) console.warn(problem); return messages; };
const keepChat = (messages: ChatMessage[]) => { try { chatFile.writeSync(saveChat(messages)); } catch (error) { console.warn('Chat history not saved:', error); } };
const clearChat = () => { if (chatFile.exists) chatFile.delete(); };

// Which model decides and which saving strategies are on, kept so the choice survives closing the app.
const settingsFile = new File(Paths.document, 'settings.json');
const SDK_MODELS = { QWEN3_1_7B_INST_Q4, QWEN3_5_2B_MULTIMODAL_Q4_K_M };

// Read-only: the balance on Home, and the lookup's ERC-8004 agent (endpoint and payTo) before each lookup.
const sepoliaClient = createPublicClient({ chain: sepolia, transport: http('https://ethereum-sepolia-rpc.publicnode.com', { timeout: 10_000 }) });
// One attempt: viem's default 3 retries would hold the tap queue for ~80 s when the RPC is down.
const resolveClient = createPublicClient({ chain: sepolia, transport: http('https://ethereum-sepolia-rpc.publicnode.com', { timeout: 10_000, retryCount: 0 }) });
const LOOKUP_HOST = `ERC-8004 agent #${config.lookup.agentId} on Sepolia`;
// The chat model reads a message into a search: the decision's settings, with room for the reply.
const CHAT_GENERATION = { ...config.generationParams, predict: 192 };
const LIMIT_REFUSAL = 'Shopping limit reached, not ordered';

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
// created when setup asks for it, unlocked on every launch after that.
function useWallet(onboarded: boolean) {
  const { status, createWallet, unlock } = useWalletManager();
  const { address, extension } = useAccount<Wallet7702>({ network: 'ethereum', accountIndex: 0 });
  const [error, setError] = useState<string | null>(null);
  const [existed, setExisted] = useState(false);
  const [opening, setOpening] = useState(false);
  const started = useRef(false); // an open is in flight or done; reset after a failure so "Try again" can run it
  // Whether the first look found no wallet. Kept for a retry, since a failed create leaves `status` at ERROR.
  const fresh = useRef<boolean | null>(null);
  const open = useCallback(() => {
    if (started.current || status === 'LOADING') return;
    started.current = true;
    fresh.current ??= status === 'NO_WALLET';
    setOpening(true); setError(null);
    openWallet('turtle', fresh.current, { createWallet, unlock, hasWallet: createSecureStorage().hasWallet })
      .then(result => setExisted(result.existed))
      .catch(e => { started.current = false; setError(e instanceof Error ? e.message : String(e)); });
  }, [status, createWallet, unlock]);
  // Opens on its own once: when set up, or when a wallet already exists. During setup a new one waits for "Create wallet".
  useEffect(() => { if (fresh.current === null && (onboarded || status !== 'NO_WALLET')) open(); }, [onboarded, status, open]);
  return { address, extension, error, existed, creating: opening && !address && !error, loading: status === 'LOADING', create: open };
}

const EXAMPLES = ['CARREFOUR EXPRESS DUBAI', 'APPLE.COM/BILL', "APPLEBEE'S GRILL 1123 ORLANDO FL", 'TESLA SUPERCHARGER ES MADRID'];

export default function App() {
  const [settings] = useState(() => {
    try {
      const text = settingsFile.exists ? settingsFile.textSync() : null;
      return { ...parseSettings(text), onboarded: onboardedFor(text, logFile.exists || spentFile.exists) };
    }
    catch (error) { return { ...parseSettings('unreadable'), problem: `Could not read the settings: ${error instanceof Error ? error.message : String(error)}` }; }
  });
  const [modelChoice, setModelChoice] = useState<ModelId>(settings.model);
  const choice = MODELS.find(m => m.id === modelChoice)!;
  const [queued, setQueued] = useState(0);
  const [loading, setLoading] = useState(settings.onboarded); // true from a choice until its load has finished or failed
  const loadChain = useRef(Promise.resolve());
  // 0 until a load is asked for: at launch once set up, or by "Download model" during setup. Each retry adds one.
  const [loadRequest, setLoadRequest] = useState(settings.onboarded ? 1 : 0);
  const [progress, setProgress] = useState<number | null>(null); // the download's fraction, null before a load starts
  const [loadError, setLoadError] = useState<string | null>(null);
  const [strategies, setStrategies] = useState<Strategies>(settings.strategies);
  const [onboarded, setOnboarded] = useState(settings.onboarded);
  const save = (model: ModelId, next: Strategies, done = onboarded) => {
    try { settingsFile.writeSync(JSON.stringify({ model, strategies: next, onboarded: done })); }
    catch (error) { setLogNote(`Could not save the settings: ${error instanceof Error ? error.message : String(error)}`); }
  };
  const choose = (id: ModelId) => { setModelChoice(id); save(id, strategies); };
  const setShare = (share: number) => { const next = { share }; setStrategies(next); save(modelChoice, next); };
  const replaySetup = () => { setOnboarded(false); save(modelChoice, strategies, false); };
  const [step, setStep] = useState(0);
  // Setup ends in Chat: the first thing a new user does is ask the agent for something.
  const finishTo = (to: Tab) => { setOnboarded(true); save(modelChoice, strategies, true); setStep(0); setTab(to); };
  const finish = () => finishTo('chat');
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
  const wallet = useWallet(onboarded);
  const active = useForeground();
  const [tab, setTab] = useState<Tab>('home');
  const [openEntry, setOpenEntry] = useState<number | null>(null);
  const [balance, setBalance] = useState<Balance>(null);
  const setPay = (id: number, pay: Payment) => { lastPay.current.set(id, pay); setResults(list => list.map(item => item.id === id ? { ...item, pay } : item)); keepPay(id, pay); }
  // Written through like a payment step, so a kill mid-lookup is on disk.
  const setLookup = (id: number, lookup: Lookup) => {
    setResults(list => list.map(item => item.id === id ? { ...item, lookup } : item));
    const entry = kept.current.get(id);
    if (entry && 'company' in entry) keep(id, { ...entry, lookup });
  };

  const setCategory = (id: number, category: CategoryPick) => {
    setResults(list => list.map(item => item.id === id ? { ...item, category } : item));
    const entry = kept.current.get(id);
    if (entry && 'company' in entry) keep(id, { ...entry, category });
  };
  // Embeds the merchant and the category descriptions with EmbeddingGemma, which loads and unloads with the classifier.
  // It never loads here: a decision holds busyRef, and waiting on the load chain from inside one can deadlock with Chat.
  const embedId = useRef<string | null>(null);
  const matchCategory = async (merchant: string, lookup: { operator: string | null; note?: string }, explanation: string): Promise<CategoryPick | null> => {
    if (!embedId.current) throw new Error('the category model is not loaded yet');
    const { embedding } = await embed({ modelId: embedId.current, text: [categoryQuery(merchant, lookup, explanation), ...CATEGORIES.map(categoryDocument)] });
    const [query, ...texts] = embedding as number[][];
    return closestCategory(query!, texts, config.stocks);
  };

  // A failing log is shown, and never stops a decision or a payment.
  const keep = (id: number, entry: Entry) => {
    kept.current.set(id, entry);
    try { logFile.writeSync(JSON.stringify(record(parseLog(logFile.exists ? logFile.textSync() : null).entries, entry))); }
    catch (error) { setLogNote(`Could not write the activity log: ${error instanceof Error ? error.message : String(error)}`); }
  };
  // Every payment step is written before the next one starts, so a kill mid-buy is still on disk.
  const keepPay = (id: number, pay: Payment) => {
    const entry = kept.current.get(id);
    if (entry && 'company' in entry) keep(id, { ...entry, pay });
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
    const value = formatMicro(amount);
    setPay(id, { state: 'signing', value });
    let spent: ReturnType<typeof spend> | undefined;
    try {
      const buyer = wallet.address;
      if (!buyer) throw new Error('The wallet is not open yet');
      const nowSeconds = Math.floor(Date.now() / 1000);
      // The seller's index: the five the classifier names first, then the category leaders (contracts/companies.json).
      const index = config.stocks.indexOf(company);
      if (index < 0) throw new Error(`${company} is not listed on the seller`);
      const { order, typed } = buildOrder({ chain: config.chain, buyer, company: index, eventId, value: amount, nowSeconds });
      checkOrder(typed, { buyer, value: amount, chain: config.chain, nowSeconds });
      spent = spend(budget, amount);
      const signature = await wallet.extension().signTypedData({ domain: typed.domain, types: typed.types, message: typed.message });
      if (typeof signature !== 'string') throw new Error('The wallet returned no signature');
      setPay(id, { state: 'sending', value });
      spent.submit();
      const sent = await wallet.extension().sendTransaction(buyCall(config.chain, order, signature as `0x${string}`));
      if (typeof sent?.hash !== 'string') throw new Error('The wallet returned no UserOperation hash');
      const userOperation = sent.hash;
      setPay(id, { state: 'mining', userOperation, value });
      // Inclusion took about 15 to 30 s on Sepolia; give up showing it after two minutes.
      for (let attempt = 0; attempt < 40; attempt++) {
        const included = await wallet.extension().getUserOperationReceipt(userOperation);
        if (included) {
          const bought: Payment = { state: 'bought', value, transaction: included.receipt.transactionHash, confirmed: included.success };
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
    if (!loadRequest) return; // during setup, nothing loads before "Download model"
    let cancelled = false;
    // Each run waits for the previous one to finish, so two loads are never in flight together.
    loadChain.current = loadChain.current.then(async () => {
      if (cancelled) return; // superseded before it started
      setReady(false); setLoading(true); setProgress(0); setLoadError(null);
      try {
        if (modelId.current) { await unloadModel({ modelId: modelId.current, clearStorage: false }); modelId.current = null; }
        if (embedId.current) { await unloadModel({ modelId: embedId.current, clearStorage: false }); embedId.current = null; }
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
        // A cached model reports 100% at once; progress only streams when onProgress is passed.
        const id = await loadModel({ modelSrc: SDK_MODELS[choice.sdk], modelType: 'llamacpp-completion',
          modelConfig: { device: 'gpu', ctx_size: 1024, ...(lora ? { lora } : {}) },
          onProgress: p => { if (!cancelled) setProgress(p.percentage / 100); } });
        if (cancelled) { await unloadModel({ modelId: id, clearStorage: false }); return; }
        modelId.current = id;
        // The category model (about 280 MB the first time) loads before ready, so a decision never waits on a download.
        setStatus('Loading the category model'); setProgress(0);
        try {
          const embedder = await loadModel({ modelSrc: EMBEDDINGGEMMA_300M_Q4_0, modelType: 'llamacpp-embedding',
            onProgress: (p: { percentage: number }) => { if (!cancelled) setProgress(p.percentage / 100); } } as never);
          if (cancelled) { await unloadModel({ modelId: embedder, clearStorage: false }); return; }
          embedId.current = embedder;
        } catch (error) { console.warn('Category model failed to load:', error); } // unlisted merchants then buy nothing, and say why
        setStatus(`${choice.label} ready, loaded in ${((Date.now() - started) / 1000).toFixed(1)} s`);
        setReady(true);
      } catch (error) {
        if (!cancelled) {
          setStatus(`Could not load the model: ${error instanceof Error ? error.message : String(error)}`);
          setLoadError(error instanceof Error ? error.message : String(error));
        }
      } finally { if (!cancelled) setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [choice, loadRequest]);

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
      // One buy per entry, from the model's company or the lookup's listed parent, so they share an event id.
      const invest = amountFor(strategies, amount ?? '');
      const buy = async (company: string) => {
        if (invest === null) setPay(id, { state: 'signing', error: 'Nothing bought: no amount to invest (unreadable or missing amount, or investing is set to 0%)' });
        else await pay(id, company, `phone-${started}-${id}`, invest);
      };
      if (decision.company) await buy(decision.company);
      else if (invest === null) setLookup(id, { state: 'paying', error: 'Not looked up: nothing to invest (investing is set to 0% or no readable amount)' });
      else if (!wallet.address) setLookup(id, { state: 'paying', error: 'Lookup unavailable: the wallet is not open yet' });
      else {
        // The model said none: pay 0.01 for a lookup, which can still find a listed parent.
        setLookup(id, { state: 'paying' });
        let found: Awaited<ReturnType<typeof paidLookup>> | undefined;
        // No URL fallback: an agent the registry cannot resolve is never paid.
        const agent = await resolveAgent(resolveClient, { registry: config.lookup.registry as Address, agentId: BigInt(config.lookup.agentId) }).catch(error => { console.warn('ERC-8004 resolve failed:', error); return null; });
        if (!agent) setLookup(id, { state: 'paying', error: `Lookup unavailable: could not resolve agent #${config.lookup.agentId}` });
        else {
          try {
            found = await paidLookup({ url: agent.endpoint, merchant: name, budget,
              signer: walletSigner(wallet.address, data => wallet.extension().signTypedData(data)),
              expected: { network: `eip155:${config.chain.chainId}`, asset: config.chain.token, maxAmount: MAX_FEE, payTo: agent.wallet } });
          } catch (error) {
            setLookup(id, { state: 'paying', error: error instanceof LookupFailed ? error.message : `Lookup unavailable: ${String(error)}` });
          }
        }
        // Outside the catch, so nothing after a paid lookup can overwrite it as unavailable.
        if (found) {
          const { result, fee, transaction } = found;
          const listed = result.listedParent && config.companies.includes(result.listedParent) ? result.listedParent : null;
          setLookup(id, { state: 'done', operator: result.operator, listedParent: listed, fee: formatMicro(fee), ...(transaction ? { transaction } : {}), agent: config.lookup.agentId });
          if (listed) await buy(listed);
          else {
            // No listed owner: invest in the listed leader of the merchant's category, matched on the phone.
            let pick: CategoryPick | null = null, why = 'no category was a clear match';
            try { pick = await matchCategory(name, result, decision.explanation); } catch (error) { why = `the category check failed: ${error instanceof Error ? error.message : String(error)}`; }
            if (pick) { setCategory(id, pick); await buy(pick.leader); }
            else setPay(id, { state: 'signing', error: `Nothing bought: not a listed company, and ${why}` });
          }
        }
      }
    } catch (error) {
      const entry: Entry = { at: started, merchant: name, amount, error: error instanceof Error ? error.message : String(error), model: choice.label };
      setResults(list => [{ id, ...entry }, ...list]);
      keep(id, entry);
    } finally { busyRef.current = false; setBusy(false); }
    return true;
  }, [choice, pay, strategies, wallet]);

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
      if (!(await decide(tap.merchant, tap.amount))) fail(tap.merchant, tap.amount, 'Nest was not ready to decide this tap');
    }
  }).finally(() => setQueued(n => n - 1)); };

  // The sample is decided like a queued tap: in the same line, by `decide`, with its cap, checks and log.
  // Setup reaches this step only with the model loaded and the wallet open.
  const sampling = useRef(false); // a double press must not queue two real buys
  const trySample = () => {
    if (sampling.current) return;
    sampling.current = true;
    finishTo('home'); // the sample's result shows on Home
    const [merchant, amount] = ['APPLE.COM/BILL', '1,00 €'];
    setQueued(n => n + 1);
    tapChain.current = tapChain.current.then(async () => {
      while (busyRef.current) await new Promise(resolve => setTimeout(resolve, 250));
      if (!(await decide(merchant, amount))) fail(merchant, amount, 'Nest was not ready to decide this tap');
    }).finally(() => { sampling.current = false; setQueued(n => n - 1); });
  };

  // Read when the wallet opens and after every decision ends (`busy` back to false), so a finished buy or lookup shows.
  // Only the latest read may set the balance, so a slow older read never overwrites a newer one.
  const balanceRead = useRef(0);
  const readBalance = useCallback(async () => {
    if (!wallet.address) return;
    const read = ++balanceRead.current;
    try {
      const value = await sepoliaClient.readContract({ address: config.chain.token as `0x${string}`, abi: erc20Abi, functionName: 'balanceOf', args: [wallet.address as `0x${string}`] });
      if (read === balanceRead.current) setBalance({ value, at: Date.now() });
    } catch (error) {
      const message = (error as { shortMessage?: string }).shortMessage ?? (error instanceof Error ? error.message : String(error));
      if (read === balanceRead.current) setBalance(last => ({ error: message, last: last && 'value' in last ? last : last?.last }));
    }
  }, [wallet.address]);
  useEffect(() => { if (!busy) void readBalance(); }, [busy, readBalance]);

  // The chat model loads while the Chat tab is open and unloads when it is left, on the classifier's load chain so loads never overlap.
  // The phone cannot hold the classifier, the chat model and Whisper at once (Whisper's load aborts in ggml_init), so the classifier
  // is unloaded while chatting (queued taps wait) and loads again on leaving.
  const chatModelId = useRef<string | null>(null);
  const asking = useRef(false); // a completion is running on the chat model, so it is not unloaded under it
  const [chatModel, setChatModel] = useState<ChatModel>({ state: 'loading' });
  const whisperId = useRef<string | null>(null);
  const hearing = useRef(false); // a transcription is running, so Whisper is not unloaded under it
  const [voice, setVoice] = useState<Voice>({ state: 'loading', percent: null });
  const chatOpen = onboarded && tab === 'chat';
  useEffect(() => {
    if (!chatOpen) return;
    let cancelled = false;
    setChatModel({ state: 'loading' });
    loadChain.current = loadChain.current.then(async () => {
      if (cancelled) return;
      try {
        // Queued taps wait: no new taps are drained once not ready, the ones already drained finish first, then any decision or order.
        setReady(false);
        for (let chain; chain !== tapChain.current;) await (chain = tapChain.current); // a tap may join while one is awaited
        while (busyRef.current) await new Promise(resolve => setTimeout(resolve, 250));
        const savingsId = modelId.current;
        modelId.current = null; setStatus('Savings model unloaded while chatting');
        if (savingsId) await unloadModel({ modelId: savingsId, clearStorage: false });
        const embedder = embedId.current;
        embedId.current = null;
        if (embedder) await unloadModel({ modelId: embedder, clearStorage: false });
        const id = await loadModel({ modelSrc: QWEN3_5_2B_MULTIMODAL_Q4_K_M, modelType: 'llamacpp-completion', modelConfig: { device: 'gpu', ctx_size: 1024 } });
        if (cancelled) { await unloadModel({ modelId: id, clearStorage: false }); return; }
        chatModelId.current = id;
        setChatModel({ state: 'ready' });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!cancelled) setChatModel({ state: 'error', message });
        return;
      }
      // Whisper turns a voice message into text on the phone; a failure here leaves typing working.
      if (cancelled) return;
      try {
        setVoice({ state: 'loading', percent: null });
        // modelFitPolicy 'off': asr-ggml 0.11.2's fit probe aborts inside ggml_init on iOS (crash on Chat open), so the check is skipped.
        const id = await loadModel({ modelSrc: WHISPER_EN_TINY_Q8_0, modelType: 'whispercpp-transcription', modelFitPolicy: 'off',
          modelConfig: { audio_format: 'f32le', language: 'en', strategy: 'greedy', no_timestamps: true, temperature: 0.0, suppress_blank: true },
          onProgress: (p: { percentage: number }) => { if (!cancelled) setVoice({ state: 'loading', percent: Math.round(p.percentage) }); } } as never);
        if (cancelled) { await unloadModel({ modelId: id, clearStorage: false }); return; }
        whisperId.current = id;
        setVoice({ state: 'ready' });
      } catch (error) {
        if (!cancelled) setVoice({ state: 'error', message: error instanceof Error ? error.message : String(error) });
      }
    });
    return () => {
      cancelled = true;
      loadChain.current = loadChain.current.then(async () => {
        while (asking.current || hearing.current) await new Promise(resolve => setTimeout(resolve, 250));
        const voiceId = whisperId.current;
        whisperId.current = null;
        if (voiceId) await unloadModel({ modelId: voiceId, clearStorage: false }).catch(error => console.warn('Whisper unload failed:', error));
        const id = chatModelId.current;
        chatModelId.current = null;
        if (id) await unloadModel({ modelId: id, clearStorage: false }).catch(error => console.warn('Chat model unload failed:', error));
      });
      setLoadRequest(n => n + 1); // the classifier loads again after the unload above
    };
  }, [chatOpen]);

  // Turns a recorded voice message into text. It returns only text: the message then goes through `ask` like a typed one.
  const hear = async (path: string): Promise<string> => {
    if (!whisperId.current) throw new Error('Voice is not ready yet');
    hearing.current = true;
    try { return String(await transcribe({ modelId: whisperId.current, audioChunk: path.replace(/^file:\/\//, '') })).trim(); }
    finally { hearing.current = false; }
  };

  // Reads a message into an intent. It returns only the intent: nothing here can pay.
  const ask = async (message: string): Promise<Intent> => {
    if (!chatModelId.current) throw new Error('The chat model is not loaded');
    asking.current = true;
    try {
      const final = await completion({ modelId: chatModelId.current, kvCache: false, stream: false,
        history: [{ role: 'system', content: CHAT_SYSTEM }, { role: 'user', content: JSON.stringify({ message }) }],
        generationParams: CHAT_GENERATION, responseFormat: chatResponseFormat as never }).final;
      return parseIntent(final.contentText);
    } finally { asking.current = false; }
  };

  // The demo shop's endpoint and wallet, resolved once per app run; a failure is not kept, so the next message tries again.
  const shopAgent = useRef<Promise<ShopAgent> | null>(null);
  const shop = () => shopAgent.current ??= resolveAgent(resolveClient, { registry: config.shop.registry as Address, agentId: BigInt(config.shop.agentId) })
    .catch(error => {
      console.warn('ERC-8004 resolve failed:', error);
      shopAgent.current = null;
      throw new Error(`could not resolve agent #${config.shop.agentId}`);
    });

  // Written through like a lookup, so a kill mid-order is on disk.
  const setOrder = (id: number, order: Order) => {
    setResults(list => list.map(item => item.id === id ? { ...item, order } : item));
    const entry = kept.current.get(id);
    if (entry && 'order' in entry) keep(id, { ...entry, order });
  };

  // Only Confirm in the order sheet calls this. It pays exactly the quoted amount, to the shop agent's wallet, within the shopping limit.
  const order = async (agent: ShopAgent, title: string, { token, quote }: ShopQuote): Promise<Ordered> => {
    if (!wallet.address) return { error: 'The wallet is not open yet', expired: false };
    if (busyRef.current) return { error: 'Nest is deciding a purchase, try again in a moment', expired: false };
    busyRef.current = true;
    setBusy(true);
    const id = nextId.current++;
    const placed: Order = { state: 'paying', productId: quote.productId, title, priceAed: quote.priceAed, amount: quote.amount, source: quote.source, checkedAt: quote.checkedAt, agent: config.shop.agentId };
    const entry: Entry = { at: Date.now(), merchant: title, model: 'Nest demo shop', order: placed };
    setResults(list => [{ id, ...entry }, ...list]);
    keep(id, entry);
    let status = 0; // the shop's last HTTP status, to tell an expired or used quote (409) from other failures
    try {
      const { order: answer, amount, transaction } = await paidOrder({ url: orderUrl(agent.endpoint, token), shopping, timeoutMs: 90_000,
        signer: walletSigner(wallet.address, data => wallet.extension().signTypedData(data)),
        expected: { network: `eip155:${config.chain.chainId}`, asset: config.chain.token, maxAmount: BigInt(quote.amount), payTo: agent.wallet },
        fetch: (input, init) => fetch(input, init).then(response => { status = response.status; return response; }) });
      setOrder(id, { ...placed, state: 'done', orderId: answer.orderId, amount: amount.toString(), ...(transaction ? { transaction } : {}) });
      return { amount: amount.toString(), transaction };
    } catch (error) {
      const expired = status === 409 && !(error instanceof OrderFailed && error.mayBePaid);
      const message = expired ? EXPIRED : error instanceof OrderFailed
        ? (error.message === LIMIT_REFUSAL ? `${LIMIT_REFUSAL} (200 a day)` : error.message) : `Order unavailable: ${String(error)}`;
      setOrder(id, { ...placed, error: message });
      return { error: message, expired, mayBePaid: error instanceof OrderFailed && error.mayBePaid };
    } finally { busyRef.current = false; setBusy(false); }
  };

  let shopped: bigint | null = null;
  try { shopped = shoppedToday(shopping); } catch { shopped = null; }

  // An unreadable spend file shows as unknown here; `spend` refuses the next buy on its own.
  let spent: bigint | null = null;
  try { spent = spentToday(budget); } catch { spent = null; }
  const entry = openEntry === null ? undefined : results.find(item => item.id === openEntry);

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="dark" />
      {onboarded && ready && wallet.address && active && <IntentTaps onTaps={decideTaps} />}
      {!onboarded ? <Setup step={step} setStep={setStep} models={MODELS} modelChoice={modelChoice} choose={choose} choiceDisabled={busy || queued > 0 || loading}
        download={{ fraction: progress, loaded: ready, error: loadError, start: () => setLoadRequest(n => n + 1), retry: () => setLoadRequest(n => n + 1) }}
        wallet={{ address: wallet.address ?? undefined, existed: wallet.existed, creating: wallet.creating, loading: wallet.loading, error: wallet.error, create: wallet.create }}
        strategies={strategies} setShare={setShare} openShortcuts={() => Linking.openURL('shortcuts://')} trySample={trySample} finish={finish} /> : <>
      <View style={styles.screen}>
        {tab === 'home' && <Home address={wallet.address} walletError={wallet.error} balance={balance} spent={spent}
          holdings={holdings(results)} recent={results.slice(0, 3)} ready={ready} loading={loading} status={status}
          onOpen={setOpenEntry} onSeeAll={() => setTab('activity')} onRefresh={readBalance}
          tryMerchant={{ merchant, amount: typedAmount, setMerchant, setAmount: setTypedAmount, decide, busy, ready, examples: EXAMPLES }} />}
        {tab === 'chat' && <Chat model={chatModel} loadHistory={loadChat} saveHistory={keepChat} ask={ask} voice={voice} hear={hear} shop={shop} order={order} shopped={shopped} />}
        {tab === 'activity' && <Activity items={results} logNote={logNote} onOpen={setOpenEntry} />}
        {tab === 'agent' && <Agent models={MODELS} modelChoice={modelChoice} choose={choose} choiceDisabled={busy || queued > 0 || loading}
          status={status} strategies={strategies} setShare={setShare} lookupHost={LOOKUP_HOST}
          address={wallet.address} walletError={wallet.error} onReplaySetup={replaySetup} onClearChat={clearChat} />}
      </View>
      <TabBar tab={tab} onTab={setTab} />
      {entry && <EntrySheet item={entry} onClose={() => setOpenEntry(null)} />}
      </>}
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
});

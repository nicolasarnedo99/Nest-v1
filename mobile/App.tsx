// Turtle on the phone, step 1: a card line gets an S&P 500 company or none, decided on
// this device. Code reads the line, EmbeddingGemma (run through Tether's QVAC SDK) finds
// the closest rows of the shipped brand table, and code picks (lib/merchant.ts).
// The owner picks which Qwen3.5 2B reads Chat: with the fine-tuned adapter, or as it comes.
// When the company is listed on the seller, the phone builds the order, checks it against the per-buy limits,
// signs it with its own WDK wallet and sends the buy on Sepolia
// itself, as a UserOperation whose gas Candide's paymaster pays.
// When the phone places nothing, it pays 0.01 USD₮0 over x402 for a merchant
// lookup, and buys the same way if the lookup finds a parent the seller lists.
// Card taps noted in the background by the "Note Payment" Shortcuts action
// wait in a queue and are decided here, one by one, when the app is open.
// The chat, Nest's one screen, reads a request with the same model into a demo shop search and a Bitrefill search; only Buy, then Confirm, pays.
// It also reads "I paid 45 AED at Careem", which after Confirm is decided like a card tap: in-app Apple Pay never fires the Wallet automation.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Keyboard, KeyboardAvoidingView, Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Asset } from 'expo-asset';
import { completion, embed, getSystemResources, loadModel, transcribe, unloadModel, EMBEDDINGGEMMA_300M_Q4_0, GEMMA4_2B_MULTIMODAL_Q4_K_M, LLAMA_3_2_1B_INST_Q4_0, QWEN3_5_0_8B_MULTIMODAL_Q4_K_M, QWEN3_5_2B_MULTIMODAL_Q4_K_M, WHISPER_EN_TINY_Q8_0 } from '@qvac/sdk';
import { createSecureStorage, useAccount, useWalletManager } from '@tetherto/wdk-react-native-core';
import adapterAsset from './assets/turtle-adapter.gguf';
import brandsEmbAsset from './assets/brands.emb';
import config from './turtle.config.json';
import { File, Paths } from 'expo-file-system';
import { checkOrder } from './lib/pay';
import { buildOrder, buyCall, onSeller } from './lib/order';
import { brandIndex, explain, placeMerchant, type BrandIndex, type BrandTable } from './lib/merchant';
import { MAX_FEE, spend, spentToday, type Store } from './lib/budget';
import { parseLog, record, unsettledBuy, type CategoryPick, type Entry, type InvestTarget, type Lookup, type Order, type Pay } from './lib/log';
import { LookupFailed, OrderFailed, paidLookup, paidOrder, walletSigner, type Requirement } from './lib/x402';
import { orderUrl, type ShopQuote } from './lib/shop';
import { mirrorOrderUrl, packageLabel, paidMirrorOrder, type MirrorQuote } from './lib/mirror';
import { BitrefillSession } from './lib/bitrefill';
import { CHAT_SYSTEM, chatResponseFormat, honest, parseIntent, type Intent } from './lib/chat';
import { resolveAgent } from './lib/registry';
import { formatMicro, parseAmount } from '../server/money';
import { MODELS, onboardedFor, parseSettings, type ModelId, type PickId, type Strategies } from './lib/settings';
import { amountFor, amountForOrder } from './lib/strategy';
import { investedIn } from './lib/bought';
import { tapFromIntent } from './lib/tap';
import { removePendingInvocationAsync, useAppIntents, type AppIntentInvocation } from 'expo-app-intents';
import { createPublicClient, erc20Abi, http, type Address } from 'viem';
import { sepolia } from 'viem/chains';
import { openWallet } from './lib/wallet';
import { color } from './ui/theme';
import { Sheet } from './ui/kit';
import { Header } from './screens/Header';
import { Page, Pages } from './screens/Pages';
import { Splash } from './screens/Splash';
import { TourHint } from './screens/Tour';
import { TOUR, nextTourStep } from './lib/tour';
import { Portfolio } from './screens/Portfolio';
import { Activity } from './screens/Activity';
import { EntrySheet } from './screens/EntrySheet';
import { Agent, type Balance } from './screens/Agent';
import { Setup } from './screens/Setup';
import { parseChat, saveChat, type ChatMessage } from './lib/chat-history';
import { CATEGORIES, SHOP_TARGET, bitrefillTarget, categoryDocument, categoryQuery, closestCategory } from './lib/categories';
import type { Paying } from './lib/steps';
import { reading, track, type MemoryLog } from './lib/memory';
import { Chat, EXPIRED, type Ordered, type ShopAgent, type Voice } from './screens/Chat';
import { readReceiptRemote } from './lib/ocr-remote'; // receipt OCR
import { faucetUrl, lookupOrigin, requestTestFunds } from './lib/faucet'; // test funds

// Each pay step leaves its mark, so a result reads: decided, signed on this phone, bought.
type Payment = Pay;
export type Item = Entry & { id: number };

// The sheets over the chat, Nest's one screen; at most one is open.
type SheetName = 'settings'; // the portfolio and activity are pages beside the chat

// What was spent today, shown in the settings sheet: a small JSON file in Documents.
const spentFile = new File(Paths.document, 'turtle-spent.json');
const budget: Store = { read: () => spentFile.exists ? spentFile.textSync() : null, write: text => spentFile.writeSync(text) };

// What the results list showed, so it survives closing the app: a record only, never read to decide or pay.
const logFile = new File(Paths.document, 'activity.json');
// The chat history: every Chat message, so the conversation is still there after closing the app.
const chatFile = new File(Paths.document, 'chat.json');
const loadChat = () => { const { messages, problem } = parseChat(chatFile.exists ? chatFile.textSync() : null); if (problem) console.warn(problem); return messages; };
const keepChat = (messages: ChatMessage[]) => { try { chatFile.writeSync(saveChat(messages)); } catch (error) { console.warn('Chat history not saved:', error); } };
const clearChat = () => { if (chatFile.exists) chatFile.delete(); };

// Which model decides and which saving strategies are on, kept so the choice survives closing the app.
const settingsFile = new File(Paths.document, 'settings.json');
// Written when the first-run walkthrough ends or is skipped, so it shows once.
const tourFile = new File(Paths.document, 'tour.json');
const SDK_MODELS = { QWEN3_5_2B_MULTIMODAL_Q4_K_M, QWEN3_5_0_8B_MULTIMODAL_Q4_K_M, LLAMA_3_2_1B_INST_Q4_0, GEMMA4_2B_MULTIMODAL_Q4_K_M };

// Read-only: the wallet balance (portfolio and settings sheets), and the lookup's ERC-8004 agent (endpoint and payTo) before each lookup.
const sepoliaClient = createPublicClient({ chain: sepolia, transport: http('https://ethereum-sepolia-rpc.publicnode.com', { timeout: 10_000 }) });
// One attempt: viem's default 3 retries would hold the tap queue for ~80 s when the RPC is down.
const resolveClient = createPublicClient({ chain: sepolia, transport: http('https://ethereum-sepolia-rpc.publicnode.com', { timeout: 10_000, retryCount: 0 }) });
const LOOKUP_HOST = `ERC-8004 agent #${config.lookup.agentId} on Sepolia`;
// Chat reads a message into a search: the decision's settings, with room for the reply.
const CHAT_GENERATION = { ...config.generationParams, predict: 192 };
// null until the mirror agent is registered (sync writes it); the app then hides Bitrefill results.
const MIRROR = config.mirror as { registry: string; agentId: string; chainId: number } | null;

type Wallet7702 = {
  signTypedData(data: object): Promise<string>;
  sign(message: string): Promise<string>; // EIP-191, for the free Bitrefill sign-in only
  sendTransaction(tx: { to: string; value: string; data: string }): Promise<{ hash: string }>;
  getUserOperationReceipt(hash: string): Promise<{ success: boolean; receipt: { transactionHash: string } } | null>;
};

// What decides a card line now, recorded as the entry's model.
const MATCHER = 'EmbeddingGemma 300M + S&P 500 brand table';

// The S&P 500 brand table and its EmbeddingGemma index (scripts/embed-brands.mjs), read once per app run.
// Logs what it costs: load time and the change in the app's memory.
async function loadBrands(): Promise<{ table: BrandTable; index: BrandIndex }> {
  const before = reading(await getSystemResources({ sample: true })).used;
  const started = Date.now();
  const table = require('./assets/brands.json') as BrandTable; // bundled JSON, evaluated only here
  const asset = Asset.fromModule(brandsEmbAsset);
  await asset.downloadAsync();
  if (!asset.localUri) throw new Error('The brand index is not available on this device');
  const index = brandIndex(table, require('./assets/brands.emb.json'), await new File(asset.localUri).bytes());
  const ms = Date.now() - started;
  const after = reading(await getSystemResources({ sample: true })).used;
  console.log(`Brand index: ${table.brands.length} brands, ${index.brand.length} rows × ${index.dim} (${(index.vectors.byteLength / 2 ** 20).toFixed(1)} MB), ` +
    `loaded in ${ms} ms, app memory ${before !== null && after !== null ? `${((after - before) / 2 ** 20).toFixed(1)} MB more` : 'not readable'}`);
  return { table, index };
}

// The phone's own wallet, kept by WDK in the Keychain under one fixed id:
// created when setup asks for it, unlocked on every launch after that.
function useWallet(onboarded: boolean) {
  const { status, createWallet, unlock, deleteWallet } = useWalletManager();
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
  return { address, extension, error, existed, creating: opening && !address && !error, loading: status === 'LOADING', create: open,
    remove: () => deleteWallet('turtle') };
}

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
  // Queued taps, notes and orders run after the render that started them, so they read the latest limits here.
  const strategiesNow = useRef(strategies);
  strategiesNow.current = strategies;
  const [onboarded, setOnboarded] = useState(settings.onboarded);
  const save = (model: ModelId, next: Strategies, done = onboarded) => {
    try { settingsFile.writeSync(JSON.stringify({ model, strategies: next, onboarded: done })); }
    catch (error) { setLogNote(`Could not save the settings: ${error instanceof Error ? error.message : String(error)}`); }
  };
  const choose = (id: ModelId) => { setModelChoice(id); save(id, strategies); };
  const setShare = (share: number) => { const next = { ...strategiesNow.current, share }; strategiesNow.current = next; setStrategies(next); save(modelChoice, next); };
  // The leader is stored as no pick, so a file written before strategies could be picked reads the same.
  const setPick = (pick: PickId) => {
    const { pick: _old, ...rest } = strategiesNow.current;
    const next: Strategies = pick === 'leader' ? rest : { ...rest, pick };
    strategiesNow.current = next; setStrategies(next); save(modelChoice, next);
  };
  const setLimit = (key: 'maxBuy' | 'maxOrder', micro: string | null) => {
    const { [key]: _old, ...rest } = strategiesNow.current;
    const next = micro === null ? rest : { ...rest, [key]: micro };
    strategiesNow.current = next; setStrategies(next); save(modelChoice, next);
  };
  const replaySetup = () => { setOnboarded(false); save(modelChoice, strategies, false); };
  // Start over: deletes the wallet's key from the Keychain and this phone's activity, chat and settings. The running app still
  // holds the old wallet in memory, so it stops here and asks to be reopened; the next launch sets up a new wallet.
  const [wiped, setWiped] = useState(false);
  const startOver = async () => {
    if (busyRef.current || queued > 0) throw new Error('Nest is still working on a payment; try again when it ends');
    await wallet.remove();
    for (const file of [logFile, chatFile, spentFile, settingsFile, tourFile]) if (file.exists) file.delete();
    setWiped(true);
  };
  const [step, setStep] = useState(0);
  // Setup ends in the chat: the first thing a new user does is ask the agent for something.
  const finish = () => { setOnboarded(true); save(modelChoice, strategies, true); setStep(0); };
  const [status, setStatus] = useState('Starting');
  const [ready, setReady] = useState(false);
  // The walkthrough: null once done. It starts when the chat first shows after setup.
  const [tour, setTour] = useState<number | null>(() => (tourFile.exists ? null : 0));
  const moveTour = (event: Parameters<typeof nextTourStep>[1]) => setTour(step => {
    if (step === null) return null;
    const next = nextTourStep(step, event);
    if (next < TOUR.length) return next;
    try { tourFile.write('{"done":true}'); } catch {} // shortcut: a failed write shows the tour again next launch, harmless
    return null;
  });
  const skipTour = () => { try { tourFile.write('{"done":true}'); } catch {} setTour(null); };
  const [splash, setSplash] = useState(true); // the mark covers the chat until the model is ready and its strokes have flown out
  useEffect(() => { if (!ready) setSplash(true); }, [ready]);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Item[]>([]);
  const modelId = useRef<string | null>(null);
  const loaded = useRef(false); // `ready` as a ref, set where it is: a note from Chat polls it, and a rendered copy can miss a true batched away
  const nextId = useRef(0);
  const busyRef = useRef(false);
  // Chat and decisions share one model, which runs one completion at a time: each waits for the one before it.
  const inference = useRef<Promise<unknown>>(Promise.resolve());
  const onModel = <T,>(run: () => Promise<T>): Promise<T> => { const turn = inference.current.then(run); inference.current = turn.catch(() => {}); return turn; };
  const [logNote, setLogNote] = useState<string | null>(settings.problem ?? null);
  const kept = useRef(new Map<number, Entry>());
  const wallet = useWallet(onboarded);
  const active = useForeground();
  const [sheet, setSheet] = useState<SheetName | null>(null);
  const [chatKey, setChatKey] = useState(0); // a new key remounts the chat, so a cleared history leaves the screen at once
  const [openEntry, setOpenEntry] = useState<number | null>(null);
  const [balance, setBalance] = useState<Balance>(null);
  const setPay = (id: number, pay: Payment) => { lastPay.current.set(id, pay); setResults(list => list.map(item => item.id === id ? { ...item, pay } : item)); keepPay(id, pay); payWatch.current.get(id)?.(pay); }
  const payWatch = useRef(new Map<number, (pay: Payment) => void>()); // an order's invest, shown live in the Chat sheet
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
  // EmbeddingGemma places the merchant in the brand table and matches categories; it loads and unloads with the chat model,
  // the brand table once per app run. It never loads here: a decision holds busyRef, and waiting on the load chain from
  // inside one can deadlock with Chat.
  const embedId = useRef<string | null>(null);
  const brands = useRef<{ table: BrandTable; index: BrandIndex } | null>(null);
  const matchCategory = async (merchant: string, lookup: { operator: string | null; note?: string }): Promise<CategoryPick | null> => {
    if (!embedId.current) throw new Error('the category model is not loaded yet');
    const { embedding } = await embed({ modelId: embedId.current, text: [categoryQuery(merchant, lookup, ''), ...CATEGORIES.map(categoryDocument)] });
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
    else if (entry && 'order' in entry) keep(id, { ...entry, pay });
  };
  const lastPay = useRef(new Map<number, Payment>());
  const unsettled = useRef(new Map<number, Entry>()); // buys the log says were cut off mid-flight, by result id
  useEffect(() => {
    try {
      const { entries, problem } = parseLog(logFile.exists ? logFile.textSync() : null);
      if (problem) setLogNote(problem);
      const first = nextId.current; nextId.current += entries.length;
      setResults(list => [...list, ...entries.map((entry, i) => ({ ...entry, id: first + i }))]);
      entries.forEach((entry, i) => { if (unsettledBuy(entry)) unsettled.current.set(first + i, entry); });
    } catch (error) { setLogNote(`Could not read the activity log: ${error instanceof Error ? error.message : String(error)}`); }
  }, []);
  // A buy cut off by a relaunch (iOS ends a backgrounded app while it waits for mining) may still have landed:
  // once the wallet opens, ask the bundler once for each, and record it as bought if it was included.
  useEffect(() => {
    if (!wallet.address || unsettled.current.size === 0) return;
    const pending = [...unsettled.current]; unsettled.current.clear();
    for (const [id, entry] of pending) {
      const userOperation = unsettledBuy(entry)!;
      wallet.extension().getUserOperationReceipt(userOperation).then(included => {
        if (!included || !('pay' in entry) || !entry.pay) return; // not included (yet): the interrupted warning stays
        kept.current.set(id, entry);
        setPay(id, { state: 'bought', value: entry.pay.value, transaction: included.receipt.transactionHash, userOperation, confirmed: included.success });
      }, () => {}); // unreachable bundler: the interrupted warning already says to check Etherscan
    }
  }, [wallet.address]);

  // One attempt, never retried: any step that fails becomes the result's error line.
  // The buy counts toward today's total before signing, and is given back only if
  // it failed before it was handed to the bundler.
  const pay = async (id: number, company: string, eventId: string, amount: bigint) => {
    const value = formatMicro(amount);
    setPay(id, { state: 'signing', value });
    let spent: ReturnType<typeof spend> | undefined;
    try {
      const buyer = wallet.address;
      if (!buyer) throw new Error('The wallet is not open yet');
      const nowSeconds = Math.floor(Date.now() / 1000);
      // The company id on the configured seller: the index seller's position in brands.json's companies, or the stock seller's (see scripts/stocks.mjs).
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
      setPay(id, { state: 'signing', ...lastPay.current.get(id), error: error instanceof Error ? error.message : String(error) });
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
      setReady(false); setLoading(true); setProgress(0); setLoadError(null); loaded.current = false;
      try {
        const old = modelId.current;
        modelId.current = null;
        await inference.current; // a chat message may still be running on it
        if (old) await unloadModel({ modelId: old, clearStorage: false });
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
        // A cached model reports 100% at once; progress only streams when onProgress is passed.
        const id = await loadModel({ modelSrc: SDK_MODELS[choice.sdk], modelType: 'llamacpp-completion',
          modelConfig: { device: 'gpu', ctx_size: 1024, ...(lora ? { lora } : {}) },
          onProgress: p => { if (!cancelled) setProgress(p.percentage / 100); } });
        if (cancelled) { await unloadModel({ modelId: id, clearStorage: false }); return; }
        modelId.current = id;
        // EmbeddingGemma (about 280 MB the first time) and the brand table load before ready, so a decision never waits on a download.
        setStatus('Loading the merchant match'); setProgress(0);
        try {
          const embedder = await loadModel({ modelSrc: EMBEDDINGGEMMA_300M_Q4_0, modelType: 'llamacpp-embedding',
            onProgress: (p: { percentage: number }) => { if (!cancelled) setProgress(p.percentage / 100); } } as never);
          if (cancelled) { await unloadModel({ modelId: embedder, clearStorage: false }); return; }
          embedId.current = embedder;
          brands.current ??= await loadBrands();
        } catch (error) { console.warn('Merchant match failed to load:', error); } // card lines then buy nothing, and say why
        setStatus(`${choice.label} ready`);
        setReady(true); loaded.current = true;
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
  // `onStart` gets the entry's `at`, so a chat message can follow this decision.
  const decide = useCallback(async (text: string, amount?: string, onStart?: (at: number) => void): Promise<boolean> => {
    const name = text.trim();
    if (!name || !loaded.current || busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    const started = Date.now();
    const id = nextId.current++;
    onStart?.(started);
    try {
      const embedder = embedId.current, table = brands.current;
      if (!embedder || !table) throw new Error('The merchant match is not loaded: EmbeddingGemma or the brand table failed to load');
      const placement = await placeMerchant(name, { ...table, embed: async texts => (await embed({ modelId: embedder, text: texts })).embedding as number[][] });
      // The placed company on the seller, by ticker: one it does not list buys nothing, never another company.
      const target = placement.company ? onSeller(placement.company, config) : null;
      const entry: Entry = { at: started, merchant: name, amount, company: target && 'name' in target ? target.name : placement.company?.name ?? null,
        explanation: explain(placement), placement: placement.step, seconds: (Date.now() - started) / 1000, model: MATCHER };
      setResults(list => [{ id, ...entry }, ...list]);
      keep(id, entry);
      // One buy per entry, from the placement or the lookup's listed parent, so they share an event id.
      const invest = amountFor(strategiesNow.current, amount ?? '');
      const buy = async (company: string) => {
        if (invest === null) setPay(id, { state: 'signing', error: 'Nothing bought: no amount to invest (unreadable or missing amount, or investing is set to 0%)' });
        else await pay(id, company, `phone-${started}-${id}`, invest);
      };
      if (target) {
        if ('error' in target) setPay(id, { state: 'signing', error: target.error });
        else await buy(target.name);
      }
      // Nothing is paid to look up text that is not a merchant.
      else if (placement.step === 'instruction') setLookup(id, { state: 'paying', error: 'Not looked up: the line is an instruction, not a merchant' });
      else if (invest === null) setLookup(id, { state: 'paying', error: 'Not looked up: nothing to invest (investing is set to 0% or no readable amount)' });
      else if (!wallet.address) setLookup(id, { state: 'paying', error: 'Lookup unavailable: the wallet is not open yet' });
      else {
        // The phone placed nothing: pay 0.01 for a lookup, which can still find a listed parent.
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
          // The parser only passes a ticker with a listed parent; the seller's name is kept, so holdings and logos match the buy.
          const parent = result.listedParent && result.ticker ? onSeller({ ticker: result.ticker, name: result.listedParent }, config) : null;
          setLookup(id, { state: 'done', operator: result.operator, listedParent: parent && 'name' in parent ? parent.name : result.listedParent, fee: formatMicro(fee),
            ...(transaction ? { transaction } : {}), agent: config.lookup.agentId, source: result.source });
          if (parent) {
            if ('error' in parent) setPay(id, { state: 'signing', error: parent.error });
            else await buy(parent.name);
          } else {
            // No listed owner: invest in the listed leader of the merchant's category, matched on the phone.
            let pick: CategoryPick | null = null, why = 'no category was a clear match';
            try { pick = await matchCategory(name, result); } catch (error) { why = `the category check failed: ${error instanceof Error ? error.message : String(error)}`; }
            if (pick) { setCategory(id, pick); await buy(pick.leader); }
            else setPay(id, { state: 'signing', error: `Nothing bought: not a listed company, and ${why}` });
          }
        }
      }
    } catch (error) {
      const entry: Entry = { at: started, merchant: name, amount, error: error instanceof Error ? error.message : String(error), model: MATCHER };
      setResults(list => [{ id, ...entry }, ...list]);
      keep(id, entry);
    } finally { busyRef.current = false; setBusy(false); }
    return true;
  }, [pay, wallet]);

  // Each tap leaves the queue before it is decided, so it is never paid twice, even
  // if Turtle is opened again or killed mid-way; a tap cut short that way is lost, not repeated.
  const seenTaps = useRef(new Set<string>());
  const tapChain = useRef(Promise.resolve());
  const fail = (merchant: string, amount: string | undefined, error: string, onStart?: (at: number) => void) => {
    const id = nextId.current++, entry: Entry = { at: Date.now(), merchant, amount, error, model: choice.label };
    onStart?.(entry.at);
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
    finish(); // the sample's result shows on the activity page
    const [merchant, amount] = ['APPLE.COM/BILL', '1,00 €'];
    setQueued(n => n + 1);
    tapChain.current = tapChain.current.then(async () => {
      while (busyRef.current) await new Promise(resolve => setTimeout(resolve, 250));
      if (!(await decide(merchant, amount))) fail(merchant, amount, 'Nest was not ready to decide this tap');
    }).finally(() => { sampling.current = false; setQueued(n => n - 1); });
  };

  // A payment told in Chat ("I paid 45 AED at Careem"), after Confirm: decided like a queued tap, in the same line, by `decide`.
  // The decision shows in the chat message that confirmed it; at launch the model may still be loading, so the run waits until it is ready.
  const noting = useRef(false); // a double Confirm must not queue two real buys
  const notePayment = (merchant: string, amount: string, onStart?: (at: number) => void) => {
    if (noting.current) return false;
    noting.current = true;
    setQueued(n => n + 1);
    tapChain.current = tapChain.current.then(async () => {
      // `loaded`, not just modelId: the category model loads after the classifier, and an unlisted merchant needs it.
      for (const until = Date.now() + 60_000; !loaded.current || !modelId.current;) {
        if (Date.now() > until) { fail(merchant, amount, 'Nest was not ready to decide this payment', onStart); return; }
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      while (busyRef.current) await new Promise(resolve => setTimeout(resolve, 250));
      if (!(await decide(merchant, amount, onStart))) fail(merchant, amount, 'Nest was not ready to decide this payment', onStart);
    }).finally(() => { noting.current = false; setQueued(n => n - 1); });
    return true;
  };

  // Try again from the chat, once, on a failed buy: the same company, amount and event id as the first try, so a buy that landed after all
  // is refused by the seller instead of bought twice. The lookup is not paid again.
  const retryBuy = (at: number): boolean => {
    const found = results.find(item => item.at === at);
    // Only an entry from this launch: its event id has the entry id in it, and ids are given again at each launch.
    if (!found || !kept.current.has(found.id) || busyRef.current || !('pay' in found) || !found.pay?.value) return false;
    const { id } = found, entry = kept.current.get(id)!;
    const company = 'order' in entry ? entry.invest?.company : 'company' in entry ? investedIn(entry)[0] : null;
    let value: bigint;
    try { value = parseAmount(found.pay.value); } catch { return false; }
    if (!company) return false;
    busyRef.current = true;
    setBusy(true);
    void pay(id, company, 'order' in entry ? `phone-order-${at}-${id}` : `phone-${at}-${id}`, value).finally(() => { busyRef.current = false; setBusy(false); });
    return true;
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
  // test funds: the faucet lives beside the lookup, so the lookup agent's endpoint gives its host. Resolves with the amount and the mint's hash.
  const addTestFunds = async () => { // test funds
    if (!wallet.address) throw new Error('The wallet is not open yet');
    const agent = await resolveAgent(resolveClient, { registry: config.lookup.registry as Address, agentId: BigInt(config.lookup.agentId) })
      .catch(error => { console.warn('ERC-8004 resolve failed:', error); throw new Error(`Test funds unavailable: could not find ${LOOKUP_HOST}`); });
    const funds = await requestTestFunds(faucetUrl(agent.endpoint), wallet.address);
    void readBalance();
    return funds;
  };

  // Whisper loads once setup is done and stays loaded with the chat, on the model's load chain so loads never overlap; it unloads on Replay setup.
  const whisperId = useRef<string | null>(null);
  const hearing = useRef(false); // a transcription is running, so Whisper is not unloaded under it
  const [voice, setVoice] = useState<Voice>({ state: 'loading', percent: null });
  const chatOpen = onboarded; // the chat is the one screen, so it is open whenever setup is done
  useEffect(() => {
    if (!chatOpen) return;
    let cancelled = false;
    loadChain.current = loadChain.current.then(async () => {
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
        while (hearing.current) await new Promise(resolve => setTimeout(resolve, 250));
        const voiceId = whisperId.current;
        whisperId.current = null;
        if (voiceId) await unloadModel({ modelId: voiceId, clearStorage: false }).catch(error => console.warn('Whisper unload failed:', error));
      });
    };
  }, [chatOpen]);

  // Turns a recorded voice message into text. It returns only text: the message then goes through `ask` like a typed one.
  const hear = async (path: string): Promise<string> => {
    if (!whisperId.current) throw new Error('Voice is not ready yet');
    hearing.current = true;
    try { return String(await transcribe({ modelId: whisperId.current, audioChunk: path.replace(/^file:\/\//, '') })).trim(); }
    finally { hearing.current = false; }
  };

  // Memory on this phone every 3 s, with the highest use and lowest headroom seen since launch and which models were
  // loaded then, Whisper included.
  const [memory, setMemory] = useState<MemoryLog | null>(null);
  useEffect(() => {
    if (!onboarded) return;
    const timer = setInterval(() => {
      const loaded = [modelId.current && 'savings and chat', embedId.current && 'merchant match', whisperId.current && 'Whisper']
        .filter(Boolean).join(' + ') || 'no models';
      getSystemResources({ sample: true }).then(r => setMemory(log => track(log, reading(r), loaded)))
        .catch(error => console.warn('Memory sample failed:', error));
    }, 3000);
    return () => clearInterval(timer);
  }, [onboarded]);

  // Receipt OCR: the phone has no memory left for the OCR model, so the image is read by the receipt reader beside the lookup.
  const readReceipt = async (uri: string, contentType: string) => {
    const agent = await resolveAgent(resolveClient, { registry: config.lookup.registry as Address, agentId: BigInt(config.lookup.agentId) })
      .catch(error => { console.warn('ERC-8004 resolve failed:', error); throw new Error(`could not find ${LOOKUP_HOST}`); });
    return readReceiptRemote(fetch, lookupOrigin(agent.endpoint), new Uint8Array(await new File(uri).arrayBuffer()), contentType);
  };

  // Reads a message into an intent. It returns only the intent: nothing here can pay.
  const ask = async (message: string): Promise<Intent> => {
    const model = modelId.current;
    if (!model) throw new Error('The model is not loaded');
    const final = await onModel(() => completion({ modelId: model, kvCache: false, stream: false,
      history: [{ role: 'system', content: CHAT_SYSTEM }, { role: 'user', content: JSON.stringify({ message }) }],
      generationParams: CHAT_GENERATION, responseFormat: chatResponseFormat as never }).final);
    return honest(parseIntent(final.contentText), message);
  };

  // The demo shop's endpoint and wallet, resolved once per app run; a failure is not kept, so the next message tries again.
  const shopAgent = useRef<Promise<ShopAgent> | null>(null);
  const shop = () => shopAgent.current ??= resolveAgent(resolveClient, { registry: config.shop.registry as Address, agentId: BigInt(config.shop.agentId) })
    .catch(error => {
      console.warn('ERC-8004 resolve failed:', error);
      shopAgent.current = null;
      throw new Error(`could not resolve agent #${config.shop.agentId}`);
    });

  // The Bitrefill mirror's endpoint and wallet, resolved like the shop's.
  const mirrorAgent = useRef<Promise<ShopAgent> | null>(null);
  const mirror = () => {
    if (!MIRROR) return Promise.reject(new Error('Bitrefill seller not registered yet'));
    return mirrorAgent.current ??= resolveAgent(resolveClient, { registry: MIRROR.registry as Address, agentId: BigInt(MIRROR.agentId) })
      .catch(error => {
        console.warn('ERC-8004 resolve failed:', error);
        mirrorAgent.current = null;
        throw new Error(`could not resolve agent #${MIRROR.agentId}`);
      });
  };
  // One Bitrefill session per app run, signed in for free by this phone's wallet. It browses only: it never pays.
  const walletNow = useRef(wallet);
  walletNow.current = wallet;
  const bitrefillSession = useRef<BitrefillSession | null>(null);
  const bitrefill = MIRROR ? () => {
    const address = walletNow.current.address;
    if (!address) throw new Error('the wallet is not open yet');
    return bitrefillSession.current ??= new BitrefillSession({ address, sign: message => walletNow.current.extension().sign(message) });
  } : null;

  // Written through like a lookup, so a kill mid-order is on disk.
  const setOrder = (id: number, order: Order) => {
    setResults(list => list.map(item => item.id === id ? { ...item, order } : item));
    const entry = kept.current.get(id);
    if (entry && 'order' in entry) keep(id, { ...entry, order });
  };

  // After an order settles: invest the chosen share of it in `target` with the decisions' gasless buy, under a fresh event id.
  // It runs inside the order's busyRef hold and releases it; a failed or skipped buy is written on the entry's `pay`, never on the order.
  const investAfter = async (id: number, at: number, settled: Order, target: InvestTarget, progress: (paying: Paying) => void) => {
    try {
      setResults(list => list.map(item => item.id === id ? { ...item, invest: target } : item));
      const entry = kept.current.get(id);
      if (entry && 'order' in entry) keep(id, { ...entry, invest: target });
      progress({ order: settled, invest: target });
      payWatch.current.set(id, pay => progress({ order: settled, invest: target, pay }));
      const value = amountForOrder(strategiesNow.current, settled.amount);
      if (value === null) setPay(id, { state: 'signing', error: 'Nothing bought: no amount to invest (investing is set to 0%, or the order was under a cent)' });
      else await pay(id, target.company, `phone-order-${at}-${id}`, value);
    } finally { payWatch.current.delete(id); busyRef.current = false; setBusy(false); }
  };

  // Only Confirm in the order sheet calls this. It pays exactly the quoted amount, to the shop agent's wallet.
  // `progress` gets the order at each x402 step (402 checked, signed, settled or failed), so the sheet can show it as it happens.
  const order = async (agent: ShopAgent, title: string, { token, quote }: ShopQuote, progress: (paying: Paying) => void, onStart?: (at: number) => void): Promise<Ordered> => {
    if (!wallet.address) return { error: 'The wallet is not open yet', expired: false };
    if (busyRef.current) return { error: 'Nest is finishing the last purchase and its invest, try again in a moment', expired: false };
    busyRef.current = true;
    setBusy(true);
    const id = nextId.current++;
    const placed: Order = { state: 'paying', productId: quote.productId, title, priceAed: quote.priceAed, amount: quote.amount, source: quote.source, checkedAt: quote.checkedAt, agent: config.shop.agentId };
    const entry: Entry = { at: Date.now(), merchant: title, model: 'Nest demo shop', order: placed };
    setResults(list => [{ id, ...entry }, ...list]);
    keep(id, entry);
    onStart?.(entry.at);
    progress({ order: placed });
    let current: Order = placed;
    const update = (next: Order) => { current = next; setOrder(id, next); progress({ order: next }); };
    const watch = { onRequirement: ({ amount, payTo, scheme, network }: Requirement) => update({ ...current, amount, payTo, scheme, network }),
      onSigned: () => update({ ...current, signed: true }) };
    let status = 0; // the shop's last HTTP status, to tell an expired or used quote (409) from other failures
    let investing = false; // once settled, the invest after it holds busyRef and releases it
    try {
      const { order: answer, amount, transaction } = await paidOrder({ url: orderUrl(agent.endpoint, token), timeoutMs: 90_000,
        signer: walletSigner(wallet.address, data => wallet.extension().signTypedData(data)),
        expected: { network: `eip155:${config.chain.chainId}`, asset: config.chain.token, maxAmount: BigInt(quote.amount), payTo: agent.wallet }, ...(strategiesNow.current.maxOrder ? { maxOrder: BigInt(strategiesNow.current.maxOrder) } : {}),
        fetch: (input, init) => fetch(input, init).then(response => { status = response.status; return response; }), ...watch });
      update({ ...current, state: 'done', orderId: answer.orderId, amount: amount.toString(), ...(transaction ? { transaction } : {}) });
      investing = true;
      void investAfter(id, entry.at, current, SHOP_TARGET, progress);
      return { amount: amount.toString(), transaction };
    } catch (error) {
      const expired = status === 409 && !(error instanceof OrderFailed && error.mayBePaid);
      const message = expired ? EXPIRED : error instanceof OrderFailed
        ? error.message : `Order unavailable: ${String(error)}`;
      update({ ...current, error: message });
      return { error: message, expired, mayBePaid: error instanceof OrderFailed && error.mayBePaid };
    } finally { if (!investing) { busyRef.current = false; setBusy(false); } }
  };

  // Only Confirm in the Bitrefill sheet calls this: the shop order's rules, paid to the mirror agent's wallet on Sepolia. Bitrefill is never paid.
  const orderMirror = async (agent: ShopAgent, { token, quote, wouldPay }: MirrorQuote, progress: (paying: Paying) => void, onStart?: (at: number) => void): Promise<Ordered> => {
    if (!wallet.address) return { error: 'The wallet is not open yet', expired: false };
    if (busyRef.current) return { error: 'Nest is finishing the last purchase and its invest, try again in a moment', expired: false };
    busyRef.current = true;
    setBusy(true);
    const id = nextId.current++;
    const placed: Order = { state: 'paying', seller: 'bitrefill', productId: quote.slug, title: quote.title, packageValue: packageLabel(quote.packageValue, quote.packageCurrency),
      priceUsd: quote.priceUsd, amount: quote.amount, checkedAt: quote.checkedAt, wouldPay, agent: MIRROR?.agentId };
    const entry: Entry = { at: Date.now(), merchant: quote.title, model: 'Bitrefill mirror', order: placed };
    setResults(list => [{ id, ...entry }, ...list]);
    keep(id, entry);
    onStart?.(entry.at);
    progress({ order: placed });
    let current: Order = placed;
    const update = (next: Order) => { current = next; setOrder(id, next); progress({ order: next }); };
    const watch = { onRequirement: ({ amount, payTo, scheme, network }: Requirement) => update({ ...current, amount, payTo, scheme, network }),
      onSigned: () => update({ ...current, signed: true }) };
    let status = 0; // the mirror's last HTTP status, to tell an expired or used quote (409) from other failures
    let investing = false;
    try {
      const { order: answer, amount, transaction } = await paidMirrorOrder({ url: mirrorOrderUrl(agent.endpoint, token), timeoutMs: 90_000,
        signer: walletSigner(wallet.address, data => wallet.extension().signTypedData(data)),
        expected: { network: `eip155:${config.chain.chainId}`, asset: config.chain.token, maxAmount: BigInt(quote.amount), payTo: agent.wallet }, ...(strategiesNow.current.maxOrder ? { maxOrder: BigInt(strategiesNow.current.maxOrder) } : {}),
        fetch: (input, init) => fetch(input, init).then(response => { status = response.status; return response; }), ...watch });
      update({ ...current, state: 'done', orderId: answer.orderId, amount: amount.toString(), ...(transaction ? { transaction } : {}) });
      investing = true;
      void investAfter(id, entry.at, current, bitrefillTarget({ kind: quote.kind, name: quote.title }), progress);
      return { amount: amount.toString(), transaction };
    } catch (error) {
      const expired = status === 409 && !(error instanceof OrderFailed && error.mayBePaid);
      const message = expired ? EXPIRED : error instanceof OrderFailed
        ? error.message : `Order unavailable: ${String(error)}`;
      update({ ...current, error: message });
      return { error: message, expired, mayBePaid: error instanceof OrderFailed && error.mayBePaid };
    } finally { if (!investing) { busyRef.current = false; setBusy(false); } }
  };


  // An unreadable spend file shows as unknown here; `spend` refuses the next buy on its own.
  let spent: bigint | null = null;
  try { spent = spentToday(budget); } catch { spent = null; }
  const entry = openEntry === null ? undefined : results.find(item => item.id === openEntry);
  // Opening the portfolio or settings reads the balance again.
  const openSheet = (next: SheetName) => { Keyboard.dismiss(); setSheet(next); void readBalance(); };
  const closeSheet = () => { setSheet(null); setOpenEntry(null); };

  if (wiped) return (
    <View style={[styles.screen, styles.wiped]}>
      <StatusBar style="dark" />
      <Text style={styles.wipedText}>This wallet, its activity and the chat are deleted from this phone. Close Nest and open it again to set up a new wallet.</Text>
    </View>
  );

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="dark" />
      {onboarded && ready && wallet.address && active && <IntentTaps onTaps={decideTaps} />}
      {!onboarded ? <Setup step={step} setStep={setStep} models={MODELS} modelChoice={modelChoice} choose={choose} choiceDisabled={busy || queued > 0 || loading}
        download={{ fraction: progress, loaded: ready, error: loadError, start: () => setLoadRequest(n => n + 1), retry: () => setLoadRequest(n => n + 1) }}
        wallet={{ address: wallet.address ?? undefined, existed: wallet.existed, creating: wallet.creating, loading: wallet.loading, error: wallet.error, create: wallet.create }}
        strategies={strategies} setShare={setShare} setLimit={setLimit} setPick={setPick} openShortcuts={() => Linking.openURL('shortcuts://')} trySample={trySample} finish={finish} /> : <>
      <Pages onPage={page => { if (page !== 1) Keyboard.dismiss(); if (page === 0) void readBalance(); moveTour({ page }); }}
        left={<Page title="Portfolio"><Portfolio entries={results} balance={balance} address={wallet.address} walletError={wallet.error} spent={spent} addTestFunds={addTestFunds} /* test funds */ /></Page>}
        right={<Page title="Activity"><Activity items={results} logNote={logNote} onOpen={setOpenEntry} /></Page>}
        middle={<Chat key={chatKey} model={loadError ? { state: 'error', message: loadError } : ready ? { state: 'ready' } : { state: 'loading' }} loadHistory={loadChat} saveHistory={keepChat} ask={ask} voice={voice} hear={hear} shop={shop} order={order}
          bitrefill={bitrefill} mirror={mirror} orderMirror={orderMirror} notePayment={notePayment} readReceipt={readReceipt} // receipt OCR
          receiptHint={tour === 1 ? TOUR[1] : undefined} onReceiptOpen={open => moveTour({ receipt: open })}
          entries={results} strategies={strategies} retryBuy={retryBuy} openEntry={at => { const found = results.find(item => item.at === at); if (found) { Keyboard.dismiss(); setOpenEntry(found.id); } }}
          header={<Header onSettings={() => openSheet('settings')} />} />} />
      {onboarded && !splash && tour !== null && tour !== 1 && sheet === null && !entry && <TourHint step={tour} onSkip={skipTour} />}
      {splash && <Splash ready={ready} error={loadError} onDone={() => setSplash(false)} />}
      {sheet === null && entry && <EntrySheet item={entry} onClose={() => setOpenEntry(null)} />}{/* from the activity page or a payment message */}
      {sheet === 'settings' && <Sheet title="Settings" onClose={closeSheet}>
        <Agent models={MODELS} modelChoice={modelChoice} choose={choose} choiceDisabled={busy || queued > 0 || loading}
          status={status} strategies={strategies} setShare={setShare} setLimit={setLimit} setPick={setPick}
          onReplaySetup={() => { closeSheet(); replaySetup(); }} onClearChat={() => { clearChat(); setChatKey(k => k + 1); }} onStartOver={startOver} memory={memory} />
      </Sheet>}
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
  wiped: { justifyContent: 'center', padding: 32 },
  wipedText: { fontSize: 17, lineHeight: 24, textAlign: 'center' },
  screen: { flex: 1, backgroundColor: color.bg },
});

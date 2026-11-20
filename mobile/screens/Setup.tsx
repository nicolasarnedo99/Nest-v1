// First launch, and "Replay setup": Welcome, then six steps you swipe through: download the model, open the wallet, how much it
// invests, what it buys, connect the card, and what the agent may spend. A step only opens once the one before is done.
import { useEffect, useRef, type ComponentRef, type ReactNode } from 'react';
import { Animated, ScrollView, StyleSheet, Text, View, useWindowDimensions, Pressable } from 'react-native';
import { Button, Card, LimitRow, LockableScroll, Mark, Panel, Pill, ProgressBar, Slider } from '../ui/kit';
import { color, radius, type } from '../ui/theme';
import type { MODELS, ModelId, PickId, Strategies } from '../lib/settings';
import { StrategyPicker } from './Agent';
import { MINIMUM_BUY } from '../../server/money';
import { short } from './Agent';

const WELCOME = [['The models run on this phone', 'Each purchase is matched against an S&P 500 brand table here'],
  ['The wallet lives on this phone', 'It signs every buy itself, gas is sponsored'], ['Open source', 'Read the code and the trained adapter']] as const;
const STEPS = 6;

export function Setup({ step, setStep, models, modelChoice, choose, choiceDisabled, download, wallet, strategies, setShare, setLimit, setPick, openShortcuts, trySample, finish }: {
  step: number; setStep(step: number): void; models: typeof MODELS; modelChoice: ModelId; choose(id: ModelId): void; choiceDisabled: boolean;
  download: { fraction: number | null; loaded: boolean; error: string | null; start(): void; retry(): void };
  wallet: { address?: string; existed: boolean; creating: boolean; loading: boolean; error: string | null; create(): void };
  strategies: Strategies; setShare(share: number): void; setLimit(key: 'maxBuy' | 'maxOrder', micro: string | null): void; setPick(pick: PickId): void; openShortcuts(): void; trySample(): void; finish(): void;
}) {
  const { width } = useWindowDimensions();
  const pager = useRef<ComponentRef<typeof ScrollView>>(null);
  // How far the swipe may go: the model must be downloaded before the wallet, and the wallet open before the rest.
  const reachable = !download.loaded ? 1 : !wallet.address ? 2 : STEPS;
  const go = (to: number) => { setStep(to); pager.current?.scrollTo({ x: (to - 1) * width, animated: true }); };
  const next = () => go(step + 1);
  if (step === 0) return <Welcome start={() => setStep(1)} />;

  // Downloading from "Download model" until the load ends; a choice made then would restart it.
  const downloading = download.fraction !== null && !download.loaded && !download.error;
  const fraction = download.loaded ? 1 : download.fraction;
  // Also off while a decision runs: choosing unloads the model it is using.
  const locked = downloading || choiceDisabled;
  const chosen = models.find(m => m.id === modelChoice);

  const pages: ReactNode[] = [
    <Page key="model">
      <Heading title="Choose the model">It reads Chat on this phone, downloads once and then works offline. Scores are from naming the company behind 24 merchants it never saw.</Heading>
      {models.map(m => (
        <Pressable key={m.id} accessibilityRole="button" accessibilityState={{ selected: m.id === modelChoice, disabled: locked }}
          disabled={locked} onPress={() => choose(m.id)} style={[s.option, m.id === modelChoice && s.optionOn, locked && m.id !== modelChoice && s.off]}>
          <View style={s.line}><Text style={s.optionName}>{m.name}</Text>{m.adapter && <Pill label="Recommended" tone="solid" />}</View>
          <View style={s.facts}>
            {'score' in m && <Text style={s.small}><Text style={s.fact}>{m.score}</Text> correct</Text>}
            <Text style={s.small}><Text style={s.fact}>{m.download}</Text> download</Text>
          </View>
        </Pressable>
      ))}
      <View style={s.grow} />
      {fraction !== null && !download.error && (
        <View style={s.progress}>
          <View style={s.line}>
            <Text style={s.small}>{chosen?.label}</Text>
            <Text style={s.small}>{download.loaded ? 'Downloaded' : `${Math.round(fraction * 100)}%`}</Text>
          </View>
          <ProgressBar fraction={fraction} />
        </View>
      )}
      {download.error && <Text style={s.error}>{download.error}</Text>}
      {download.error ? <Button title="Try again" onPress={download.retry} />
        : download.loaded ? <Button title="Continue" onPress={next} />
        : <Button title={downloading ? 'Downloading…' : 'Download model'} disabled={downloading} onPress={download.start} />}
    </Page>,

    <Page key="wallet">
      <Heading title="Create your wallet">The key is generated on this phone and kept in its Keychain. It holds USD₮0 and the stock tokens it buys. It never needs ETH: a paymaster covers gas.</Heading>
      {wallet.address && (
        <Panel>
          <View style={s.panelBody}>
            <View style={s.line}>
              <View style={s.done}><View style={s.tick}><Text style={s.tickText}>✓</Text></View>
                <Text style={s.strong}>{wallet.existed ? 'Already on this phone' : 'Created on this phone'}</Text></View>
              <Pill label="Sepolia" tone="quiet" />
            </View>
            <Text style={s.address}>{short(wallet.address)}</Text>
            <Text style={s.mono}>{wallet.address}</Text>
          </View>
        </Panel>
      )}
      {wallet.error && <Text style={s.error}>Wallet error: {wallet.error}</Text>}
      <View style={s.grow} />
      {wallet.address ? <Button title="Continue" onPress={next} />
        : wallet.loading ? <Button title="Opening…" disabled onPress={wallet.create} />
        : wallet.error ? <Button title="Try again" onPress={wallet.create} />
        : <Button title={wallet.creating ? 'Creating…' : 'Create wallet'} disabled={wallet.creating} onPress={wallet.create} />}
    </Page>,

    <Page key="share">
      <Heading title="How much should it invest?">When you pay, Nest buys a slice of the company you paid, or of the listed leader of its category when that company isn't listed.</Heading>
      <Text style={s.share}>{strategies.share === 0 ? 'Investing is off' : `${strategies.share}% of each purchase`}</Text>
      <Slider value={strategies.share} onChange={setShare} label="Share of each purchase to invest" />
      <LimitRow label="Max per stock buy" value={strategies.maxBuy} least={MINIMUM_BUY} onChange={micro => setLimit('maxBuy', micro)} />
      <View style={s.cap}><Text style={s.capText}>Each buy is at least <Text style={s.bold}>0.10</Text>; a lookup fee is at most 0.01. The limit is optional.</Text></View>
      <View style={s.grow} />
      <Button title="Continue" onPress={next} />
    </Page>,

    <Page key="pick">
      <Heading title="What should it buy?">The company you paid is the default. The others change what each purchase invests in.</Heading>
      <StrategyPicker pick={strategies.pick} setPick={setPick} />
      <View style={s.grow} />
      <Button title="Continue" onPress={next} />
    </Page>,

    <Page key="card">
      <Heading title="Connect your card">iOS lets only you create this automation. It takes a minute, once.</Heading>
      <Numbered n={1}>Shortcuts, Automation, <Text style={s.bold}>+</Text>, then <Text style={s.bold}>Wallet</Text>. Pick your card.</Numbered>
      <Numbered n={2}>Choose <Text style={s.bold}>Run Immediately</Text>.</Numbered>
      <Numbered n={3}>Add <Text style={s.bold}>Note Payment</Text>. Map Merchant and Amount from Shortcut Input.</Numbered>
      <View style={s.grow} />
      <Button kind="secondary" title="Open Shortcuts" onPress={openShortcuts} />
      <Button title="Continue" onPress={next} />
    </Page>,

    <Page key="agent">
      <Heading title="Your agent can shop too">Ask in Chat for a gift card, an eSIM or a top-up. The agent on this phone finds it, shows you the price, and pays only when you confirm.</Heading>
      <LimitRow label="Max per purchase" value={strategies.maxOrder} onChange={micro => setLimit('maxOrder', micro)} />
      <View style={s.cap}><Text style={s.capText}>An order above the limit is refused on this phone before anything is signed. The limit is optional.</Text></View>
      <View style={s.grow} />
      <Button title="Try it with a sample purchase" onPress={trySample} />
      <Button kind="quiet" title="Finish" onPress={finish} />
    </Page>,
  ];

  return (
    <View style={s.screen}>
      <View style={s.header}>
        <View style={s.dots}>{Array.from({ length: STEPS }, (_, i) => i + 1).map(i => <View key={i} style={[s.dot, i <= step && s.dotOn, i === step && s.dotNow]} />)}</View>
        <Text style={s.stepOf}>Step {step} of {STEPS}</Text>
      </View>
      {/* Swipe between the steps opened so far. A slider on a page locks the swipe while it is dragged. */}
      <LockableScroll ref={pager} horizontal pagingEnabled directionalLockEnabled showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled"
        contentOffset={{ x: (step - 1) * width, y: 0 }}
        onMomentumScrollEnd={event => setStep(Math.round(event.nativeEvent.contentOffset.x / width) + 1)}>
        {pages.slice(0, reachable).map((page, i) => <View key={i} style={{ width }}>{page}</View>)}
      </LockableScroll>
    </View>
  );
}

// The welcome screen fades in a piece at a time: the mark, the name, the line, then the three facts.
function Welcome({ start }: { start(): void }) {
  const shown = useRef([0, 1, 2, 3].map(() => new Animated.Value(0))).current;
  useEffect(() => {
    Animated.stagger(180, shown.map(v => Animated.timing(v, { toValue: 1, duration: 520, useNativeDriver: true }))).start();
  }, [shown]);
  const rise = (v: Animated.Value) => ({ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] });
  return (
    <View style={s.screen}>
      <LockableScroll contentContainerStyle={[s.page, { paddingTop: 72 }]}>
        <View style={s.grow}>
          <Animated.View style={[s.tile, rise(shown[0]!), { transform: [{ scale: shown[0]!.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }] }]}><Mark size={44} /></Animated.View>
          <Animated.View style={rise(shown[1]!)}><Text accessibilityRole="header" style={s.name}>Nest.</Text></Animated.View>
          <Animated.View style={[s.grow, rise(shown[2]!)]}>
            <Text style={s.lead}>An agent that invests a little every time you spend.</Text>
            <Text style={s.body}>No account and no sign-up. Setting up downloads a model, creates a wallet, and keeps the model, the wallet key and the activity on this phone.</Text>
          </Animated.View>
          <Animated.View style={[s.list, rise(shown[3]!)]}>
            {WELCOME.map(([title, sub]) => (
              <Card key={title} style={s.welcomeCard}><Text style={s.strong}>{title}</Text><Text style={s.small}>{sub}</Text></Card>
            ))}
          </Animated.View>
        </View>
        <Button title="Set up" onPress={start} />
      </LockableScroll>
    </View>
  );
}

function Page({ children }: { children: ReactNode }) {
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[s.page, { paddingTop: 28 }]}>{children}</ScrollView>;
}

function Heading({ title, children }: { title: string; children: ReactNode }) {
  return <View style={s.heading}><Text accessibilityRole="header" style={s.title}>{title}</Text><Text style={s.body}>{children}</Text></View>;
}

function Numbered({ n, children }: { n: number; children: ReactNode }) {
  return <View style={s.numbered}><View style={s.badge}><Text style={s.badgeText}>{n}</Text></View><Text style={s.stepText}>{children}</Text></View>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  page: { flexGrow: 1, paddingHorizontal: 24, paddingBottom: 32, gap: 18 },
  grow: { flexGrow: 1, gap: 14 },
  tile: { width: 64, height: 64, borderRadius: radius.tile, backgroundColor: color.bg, borderWidth: 1, borderColor: color.hairline, alignItems: 'center', justifyContent: 'center' },
  name: { marginTop: 12, fontSize: 44, fontWeight: '800', letterSpacing: -1.5, color: color.text },
  lead: { fontSize: 19, lineHeight: 27, fontWeight: '500', color: color.text },
  body: { fontSize: type.body, lineHeight: 22, color: color.muted },
  list: { gap: 10, marginTop: 12 },
  welcomeCard: { paddingVertical: 14, paddingHorizontal: 16, gap: 2, borderRadius: 16 },
  strong: { fontSize: type.body, fontWeight: '600', color: color.text },
  small: { fontSize: type.small, color: color.muted },
  bold: { fontWeight: '700' },
  header: { paddingTop: 60, paddingBottom: 4, paddingHorizontal: 24, flexDirection: 'row', alignItems: 'center', gap: 12 },
  done: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  tick: { width: 22, height: 22, borderRadius: 11, backgroundColor: color.ok, alignItems: 'center', justifyContent: 'center' },
  tickText: { fontSize: 13, fontWeight: '800', color: color.onPrimary },
  share: { fontSize: 22, fontWeight: '700', color: color.text },
  dots: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: color.off },
  dotOn: { backgroundColor: color.primary },
  dotNow: { width: 22 },
  stepOf: { marginLeft: 'auto', fontSize: type.small, color: color.muted },
  heading: { gap: 8 },
  title: { fontSize: type.title, fontWeight: '800', letterSpacing: -0.6, color: color.text },
  option: { borderWidth: 2, borderColor: color.hairline, borderRadius: radius.card, padding: 16, gap: 10 },
  optionOn: { borderColor: color.primary },
  off: { opacity: 0.4 },
  optionName: { flexShrink: 1, fontSize: 16, fontWeight: '700', color: color.text },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  facts: { flexDirection: 'row', gap: 20 },
  fact: { fontSize: 18, fontWeight: '700', color: color.text },
  progress: { gap: 8 },
  error: { fontSize: type.small, color: color.error },
  panelBody: { gap: 14 },
  address: { fontSize: 26, fontWeight: '700', letterSpacing: -0.5, color: color.text },
  mono: { fontFamily: 'Menlo', fontSize: 11, color: color.muted },
  strategy: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 },
  divided: { borderTopWidth: 1, borderTopColor: color.quiet },
  text: { flex: 1, gap: 3 },
  cap: { backgroundColor: color.quiet, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 16 },
  capText: { fontSize: 14, lineHeight: 20, color: color.text },
  numbered: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: color.hairline },
  badge: { width: 24, height: 24, borderRadius: 12, backgroundColor: color.primary, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 13, fontWeight: '700', color: color.onPrimary },
  stepText: { flex: 1, fontSize: 14, lineHeight: 20, color: color.text },
});

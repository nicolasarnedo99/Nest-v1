// First launch, and "Replay setup": Welcome, then four steps that download the model,
// open the wallet, pick how it saves and connect the card.
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, LimitRow, Mark, Panel, Pill, ProgressBar, Slider } from '../ui/kit';
import { color, radius, type } from '../ui/theme';
import type { MODELS, ModelId, Strategies } from '../lib/settings';
import { MINIMUM_BUY } from '../../server/money';
import { short } from './Agent';

const WELCOME = [['The models run on this phone', 'Each purchase is matched against an S&P 500 brand table here'],
  ['The wallet lives on this phone', 'It signs every buy itself, gas is sponsored'], ['Open source', 'Read the code and the trained adapter']] as const;

export function Setup({ step, setStep, models, modelChoice, choose, choiceDisabled, download, wallet, strategies, setShare, setLimit, openShortcuts, trySample, finish }: {
  step: number; setStep(step: number): void; models: typeof MODELS; modelChoice: ModelId; choose(id: ModelId): void; choiceDisabled: boolean;
  download: { fraction: number | null; loaded: boolean; error: string | null; start(): void; retry(): void };
  wallet: { address?: string; existed: boolean; creating: boolean; loading: boolean; error: string | null; create(): void };
  strategies: Strategies; setShare(share: number): void; setLimit(key: 'maxBuy' | 'maxOrder', micro: string | null): void; openShortcuts(): void; trySample(): void; finish(): void;
}) {
  const next = () => setStep(step + 1);
  if (step === 0) return (
    <Page padTop={72}>
      <View style={s.grow}>
        <View style={s.tile}><Mark size={44} /></View>
        <Text accessibilityRole="header" style={s.name}>Nest.</Text>
        <Text style={s.lead}>An agent that invests a little every time you spend.</Text>
        <Text style={s.body}>No account and no sign-up. Setting up downloads a model, creates a wallet, and keeps the model, the wallet key and the activity on this phone.</Text>
        <View style={s.list}>
          {WELCOME.map(([title, sub]) => (
            <Card key={title} style={s.welcomeCard}><Text style={s.strong}>{title}</Text><Text style={s.small}>{sub}</Text></Card>
          ))}
        </View>
      </View>
      <Button title="Set up" onPress={next} />
    </Page>
  );

  const header = (
    <View style={s.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => setStep(step - 1)} style={s.back}>
        <Text style={s.backText}>‹</Text>
      </Pressable>
      <View style={s.dots}>{[1, 2, 3, 4].map(i => <View key={i} style={[s.dot, i <= step && s.dotOn, i === step && s.dotNow]} />)}</View>
      <Text style={s.stepOf}>Step {step} of 4</Text>
    </View>
  );

  if (step === 1) {
    // Downloading from "Download model" until the load ends; a choice made then would restart it.
    const downloading = download.fraction !== null && !download.loaded && !download.error;
    const fraction = download.loaded ? 1 : download.fraction;
    // Also off while a decision runs: choosing unloads the model it is using.
    const locked = downloading || choiceDisabled;
    return (
      <Page header={header}>
        <Heading title="Choose the model">It reads Chat on this phone, downloads once and then works offline. Scores are from naming the company behind 24 merchants it never saw.</Heading>
        {models.map(m => (
          <Pressable key={m.id} accessibilityRole="button" accessibilityState={{ selected: m.id === modelChoice, disabled: locked }}
            disabled={locked} onPress={() => choose(m.id)} style={[s.option, m.id === modelChoice && s.optionOn, locked && m.id !== modelChoice && s.off]}>
            <View style={s.line}><Text style={s.optionName}>{m.name}</Text>{m.adapter && <Pill label="Recommended" tone="solid" />}</View>
            <View style={s.facts}>
              <Text style={s.small}><Text style={s.fact}>{m.score}</Text> correct</Text>
              <Text style={s.small}><Text style={s.fact}>{m.download}</Text> download</Text>
            </View>
          </Pressable>
        ))}
        <View style={s.grow} />
        {fraction !== null && !download.error && (
          <View style={s.progress}>
            <View style={s.line}>
              <Text style={s.small}>{download.loaded ? 'Downloaded, ready offline' : `Downloading ${Math.round(fraction * 100)}%`}</Text>
            </View>
            <ProgressBar fraction={fraction} />
          </View>
        )}
        {download.error && <Text style={s.error}>{download.error}</Text>}
        {download.error ? <Button title="Try again" onPress={download.retry} />
          : download.loaded ? <Button title="Continue" onPress={next} />
          : <Button title={downloading ? 'Downloading…' : 'Download model'} disabled={downloading} onPress={download.start} />}
      </Page>
    );
  }

  if (step === 2) return (
    <Page header={header}>
      <Heading title="Create your wallet">The key is generated on this phone and kept in its Keychain. It holds USD₮0 and the stock tokens it buys. It never needs ETH: a paymaster covers gas.</Heading>
      {wallet.address && <>
        <Panel>
          <View style={s.panelBody}>
            <View style={s.line}><Text style={s.small}>Wallet on this phone</Text><Pill label="Sepolia" tone="quiet" /></View>
            <Text style={s.address}>{short(wallet.address)}</Text>
            <Text style={s.mono}>{wallet.address}</Text>
          </View>
        </Panel>
        <Text style={s.strong}>{wallet.existed ? 'Already on this phone' : 'Created on this phone'}</Text>
      </>}
      {wallet.error && <Text style={s.error}>Wallet error: {wallet.error}</Text>}
      <View style={s.grow} />
      {wallet.address ? <Button title="Continue" onPress={next} />
        : wallet.loading ? <Button title="Opening…" disabled onPress={wallet.create} />
        : wallet.error ? <Button title="Try again" onPress={wallet.create} />
        : <Button title={wallet.creating ? 'Creating…' : 'Create wallet'} disabled={wallet.creating} onPress={wallet.create} />}
    </Page>
  );

  if (step === 3) return (
    <Page header={header}>
      <Heading title="How much should it invest?">When you pay, Nest buys a slice of the company you paid, or of the listed leader of its category when that company isn't listed.</Heading>
      <Card>
        <View style={s.strategy}>
          <View style={s.text}><Text style={s.strong}>{strategies.share}% of each purchase</Text>
            <Text style={s.small}>{strategies.share === 0 ? 'Investing is off' : `An 8.00 purchase invests ${(Math.min(1, Math.max(0.1, 8 * strategies.share / 100))).toFixed(2)}`}</Text></View>
        </View>
        <Slider value={strategies.share} onChange={setShare} label="Share of each purchase to invest" />
        <LimitRow label="Max per stock buy" value={strategies.maxBuy} least={MINIMUM_BUY} onChange={micro => setLimit('maxBuy', micro)} />
        <LimitRow label="Max per purchase" value={strategies.maxOrder} onChange={micro => setLimit('maxOrder', micro)} />
      </Card>
      <View style={s.cap}><Text style={s.capText}>Each buy is at least <Text style={s.bold}>0.10</Text>; a lookup fee is at most 0.01. Both limits are optional.</Text></View>
      <View style={s.grow} />
      <Button title="Continue" onPress={next} />
    </Page>
  );

  return (
    <Page header={header}>
      <Heading title="Connect your card">iOS lets only you create this automation. It takes a minute, once.</Heading>
      <Numbered n={1}>Shortcuts, Automation, <Text style={s.bold}>+</Text>, then <Text style={s.bold}>Wallet</Text>. Pick your card.</Numbered>
      <Numbered n={2}>Choose <Text style={s.bold}>Run Immediately</Text>.</Numbered>
      <Numbered n={3}>Add <Text style={s.bold}>Note Payment</Text>. Map Merchant and Amount from Shortcut Input.</Numbered>
      <View style={s.grow} />
      <Button kind="secondary" title="Open Shortcuts" onPress={openShortcuts} />
      <Button title="Try it with a sample purchase" onPress={trySample} />
      <Button kind="quiet" title="Skip for now" onPress={finish} />
    </Page>
  );
}

function Page({ header, padTop = 28, children }: { header?: ReactNode; padTop?: number; children: ReactNode }) {
  return (
    <View style={s.screen}>
      {header}
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[s.page, { paddingTop: padTop }]}>{children}</ScrollView>
    </View>
  );
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
  header: { paddingTop: 60, paddingHorizontal: 24, flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: { width: 40, height: 40, borderRadius: 12, backgroundColor: color.quiet, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: 26, lineHeight: 28, color: color.text },
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

// The settings sheet, from the wheel, one box each: the model, saving and its limits, the investment strategy, who reads receipts,
// where things run, and memory. The wallet is on the portfolio page.
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Card, LimitRow, Slider } from '../ui/kit';
import { color, radius, space, type } from '../ui/theme';
import { PICKS, READERS, type MODELS, type ModelId, type PickId, type ReaderId, type Strategies } from '../lib/settings';
import { MINIMUM_BUY } from '../../server/money';
import { money } from '../lib/holdings';
import { gb, type MemoryLog } from '../lib/memory';
import { clock } from './Activity';

export type Balance = { value: bigint; at: number } | { error: string; last?: { value: bigint; at: number } } | null;

export const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

// The wallet's USD₮0 balance, or why it could not be read, with the last one that was.
export function BalanceLine({ balance }: { balance: Balance }) {
  if (balance === null) return <Text style={s.value}>…</Text>;
  if ('value' in balance) return <Text style={s.value}>{money(balance.value)} USD₮0</Text>;
  return (
    <View style={s.text}>
      <Text style={s.value}>Balance unavailable</Text>
      <Text style={s.small} numberOfLines={2}>{balance.last ? `Last read ${money(balance.last.value)} USD₮0 at ${clock(balance.last.at)}. ` : ''}{balance.error}</Text>
    </View>
  );
}

// A dropdown: the model in use, and on tap every model with its download size. Choosing one downloads it the first time.
function ModelPicker({ models, modelChoice, choose, disabled }: { models: typeof MODELS; modelChoice: ModelId; choose(id: ModelId): void; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const chosen = models.find(m => m.id === modelChoice);
  return (
    <View style={[s.picker, disabled && s.off]}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open, disabled }} disabled={disabled} onPress={() => setOpen(!open)} style={s.pickerRow}>
        <Text style={[s.value, s.pickerName]}>{chosen?.name ?? modelChoice}</Text>
        <Text style={s.chevron}>{open ? '▴' : '▾'}</Text>
      </Pressable>
      {open && models.map(m => (
        <Pressable key={m.id} accessibilityRole="radio" accessibilityState={{ selected: m.id === modelChoice }} disabled={disabled}
          onPress={() => { setOpen(false); if (m.id !== modelChoice) choose(m.id); }} style={[s.pickerRow, s.pickerOption]}>
          <View style={s.pickerName}>
            <Text style={s.value}>{m.name}</Text>
            <Text style={s.small}>{m.download}</Text>
          </View>
          {m.id === modelChoice && <Text style={s.chevron}>✓</Text>}
        </Pressable>
      ))}
    </View>
  );
}

const WHERE = [['Model', 'On this phone'], ['Merchant match', 'On this phone, against an S&P 500 brand table'], ['Receipts', "On a MacBook, through Nest's server"], ['Wallet key', "In this phone's Keychain"], ['Activity', 'On this phone'],
  ['Lookups', 'Paid over x402 to the lookup service']] as const;
// Who reads receipt photos, one tap to choose, like the strategy.
export function ReaderPicker({ receipts = 'own', setReceipts, withOff = true }: { receipts?: ReaderId; setReceipts(id: ReaderId): void; withOff?: boolean }) {
  return (
    <View style={s.picker}>
      {READERS.filter(r => withOff || r.id !== 'off').map((r, i) => (
        <Pressable key={r.id} accessibilityRole="radio" accessibilityState={{ selected: r.id === receipts }} onPress={() => setReceipts(r.id)}
          style={[s.pickerRow, i > 0 && s.pickerOption]}>
          <View style={s.pickerName}><Text style={s.value}>{r.name}</Text><Text style={s.small}>{r.detail}</Text></View>
          {r.id === receipts && <Text style={s.chevron}>✓</Text>}
        </Pressable>
      ))}
    </View>
  );
}
// What a purchase invests in, one tap to choose. Only the leader is built; the others are saved when chosen and buy like it (demo).
export function StrategyPicker({ pick = 'leader', setPick }: { pick?: PickId; setPick(pick: PickId): void }) {
  return (
    <View style={s.picker}>
      {PICKS.map((p, i) => (
        <Pressable key={p.id} accessibilityRole="radio" accessibilityState={{ selected: p.id === pick }} onPress={() => setPick(p.id)}
          style={[s.pickerRow, i > 0 && s.pickerOption]}>
          <View style={s.pickerName}><Text style={s.value}>{p.name}</Text><Text style={s.small}>{p.detail}</Text></View>
          {p.id === pick && <Text style={s.chevron}>✓</Text>}
        </Pressable>
      ))}
    </View>
  );
}

export function Agent({ models, modelChoice, choose, choiceDisabled, status, strategies, setShare, setLimit, setPick, setReceipts, onReplaySetup, onClearChat, onStartOver, memory }: {
  models: typeof MODELS; modelChoice: ModelId; choose(id: ModelId): void; choiceDisabled: boolean; status: string;
  strategies: Strategies; setShare(share: number): void; setLimit(key: 'maxBuy' | 'maxOrder', micro: string | null): void; setPick(pick: PickId): void; setReceipts(id: ReaderId): void;
  onReplaySetup(): void; onClearChat(): void; onStartOver(): Promise<void>; memory: MemoryLog | null;
}) {
  return (
    <View style={s.body}>
      <Card>
        <View style={[s.row, s.last]}>
          <Text style={s.label}>Model</Text>
          <ModelPicker models={models} modelChoice={modelChoice} choose={choose} disabled={choiceDisabled} />
          <Text style={s.small}>{status}</Text>
        </View>
      </Card>

      <Card>
        <View style={[s.row, s.last]}>
          <Text style={s.label}>Saving</Text>
          <Text style={s.value}>Invest {strategies.share}% of what I buy</Text>
          <Slider value={strategies.share} onChange={setShare} label="Share of each purchase to invest" />
          <Text style={s.small}>Chat orders invest too. At least 0.10 a buy.</Text>
          <LimitRow label="Max per stock buy" value={strategies.maxBuy} least={MINIMUM_BUY} onChange={micro => setLimit('maxBuy', micro)} />
          <LimitRow label="Max per purchase" value={strategies.maxOrder} onChange={micro => setLimit('maxOrder', micro)} />
        </View>
      </Card>

      <Card>
        <View style={[s.row, s.last]}>
          <Text style={s.label}>Investment strategy</Text>
          <StrategyPicker pick={strategies.pick} setPick={setPick} />
        </View>
      </Card>

      <Card>
        <View style={[s.row, s.last]}>
          <Text style={s.label}>Receipts</Text>
          <ReaderPicker receipts={strategies.receipts} setReceipts={setReceipts} />
          <Text style={s.small}>Too heavy for this phone with the chat model loaded, so it runs on a bigger machine.</Text>
        </View>
      </Card>

      <Card>
        <View style={s.row}><Text style={s.value}>Where things run</Text></View>
        {WHERE.map(([what, where], i) => (
          <View key={what} style={[s.row, s.line, i === WHERE.length - 1 && s.last]}>
            <Text style={s.label}>{what}</Text><Text style={[s.small, s.where]}>{where}</Text>
          </View>
        ))}
      </Card>

      <Card>
        <View style={s.row}>
          <Text style={s.label}>Memory on this phone</Text>
          {memory ? <>
            <View style={s.line}><Text style={s.value}>Now {gb(memory.now.used)} used</Text><Text style={s.small}>{gb(memory.now.available)} still available</Text></View>
            <Text style={s.small}>Peak {gb(memory.peakUsed)} with {memory.peakWith || 'n/a'}</Text>
            <Text style={s.small}>Least available {gb(memory.leastAvailable)} with {memory.leastWith || 'n/a'}</Text>
            <Text style={s.small}>Phone total {gb(memory.now.total)} · read every 3 s through QVAC</Text>
          </> : <Text style={s.small}>Reading…</Text>}
        </View>
      </Card>
      <DeveloperOptions>
        <Button kind="secondary" title="Replay setup" onPress={onReplaySetup} />
        <ClearChat onClear={onClearChat} />
        <StartOver onStartOver={onStartOver} />
      </DeveloperOptions>
    </View>
  );
}

const s = StyleSheet.create({
  body: { gap: space.gap },
  row: { paddingVertical: 14, paddingHorizontal: 16, gap: 8, borderBottomWidth: 1, borderBottomColor: color.hairline },
  last: { borderBottomWidth: 0 },
  devRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, paddingVertical: 10 },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  text: { flex: 1, gap: 2 },
  label: { fontSize: type.small, color: color.muted },
  value: { fontSize: type.body, fontWeight: '600', color: color.text },
  small: { fontSize: type.tiny, color: color.muted },
  where: { flexShrink: 1, textAlign: 'right' },
  picker: { borderWidth: 1, borderColor: color.hairline, borderRadius: radius.button, overflow: 'hidden' },
  pickerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14 },
  pickerOption: { borderTopWidth: 1, borderTopColor: color.hairline },
  pickerName: { flex: 1, minWidth: 0, gap: 2 },
  chevron: { fontSize: type.body, color: color.text },
  off: { opacity: 0.4 },
});

// Two taps, so the history is not wiped by accident; App remounts the chat, so it empties at once.
// Replay setup, clear chat and start over, folded away under one quiet row.
function DeveloperOptions({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={s.devRow}>
      <Text style={s.small}>Developer options</Text>
      <Text style={s.small}>{open ? '▴' : '▾'}</Text>
    </Pressable>
    {open && children}
  </>;
}

// Two taps, like Clear chat: the second deletes the wallet's key, so its test funds and holdings can't be reached again.
function StartOver({ onStartOver }: { onStartOver(): Promise<void> }) {
  const [state, setState] = useState<'idle' | 'sure' | 'deleting'>('idle');
  const [error, setError] = useState<string | null>(null);
  const run = () => { setState('deleting'); setError(null);
    onStartOver().catch(e => { setState('idle'); setError(e instanceof Error ? e.message : String(e)); }); };
  return <>
    <Button kind="secondary" title={state === 'sure' ? "Tap again to delete this wallet's key, activity and chat" : state === 'deleting' ? 'Deleting…' : 'Start over with a new wallet'}
      disabled={state === 'deleting'} onPress={() => { if (state === 'sure') run(); else setState('sure'); }} />
    {error && <Text style={s.small}>{error}</Text>}
  </>;
}

function ClearChat({ onClear }: { onClear(): void }) {
  const [state, setState] = useState<'idle' | 'sure' | 'done'>('idle');
  if (state === 'done') return <Text style={s.small}>Chat history cleared.</Text>;
  return <Button kind="secondary" title={state === 'sure' ? 'Tap again to clear the chat history' : 'Clear chat history'}
    onPress={() => { if (state === 'sure') { onClear(); setState('done'); } else setState('sure'); }} />;
}

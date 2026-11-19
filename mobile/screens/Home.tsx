// The first tab: what the wallet holds, what was spent today, what was bought, and the latest entries.
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button, Card, Mark, Panel, SectionLabel } from '../ui/kit';
import { color, radius, space, type } from '../ui/theme';
import { money, type Holding } from '../lib/holdings';
import type { Item } from '../App';
import { EntryRow, clock } from './Activity';

export type Balance = { value: bigint; at: number } | { error: string; last?: { value: bigint; at: number } } | null;

export const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

type TryMerchant = {
  merchant: string; amount: string; setMerchant(text: string): void; setAmount(text: string): void;
  decide(text: string, amount?: string): Promise<boolean>; busy: boolean; ready: boolean; examples: string[];
};

export function Home({ address, walletError, balance, spent, holdings, recent, ready, loading, status, onOpen, onSeeAll, onRefresh, tryMerchant }: {
  address?: string | null; walletError: string | null; balance: Balance; spent: bigint | null; holdings: Holding[]; recent: Item[];
  ready: boolean; loading: boolean; status: string; onOpen(id: number): void; onSeeAll(): void; onRefresh(): Promise<void>; tryMerchant: TryMerchant;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const refresh = () => { setRefreshing(true); void onRefresh().finally(() => setRefreshing(false)); };
  const failed = !ready && !loading;
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.body} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
      <View style={s.header}>
        <View style={s.brand}><Mark size={28} /><Text style={s.name}>Nest</Text></View>
        <View style={[s.status, failed && s.statusError]}>
          {ready && <View style={s.dot} />}
          <Text style={[s.statusText, failed && s.errorText]} numberOfLines={1}>{ready ? 'Agent ready' : status}</Text>
        </View>
      </View>

      <Panel>
        <View style={s.panel}>
          <Text style={s.muted}>Available to invest</Text>
          {balance === null
            ? <Text style={s.balance}>…</Text>
            : 'value' in balance
              ? <Text style={s.balance}>{money(balance.value)} <Text style={s.unit}>USD₮0</Text></Text>
              : <>
                  <Text style={s.unavailable}>Balance unavailable</Text>
                  <Text style={s.muted} numberOfLines={2}>{balance.last ? `Last read ${money(balance.last.value)} USD₮0 at ${clock(balance.last.at)}. ` : ''}{balance.error}</Text>
                </>}
          <Text style={walletError ? s.errorText : s.muted}>
            {walletError ? `Wallet error: ${walletError}` : address ? `Wallet ${short(address)} · Sepolia` : 'Opening the wallet…'}
          </Text>
          <View style={s.spent}>
            {spent === null
              ? <Text style={s.muted}>Spent today unavailable</Text>
              : <>
                  <View style={s.spentRow}>
                    <Text style={s.muted}>Spent today</Text>
                    <Text style={s.text}><Text style={s.bold}>{money(spent)}</Text></Text>
                  </View>
                </>}
          </View>
        </View>
      </Panel>

      <View style={s.section}>
        <SectionLabel>INVESTED</SectionLabel>
        {holdings.length === 0
          ? <Text style={s.muted}>Nothing invested yet. Purchases at Apple, Alphabet, Microsoft, Tesla or NVIDIA invest automatically.</Text>
          : <View style={s.grid}>
              {holdings.map(h => (
                <Card key={h.company} style={s.tile}>
                  <Text style={s.muted}>{h.company}</Text>
                  <Text style={s.tileValue}>{h.invested > 0n ? money(h.invested) : `${h.buys} ${h.buys === 1 ? 'buy' : 'buys'}`}</Text>
                  <Text style={s.tiny}>{h.buys} {h.buys === 1 ? 'buy' : 'buys'}</Text>
                </Card>
              ))}
            </View>}
      </View>

      <View style={s.section}>
        <View style={s.spentRow}>
          <SectionLabel>RECENT</SectionLabel>
          <Pressable accessibilityRole="button" onPress={onSeeAll} hitSlop={8}><Text style={s.seeAll}>See all</Text></Pressable>
        </View>
        {recent.length === 0
          ? <Text style={s.muted}>Nothing yet.</Text>
          : <Card>{recent.map((item, i) => <EntryRow key={item.id} item={item} onOpen={onOpen} last={i === recent.length - 1} />)}</Card>}
      </View>

      <TryMerchantCard {...tryMerchant} />
    </ScrollView>
  );
}

function TryMerchantCard({ merchant, amount, setMerchant, setAmount, decide, busy, ready, examples }: TryMerchant) {
  const [open, setOpen] = useState(false);
  return (
    <Card style={s.try}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={s.spentRow}>
        <SectionLabel>TRY A MERCHANT</SectionLabel>
        <Text style={s.muted}>{open ? '▾' : '▸'}</Text>
      </Pressable>
      {open && <>
        <TextInput style={s.input} value={merchant} onChangeText={setMerchant} placeholder="e.g. Apple Store Madrid"
          placeholderTextColor={color.tabOff} autoCapitalize="characters" autoCorrect={false} editable={ready && !busy}
          returnKeyType="go" onSubmitEditing={() => void decide(merchant, amount)} />
        <TextInput style={s.input} value={amount} onChangeText={setAmount} placeholder="Amount, e.g. 4,50 €"
          placeholderTextColor={color.tabOff} autoCorrect={false} editable={ready && !busy} />
        <Button title={busy ? 'Deciding…' : 'Decide'} disabled={!ready || busy || !merchant.trim()} onPress={() => void decide(merchant, amount)} />
        <View style={s.chips}>
          {examples.map(example => (
            <Pressable key={example} style={[s.chip, (!ready || busy) && s.off]} disabled={!ready || busy} onPress={() => void decide(example, amount)}>
              <Text style={s.chipText}>{example}</Text>
            </Pressable>
          ))}
        </View>
      </>}
    </Card>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  body: { paddingTop: 60, paddingHorizontal: space.screen, paddingBottom: 24, gap: 18 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontSize: type.heading, fontWeight: '800', letterSpacing: -0.5, color: color.text },
  status: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: color.quiet, paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.pill },
  statusError: { backgroundColor: color.errorBg },
  statusText: { flexShrink: 1, fontSize: type.tiny, fontWeight: '600', color: color.text },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: color.ok },
  panel: { gap: 6 },
  muted: { fontSize: type.small, color: color.muted },
  text: { fontSize: type.small, color: color.text },
  bold: { fontWeight: '700' },
  tiny: { fontSize: type.tiny, color: color.muted },
  balance: { fontSize: type.balance, fontWeight: '800', letterSpacing: -1.5, color: color.text, fontVariant: ['tabular-nums'] },
  unit: { fontSize: 20, fontWeight: '600', letterSpacing: 0 },
  unavailable: { fontSize: type.heading, fontWeight: '700', color: color.text },
  errorText: { fontSize: type.small, color: color.error },
  spent: { gap: 6, marginTop: 12 },
  spentRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  section: { gap: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: '48%', padding: 14, gap: 4 },
  tileValue: { fontSize: type.heading, fontWeight: '700', color: color.text },
  seeAll: { fontSize: 14, fontWeight: '600', color: color.text },
  try: { padding: 16, gap: 12 },
  input: { borderWidth: 1, borderColor: color.hairline, borderRadius: 12, padding: 12, fontSize: 16, color: color.text, backgroundColor: color.panel },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: color.hairline, borderRadius: radius.pill, paddingVertical: 6, paddingHorizontal: 10 },
  chipText: { fontSize: 11, color: color.text },
  off: { opacity: 0.4 },
});

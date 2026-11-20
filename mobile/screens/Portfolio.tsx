// The portfolio page, a swipe right of the chat: what was invested per company from confirmed buys, as a donut and rows, then the wallet:
// its cash, its address and where its key is.
// No market prices: amounts are what was paid in.
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Card } from '../ui/kit';
import { Logo } from '../ui/icons';
import { color, space, type } from '../ui/theme';
import { money } from '../lib/holdings';
import { logoFor } from '../lib/logos';
import { donutArcs, portfolio, shareLabel } from '../lib/portfolio';
import type { Entry } from '../lib/log';
import { BalanceLine, short, type Balance } from './Agent';
import { TestFunds } from './TestFunds'; // test funds
import type { TestFunds as Funds } from '../lib/faucet'; // test funds

const SIZE = 220;
const STROKE = 28;
const R = (SIZE - STROKE) / 2;
const C = 2 * Math.PI * R;
const GAP = 3; // points of white between slices, so neighbours never run together
const MID = SIZE / 2;

export function Portfolio({ entries, balance, address, walletError, spent, addTestFunds }: {
  entries: Entry[]; balance: Balance; address?: string | null; walletError: string | null; spent: bigint | null; addTestFunds(): Promise<Funds>;
}) {
  const { total, slices } = portfolio(entries);
  const arcs = donutArcs(slices.map(slice => slice.share), C, GAP);
  return (
    <View style={s.body}>
      {slices.length === 0
        ? <Text style={s.muted}>Every payment you make invests a share here.</Text>
        : <>
            <View style={s.donut} accessible accessibilityLabel={`Invested ${money(total)} USD₮0 in ${slices.length} ${slices.length === 1 ? 'company' : 'companies'}`}>
              <Svg width={SIZE} height={SIZE}>
                {slices.map((slice, i) => arcs[i]!.length > 0 && (
                  // Each slice is the ring's stroke dashed to its length, turned to where it starts (12 o'clock first).
                  <Circle key={slice.company} cx={MID} cy={MID} r={R} fill="none" stroke={logoFor(slice.company)?.color ?? color.off} strokeWidth={STROKE}
                    strokeDasharray={`${arcs[i]!.length} ${C}`} transform={`rotate(${-90 + arcs[i]!.offset / C * 360} ${MID} ${MID})`} />
                ))}
              </Svg>
              <View style={s.center} pointerEvents="none">
                <Text style={s.muted}>Invested</Text>
                <Text style={s.total}>{money(total)}</Text>
                <Text style={s.muted}>USD₮0</Text>
              </View>
            </View>
            <Card>
              {slices.map((slice, i) => (
                <View key={slice.company} style={[s.row, i === slices.length - 1 && s.last]}>
                  <View style={[s.dot, { backgroundColor: logoFor(slice.company)?.color ?? color.off }]} />
                  <Logo company={slice.company} size={22} />
                  <Text style={s.name} numberOfLines={1}>{slice.company}</Text>
                  <Text style={s.amount}>{money(slice.invested)}</Text>
                  <Text style={s.share}>{shareLabel(slice.share)}</Text>
                </View>
              ))}
            </Card>
          </>}
      <Card>
        <View style={s.wallet}>
          <Text style={s.muted}>Cash to invest · Sepolia</Text>
          {balance && 'value' in balance ? <Text style={s.cash}>{money(balance.value)} <Text style={s.unit}>USD₮0</Text></Text> : <BalanceLine balance={balance} />}
          <Text style={s.muted}>{spent === null ? 'Spent today unavailable' : `Spent today ${money(spent)}`}</Text>
        </View>
        <View style={[s.row, s.last]}>
          {walletError
            ? <Text style={s.error}>Wallet error: {walletError}</Text>
            : <>
                <View style={s.text}>
                  <Text style={s.address}>{address ? short(address) : 'Opening the wallet…'}</Text>
                  <Text style={s.muted}>Key in this phone's Keychain</Text>
                </View>
                {address && <Pressable accessibilityRole="button" hitSlop={8} onPress={() => void Share.share({ message: address })}>
                  <Text style={s.copy}>Copy address</Text>
                </Pressable>}
              </>}
        </View>
      </Card>
      <TestFunds add={addTestFunds} /* test funds */ />
    </View>
  );
}

const s = StyleSheet.create({
  body: { gap: space.gap },
  donut: { alignSelf: 'center', width: SIZE, height: SIZE },
  center: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  total: { fontSize: 32, fontWeight: '800', letterSpacing: -1, color: color.text, fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: color.hairline },
  last: { borderBottomWidth: 0 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  name: { flex: 1, fontSize: type.body, fontWeight: '600', color: color.text },
  amount: { fontSize: type.body, color: color.text, fontVariant: ['tabular-nums'] },
  share: { width: 44, textAlign: 'right', fontSize: type.small, color: color.muted, fontVariant: ['tabular-nums'] },
  wallet: { paddingVertical: 16, paddingHorizontal: 16, gap: 4, borderBottomWidth: 1, borderBottomColor: color.hairline },
  cash: { fontSize: 32, fontWeight: '800', letterSpacing: -1, color: color.text, fontVariant: ['tabular-nums'] },
  unit: { fontSize: type.body, fontWeight: '600', letterSpacing: 0, color: color.muted },
  text: { flex: 1, gap: 2 },
  address: { fontSize: type.body, fontWeight: '600', color: color.text, fontVariant: ['tabular-nums'] },
  copy: { fontSize: 14, fontWeight: '600', color: color.text, textDecorationLine: 'underline' },
  error: { fontSize: type.small, color: color.error },
  muted: { fontSize: type.small, color: color.muted },
});

// One entry, step by step: what the model decided, the paid lookup if there was one, and the buy. A demo shop order or Bitrefill purchase is one card.
import { ActivityIndicator, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card } from '../ui/kit';
import { color, space, type } from '../ui/theme';
import type { Lookup, Order, Pay } from '../lib/log';
import { money } from '../lib/holdings';
import type { Item } from '../App';
import { steps, type StepState } from '../lib/steps';
import { clock } from './Activity';

export function EntrySheet({ item, onClose }: { item: Item; onClose(): void }) {
  const lookup = 'company' in item ? item.lookup : undefined;
  const pay = 'company' in item ? item.pay : undefined;
  const category = 'company' in item ? item.category : undefined;
  const at = steps(item);
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ScrollView style={s.sheet} contentContainerStyle={s.body}>
        <View style={s.header}>
          <View style={s.headerText}>
            <Text style={s.muted}>{item.amount ? `${item.amount} · ` : ''}{clock(item.at)}</Text>
            <Text style={s.merchant}>{item.merchant}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={s.close}><Text style={s.closeText}>✕</Text></Pressable>
        </View>

        {!('order' in item) && <StepBar at={at} />}

        {'order' in item ? <Card style={s.step}>
          <Text style={s.label}>DEMO ORDER</Text>
          {item.order.seller === 'bitrefill' ? <BitrefillLines order={item.order} /> : <OrderLines order={item.order} />}
        </Card> : <Card style={s.step}>
          <Text style={s.label}>1 · DECIDED ON THIS PHONE</Text>
          {'error' in item
            ? <><Text style={s.error}>{item.error}</Text><Text style={s.muted}>{item.model}</Text></>
            : <>
                <Text style={s.title}>{item.company ?? 'No listed company'}</Text>
                <Text style={s.muted}>“{item.explanation}” · {item.seconds.toFixed(2)} s · {item.model}</Text>
              </>}
        </Card>}

        {lookup && (
          <Card style={[s.step, at.lookup === 'active' && s.now]}>
            <Text style={s.label}>2 · LOOKED UP (DEMO DATA)</Text>
            <LookupLines lookup={lookup} />
            {category && <Text style={s.muted}>Not listed · matched on this phone to {category.name.toLowerCase()} ({category.score.toFixed(2)}) · invests in its leader, {category.leader}</Text>}
          </Card>
        )}

        {'company' in item && (
          <Card style={[s.step, at.buy === 'active' && s.now]}>
            <Text style={s.label}>{lookup ? 3 : 2} · BUY</Text>
            {pay ? <PayLines pay={pay} /> : <Text style={s.title}>Nothing bought</Text>}
          </Card>
        )}
      </ScrollView>
    </Modal>
  );
}

// Decide, look up, buy: a filled dot with a tick when done, a spinner on the step the agent is on now.
const STEPS = [['decide', 'Decide'], ['lookup', 'Look up'], ['buy', 'Buy']] as const;
function StepBar({ at }: { at: ReturnType<typeof steps> }) {
  return (
    <View style={s.bar} accessibilityRole="progressbar" accessibilityLabel={STEPS.map(([key, name]) => `${name} ${at[key]}`).join(', ')}>
      {STEPS.map(([key, name], i) => (
        <View key={key} style={s.barStep}>
          {i > 0 && <View style={[s.barLine, (at[key] === 'done' || at[key] === 'active') && s.barLineOn]} />}
          <Dot state={at[key]} />
          <Text style={[s.barText, at[key] === 'active' && s.barTextNow, at[key] === 'skipped' && s.barTextOff]}>{at[key] === 'skipped' ? `${name} · not needed` : name}</Text>
        </View>
      ))}
    </View>
  );
}
function Dot({ state }: { state: StepState }) {
  if (state === 'active') return <View style={[s.dot, s.dotNow]}><ActivityIndicator size="small" color={color.primary} /></View>;
  return <View style={[s.dot, state === 'done' && s.dotDone, state === 'failed' && s.dotFailed, state === 'skipped' && s.dotSkipped]}>
    <Text style={s.dotText}>{state === 'done' ? '✓' : state === 'failed' ? '✕' : ''}</Text>
  </View>;
}

function LookupLines({ lookup }: { lookup: Lookup }) {
  if (lookup.error) return <Text style={s.error}>{lookup.error}</Text>;
  if (lookup.state === 'paying') return <Text style={s.muted}>Looking up (0.01 USD₮0)…</Text>;
  const paid = `Paid ${lookup.fee ?? '0.01'} USD₮0 over x402`;
  return (
    <>
      {lookup.agent ? <Text style={s.muted}>Resolved agent #{lookup.agent} in the ERC-8004 registry</Text> : null}
      {lookup.transaction
        ? <Text style={s.link} onPress={() => void Linking.openURL(`https://sepolia.etherscan.io/tx/${lookup.transaction}`)}>{paid} · view on Etherscan</Text>
        : <Text style={s.muted}>{paid}</Text>}
      <Text style={s.title}>{lookup.operator ? `Operated by ${lookup.operator}` : 'Unknown to the lookup'}</Text>
      <Text style={s.muted}>{lookup.listedParent ? `${lookup.listedParent}, would buy` : 'Not a listed company'}</Text>
    </>
  );
}

type ShopOrder = Exclude<Order, { seller: 'bitrefill' }>;
// Where the price came from, dated; entries saved before the date was kept show none.
const source = ({ source, checkedAt }: ShopOrder) => source === 'sample' ? 'sample price'
  : `${source === 'live' ? 'checked at' : 'recorded price,'} Amazon.ae${checkedAt ? `, ${checkedAt.slice(0, 10)}` : ''}`; // a live check is a full ISO time

function OrderLines({ order }: { order: ShopOrder }) {
  const shop = `Nest demo shop${order.agent ? ` (agent #${order.agent})` : ''}`;
  const paid = `Paid ${money(BigInt(order.amount))} USD₮0 over x402`;
  return (
    <>
      {order.error
        ? <Text style={s.error}>{order.error}</Text>
        : <Text style={s.title}>{order.state === 'done' ? `Ordered from ${shop}` : `Ordering from ${shop}…`}</Text>}
      {order.transaction
        ? <Text style={s.link} onPress={() => void Linking.openURL(`https://sepolia.etherscan.io/tx/${order.transaction}`)}>{paid} · view on Etherscan</Text>
        : null}
      <Text style={s.muted}>AED {order.priceAed} · {source(order)}</Text>
      <Text style={s.muted}>Demo order, not shipped</Text>
    </>
  );
}

const NETWORKS: Record<string, string> = { 'eip155:42161': 'Arbitrum' };
const short = (address: string) => (address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address);

function BitrefillLines({ order }: { order: Extract<Order, { seller: 'bitrefill' }> }) {
  const mirror = `the Sepolia mirror${order.agent ? ` (agent #${order.agent})` : ''}`;
  const { wouldPay } = order;
  return (
    <>
      {order.error
        ? <Text style={s.error}>{order.error}</Text>
        : <Text style={s.title}>{order.state === 'done' ? `Found on Bitrefill · paid ${mirror}` : `Found on Bitrefill · paying ${mirror}…`}</Text>}
      {order.transaction
        ? <Text style={s.link} onPress={() => void Linking.openURL(`https://sepolia.etherscan.io/tx/${order.transaction}`)}>
            Paid {money(BigInt(order.amount))} USD₮0 over x402 · view on Etherscan</Text>
        : null}
      <Text style={s.muted}>{order.packageValue} · {order.priceUsd} USD at Bitrefill{order.checkedAt ? `, checked ${order.checkedAt.slice(0, 10)}` : ''}</Text>
      <Text style={s.muted}>On {NETWORKS[wouldPay.network] ?? wouldPay.network} this would pay {money(BigInt(wouldPay.amount))} USD₮0 to {wouldPay.seller} ({short(wouldPay.payTo)})</Text>
      <Text style={s.muted}>Demo purchase on Sepolia · the card is not issued</Text>
    </>
  );
}

function PayLines({ pay }: { pay: Pay }) {
  const signed = pay.state !== 'signing';
  const waiting = { signing: 'Signing on this phone…', sending: 'Sending the buy, gas paid by the paymaster…', mining: 'Waiting for Sepolia to include it…', bought: '' }[pay.state];
  return (
    <>
      {signed && <Text style={s.muted}>Signed on this phone</Text>}
      {pay.state === 'bought'
        ? <Text style={s.link} onPress={() => void Linking.openURL(`https://sepolia.etherscan.io/tx/${pay.transaction}`)}>
            {pay.confirmed ? 'Bought on Sepolia' : 'The buy failed on Sepolia'} · view on Etherscan</Text>
        : pay.error ? <Text style={s.error}>{pay.error}</Text> : <Text style={s.muted}>{waiting}</Text>}
    </>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4 },
  barStep: { flex: 1, alignItems: 'center', gap: 6 },
  barLine: { position: 'absolute', top: 13, right: '50%', width: '100%', height: 2, backgroundColor: color.hairline },
  barLineOn: { backgroundColor: color.primary },
  dot: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: color.off, backgroundColor: color.bg, alignItems: 'center', justifyContent: 'center' },
  dotNow: { borderColor: color.primary },
  dotDone: { backgroundColor: color.primary, borderColor: color.primary },
  dotFailed: { backgroundColor: color.error, borderColor: color.error },
  dotSkipped: { borderStyle: 'dashed' },
  dotText: { color: color.onPrimary, fontSize: 14, fontWeight: '700' },
  barText: { fontSize: type.small, color: color.muted, textAlign: 'center' },
  barTextNow: { color: color.text, fontWeight: '700' },
  barTextOff: { color: color.off },
  now: { borderColor: color.primary, borderWidth: 2 },
  sheet: { flex: 1, backgroundColor: color.bg },
  body: { padding: space.screen, paddingBottom: 30, gap: space.gap },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  headerText: { flex: 1, minWidth: 0, gap: 4 },
  merchant: { fontSize: type.heading, fontWeight: '800', letterSpacing: -0.4, color: color.text },
  close: { width: 36, height: 36, borderRadius: 18, backgroundColor: color.quiet, alignItems: 'center', justifyContent: 'center' },
  closeText: { fontSize: 16, color: color.text },
  step: { padding: 16, gap: 4 },
  label: { fontSize: type.tiny, fontWeight: '600', color: color.muted, letterSpacing: 0.4 },
  title: { fontSize: 16, fontWeight: '700', color: color.text },
  muted: { fontSize: type.small, color: color.muted },
  error: { fontSize: type.small, color: color.error },
  link: { fontSize: type.small, fontWeight: '600', color: color.text, textDecorationLine: 'underline' },
});

// One entry, step by step: what the phone decided, the paid lookup if there was one, and the buy. A demo shop order or Bitrefill purchase is one card.
import { ActivityIndicator, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card } from '../ui/kit';
import { color, space, type } from '../ui/theme';
import type { Order } from '../lib/log';
import type { Item } from '../App';
import { paySteps, timeline, wouldPayLine, type Paying, type StepState, type TimelineStep } from '../lib/steps';
import { clock } from './Activity';

export function EntrySheet({ item, onClose }: { item: Item; onClose(): void }) {
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

        {'order' in item ? <Card style={s.step}>
          <Text style={s.label}>DEMO ORDER</Text>
          {item.order.seller === 'bitrefill' ? <BitrefillLines order={item.order} /> : <OrderLines order={item.order} />}
          <PaySteps order={item.order} invest={item.invest} pay={item.pay} />
        </Card> : <Timeline steps={timeline(item)} />}
      </ScrollView>
    </Modal>
  );
}

// The story of a card decision as a vertical line of dots: a spinner on the step running now, a tick when done, a cross when it failed.
function Timeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={steps.map(step => `${step.title}, ${step.state}`).join('; ')}>
      {steps.map((step, i) => (
        <View key={step.key} style={s.row}>
          <View style={s.rail}>
            <Dot state={step.state} />
            {i < steps.length - 1 && <View style={[s.railLine, step.state === 'done' && s.barLineOn]} />}
          </View>
          <View style={s.rowText}>
            {step.transaction
              ? <Text style={[s.title, s.titleLink]} onPress={() => void Linking.openURL(`https://sepolia.etherscan.io/tx/${step.transaction}`)}>{step.title} ↗</Text>
              : <Text style={[s.title, step.state === 'failed' && s.titleFailed, (step.state === 'pending' || step.state === 'skipped') && s.barTextOff]}>{step.title}</Text>}
            {step.detail ? <Text style={s.muted}>{step.detail}</Text> : null}
          </View>
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

// The x402 exchange as steps, then the invest after it, same dots as the bar; the order sheet in Chat shows it live while paying.
export function PaySteps({ order, invest, pay }: Paying) {
  return (
    <View style={s.paySteps}>
      {paySteps(order, invest, pay).map(step => (
        <View key={step.key} style={s.payStep}>
          <Dot state={step.state} />
          {step.transaction
            ? <Text style={[s.payText, s.link]} onPress={() => void Linking.openURL(`https://sepolia.etherscan.io/tx/${step.transaction}`)}>{step.text} · view on Etherscan</Text>
            : <Text style={[s.payText, step.state === 'active' && s.barTextNow, (step.state === 'pending' || step.state === 'skipped') && s.barTextOff]}>{step.text}</Text>}
        </View>
      ))}
    </View>
  );
}


type ShopOrder = Exclude<Order, { seller: 'bitrefill' }>;
// Where the price came from, dated; entries saved before the date was kept show none.
const source = ({ source, checkedAt }: ShopOrder) => source === 'sample' ? 'sample price'
  : `${source === 'live' ? 'checked at' : 'recorded price,'} Amazon.ae${checkedAt ? `, ${checkedAt.slice(0, 10)}` : ''}`; // a live check is a full ISO time

function OrderLines({ order }: { order: ShopOrder }) {
  const shop = `Nest demo shop${order.agent ? ` (agent #${order.agent})` : ''}`;
  return (
    <>
      {order.error
        ? <Text style={s.error}>{order.error}</Text>
        : <Text style={s.title}>{order.state === 'done' ? `Ordered from ${shop}` : `Ordering from ${shop}…`}</Text>}
      <Text style={s.muted}>AED {order.priceAed} · {source(order)}</Text>
      <Text style={s.muted}>Demo order, not shipped</Text>
    </>
  );
}

function BitrefillLines({ order }: { order: Extract<Order, { seller: 'bitrefill' }> }) {
  const mirror = `the Sepolia mirror${order.agent ? ` (agent #${order.agent})` : ''}`;
  const { wouldPay } = order;
  return (
    <>
      {order.error
        ? <Text style={s.error}>{order.error}</Text>
        : <Text style={s.title}>{order.state === 'done' ? `Found on Bitrefill · paid ${mirror}` : `Found on Bitrefill · paying ${mirror}…`}</Text>}
      <Text style={s.muted}>{order.packageValue} · {order.priceUsd} USD at Bitrefill{order.checkedAt ? `, checked ${order.checkedAt.slice(0, 10)}` : ''}</Text>
      <Text style={s.muted}>{wouldPayLine(wouldPay)}</Text>
      <Text style={s.muted}>Demo purchase on Sepolia · the card is not issued</Text>
    </>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: 14 },
  rail: { alignItems: 'center', width: 28 },
  railLine: { flex: 1, width: 2, minHeight: 14, backgroundColor: color.hairline, marginVertical: 4 },
  rowText: { flex: 1, minWidth: 0, gap: 2, paddingTop: 3, paddingBottom: 18 },
  titleLink: { textDecorationLine: 'underline' },
  titleFailed: { color: color.error },
  barLineOn: { backgroundColor: color.primary },
  dot: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: color.off, backgroundColor: color.bg, alignItems: 'center', justifyContent: 'center' },
  dotNow: { borderColor: color.primary },
  dotDone: { backgroundColor: color.primary, borderColor: color.primary },
  dotFailed: { backgroundColor: color.error, borderColor: color.error },
  dotSkipped: { borderStyle: 'dashed' },
  dotText: { color: color.onPrimary, fontSize: 14, fontWeight: '700' },
  barTextNow: { color: color.text, fontWeight: '700' },
  barTextOff: { color: color.off },
  paySteps: { gap: 8, marginTop: 8 },
  payStep: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  payText: { flex: 1, fontSize: type.small, color: color.muted },
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

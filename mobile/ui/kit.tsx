import { useRef, useState, type ReactNode } from 'react'
import { Image, Modal, PanResponder, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, type StyleProp, type ViewStyle } from 'react-native'
import { color, radius, space, type } from './theme'
import { limitFromText, limitText } from '../lib/settings'

export function SectionLabel({ children }: { children: ReactNode }) {
  return <Text style={s.section}>{children}</Text>
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[s.card, style]}>{children}</View>
}

export function Panel({ children }: { children: ReactNode }) {
  return <View style={s.panel}>{children}</View>
}

// A sheet over the chat, the way the entry and order sheets open: it slides up, and closes with a drag down (iOS calls onRequestClose) or the ✕.
export function Sheet({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ScrollView style={s.sheet} contentContainerStyle={s.sheetBody} keyboardShouldPersistTaps="handled">
        <View style={s.sheetHeader}>
          <Text accessibilityRole="header" style={s.sheetTitle}>{title}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={s.close}><Text style={s.closeText}>✕</Text></Pressable>
        </View>
        {children}
      </ScrollView>
    </Modal>
  )
}

export function Button({ title, onPress, kind = 'primary', disabled }:
  { title: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'quiet'; disabled?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress}
      hitSlop={kind === 'quiet' ? 4 : 0} style={[s.button, buttonKind[kind], disabled && s.disabled]}>
      <Text style={[s.buttonText, kind === 'primary' ? s.onPrimary : kind === 'quiet' ? s.quietText : s.secondaryText]}>{title}</Text>
    </Pressable>
  )
}

const pillTone = {
  solid: { bg: color.primary, fg: color.onPrimary },
  quiet: { bg: color.quiet, fg: '#333333' },
  error: { bg: color.errorBg, fg: color.error },
} as const

export function Pill({ label, tone }: { label: string; tone: 'solid' | 'quiet' | 'error' }) {
  const t = pillTone[tone]
  return <View style={[s.pill, { backgroundColor: t.bg }]}><Text style={[s.pillText, { color: t.fg }]}>{label}</Text></View>
}

export function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return <Switch value={value} onValueChange={onChange} accessibilityLabel={label} trackColor={{ true: '#0a0a0a', false: '#d9d9d6' }} />
}

// A dot on a line, dragged left to right from 0 to 100; it reports whole steps. VoiceOver adjusts it by `step`.
export function Slider({ value, onChange, label, step = 5 }: { value: number; onChange: (v: number) => void; label: string; step?: number }) {
  const [width, setWidth] = useState(0)
  const start = useRef(0)
  const latest = useRef({ value, width, onChange })
  latest.current = { value, width, onChange }
  const clamp = (v: number) => Math.min(100, Math.max(0, Math.round(v)))
  // Only a changed value is reported: each report writes settings.json.
  const report = (v: number) => { const next = clamp(v); if (next !== latest.current.value) latest.current.onChange(next) }
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false, // keep the drag when a scroll view wants it
    onPanResponderGrant: event => { const w = latest.current.width; if (w > 0) { start.current = event.nativeEvent.locationX / w * 100; report(start.current) } },
    onPanResponderMove: (_event, gesture) => { const w = latest.current.width; if (w > 0) report(start.current + gesture.dx / w * 100) },
  })).current
  return (
    <View style={s.slider} onLayout={event => setWidth(event.nativeEvent.layout.width)} {...pan.panHandlers}
      accessible accessibilityRole="adjustable" accessibilityLabel={label} accessibilityValue={{ min: 0, max: 100, now: value, text: `${value}%` }}
      onAccessibilityAction={event => onChange(clamp(value + (event.nativeEvent.actionName === 'increment' ? step : -step)))}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}>
      <View style={s.sliderLine} pointerEvents="none"><View style={[s.sliderFill, { width: `${value}%` }]} /></View>
      <View pointerEvents="none" style={[s.sliderDot, { left: Math.min(Math.max(0, width - 28), Math.max(0, width * value / 100 - 14)) }]} />
    </View>
  )
}

// An optional amount limit: "No limit" or the amount, typed with a decimal keypad and saved when editing ends. `least` is the smallest amount allowed.
export function LimitRow({ label, value, onChange, least = 0n }: { label: string; value?: string; onChange: (micro: string | null) => void; least?: bigint }) {
  const [text, setText] = useState(value === undefined ? '' : limitText(BigInt(value)))
  const [bad, setBad] = useState(false)
  // A valid amount is saved as it is typed, so leaving the screen with the keyboard open keeps it; an invalid one shows the error.
  const commit = (next: string) => {
    if (next.trim() === '') { setBad(false); if (value !== undefined) onChange(null); return }
    const micro = limitFromText(next, least)
    setBad(micro === null)
    if (micro !== null && micro !== value) onChange(micro)
  }
  return (
    <View style={s.limit}>
      <View style={s.limitLine}>
        <Text style={s.limitLabel}>{label}</Text>
        <Text style={s.limitValue}>{value === undefined ? 'No limit' : `${limitText(BigInt(value))} USD₮0`}</Text>
      </View>
      <View style={s.limitLine}>
        <TextInput style={s.limitInput} value={text} onChangeText={next => { setText(next); commit(next) }}
          keyboardType="decimal-pad" placeholder="No limit" placeholderTextColor={color.muted} accessibilityLabel={label} />
        {value !== undefined && <Pressable accessibilityRole="button" hitSlop={8} onPress={() => { setText(''); setBad(false); onChange(null) }}><Text style={s.limitClear}>No limit</Text></Pressable>}
      </View>
      {bad && <Text style={s.limitError}>Enter an amount with at most 2 decimals{least > 0n ? `, at least ${limitText(least)}` : ''}</Text>}
    </View>
  )
}

export function ProgressBar({ fraction }: { fraction: number }) {
  const pct = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%` as const
  return <View style={s.track}><View style={[s.fill, { width: pct }]} /></View>
}

export function Mark({ size }: { size: number }) {
  return <Image source={require('../assets/mark.png')} style={{ width: size, height: size }} accessibilityLabel="Nest" />
}

const s = StyleSheet.create({
  slider: { height: 44, justifyContent: 'center' },
  sliderLine: { height: 4, borderRadius: 2, backgroundColor: color.off },
  sliderFill: { height: 4, borderRadius: 2, backgroundColor: color.primary },
  sliderDot: { position: 'absolute', width: 28, height: 28, borderRadius: 14, backgroundColor: color.primary, borderWidth: 3, borderColor: color.bg },
  limit: { gap: 6, paddingTop: 10 },
  limitLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  limitLabel: { fontSize: type.body, color: color.text },
  limitValue: { fontSize: type.small, color: color.muted },
  limitInput: { flex: 1, borderWidth: 1, borderColor: color.hairline, borderRadius: radius.button, paddingVertical: 8, paddingHorizontal: 12, fontSize: type.body, color: color.text },
  limitClear: { fontSize: type.small, color: color.text, textDecorationLine: 'underline' },
  limitError: { fontSize: type.tiny, color: color.error },
  section: { fontSize: type.small, fontWeight: '600', color: color.muted, letterSpacing: 0.4 },
  card: { backgroundColor: color.bg, borderWidth: 1, borderColor: color.hairline, borderRadius: radius.card },
  panel: { backgroundColor: color.panel, borderRadius: 22, padding: 20 },
  button: { alignItems: 'center', justifyContent: 'center', minHeight: 44, borderRadius: radius.button },
  buttonText: { fontSize: 17, fontWeight: '600' },
  onPrimary: { color: color.onPrimary },
  secondaryText: { color: color.text },
  quietText: { color: color.muted, fontSize: type.body },
  disabled: { opacity: 0.4 },
  pill: { alignSelf: 'flex-start', borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  pillText: { fontSize: type.tiny, fontWeight: '600' },
  track: { height: 8, borderRadius: 4, backgroundColor: color.quiet, overflow: 'hidden' },
  fill: { height: 8, backgroundColor: color.primary },
  sheet: { flex: 1, backgroundColor: color.bg },
  sheetBody: { padding: space.screen, paddingBottom: 30, gap: space.gap },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  sheetTitle: { fontSize: type.heading, fontWeight: '800', letterSpacing: -0.4, color: color.text },
  close: { width: 36, height: 36, borderRadius: 18, backgroundColor: color.quiet, alignItems: 'center', justifyContent: 'center' },
  closeText: { fontSize: 16, color: color.text },
})

const buttonKind = {
  primary: { height: 56, backgroundColor: color.primary },
  secondary: { height: 52, borderWidth: 2, borderColor: color.text },
  quiet: {},
} as const

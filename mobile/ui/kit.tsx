import type { ReactNode } from 'react'
import { Image, Pressable, ScrollView, StyleSheet, Switch, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { color, radius, space, type } from './theme'

export function Screen({ children, scroll }: { children: ReactNode; scroll?: boolean }) {
  return scroll
    ? <ScrollView style={s.screen} contentContainerStyle={s.screenBody}>{children}</ScrollView>
    : <View style={[s.screen, s.screenBody]}>{children}</View>
}

export function Title({ children }: { children: ReactNode }) {
  return <Text accessibilityRole="header" style={s.title}>{children}</Text>
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <Text style={s.section}>{children}</Text>
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[s.card, style]}>{children}</View>
}

export function Panel({ children }: { children: ReactNode }) {
  return <View style={s.panel}>{children}</View>
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

export function Row({ title, subtitle, right, onPress }: { title: string; subtitle?: string; right?: ReactNode; onPress?: () => void }) {
  const body = (
    <>
      <View style={s.rowText}>
        <Text style={s.rowTitle}>{title}</Text>
        {subtitle ? <Text style={s.rowSub}>{subtitle}</Text> : null}
      </View>
      {right}
    </>
  )
  return onPress
    ? <Pressable accessibilityRole="button" onPress={onPress} style={s.row}>{body}</Pressable>
    : <View style={s.row}>{body}</View>
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

export function ProgressBar({ fraction }: { fraction: number }) {
  const pct = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%` as const
  return <View style={s.track}><View style={[s.fill, { width: pct }]} /></View>
}

export function Mark({ size }: { size: number }) {
  return <Image source={require('../assets/mark.png')} style={{ width: size, height: size }} accessibilityLabel="Nest" />
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  screenBody: { paddingTop: 60, paddingHorizontal: space.screen },
  title: { fontSize: type.title, fontWeight: '700', color: color.text },
  section: { fontSize: type.small, fontWeight: '600', color: color.muted, letterSpacing: 0.4 },
  card: { backgroundColor: color.bg, borderWidth: 1, borderColor: color.hairline, borderRadius: radius.card },
  panel: { backgroundColor: color.panel, borderRadius: 22, padding: 20 },
  button: { alignItems: 'center', justifyContent: 'center', minHeight: 44, borderRadius: radius.button },
  buttonText: { fontSize: 17, fontWeight: '600' },
  onPrimary: { color: color.onPrimary },
  secondaryText: { color: color.text },
  quietText: { color: color.muted, fontSize: type.body },
  disabled: { opacity: 0.4 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: color.hairline },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 16, color: color.text },
  rowSub: { fontSize: type.small, color: color.muted, marginTop: 2 },
  pill: { alignSelf: 'flex-start', borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  pillText: { fontSize: type.tiny, fontWeight: '600' },
  track: { height: 8, borderRadius: 4, backgroundColor: color.quiet, overflow: 'hidden' },
  fill: { height: 8, backgroundColor: color.primary },
})

const buttonKind = {
  primary: { height: 56, backgroundColor: color.primary },
  secondary: { height: 52, borderWidth: 2, borderColor: color.text },
  quiet: {},
} as const

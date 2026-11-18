// The three tabs along the bottom, each with a small icon drawn from Views.
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { color } from '../ui/theme';

export type Tab = 'home' | 'activity' | 'agent';

const TABS = [['home', 'Home'], ['activity', 'Activity'], ['agent', 'Agent']] as const;

function Icon({ tab, tint }: { tab: Tab; tint: string }) {
  if (tab === 'home') return <View style={[s.home, { borderColor: tint }]} />;
  if (tab === 'activity') return <View style={s.lines}>{[0, 1, 2].map(i => <View key={i} style={[s.line, { backgroundColor: tint }]} />)}</View>;
  return <View style={[s.agent, { borderColor: tint }]}><View style={[s.core, { backgroundColor: tint }]} /></View>;
}

export function TabBar({ tab, onTab }: { tab: Tab; onTab(tab: Tab): void }) {
  return (
    <View style={s.bar}>
      {TABS.map(([id, label]) => {
        const tint = id === tab ? color.text : color.tabOff;
        return (
          <Pressable key={id} accessibilityRole="tab" accessibilityState={{ selected: id === tab }} accessibilityLabel={label}
            onPress={() => onTab(id)} style={s.tab}>
            <View style={s.icon}><Icon tab={id} tint={tint} /></View>
            <Text style={[s.label, { color: tint }]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: 'row', paddingTop: 8, paddingHorizontal: 12, paddingBottom: 26, backgroundColor: color.bg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.hairline },
  tab: { flex: 1, alignItems: 'center', gap: 3, paddingVertical: 6 },
  icon: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 11, fontWeight: '600' },
  home: { width: 18, height: 16, borderWidth: 2, borderTopLeftRadius: 9, borderTopRightRadius: 9, borderBottomLeftRadius: 2, borderBottomRightRadius: 2 },
  lines: { gap: 4 },
  line: { width: 18, height: 2, borderRadius: 1 },
  agent: { width: 18, height: 18, borderWidth: 2, borderRadius: 5, alignItems: 'center', justifyContent: 'center' },
  core: { width: 6, height: 6, borderRadius: 2 },
});

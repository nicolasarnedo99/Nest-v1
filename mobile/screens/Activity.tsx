// Every entry in the activity log, newest first, grouped by day. Display only: tapping opens the entry sheet.
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Card, Pill, Screen, SectionLabel, Title } from '../ui/kit';
import { color, space, type } from '../ui/theme';
import { summarise, type Summary } from '../lib/holdings';
import type { Item } from '../App';

export const pillTone = (pill: Summary['pill']) => pill === 'Bought' ? 'solid' : pill === 'Error' ? 'error' : 'quiet';
export const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// The kit's Row cannot hold its title to one line, so entries use this one.
export function EntryRow({ item, onOpen, time, last }: { item: Item; onOpen(id: number): void; time?: boolean; last?: boolean }) {
  const { pill, line } = summarise(item);
  return (
    <Pressable accessibilityRole="button" onPress={() => onOpen(item.id)} style={[s.row, last && s.rowLast]}>
      <View style={s.text}>
        <Text style={s.title} numberOfLines={1}>{item.merchant}</Text>
        <Text style={s.sub} numberOfLines={1}>{line}</Text>
      </View>
      <View style={s.right}>
        <Pill label={pill} tone={pillTone(pill)} />
        {time && <Text style={s.sub}>{clock(item.at)}</Text>}
      </View>
    </Pressable>
  );
}

function dayLabel(at: number, now = new Date()) {
  const day = new Date(at).toDateString();
  if (day === now.toDateString()) return 'TODAY';
  if (day === new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).toDateString()) return 'YESTERDAY';
  return new Date(at).toLocaleDateString();
}

export function Activity({ items, logNote, onOpen }: { items: Item[]; logNote: string | null; onOpen(id: number): void }) {
  const groups: { label: string; items: Item[] }[] = [];
  for (const item of [...items].sort((a, b) => b.at - a.at)) {
    const label = dayLabel(item.at);
    if (groups.at(-1)?.label === label) groups.at(-1)!.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return (
    <Screen scroll>
      <View style={s.body}>
        <Title>Activity</Title>
        {logNote && <Text style={s.error}>{logNote}</Text>}
        {groups.length === 0 && <Text style={s.sub}>Nothing yet. Purchases you decide or tap with your card show here.</Text>}
        {groups.map(group => (
          <View key={group.label} style={s.group}>
            <SectionLabel>{group.label}</SectionLabel>
            <Card>
              {group.items.map((item, i) => <EntryRow key={item.id} item={item} onOpen={onOpen} time last={i === group.items.length - 1} />)}
            </Card>
          </View>
        ))}
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  body: { gap: space.gap, paddingBottom: 24 },
  group: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: color.hairline },
  rowLast: { borderBottomWidth: 0 },
  text: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: type.body, fontWeight: '600', color: color.text },
  sub: { fontSize: type.small, color: color.muted },
  right: { alignItems: 'flex-end', gap: 4 },
  error: { fontSize: type.small, color: color.error },
});

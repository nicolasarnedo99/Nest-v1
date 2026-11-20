// The top of the chat: the Nest mark and the settings wheel. No title; the portfolio and activity are a swipe away.
import { Pressable, StyleSheet, View } from 'react-native';
import { NestMark, SlidersIcon } from '../ui/icons';
import { color } from '../ui/theme';

export function Header({ onSettings }: { onSettings(): void }) {
  return (
    <View style={s.header}>
      <NestMark size={35} />
      <Pressable accessibilityRole="button" accessibilityLabel="Settings" hitSlop={10} onPress={onSettings}>
        <SlidersIcon size={26} tint={color.text} />
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});

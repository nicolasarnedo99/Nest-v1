// The top of Nest's one screen: the Nest mark, which opens the portfolio, and the settings wheel. No title.
import { Pressable, StyleSheet, View } from 'react-native';
import { GearIcon, NestMark } from '../ui/icons';
import { color } from '../ui/theme';

export function Header({ onPortfolio, onSettings }: { onPortfolio(): void; onSettings(): void }) {
  return (
    <View style={s.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="Portfolio" hitSlop={10} onPress={onPortfolio}>
        <NestMark size={30} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Settings" hitSlop={10} onPress={onSettings}>
        <GearIcon size={24} tint={color.text} />
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});

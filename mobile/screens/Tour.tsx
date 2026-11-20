// The first-run walkthrough, shown once after setup: each hint waits for you to do what it says, then the next one shows.
// Step 1 (the receipt sheet's own hint) is drawn inside that sheet, which covers the app; the others sit over the pages.
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { color, space } from '../ui/theme';
import { TOUR } from '../lib/tour';

export function TourHint({ step, onSkip }: { step: number; onSkip(): void }) {
  return (
    <View style={s.layer} pointerEvents="box-none">
      <View style={s.bubble} accessibilityLiveRegion="polite">
        <Text style={s.text}>{TOUR[step]}</Text>
        <Pressable accessibilityRole="button" onPress={onSkip} hitSlop={10}><Text style={s.skip}>Skip</Text></Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  layer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, justifyContent: 'center', alignItems: 'center', padding: space.screen },
  bubble: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12, paddingHorizontal: 18, borderRadius: 999, backgroundColor: color.text },
  text: { fontSize: 16, fontWeight: '600', color: color.bg },
  skip: { fontSize: 14, color: color.off },
});

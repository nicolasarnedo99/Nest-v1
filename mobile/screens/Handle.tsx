// The activity handle above the message field: a grabber and one line for the newest entry. A tap or a swipe up opens the activity sheet.
import { useEffect, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';
import { color, type } from '../ui/theme';
import { peek } from '../lib/peek';
import type { Entry } from '../lib/log';

const TAP = 8; // points a tap may move
const SWIPE = 24; // points up that make a swipe

export function Handle({ items, onOpen }: { items: Entry[]; onOpen(): void }) {
  const [, setTick] = useState(0);
  // "2 min ago" moves on by itself, so the line is read again every 30 s.
  useEffect(() => { const timer = setInterval(() => setTick(n => n + 1), 30_000); return () => clearInterval(timer); }, []);
  const latest = useRef(onOpen);
  latest.current = onOpen;
  // A PanResponder on a View, not a Pressable: a Pressable claims the touch and never sees the swipe.
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderRelease: (_event, g) => {
      if ((Math.abs(g.dx) < TAP && Math.abs(g.dy) < TAP) || g.dy < -SWIPE) latest.current();
    },
  })).current;
  const line = peek(items, Date.now());
  return (
    <View style={s.handle} {...pan.panHandlers} accessible accessibilityRole="button" accessibilityLabel={line}
      accessibilityHint="Opens your activity" onAccessibilityTap={onOpen}>
      <View style={s.grabber} />
      <Text style={s.peek} numberOfLines={1}>{line}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  handle: { alignItems: 'center', gap: 6, paddingTop: 4, paddingBottom: 10 },
  grabber: { width: 36, height: 5, borderRadius: 3, backgroundColor: color.off },
  peek: { alignSelf: 'stretch', textAlign: 'center', fontSize: type.small, color: color.muted },
});

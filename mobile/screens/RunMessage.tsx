// A confirmed payment in the chat: a ring circles the message while it runs, a tick or a cross shows for a moment when it ends,
// then it is a normal message. A failure keeps its reason and, once, Try again. Tapping it opens the entry's detail.
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { color, radius, type } from '../ui/theme';
import type { Ring } from '../lib/ring';

const MOMENT = 1500; // how long the tick or cross stays before the message settles

export function RunMessage({ ring, note, canRetry, onRetry, onOpen }: { ring: Ring; note?: string; canRetry: boolean; onRetry(): void; onOpen?: () => void }) {
  const [moment, setMoment] = useState(false);
  const was = useRef(ring.state);
  useEffect(() => {
    if (was.current === 'running' && ring.state !== 'running') {
      setMoment(true);
      const timer = setTimeout(() => setMoment(false), MOMENT);
      was.current = ring.state;
      return () => clearTimeout(timer);
    }
    was.current = ring.state;
  }, [ring.state]);

  const failed = ring.state === 'failed';
  return (
    <Pressable onPress={onOpen} disabled={!onOpen} accessibilityRole="button" accessibilityHint="Opens the steps of this payment"
      style={[s.bubble, ring.state === 'running' && s.bubbleRunning]}>
      <View style={s.row}>
        <Text style={[s.text, failed && s.textFailed]}>{ring.text}</Text>
        {ring.state === 'running' ? <Spinner />
          : moment ? <View style={[s.mark, failed ? s.markFailed : ring.state === 'done' ? s.markDone : s.markEnded]}>
              <Text style={s.markText}>{failed ? '✕' : ring.state === 'done' ? '✓' : '–'}</Text>
            </View> : null}
      </View>
      {failed && <Text style={s.reason}>{ring.reason}</Text>}
      {note && <Text style={s.note}>{note}</Text>}
      {failed && canRetry && !moment && (
        <Pressable onPress={onRetry} accessibilityRole="button" style={s.retry}><Text style={s.retryText}>Try again</Text></Pressable>
      )}
    </Pressable>
  );
}

// A ring that turns: one dark arc on a light circle.
function Spinner() {
  const turn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(turn, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [turn]);
  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return <Animated.View accessibilityLabel="In progress" style={[s.spinner, { transform: [{ rotate }] }]} />;
}

const s = StyleSheet.create({
  bubble: { alignSelf: 'flex-start', maxWidth: '85%', borderRadius: radius.card, paddingVertical: 10, paddingHorizontal: 14, backgroundColor: color.panel, gap: 4,
    borderWidth: 1, borderColor: 'transparent' },
  bubbleRunning: { borderColor: color.hairline },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  text: { flexShrink: 1, fontSize: type.body, color: color.text },
  textFailed: { color: color.muted },
  reason: { fontSize: type.small, color: color.error },
  note: { fontSize: type.small, color: color.muted },
  spinner: { width: 20, height: 20, borderRadius: 10, borderWidth: 2.5, borderColor: color.off, borderTopColor: color.primary },
  mark: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  markDone: { backgroundColor: color.primary },
  markFailed: { backgroundColor: color.error },
  markEnded: { backgroundColor: color.muted },
  markText: { color: color.onPrimary, fontSize: 12, fontWeight: '700' },
  retry: { alignSelf: 'flex-start', marginTop: 4, paddingVertical: 6, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: color.primary },
  retryText: { color: color.onPrimary, fontSize: type.small, fontWeight: '600' },
});

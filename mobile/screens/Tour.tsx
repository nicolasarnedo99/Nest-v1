// The walkthrough's hint: the whole screen greys over a little and the hint shows in white at its centre. Touches go through,
// so you can do what it says. On a page you just reached it waits a moment first, so you see the page before the hint.
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { TOUR } from '../lib/tour';

export const DIM = 'rgba(10,10,10,0.42)';

export function TourHint({ step, delay }: { step: number; delay: number }) {
  const shown = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    shown.setValue(0);
    const fade = Animated.sequence([Animated.delay(delay), Animated.timing(shown, { toValue: 1, duration: 450, useNativeDriver: true })]);
    fade.start();
    return () => fade.stop();
  }, [step, delay, shown]);
  return (
    <Animated.View pointerEvents="none" style={[s.layer, { opacity: shown }]} accessibilityLiveRegion="polite">
      <Text style={s.text}>{TOUR[step]}</Text>
    </Animated.View>
  );
}

export const tourText = { fontSize: 22, fontWeight: '700', color: '#ffffff', textAlign: 'center', paddingHorizontal: 32 } as const;

const s = StyleSheet.create({
  layer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, justifyContent: 'center', alignItems: 'center', backgroundColor: DIM },
  text: tourText,
});

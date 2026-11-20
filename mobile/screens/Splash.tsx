// While the model loads: a white screen with the Nest mark, a pulse going round it counter-clockwise, each twig growing 8% as it
// passes. Once the model is ready, the twigs spiral out together, each on its own curve to a different edge, and the chat shows
// through. A failed load stays and says why.
import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg from 'react-native-svg';
import { PETALS, Twig } from '../ui/icons';
import { color, space, type } from '../ui/theme';

const SIZE = 154; // 10% bigger than the 140 it was
// Degrees each twig travels round the centre on its way out; different for each so they leave to all round the screen.
const SPIN_OUT = [110, 180, 130, 205, 100, 165, 140, 190];
const LAP_MS = 2100; // one turn of the pulse round the eight twigs
const GROW = 1.08; // a twig's size as the pulse passes
const DISSOLVE_MS = 700;

// 1 when the pulse is on twig `i`, falling to 0 one twig away; the pulse runs 0 → 8 and 8 wraps to 0. Twigs are numbered
// clockwise, so twig 8 - k is lit at step k and the pulse goes round counter-clockwise.
const at = (i: number) => ({ inputRange: [0, 1, 2, 3, 4, 5, 6, 7, 8], outputRange: [0, 1, 2, 3, 4, 5, 6, 7, 8].map(k => ((8 - k) % 8 === i ? 1 : 0)) });
const toRad = (deg: number) => (deg * Math.PI) / 180;

export function Splash({ ready, error, onDone }: { ready: boolean; error: string | null; onDone(): void }) {
  const { width, height } = useWindowDimensions();
  const pulse = useRef(new Animated.Value(0)).current;
  const out = useRef(new Animated.Value(0)).current;
  // Round: until the model is ready. A failed load stops it, so it does not look like it is still trying.
  useEffect(() => {
    pulse.setValue(0);
    if (ready || error) return;
    const lap = Animated.loop(Animated.timing(pulse, { toValue: 8, duration: LAP_MS, easing: Easing.linear, useNativeDriver: true }));
    lap.start();
    return () => lap.stop();
  }, [ready, error, pulse]);

  // Out: when the model is ready.
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (!ready) { out.setValue(0); return; }
    const run = Animated.timing(out, { toValue: 1, duration: DISSOLVE_MS, easing: Easing.in(Easing.cubic), useNativeDriver: true });
    run.start(({ finished }) => { if (finished) done.current(); });
    return () => run.stop();
  }, [ready, out]);

  // How far a twig must be pushed out, at screen angle `deg`, to sit just past the edge of the screen in that direction.
  const edge = (deg: number) => {
    const c = Math.abs(Math.cos(toRad(deg))), n = Math.abs(Math.sin(toRad(deg)));
    return Math.min(c ? width / 2 / c : Infinity, n ? height / 2 / n : Infinity) + SIZE;
  };
  return (
    <View style={s.screen} pointerEvents={ready ? 'none' : 'auto'} accessibilityLabel={error ? `Could not load the model: ${error}` : 'Loading the model'}>
      <Animated.View style={[s.backdrop, { opacity: out.interpolate({ inputRange: [0, 0.6, 1], outputRange: [1, 1, 0] }) }]} />
      <View style={s.mark}>
        {PETALS.map((angle, i) => {
          const lit = pulse.interpolate(at(i));
          // Out: pushed `r` along its own direction and turned `turn` degrees round the centre, both growing, so it spirals clockwise to an edge.
          const turn = out.interpolate({ inputRange: [0, 1], outputRange: [0, SPIN_OUT[i]!] });
          const r = out.interpolate({ inputRange: [0, 1], outputRange: [0, edge(angle + SPIN_OUT[i]!)] });
          return (
            <Animated.View key={angle} style={[StyleSheet.absoluteFill, {
              opacity: out.interpolate({ inputRange: [0, 0.8, 1], outputRange: [1, 1, 0] }),
              transform: [
                { rotate: turn.interpolate({ inputRange: [0, 360], outputRange: ['0deg', '360deg'] }) },
                { translateX: Animated.multiply(r, Math.cos(toRad(angle))) },
                { translateY: Animated.multiply(r, Math.sin(toRad(angle))) },
                { scale: ready ? 1 : lit.interpolate({ inputRange: [0, 1], outputRange: [1, GROW] }) },
              ],
            }]}>
              <Svg width={SIZE} height={SIZE} viewBox="0 0 100 100"><Twig angle={angle} /></Svg>
            </Animated.View>
          );
        })}
      </View>
      {error && <Text style={s.error}>Could not load the model: {error}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  screen: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', gap: 28, paddingHorizontal: space.screen },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: color.bg },
  mark: { width: SIZE, height: SIZE },
  error: { fontSize: type.small, color: color.error, textAlign: 'center' },
});

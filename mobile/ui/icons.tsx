// The app's drawn icons, with react-native-svg: the Nest mark, the mic, the settings sliders, and the listed companies' marks.
import { Text, View } from 'react-native';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';
import { color } from './theme';
import { logoFor } from '../lib/logos';

export const PETALS = [0, 45, 90, 135, 180, 225, 270, 315];
// One twig of assets/mark.svg (B4): a filled outline of the curve M72 50 C80 52 84 70 75.7 80.6, round at the inner end, tapering to a point.
const TWIG = 'M71.21 53.15 L71.40 53.21 L71.60 53.27 L71.80 53.35 L72.00 53.45 L72.22 53.56 L72.43 53.69 L72.66 53.84 L72.89 54.01 L73.13 54.19 L73.37 54.40 L73.61 54.63 L73.86 54.88 L74.10 55.15 L74.35 55.45 L74.59 55.76 L74.84 56.09 L75.08 56.44 L75.32 56.81 L75.55 57.19 L75.78 57.60 L76.01 58.02 L76.22 58.45 L76.44 58.90 L76.64 59.37 L76.84 59.85 L77.03 60.34 L77.21 60.85 L77.38 61.37 L77.54 61.90 L77.69 62.43 L77.83 62.98 L77.97 63.54 L78.09 64.11 L78.20 64.69 L78.29 65.27 L78.38 65.86 L78.45 66.45 L78.51 67.05 L78.56 67.66 L78.59 68.27 L78.61 68.89 L78.61 69.51 L78.60 70.13 L78.57 70.75 L78.53 71.37 L78.47 72.00 L78.40 72.63 L78.31 73.26 L78.20 73.88 L78.07 74.51 L77.93 75.13 L77.76 75.76 L77.58 76.38 L77.37 76.99 L77.15 77.61 L76.91 78.22 L76.64 78.82 L76.35 79.42 L76.04 80.01 L75.70 80.60 L75.70 80.60 L76.17 80.11 L76.63 79.61 L77.07 79.09 L77.49 78.56 L77.90 78.01 L78.28 77.45 L78.65 76.87 L79.01 76.29 L79.34 75.69 L79.66 75.07 L79.95 74.45 L80.23 73.82 L80.50 73.18 L80.74 72.54 L80.97 71.88 L81.17 71.22 L81.36 70.55 L81.54 69.88 L81.69 69.21 L81.83 68.53 L81.95 67.85 L82.05 67.16 L82.13 66.48 L82.20 65.79 L82.25 65.11 L82.28 64.43 L82.29 63.74 L82.29 63.06 L82.27 62.39 L82.23 61.72 L82.18 61.05 L82.11 60.38 L82.02 59.73 L81.92 59.08 L81.80 58.43 L81.66 57.79 L81.50 57.17 L81.33 56.55 L81.14 55.94 L80.94 55.34 L80.71 54.75 L80.47 54.17 L80.22 53.60 L79.94 53.05 L79.65 52.51 L79.33 51.99 L79.00 51.48 L78.65 50.98 L78.28 50.51 L77.89 50.05 L77.48 49.61 L77.04 49.19 L76.59 48.79 L76.11 48.42 L75.61 48.08 L75.09 47.77 L74.54 47.48 L73.98 47.23 L73.39 47.02 L72.79 46.85 Z';

// One twig turned to `angle` around the centre, in a 100 × 100 box.
export function Twig({ angle, tint = color.text }: { angle: number; tint?: string }) {
  return <G transform={`rotate(${angle} 50 50)`} fill={tint}><Path d={TWIG} /><Circle cx={72} cy={50} r={3.25} /></G>;
}

// assets/mark.svg drawn in code: eight twigs turned around the centre.
export function NestMark({ size, tint = color.text }: { size: number; tint?: string }) {
  return <Svg width={size} height={size} viewBox="0 0 100 100">{PETALS.map(angle => <Twig key={angle} angle={angle} tint={tint} />)}</Svg>;
}

// A flat microphone: a filled capsule, the cradle under it and the stand.
export function MicIcon({ size, tint }: { size: number; tint: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={tint} strokeWidth={2} strokeLinecap="round">
      <Rect x={9} y={2.5} width={6} height={11} rx={3} fill={tint} />
      <Path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
      <Path d="M12 17.5V21" />
    </Svg>
  );
}

// Settings: two thin sliders, each a line with an open knob, in the mark's light stroke.
export function SlidersIcon({ size, tint }: { size: number; tint: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={tint} strokeWidth={1.6} strokeLinecap="round">
      <Path d="M3 8h5M12 8h9M3 16h11M18 16h3" />
      <Circle cx={10} cy={8} r={2.2} />
      <Circle cx={16} cy={16} r={2.2} />
    </Svg>
  );
}

// A listed company's mark in one colour. A company without a bundled mark (most of the S&P 500) gets a grey disc with its initial,
// and no company at all (nothing bought) an empty one, so every row keeps its image slot.
export function Logo({ company, size, tint = color.text }: { company: string | null; size: number; tint?: string }) {
  const logo = company ? logoFor(company) : undefined;
  if (!logo) return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color.quiet, alignItems: 'center', justifyContent: 'center' }}>
      {company ? <Text style={{ fontSize: size * 0.5, fontWeight: '700', color: color.muted }}>{company.trim().charAt(0).toUpperCase()}</Text> : null}
    </View>
  );
  return <Svg width={size} height={size} viewBox="0 0 24 24"><Path d={logo.path} fill={tint} /></Svg>;
}

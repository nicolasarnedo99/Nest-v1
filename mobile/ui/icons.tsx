// The app's drawn icons, with react-native-svg: the Nest mark, the mic, the receipt, the settings wheel, and the listed companies' marks.
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';
import { color } from './theme';
import { logoFor } from '../lib/logos';

const PETALS = [0, 45, 90, 135, 180, 225, 270, 315];

// assets/mark.svg drawn in code: eight curved strokes turned around the centre.
export function NestMark({ size, tint = color.text }: { size: number; tint?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" fill="none" stroke={tint} strokeWidth={5} strokeLinecap="round">
      {PETALS.map(angle => <G key={angle} transform={`rotate(${angle} 50 50)`}><Path d="M72 50 C80 52 84 70 75.7 80.6" /></G>)}
    </Svg>
  );
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

// A flat receipt: a slip with a torn, zigzag bottom edge and three printed lines.
export function ReceiptIcon({ size, tint }: { size: number; tint: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={tint} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M5.5 2.5h13v19l-2.2-1.6-2.1 1.6-2.2-1.6-2.2 1.6-2.1-1.6-2.2 1.6z" />
      <Path d="M9 8h6M9 12h6M9 16h3.5" />
    </Svg>
  );
}

// A settings wheel: four bars through the centre make eight teeth, then the body and its hole.
export function GearIcon({ size, tint }: { size: number; tint: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {[0, 45, 90, 135].map(angle => <Rect key={angle} x={10.5} y={1.5} width={3} height={21} rx={1} fill={tint} transform={`rotate(${angle} 12 12)`} />)}
      <Circle cx={12} cy={12} r={7.5} fill={tint} />
      <Circle cx={12} cy={12} r={3} fill={color.bg} />
    </Svg>
  );
}

// A listed company's mark in one colour, or nothing for any other name.
export function Logo({ company, size, tint = color.text }: { company: string; size: number; tint?: string }) {
  const logo = logoFor(company);
  if (!logo) return null;
  return <Svg width={size} height={size} viewBox="0 0 24 24"><Path d={logo.path} fill={tint} /></Svg>;
}

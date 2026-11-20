// Nest's three pages side by side, Portfolio ← Chat → Activity. It opens on the chat, and a swipe moves one page.
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { color, space, type } from '../ui/theme';

export function Pages({ left, middle, right, onPage }: { left: ReactNode; middle: ReactNode; right: ReactNode; onPage(index: number): void }) {
  const { width } = useWindowDimensions();
  return (
    <ScrollView horizontal pagingEnabled directionalLockEnabled showsHorizontalScrollIndicator={false} keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled" contentOffset={{ x: width, y: 0 }}
      onMomentumScrollEnd={event => onPage(Math.round(event.nativeEvent.contentOffset.x / width))}>
      <View style={{ width }}>{left}</View>
      <View style={{ width }}>{middle}</View>
      <View style={{ width }}>{right}</View>
    </ScrollView>
  );
}

// A side page: its title, then its content, scrolling on its own.
export function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <ScrollView style={s.page} contentContainerStyle={s.body}>
      <Text accessibilityRole="header" style={s.title}>{title}</Text>
      {children}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.bg },
  body: { paddingTop: 60, paddingHorizontal: space.screen, paddingBottom: 40, gap: space.gap },
  title: { fontSize: type.title, fontWeight: '800', letterSpacing: -0.6, color: color.text },
});

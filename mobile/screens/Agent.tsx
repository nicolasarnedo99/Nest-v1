// The Agent tab: which model decides, how it saves, what it pays when unsure, its shopping limit, and where each part runs.
import { useState } from 'react';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Screen, Slider, Title } from '../ui/kit';
import { color, radius, space, type } from '../ui/theme';
import type { MODELS, ModelId, Strategies } from '../lib/settings';
import { short } from './Home';

const WHERE = [['Model', 'On this phone'], ['Wallet key', "In this phone's Keychain"], ['Activity', 'On this phone'], ['Lookups', 'Paid over x402 to the lookup service']] as const;

export function Agent({ models, modelChoice, choose, choiceDisabled, status, strategies, setShare, lookupHost, address, walletError, onReplaySetup, onClearChat }: {
  models: typeof MODELS; modelChoice: ModelId; choose(id: ModelId): void; choiceDisabled: boolean; status: string;
  strategies: Strategies; setShare(share: number): void; lookupHost: string; address?: string | null; walletError: string | null; onReplaySetup(): void; onClearChat(): void;
}) {
  return (
    <Screen scroll>
      <View style={s.body}>
        <Title>Agent</Title>
        <Card>
          <View style={s.row}>
            <Text style={s.label}>Model</Text>
            {models.map(m => (
              <Pressable key={m.id} style={[s.option, m.id === modelChoice && s.optionOn, choiceDisabled && s.off]}
                disabled={choiceDisabled} onPress={() => choose(m.id)}>
                <Text style={s.value}>{m.id === modelChoice ? '● ' : '○ '}{m.name}</Text>
                <Text style={s.small}>Blind-set score {m.score}.{m.id === modelChoice ? ' In use.' : ''}</Text>
              </Pressable>
            ))}
            <Text style={s.small}>{status}</Text>
          </View>
          <View style={s.row}>
            <Text style={s.label}>Saving</Text>
            <View style={s.line}><Text style={s.value}>Invest {strategies.share}% of what I buy</Text></View>
            <Slider value={strategies.share} onChange={setShare} label="Share of each purchase to invest" />
            <Text style={s.small}>In the company you paid, or the listed leader of its category. 0.10 to 1.00 a buy, max 5.00 a day.</Text>
          </View>
          <View style={s.row}>
            <Text style={s.label}>When unsure</Text>
            <View style={s.line}><Text style={s.value}>Pays 0.01 USD₮0 for a lookup</Text><Text style={s.small}>x402</Text></View>
            <Text style={s.small}>{lookupHost}</Text>
          </View>
          <View style={s.row}>
            <Text style={s.value}>Shopping: up to 200 USD₮0 per order and per day, every order confirmed</Text>
          </View>
          <View style={[s.row, s.last]}>
            <Text style={s.label}>Wallet</Text>
            {walletError
              ? <Text style={s.error}>Wallet error: {walletError}</Text>
              : <View style={s.line}>
                  <Text style={s.value}>{address ? short(address) : 'Opening the wallet…'}</Text>
                  {address && <Pressable accessibilityRole="button" hitSlop={8} onPress={() => void Share.share({ message: address })}>
                    <Text style={s.share}>Share address</Text>
                  </Pressable>}
                </View>}
          </View>
        </Card>

        <Card>
          <View style={s.row}><Text style={s.value}>Where things run</Text></View>
          {WHERE.map(([what, where], i) => (
            <View key={what} style={[s.row, s.line, i === WHERE.length - 1 && s.last]}>
              <Text style={s.label}>{what}</Text><Text style={[s.small, s.where]}>{where}</Text>
            </View>
          ))}
        </Card>

        <Button kind="secondary" title="Replay setup" onPress={onReplaySetup} />
        <ClearChat onClear={onClearChat} />
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  body: { gap: space.gap, paddingBottom: 24 },
  row: { paddingVertical: 14, paddingHorizontal: 16, gap: 8, borderBottomWidth: 1, borderBottomColor: color.hairline },
  last: { borderBottomWidth: 0 },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  text: { flex: 1, gap: 2 },
  label: { fontSize: type.small, color: color.muted },
  value: { fontSize: type.body, fontWeight: '600', color: color.text },
  small: { fontSize: type.tiny, color: color.muted },
  where: { flexShrink: 1, textAlign: 'right' },
  option: { borderWidth: 1, borderColor: color.hairline, borderRadius: radius.button, padding: 12, gap: 2 },
  optionOn: { borderColor: color.primary },
  off: { opacity: 0.4 },
  share: { fontSize: 14, fontWeight: '600', color: color.text },
  error: { fontSize: type.small, color: color.error },
});

// Two taps, so the history is not wiped by accident; the chat starts empty next time it opens.
function ClearChat({ onClear }: { onClear(): void }) {
  const [state, setState] = useState<'idle' | 'sure' | 'done'>('idle');
  if (state === 'done') return <Text style={s.small}>Chat history cleared.</Text>;
  return <Button kind="secondary" title={state === 'sure' ? 'Tap again to clear the chat history' : 'Clear chat history'}
    onPress={() => { if (state === 'sure') { onClear(); setState('done'); } else setState('sure'); }} />;
}

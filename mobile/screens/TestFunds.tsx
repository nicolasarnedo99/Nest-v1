// The test-funds button on the portfolio's Cash line: a labelled demo stand-in for an onramp that mints test USD₮0 on Sepolia.
import { useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { Button } from '../ui/kit';
import { color, type } from '../ui/theme';
import type { TestFunds as Funds } from '../lib/faucet';

type State = { at: 'idle' } | { at: 'adding' } | { at: 'added' } & Funds | { at: 'failed'; message: string };

// `add` asks the faucet and re-reads the balance; it resolves with the amount and the mint's transaction hash.
export function TestFunds({ add }: { add(): Promise<Funds> }) {
  const [state, setState] = useState<State>({ at: 'idle' });
  const press = async () => {
    setState({ at: 'adding' });
    try { setState({ at: 'added', ...await add() }); }
    catch (error) { setState({ at: 'failed', message: error instanceof Error ? error.message : String(error) }); }
  };
  return (
    <View style={s.body}>
      <Button kind="secondary" title={state.at === 'adding' ? 'Adding…' : 'Add test funds (Sepolia)'} disabled={state.at === 'adding'} onPress={() => void press()} />
      <Text style={s.muted}>Demo stand-in for an onramp: mints 100 test USD₮0 to this wallet.</Text>
      {state.at === 'added' && <Text style={s.link} onPress={() => void Linking.openURL(`https://sepolia.etherscan.io/tx/${state.transaction}`)}>Added {state.amount} test USD₮0 · view on Etherscan</Text>}
      {state.at === 'failed' && <Text style={s.error}>{state.message}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  body: { gap: 6, paddingHorizontal: 16 },
  muted: { fontSize: type.small, color: color.muted },
  error: { fontSize: type.small, color: color.error },
  link: { fontSize: type.small, fontWeight: '600', color: color.text, textDecorationLine: 'underline' },
});

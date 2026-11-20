import { useCallback, useEffect, useRef, useState } from 'react';
import { ShortcutSetup } from './ShortcutSetup';

export type Event = { id: string; merchant: string; amount: string; currency: string; timestamp: string; source: string; status: string; reason: string; principal: string;
  detail: { company?: string | null; explanation?: string; transaction?: string; shares?: string } };
export type Status = {
  wallet: { address: string; balance: string; ethBalance: string; chainId: number; holdings: { symbol: string; balance: string; address: string }[] };
  model: { name: string; adapter: string | null } | null;
  execution: { paused: boolean };
  limits: { dailyCap: string; minimumBuy: string; maximumBuy: string };
  eurUsdRate: { value: string; date: string; demo: boolean };
};
type Draft = { id: string; merchant: string; amount: string; currency: string; timestamp: string };
class ApiError extends Error { constructor(message: string, readonly status: number) { super(message); } }

export function Turtle({ large = false }: { large?: boolean }) {
  return <svg className={large ? 'turtle-large' : 'turtle-mark'} viewBox="0 0 120 90" fill="none" aria-hidden="true">
    <path d="M22 55c-7 0-12 4-15 8M35 63l-6 12M68 66l5 10" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
    <path d="M24 56c0-23 12-38 33-38s32 15 32 38c-16 13-48 13-65 0Z" fill="currentColor" />
    <path d="m56 20-13 18 9 19 21-1 11-17M25 50l18-12M52 57l-6 10" stroke="#c9e4c8" strokeWidth="3" strokeLinejoin="round" />
    <path d="M86 44c6-9 21-11 25-2 5 12-9 22-21 17" fill="currentColor" />
    <circle cx="104" cy="45" r="2" fill="#f7faf2" />
  </svg>;
}

export default function App() {
  // Single-user local demo: there is no login.
  const authenticated = true;
  const user = { id: 'local' };
  const [status, setStatus] = useState<Status | null>(null);
  const [events, setEvents] = useState<Event[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [merchant, setMerchant] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [pending, setPending] = useState<Draft | null>(null);
  const [draftRecoveryError, setDraftRecoveryError] = useState(false);
  const session = useRef(0);
  const refreshSequence = useRef(0);
  const request = useCallback(async (path: string, body?: unknown) => {
    const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000) });
    const data = await response.json();
    if (!response.ok) throw new ApiError(typeof data.error === 'string' ? data.error : 'Request failed. Try again.', response.status);
    return data;
  }, []);
  const refresh = useCallback(async () => {
    const current = session.current;
    const sequence = ++refreshSequence.current;
    setLoading(true);
    try {
      const results = await Promise.allSettled([request('/api/status'), request('/api/events')]);
      if (current !== session.current || sequence !== refreshSequence.current) {
        return;
      }
      const [wallet, activity] = results;
      if (wallet.status === 'fulfilled') setStatus(wallet.value); else setStatus(null);
      if (activity.status === 'fulfilled') setEvents(activity.value.events); else setEvents(null);
      const failed = results.find((result) => result.status === 'rejected');
      setError(failed?.status === 'rejected' ? failed.reason.message : '');
    } finally { if (current === session.current && sequence === refreshSequence.current) setLoading(false); }
  }, [request]);
  useEffect(() => {
    session.current++;
    setStatus(null); setEvents(null); setError(''); setNotice(''); setPending(null); setSaving(false); setLoading(false);
    setDraftRecoveryError(false);
    if (authenticated && user?.id) {
      try {
        const stored = sessionStorage.getItem(`turtle.pending.${user.id}`);
        if (stored) {
          const draft = JSON.parse(stored);
          if (!draft || ['id', 'merchant', 'amount', 'currency', 'timestamp'].some(key => typeof draft[key] !== 'string')) throw new Error('Invalid saved draft');
          setPending(draft); setMerchant(draft.merchant); setAmount(draft.amount); setCurrency(draft.currency);
        }
      } catch {
        setDraftRecoveryError(true);
        setError('Unable to recover the pending simulation. Check its saved activity before submitting again.');
      }
    }
    if (!authenticated) return;
    void refresh();
    const interval = setInterval(() => void refresh(), 3_000);
    return () => { session.current++; clearInterval(interval); };
  }, [authenticated, refresh, user?.id]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const current = session.current;
    const draft = pending ?? { id: crypto.randomUUID(), merchant, amount, currency, timestamp: new Date().toISOString() };
    if (!user?.id || draftRecoveryError) return;
    const key = `turtle.pending.${user.id}`;
    try { sessionStorage.setItem(key, JSON.stringify(draft)); }
    catch { setError('Unable to preserve this simulation for safe retry. Nothing was submitted.'); return; }
    setPending(draft); setSaving(true); setNotice(''); setError('');
    try {
      await request('/api/events', draft);
      if (current !== session.current) return;
      sessionStorage.removeItem(key);
      setPending(null); setMerchant(''); setAmount('');
      setNotice('Event saved. The model is deciding; the result appears in your activity.');
      await refresh();
    } catch (failure) {
      if (current !== session.current) return;
      if (failure instanceof ApiError && failure.status === 400) { sessionStorage.removeItem(key); setPending(null); }
      setError(failure instanceof Error ? failure.message : 'Unable to save simulation.');
    } finally { if (current === session.current) setSaving(false); }
  }

  // Sepolia has a public explorer; the local test chain does not.
  const network = status?.wallet.chainId === 31337 ? { name: 'Local test chain', explorer: '' } : { name: 'Sepolia testnet', explorer: 'https://sepolia.etherscan.io' };
  const short = (value: string) => value.replace(/(\.\d{6})\d+$/, '$1');
  const displayBalance = status?.wallet.balance.replace(/(\.\d{4})\d+$/, '$1');
  const approximateBalance = !!status && displayBalance !== status.wallet.balance;
  const tinyBalance = !!status && displayBalance === '0.0000' && /[1-9]/.test(status.wallet.balance);

  return <div className="site">
    <header><a className="brand" href="/" aria-label="Turtle home"><Turtle /><span>turtle<span className="brand-dot">.</span></span></a>
      <div className="header-actions"><span className="network"><i />{network.name}</span></div>
    </header>
    <main>
      <section className="intro"><div><p className="eyebrow">A LITTLE AT A TIME</p><h1>Small steps.<br /><span>Something to grow.</span></h1><p className="intro-copy">A local model decides which listed company a card purchase belongs to, or none. A wallet then buys a little of it. One careful step at a time.</p></div><div className="turtle-garden"><Turtle large /><span className="sprout sprout-one" /><span className="sprout sprout-two" /><span className="garden-caption">slow &amp; steady</span></div></section>
      <div className="disclosure">TESTNET DEMO <span>·</span> Stand-in tokens, not shares <span>·</span> A test copy of the USD₮0 contract, not USD₮0</div>
      {<>
        {status?.execution.paused && <section className="gate" role="status"><span className="gate-icon" aria-hidden="true">Ⅱ</span><div><strong>Purchases are paused</strong><p>Events are still classified, but nothing is signed or bought until purchases are resumed.</p></div></section>}
        {draftRecoveryError && <div className="error" role="alert">Pending simulation recovery failed. Submission is blocked until its saved identity is recovered.</div>}
        {error && <div className="error" role="alert">{error}</div>}
        {notice && <div className="notice" role="status">{notice}</div>}
        <div className="dashboard">
          <section className="wallet-card"><div className="section-title"><span className="eyebrow">THE AGENT'S WALLET · TETHER WDK</span><button className="text-button" onClick={() => void refresh()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button></div>
            <div className="balance">{tinyBalance ? '< 0.0001' : <>{approximateBalance && '≈ '}{displayBalance ?? '—'}</>}<span>test USD₮0 copy</span></div><p className="muted">{approximateBalance ? 'Approximate balance' : 'Available balance'} on {network.name}</p>
            {status && (network.explorer ? <a className="wallet-address" href={`${network.explorer}/address/${status.wallet.address}`} target="_blank" rel="noreferrer">{status.wallet.address}<span aria-hidden="true"> ↗</span></a> : <span className="wallet-address">{status.wallet.address}</span>)}
            <div className="limits"><div><span>ETH held by the agent</span><strong>{status?.wallet.ethBalance ?? '—'}</strong></div><div><span>Deciding model · Tether QVAC</span><strong>{status?.model ? `${status.model.name}, ${status.model.adapter ? `fine-tuned (${status.model.adapter})` : 'not fine-tuned'}` : '—'}</strong></div><div><span>Daily purchase cap</span><strong>{status?.limits.dailyCap ?? '5'} per day</strong></div><div><span>Per purchase</span><strong>{status?.limits.minimumBuy ?? '0.10'} to {status?.limits.maximumBuy ?? '1'}</strong></div></div>
            <p className="fine-print">A Tether WDK wallet. It signs one message per purchase and never pays gas; a relayer submits it.</p>
          </section>
          <section className="simulation-card"><p className="eyebrow">SEND A SIMULATED CARD PURCHASE</p><h2>A small everyday moment.</h2><form onSubmit={(event) => void save(event)}>
            <label htmlFor="merchant">Merchant</label><input id="merchant" value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="e.g. Apple Store Madrid" maxLength={160} required disabled={saving || !!pending} />
            <div className="form-row"><div><label htmlFor="amount">Purchase amount</label><input id="amount" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,2})?" required disabled={saving || !!pending} /></div><div><label htmlFor="currency">Currency</label><select id="currency" value={currency} onChange={(e) => setCurrency(e.target.value)} disabled={saving || !!pending}><option>USD</option><option>EUR</option></select></div></div>
            <p className="fine-print">Planned allocation: 10%, bounded to 0.10–1 of the test token.{currency === 'EUR' && ' Demo rate: 1 EUR = 1.10 USD, dated 12 Sep 2026. Not a market quote.'}</p>
            <button className="primary" disabled={saving || !status || draftRecoveryError}>{saving ? 'Saving…' : pending ? 'Retry saving this event' : 'Send event'}<span aria-hidden="true">+</span></button>
            <p className="save-note">Does not charge a card. If the model names a listed company, the wallet buys a stand-in token on the testnet.</p>
          </form></section>
        </div>
        <section className="activity"><div className="section-title"><div><p className="eyebrow">ONE STEP AT A TIME</p><h2>Your activity</h2></div><span className="count">{events ? `${events.length} events` : 'Unavailable'}</span></div>
          {events === null ? <p className="muted">Activity unavailable. Refresh to check saved simulations.</p> : events.length === 0 ? <div className="empty"><span className="empty-mark">⌁</span><strong>No events yet</strong><p>Your saved events will appear here, with an honest status for every step.</p></div> : <ul className="events">{events.map(event => <li key={event.id}><span className="merchant-icon" aria-hidden="true">{event.merchant.slice(0, 1).toUpperCase()}</span><div className="event-detail"><strong>{event.merchant}</strong><span>{event.amount} {event.currency} · {event.source === 'apple_wallet' ? 'Apple Wallet Shortcut' : 'Simulation'} · {new Date(event.timestamp).toLocaleString('en-GB', { timeZone: 'Europe/Madrid', dateStyle: 'medium', timeStyle: 'short' })} Madrid</span><p>{event.detail.company !== undefined && <>Model decided: <b className="decision">{event.detail.company ?? 'no listed company'}</b>{event.detail.explanation ? ` · “${event.detail.explanation}”` : ''}</>}{event.status !== 'skipped' && event.reason && <> {event.reason}</>}</p><p className="trail">{event.status === 'skipped' ? 'Nothing signed · nothing bought' : event.status === 'bought' ? <>Budget checked · wallet signed one message · relayer submitted · confirmed{event.detail.transaction && network.explorer && <> · <a href={`${network.explorer}/tx/${event.detail.transaction}`} target="_blank" rel="noreferrer">view transaction ↗</a></>}</> : event.status === 'blocked' ? 'Refused before signing' : event.status === 'uncertain' ? 'Signed, outcome not yet known' : event.status === 'failed' ? 'Nothing signed' : 'Working…'}</p></div><div className="event-status"><span className={`status-pill status-${event.status}`}>{event.status}</span><span>{event.status === 'bought' ? `${event.principal} tUSDT0 paid` : event.status === 'skipped' ? 'nothing bought' : `${event.principal} tUSDT0 planned`}</span></div></li>)}</ul>}
          <p className="fine-print">Nothing is retried automatically.</p>
        </section>
        <section className="holdings"><div className="section-title"><h2>What the wallet holds</h2><span className="muted">Read from the chain</span></div>{status ? status.wallet.holdings.some(h => !/^0(?:\.0+)?$/.test(h.balance)) ? <ul className="holding-list">{status.wallet.holdings.filter(h => !/^0(?:\.0+)?$/.test(h.balance)).map(h => <li key={h.symbol}><strong>{h.symbol}</strong><span>{short(h.balance)} stand-in shares</span>{network.explorer ? <a href={`${network.explorer}/token/${h.address}?a=${status.wallet.address}`} target="_blank" rel="noreferrer">View token ↗</a> : <span className="muted">local chain</span>}</li>)}</ul> : <p className="muted">No stand-in tokens held yet.</p> : <p className="muted">Balances unavailable until the wallet refresh succeeds.</p>}</section>
        <ShortcutSetup request={request} />
      </>}
    </main><footer><span>turtle · slow and steady</span><span>Built with Tether QVAC and WDK · Sepolia testnet</span></footer>
  </div>;
}

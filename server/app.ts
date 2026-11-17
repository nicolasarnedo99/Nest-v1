import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import { z } from 'zod';
import { AMOUNT_PATTERN, DEMO_RATE, parseAmount } from './money.js';
import { EventConflict, type EventStore, type SavedEvent } from './store.js';
import type { WalletSnapshot } from './wallet.js';

export type AppDependencies = {
  store: EventStore;
  readWallet: () => Promise<WalletSnapshot>;
  // Shown on the page so a recording makes clear which model is deciding.
  model?: { name: string; adapter: string | null };
  // Called once for each newly stored event. The pipeline hangs off this.
  onEvent?: (event: SavedEvent) => void;
  now?: () => number;
};

const eventSchema = z.strictObject({
  id: z.uuid().transform(value => value.toLowerCase()), merchant: z.string().min(1).max(160).refine(value => value.trim().length > 0 && !/[\x00-\x1f\x7f]/.test(value)),
  amount: z.string().regex(AMOUNT_PATTERN).refine(value => { try { parseAmount(value); return true; } catch { return false; } }),
  currency: z.enum(['USD', 'EUR']), timestamp: z.iso.datetime({ offset: true }),
});

// This is a single-user demo with no login. Everything except the Shortcut
// intake only answers requests from this machine; the Shortcut intake is the
// one route reachable from the phone, and it needs its own scoped token.
const localOnly: RequestHandler = (request, response, next) => {
  const address = request.socket.remoteAddress ?? '';
  if (address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1') { next(); return; }
  response.status(403).json({ error: 'Only available on the machine running Turtle' });
};

export function createApp(dependencies: AppDependencies) {
  const app = express();
  const now = dependencies.now ?? Date.now;
  const { store } = dependencies;
  app.disable('x-powered-by');
  app.use((_request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  app.use('/api', (_request, response, next) => { response.setHeader('Cache-Control', 'no-store'); next(); });
  const shortcutEndpoint = '/api/notifications/apple-wallet';
  let shortcutWindow = now();
  let shortcutCount = 0;
  app.post(shortcutEndpoint, (request, response, next) => {
    const match = /^Bearer ([^\s]+)$/.exec(request.headers.authorization ?? '');
    if (!match || !store.acceptsShortcutToken(match[1]!)) {
      response.status(401).json({ error: 'Valid Shortcut intake token required' }); return;
    }
    const time = now();
    if (time - shortcutWindow >= 60_000) { shortcutWindow = time; shortcutCount = 0; }
    if (++shortcutCount > 30) {
      response.setHeader('Retry-After', '60');
      response.status(429).json({ error: 'Shortcut intake limit reached; wait one minute' }); return;
    }
    next();
  }, express.json({ limit: '4kb', strict: true }), (request, response) => {
    const parsed = eventSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ error: 'Invalid purchase notification' }); return; }
    try {
      const result = store.intake(parsed.data, 'apple_wallet');
      if (result.created) dependencies.onEvent?.(result.event);
      response.status(result.created ? 202 : 200).json({ id: result.event.id, received: true, status: result.event.status });
    } catch (error) {
      if (error instanceof EventConflict) { response.status(409).json({ error: error.message }); return; }
      throw error;
    }
  });
  app.use('/api', localOnly, express.json({ limit: '4kb', strict: true }));
  app.get('/api/shortcut', (_request, response) => {
    response.json({ enabled: store.shortcutEnabled(), endpointPath: shortcutEndpoint });
  });
  app.post('/api/shortcut/token', (_request, response) => {
    response.json({ token: store.rotateShortcutToken(), endpointPath: shortcutEndpoint });
  });
  app.post('/api/shortcut/revoke', (_request, response) => {
    store.revokeShortcutToken();
    response.json({ enabled: false });
  });
  app.get('/api/status', async (_request, response) => {
    let wallet: WalletSnapshot;
    try { wallet = await dependencies.readWallet(); }
    catch { response.status(503).json({ error: 'Wallet state unavailable; retry the read later' }); return; }
    response.json({ wallet, model: dependencies.model ?? null, execution: { paused: store.paused() },
      limits: { dailyCap: '5', minimumBuy: '0.10', maximumBuy: '1' }, eurUsdRate: DEMO_RATE });
  });
  app.get('/api/events', (_request, response) => { response.json({ events: store.list() }); });
  let intakeWindow = now();
  let intakeCount = 0;
  app.post('/api/events', (request, response) => {
    const time = now();
    if (time - intakeWindow >= 60_000) { intakeWindow = time; intakeCount = 0; }
    if (++intakeCount > 30) {
      response.setHeader('Retry-After', '60');
      response.status(429).json({ error: 'Simulation intake limit reached; wait one minute' }); return;
    }
    const parsed = eventSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ error: 'Invalid simulation event' }); return; }
    try {
      const result = store.intake(parsed.data);
      if (result.created) dependencies.onEvent?.(result.event);
      response.status(result.created ? 202 : 200).json({ event: result.event });
    } catch (error) {
      if (error instanceof EventConflict) { response.status(409).json({ error: error.message }); return; }
      throw error;
    }
  });
  app.post('/api/pause', (request, response) => {
    const parsed = z.strictObject({ paused: z.boolean() }).safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ error: 'Expected paused boolean' }); return; }
    store.setPaused(parsed.data.paused);
    response.json({ paused: store.paused() });
  });
  app.use('/api', (_request, response) => { response.status(404).json({ error: 'Unknown API endpoint' }); });
  const errors: ErrorRequestHandler = (error, _request, response, _next) => {
    if (error?.type === 'entity.too.large') { response.status(413).json({ error: 'Request body too large' }); return; }
    if (error?.type === 'entity.parse.failed') { response.status(400).json({ error: 'Invalid JSON' }); return; }
    response.status(500).json({ error: 'Request failed' });
  };
  app.use(errors);
  return app;
}

import { expect, test } from '@playwright/test';

const wallet = { address: '0xE0025f5afd3FD375e30E8C3679924a499eE926F4', balanceUsdc: '9.993153889999999688', chainId: 5042002, holdings: [] };
const status = { wallet, execution: { enabled: false, paused: true, reason: 'Classification is not verified.' }, limits: { dailyCapUsdc: '5', reserveUsdc: '1' }, eurUsdRate: { value: '1.10', date: '2026-09-12', demo: true } };

test('demo journey signs in, checks funding, saves a labeled simulation and reloads without purchases', async ({ page }) => {
  const events: Record<string, unknown>[] = [];
  const writes: string[] = [];
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== 'GET') writes.push(`${request.method()} ${path}`);
    if (path === '/api/config') return route.fulfill({ json: { privyAppId: 'public-test-app' } });
    expect(request.headers().authorization).toBe('Bearer browser-test-token');
    if (path === '/api/status') return route.fulfill({ json: status });
    if (path === '/api/shortcut') return route.fulfill({ json: { enabled: false } });
    if (path === '/api/events' && request.method() === 'GET') return route.fulfill({ json: { events } });
    if (path === '/api/events' && request.method() === 'POST') {
      events.push({ ...request.postDataJSON(), source: 'simulation', status: 'needs_retry', principalUsdc: '0.55', reason: 'Investments are paused. No tokens were purchased.' });
      return route.fulfill({ status: 202, json: { event: events[0] } });
    }
    throw new Error(`Unexpected request: ${request.method()} ${path}`);
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Sign in with Privy' })).toBeVisible();
  await page.screenshot({ path: 'test-results/demo-login-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Sign in with Privy' }).click();
  await expect(page.getByText('Investments are paused', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm pause' })).toHaveCount(0);
  await expect(page.getByText('No events yet', { exact: true })).toBeVisible();
  await expect(page.getByText('No synthetic tokens held. Saving a simulation does not create a holding.')).toBeVisible();
  await expect(page.getByText(/Actual Apple Wallet fields and delivery still need verification/)).toBeVisible();
  await page.screenshot({ path: 'test-results/demo-empty-mobile.png', fullPage: true });
  const funding = page.getByRole('region', { name: 'Add test USDC' });
  await expect(funding.getByLabel('Receive address', { exact: false })).toHaveValue(wallet.address);
  await funding.getByRole('button', { name: 'Check incoming funds' }).click();
  await expect(funding.getByRole('status')).toContainText('A balance change alone does not confirm a particular deposit');
  await page.getByLabel('Merchant', { exact: true }).fill('SIMULATION · Apple Store Madrid');
  await page.getByLabel('Purchase amount').fill('5.00');
  await page.getByLabel('Currency').selectOption('EUR');
  await page.getByRole('button', { name: 'Save simulation', exact: false }).click();
  await expect(page.getByText(/Simulation saved. No purchase was made/)).toBeVisible();
  await expect(page.locator('.events li')).toHaveCount(1);
  await expect(page.locator('.events li')).toContainText('5.00 EUR · Simulation');
  await expect(page.locator('.events li')).toContainText('Not purchased');
  await page.reload();
  await expect(page.locator('.events li')).toHaveCount(1);
  await expect(page.locator('.events li')).toContainText('5.00 EUR · Simulation');
  await expect(page.locator('.events li')).toContainText('Not purchased');
  await expect(page.locator('.balance')).toContainText('≈ 9.9931');
  await expect(page.getByText('Approximate balance on Arc testnet. Exact balance below.')).toBeVisible();
  await expect(page.locator('.funding-balances')).toContainText(wallet.balanceUsdc);
  await expect(page.getByText(/saved events will not buy automatically later/)).toBeVisible();
  await expect(page.getByText('No synthetic tokens held. Saving a simulation does not create a holding.')).toBeVisible();
  expect(writes).toEqual(['POST /api/events']);
  for (const width of [320, 390, 430, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px has no horizontal overflow`).toBe(true);
    await page.screenshot({ path: `test-results/demo-${width}.png`, fullPage: true });
  }
  expect(pageErrors).toEqual([]);
});

test('activity failure is unavailable, not empty, and can recover on refresh', async ({ page }) => {
  let activityFails = true;
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/config') return route.fulfill({ json: { privyAppId: 'public-test-app' } });
    if (path === '/api/status') return route.fulfill({ json: status });
    if (path === '/api/shortcut') return route.fulfill({ json: { enabled: false } });
    if (path === '/api/events') return activityFails
      ? route.fulfill({ status: 503, json: { error: 'Saved activity is temporarily unavailable.' } })
      : route.fulfill({ json: { events: [] } });
    throw new Error(`Unexpected request: ${path}`);
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?signed-in=1');
  await expect(page.getByRole('alert')).toContainText('Saved activity is temporarily unavailable.');
  await expect(page.getByText('Activity unavailable. Refresh to check saved simulations.')).toBeVisible();
  await expect(page.getByText('No events yet', { exact: true })).toHaveCount(0);
  await expect(page.locator('.balance')).toContainText('≈ 9.9931');
  await expect(page.getByText('Approximate balance on Arc testnet. Exact balance below.')).toBeVisible();
  await expect(page.locator('.funding-balances')).toContainText(wallet.balanceUsdc);
  await page.screenshot({ path: 'test-results/demo-error-mobile.png', fullPage: true });
  activityFails = false;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText('No events yet', { exact: true })).toBeVisible();
});

test('invalid simulation can be corrected without claiming it was saved', async ({ page }) => {
  await page.route('**/api/**', route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/config') return route.fulfill({ json: { privyAppId: 'public-test-app' } });
    if (path === '/api/status') return route.fulfill({ json: status });
    if (path === '/api/shortcut') return route.fulfill({ json: { enabled: false } });
    if (path === '/api/events') return request.method() === 'GET'
      ? route.fulfill({ json: { events: [] } })
      : route.fulfill({ status: 400, json: { error: 'Amount must be greater than zero.' } });
    throw new Error(`Unexpected request: ${path}`);
  });
  await page.goto('/?signed-in=1');
  await page.getByLabel('Merchant', { exact: true }).fill('SIMULATION');
  await page.getByLabel('Purchase amount').fill('0');
  await page.getByRole('button', { name: 'Save simulation', exact: false }).click();
  await expect(page.getByRole('alert')).toContainText('Amount must be greater than zero.');
  await expect(page.getByLabel('Merchant', { exact: true })).toBeEnabled();
  await expect(page.getByLabel('Purchase amount')).toBeEnabled();
  await expect(page.getByText(/Simulation saved/)).toHaveCount(0);
  await expect(page.getByText('No events yet', { exact: true })).toBeVisible();
});

for (const balance of ['0.000000000000000001', '0']) {
  test(`balance ${balance} remains distinguishable from zero`, async ({ page }) => {
    await page.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/config') return route.fulfill({ json: { privyAppId: 'public-test-app' } });
      if (path === '/api/status') return route.fulfill({ json: { ...status, wallet: { ...wallet, balanceUsdc: balance } } });
      if (path === '/api/shortcut') return route.fulfill({ json: { enabled: false } });
      if (path === '/api/events') return route.fulfill({ json: { events: [] } });
      throw new Error(`Unexpected request: ${path}`);
    });
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto('/?signed-in=1');
    await expect(page.locator('.balance')).toHaveText(balance === '0' ? '0test USDC' : '< 0.0001test USDC');
    await expect(page.locator('.funding-balances')).toContainText(balance);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

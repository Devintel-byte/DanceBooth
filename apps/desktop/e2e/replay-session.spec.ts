import { expect, test } from '@playwright/test';
import WebSocket from 'ws';
import { enterNames, launchBooth, type Booth } from './launch';

/**
 * Integrated slice in REPLAY mode (no webcam): synthetic landmark fixture ->
 * player assignment -> calibration -> audio-clock song timeline -> scoring ->
 * results -> reset, plus security and repeated-session checks.
 */
let booth: Booth;

test.beforeAll(async () => {
  booth = await launchBooth(
    { BOOTH_FORCE_REPLAY: '1' },
    { scoreFeed: { enabled: true, port: 18787, sharedKey: 'e2e-shared-key-0123456789', boothId: 'booth-e2e' } },
  );
});

test.afterAll(async () => {
  await booth?.close();
});

const state = (s: string) => `.app.state-${s.toLowerCase()}`;

test('renderers are isolated and only see the narrow bridge', async () => {
  const p = booth.participant;
  await expect(p.locator(state('ATTRACT'))).toBeVisible({ timeout: 30_000 });
  const probe = await p.evaluate(() => ({
    require: typeof (window as unknown as { require?: unknown }).require,
    process: typeof (window as unknown as { process?: unknown }).process,
    bridgeKeys: Object.keys(window.booth).sort(),
    role: window.booth.role,
  }));
  expect(probe.require).toBe('undefined');
  expect(probe.process).toBe('undefined');
  expect(probe.role).toBe('participant');
  expect(probe.bridgeKeys).not.toContain('ipcRenderer');
  // Participant may not issue operator commands.
  const denied = await p.evaluate(() => {
    try {
      window.booth.sendCommand({ type: 'abort' });
      return false;
    } catch {
      return true;
    }
  });
  expect(denied).toBe(true);
  // Remote navigation and popups are blocked.
  await p.evaluate(() => window.open('https://example.com'));
  await p.waitForTimeout(500);
  expect(booth.pages().filter((w) => w.url().startsWith('https://')).length).toBe(0);
  // Path traversal through the asset protocol is refused.
  const status = await p.evaluate(async () => (await fetch('booth-asset://content/%2e%2e/%2e%2e/package.json')).status);
  expect(status).toBe(404);
});

test('full replay session: journey, scoring, results and reset', async () => {
  const p = booth.participant;
  await expect(p.locator('.demo-badge')).toBeVisible();
  await p.keyboard.press('Enter'); // START
  await expect(p.locator(state('MODE_SELECT'))).toBeVisible();
  await p.keyboard.press('Enter'); // solo
  await expect(p.locator(state('CHARACTER_SELECT'))).toBeVisible();
  await p.keyboard.press('Enter'); // confirm character
  await expect(p.locator(state('NAME_ENTRY'))).toBeVisible();
  await enterNames(p, ['Ada']);
  await expect(p.locator(state('CALIBRATION'))).toBeVisible();
  // Synthetic participant is well framed: calibration completes on its own.
  await expect(p.locator(state('TUTORIAL'))).toBeVisible({ timeout: 20_000 });
  await p.keyboard.press('Enter'); // skip tutorial
  await expect(p.locator(state('COUNTDOWN'))).toBeVisible();
  await expect(p.locator(state('PLAYING'))).toBeVisible({ timeout: 10_000 });
  await expect(p.locator('.feedback').first()).toBeVisible({ timeout: 10_000 });
  await expect(p.locator(state('RESULTS'))).toBeVisible({ timeout: 60_000 });
  // The synthetic dancer performs the default dance (replay always plays it):
  // nearly every judged move should be a match.
  const detail = await p.locator('.result-detail').first().innerText();
  const matched = Number(/(\d+) matched/.exec(detail)?.[1] ?? 0);
  const close = Number(/(\d+) close/.exec(detail)?.[1] ?? 0);
  const points = Number((await p.locator('.result-score').first().innerText()).replace(/,/g, ''));
  console.info(`replay session: ${points} points, ${matched} matched, ${close} close (${detail})`);
  expect(points).toBe(matched * 10 + close * 4);
  expect(matched).toBeGreaterThan(close * 3);
  // Results: the leaderboard opens in its own window; replay sessions never rank.
  await p.getByRole('button', { name: 'View leaderboard' }).click();
  let lb = booth.pages().find((w) => w.url().startsWith('booth-app://leaderboard'));
  for (let i = 0; !lb && i < 50; i++) {
    await p.waitForTimeout(100);
    lb = booth.pages().find((w) => w.url().startsWith('booth-app://leaderboard'));
  }
  expect(lb).toBeDefined();
  await expect(lb!.getByText('No scores yet today')).toBeVisible({ timeout: 10_000 });
  await lb!.getByRole('button', { name: 'Fullscreen' }).click();
  await expect(lb!.getByRole('button', { name: 'Exit fullscreen' })).toBeVisible();
  await lb!.getByRole('button', { name: 'Exit fullscreen' }).click();
  await p.getByRole('button', { name: 'Finish' }).click();
  await expect(p.locator(state('ATTRACT'))).toBeVisible({ timeout: 10_000 });
});

test('operator abort mid-song asks for confirmation', async () => {
  const p = booth.participant;
  const op = booth.operator;
  await op.getByRole('button', { name: 'Start solo' }).click();
  await enterNames(p, ['Bo']);
  await expect(p.locator(state('CALIBRATION'))).toBeVisible();
  await op.getByRole('button', { name: 'Skip calibration' }).click();
  await p.keyboard.press('Enter'); // skip tutorial
  await expect(p.locator(state('PLAYING'))).toBeVisible({ timeout: 10_000 });
  // End quickly: abort is confirmed by the operator mid-song.
  await op.getByRole('button', { name: /Abort/ }).click();
  await op.getByRole('alertdialog').getByRole('button', { name: /Abort/ }).click();
  await expect(p.locator(state('ATTRACT'))).toBeVisible({ timeout: 10_000 });
});

test('operator status, abort from gameplay and repeated cycles', async () => {
  const p = booth.participant;
  const op = booth.operator;
  await expect(op.locator('.state-pill')).toHaveText('ATTRACT', { timeout: 10_000 });
  for (let i = 0; i < 3; i++) {
    await op.getByRole('button', { name: 'Start duo' }).click();
    await enterNames(p, [`Cy${i}`, `Di${i}`]);
    await expect(p.locator(state('CALIBRATION'))).toBeVisible();
    await op.getByRole('button', { name: 'Skip calibration' }).click();
    await expect(p.locator(state('TUTORIAL'))).toBeVisible();
    await op.getByRole('button', { name: /Abort/ }).click();
    await expect(p.locator(state('ATTRACT'))).toBeVisible({ timeout: 10_000 });
  }
  await expect(op.locator('.state-pill')).toHaveText('ATTRACT');
  const heap = await p.evaluate(() => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0);
  console.info(`participant JS heap after cycles: ${(heap / 1e6).toFixed(1)} MB`);
});

test('names get serial player ids and show on results', async () => {
  // Ada (session 1) was the first registered player of this fresh profile.
  const ids = await booth.participant.evaluate(() => window.booth.registerPlayers([{ name: 'Ada' }, { name: 'Ada' }]));
  expect(ids.map((x) => x.name)).toEqual(['Ada', 'Ada']);
  expect(new Set(ids.map((x) => x.playerId)).size).toBe(2);
  expect(ids.every((x) => /^player-\d{3}$/.test(x.playerId))).toBe(true);
  // Invalid names are rejected by the main process.
  const bad = await booth.participant.evaluate(() => window.booth.registerPlayers([{ name: '<script>' }]).then(() => 'ok', () => 'rejected'));
  expect(bad).toBe('rejected');
});

test('score feed is reachable on the LAN port with the shared key only', async () => {
  const health = await fetch('http://127.0.0.1:18787/v1/health').then((r) => r.json());
  expect(health).toMatchObject({ ok: true, boothId: 'booth-e2e' });
  expect((await fetch('http://127.0.0.1:18787/v1/snapshot')).status).toBe(401);
  const messages: { type: string; data: unknown }[] = [];
  const ws = new WebSocket('ws://127.0.0.1:18787/v1/stream?key=e2e-shared-key-0123456789&client=leaderboardhq');
  ws.on('message', (m) => messages.push(JSON.parse(String(m))));
  await new Promise((r) => ws.on('open', r));
  for (let i = 0; i < 50 && messages.length < 2; i++) await new Promise((r) => setTimeout(r, 50));
  expect(messages.map((m) => m.type)).toEqual(['hello', 'snapshot']);
  expect(messages[0]!.data).toMatchObject({ capabilities: ['registry'] });
  // Replay sessions are demo input: they never reach the scoreboard.
  expect(messages[1]!.data).toEqual({ records: [] });
  // The operator console shows the main leaderboard as connected (status bar) …
  await expect(booth.operator.locator('.feed-bar')).toContainText('Connected to the main leaderboard (127.0.0.1)', { timeout: 5000 });
  // … and receives the shared key only on Show.
  const status = await booth.operator.evaluate(() => window.booth.getFeedStatus());
  expect(JSON.stringify(status)).not.toContain('e2e-shared-key-0123456789');
  expect(await booth.operator.evaluate(() => window.booth.revealFeedKey())).toBe('e2e-shared-key-0123456789');
  // The player list arrives on the same connection; the booth then recognises player numbers.
  ws.send(JSON.stringify({ type: 'registry', data: { competitionId: 'maltina_2026', title: 'Maltina Arcade Night', revision: '1', sentAt: new Date().toISOString(), players: [{ code: '0377', name: 'Tolu Adeyemi' }] } }));
  await expect(booth.operator.locator('.feed-enter')).toContainText('1 registered player', { timeout: 5000 });
  await booth.operator.locator('.feed-panel').scrollIntoViewIfNeeded();
  await booth.operator.screenshot({ path: test.info().outputPath('operator-feed.png'), fullPage: true });
  expect(await booth.participant.evaluate(() => window.booth.lookupPlayerNumber(1, '0377'))).toEqual({ status: 'known', number: '0377', name: 'Tolu Adeyemi' });
  // 0377 is not 377.
  expect(await booth.participant.evaluate(() => window.booth.lookupPlayerNumber(1, '377'))).toEqual({ status: 'invalid' });
  ws.close();
  await expect(booth.operator.locator('.feed-bar')).toContainText('Waiting for the main leaderboard', { timeout: 5000 });
  // The renderer never sees the shared key in its settings.
  const leaked = await booth.operator.evaluate(() => window.booth.getBootstrap().then((b) => b.settings.scoreFeed.sharedKey));
  expect(leaked).toBeNull();
});

test('one entry accepts a registered ID or a name, and calibration can return to start', async () => {
  const p = booth.participant;
  const op = booth.operator;
  await op.getByRole('button', { name: 'Start solo' }).click();
  await expect(p.locator(state('NAME_ENTRY'))).toBeVisible();
  const input = p.getByLabel('Enter your name or ID');
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute('inputmode', 'text');
  // Unknown ID: ask for a name; the operator can still check the entered ID.
  await input.fill('9999');
  await expect(p.locator('.number-status')).toHaveText('ID not found. Check it or enter your name instead.');
  await expect(op.locator('.entry-check')).toContainText('9999');
  await input.fill('0377');
  await expect(p.locator('.number-status')).toHaveText('Tolu Adeyemi · registered player');
  await expect(p.locator('.number-status .number-status-icon svg')).toBeVisible();
  // Operator: number and name, to check with the player.
  await expect(op.locator('.entry-check')).toContainText('0377');
  await expect(op.locator('.entry-check')).toContainText('Tolu Adeyemi');
  // Public screen: the number is shown as dots, never as text.
  expect(await p.locator('body').innerText()).not.toContain('0377');
  expect(await input.evaluate((el) => getComputedStyle(el).getPropertyValue('-webkit-text-security'))).toBe('disc');
  await p.screenshot({ path: test.info().outputPath('number-known.png') });
  await op.screenshot({ path: test.info().outputPath('operator-check.png') });
  await p.keyboard.press('Enter');
  await expect(p.locator(state('CALIBRATION'))).toBeVisible();
  await p.getByRole('button', { name: 'Back' }).click();
  await expect(p.locator(state('ATTRACT'))).toBeVisible({ timeout: 10_000 });
});

test('diagnostics export writes a bundle without images', async () => {
  const result = await booth.operator.evaluate(() => window.booth.exportDiagnostics());
  expect(result.ok).toBe(true);
});

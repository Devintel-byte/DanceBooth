import path from 'node:path';
import { expect, test } from '@playwright/test';
import { enterNames, launchBooth } from './launch';

/** Captures reference screenshots in replay mode. Opt in with BOOTH_E2E_SCREENSHOTS=1. */
test.skip(process.env.BOOTH_E2E_SCREENSHOTS !== '1', 'set BOOTH_E2E_SCREENSHOTS=1 to capture screenshots');

const out = (name: string) => path.resolve(__dirname, '../../../docs/screenshots', `${name}.png`);

test('capture journey screenshots', async () => {
  const booth = await launchBooth({ BOOTH_FORCE_REPLAY: '1' }, { showPerfOverlay: true });
  try {
    const p = booth.participant;
    await expect(p.locator('.app.state-attract')).toBeVisible({ timeout: 30_000 });
    await p.waitForTimeout(1500);
    await p.screenshot({ path: out('01-attract') });
    await p.keyboard.press('Enter');
    await p.waitForTimeout(600);
    await p.screenshot({ path: out('02-mode-select') });
    await p.keyboard.press('Enter'); // solo
    await p.waitForTimeout(600);
    await p.screenshot({ path: out('03-character-select') });
    await p.keyboard.press('Enter');
    await expect(p.locator('.app.state-name_entry')).toBeVisible();
    await p.keyboard.type('Ada', { delay: 30 });
    await p.screenshot({ path: out('03b-name-entry') });
    await p.keyboard.press('Enter');
    await expect(p.locator('.app.state-calibration')).toBeVisible();
    await p.waitForTimeout(700);
    await p.screenshot({ path: out('04-calibration') });
    await expect(p.locator('.app.state-tutorial')).toBeVisible({ timeout: 20_000 });
    await p.keyboard.press('Enter');
    await expect(p.locator('.app.state-playing')).toBeVisible({ timeout: 10_000 });
    await p.waitForTimeout(6000);
    await p.screenshot({ path: out('05-playing') });
    await expect(p.locator('.app.state-results')).toBeVisible({ timeout: 60_000 });
    await p.waitForTimeout(800);
    await p.screenshot({ path: out('06-results') });
    await p.getByRole('button', { name: 'View leaderboard' }).click();
    await p.waitForTimeout(1500);
    const lb = booth.pages().find((w) => w.url().startsWith('booth-app://leaderboard'));
    if (lb) await lb.screenshot({ path: out('08-leaderboard') });
    await booth.operator.screenshot({ path: out('07-operator') });
    await p.getByRole('button', { name: 'Finish' }).click();
    // Duo calibration view (replay has one dancer, so Player 2 is prompted).
    await expect(p.locator('.app.state-attract')).toBeVisible({ timeout: 10_000 });
    await booth.operator.getByRole('button', { name: 'Start duo' }).click();
    await enterNames(p, ['Kemi', 'Tunde']);
    await p.waitForTimeout(1500);
    await p.screenshot({ path: out('09-duo-calibration') });
    await booth.operator.getByRole('button', { name: 'Skip calibration' }).click();
    await p.keyboard.press('Enter'); // skip tutorial
    await expect(p.locator('.app.state-playing, .app.state-paused')).toBeVisible({ timeout: 15_000 });
    await p.waitForTimeout(2500);
    await p.screenshot({ path: out('10-duo-playing') });
  } finally {
    await booth.close();
  }
});

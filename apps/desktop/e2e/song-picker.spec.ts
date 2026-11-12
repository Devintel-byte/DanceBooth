import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launchBooth } from './launch';

const shot = (name: string) => path.resolve(process.env.BOOTH_SHOT_DIR ?? path.resolve(__dirname, '../../../docs/screenshots'), `${name}.png`);

test('participant picks the song on the character screen; operator song applies to new sessions', async () => {
  const booth = await launchBooth({ BOOTH_FORCE_REPLAY: '1' });
  try {
    const p = booth.participant;
    await expect(p.locator('.app.state-attract')).toBeVisible({ timeout: 30_000 });
    // Operator picks a song for new sessions.
    const songSelect = booth.operator.locator('label', { hasText: 'Song' }).locator('select');
    const options = await songSelect.locator('option').allTextContents();
    expect(options.length).toBeGreaterThan(1);
    await songSelect.selectOption({ label: options[2]! });
    await p.keyboard.press('Enter');
    await p.waitForTimeout(400);
    await p.keyboard.press('Enter'); // solo
    await expect(p.locator('.app.state-character_select')).toBeVisible();
    await expect(p.locator('.song-picker-title')).toHaveText(options[2]!);
    // Participant opens the list and picks another song.
    await p.locator('.song-picker-current').click();
    await p.waitForTimeout(300);
    await p.screenshot({ path: shot('03c-song-picker') });
    await p.getByRole('option', { name: options[4]! }).click();
    await expect(p.locator('.song-picker-title')).toHaveText(options[4]!);
    // Keyboard / controller shoulder buttons step through songs.
    await p.keyboard.press('PageDown');
    await expect(p.locator('.song-picker-title')).toHaveText(options[5]!);
    await p.keyboard.press('PageUp');
    await expect(p.locator('.song-picker-title')).toHaveText(options[4]!);
    await p.waitForTimeout(300);
    await p.screenshot({ path: shot('03-character-select') });
  } finally {
    await booth.close();
  }
});

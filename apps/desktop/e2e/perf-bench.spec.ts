import { expect, test } from '@playwright/test';
import { enterNames, launchBooth } from './launch';

/**
 * Hardware benchmark (real webcam): tracking rate and render rate while the
 * gameplay scene is on screen, for several settings. Opt in with BOOTH_E2E_PERF=1.
 * Calibration is skipped through the operator console so no person is needed;
 * with nobody in frame the session may pause for tracking loss, but the full
 * 3D studio keeps rendering, which is the load being measured.
 */
test.skip(process.env.BOOTH_E2E_PERF !== '1', 'set BOOTH_E2E_PERF=1 to run the hardware benchmark');
test.setTimeout(600_000);

const VARIANTS = [
  { name: 'CPU medium cap30', settings: { tracking: { delegate: 'CPU' }, quality: 'medium', maxRenderFps: 30 } },
  { name: 'CPU low cap30', settings: { tracking: { delegate: 'CPU' }, quality: 'low', maxRenderFps: 30 } },
  { name: 'CPU low cap24', settings: { tracking: { delegate: 'CPU' }, quality: 'low', maxRenderFps: 24 } },
  { name: 'GPU low cap24', settings: { tracking: { delegate: 'GPU' }, quality: 'low', maxRenderFps: 24 } },
];

test('tracking and render rates during gameplay', async () => {
  const rows: string[] = [];
  for (const v of VARIANTS) {
    const booth = await launchBooth({}, v.settings);
    try {
      const p = booth.participant;
      const op = booth.operator;
      await expect(p.locator('.app.state-attract')).toBeVisible({ timeout: 60_000 });
      await op.getByRole('button', { name: 'Start solo' }).click();
      await enterNames(p, ['Bench']);
      await op.getByRole('button', { name: 'Skip calibration' }).click();
      await p.keyboard.press('Enter');
      await expect(p.locator('.app.state-playing, .app.state-paused')).toBeVisible({ timeout: 15_000 });
      const samples: { hz: number; infer: number; fps: number; p95: number }[] = [];
      for (let i = 0; i < 6; i++) {
        await op.waitForTimeout(1000);
        const t = await op.locator('.panel').filter({ hasText: 'Camera & tracking' }).innerText();
        const r = await op.locator('.panel').filter({ hasText: 'Performance' }).first().innerText();
        samples.push({
          hz: Number(/Update rate\s+(\d+)/.exec(t)?.[1] ?? 0),
          infer: Number(/Inference\s+([\d.]+)/.exec(t)?.[1] ?? NaN),
          fps: Number(/3D render FPS\s+(\d+)/.exec(r)?.[1] ?? 0),
          p95: Number(/Frame p50\/p95\/p99\s+[\d.]+ \/ ([\d.]+)/.exec(r)?.[1] ?? NaN),
        });
      }
      const avg = (k: keyof (typeof samples)[number]) => samples.slice(2).reduce((s, x) => s + x[k], 0) / (samples.length - 2);
      const row = `| ${v.name} | ${avg('hz').toFixed(1)} | ${avg('infer').toFixed(1)} | ${avg('fps').toFixed(0)} | ${avg('p95').toFixed(1)} |`;
      console.info(row);
      rows.push(row);
    } finally {
      await booth.close();
      // Give Windows time to release the camera before the next variant opens it.
      await new Promise((r) => setTimeout(r, 6000));
    }
  }
  console.info(['| Variant | Tracking Hz | Inference ms | Render FPS | Frame p95 ms |', '| --- | --- | --- | --- | --- |', ...rows].join('\n'));
});

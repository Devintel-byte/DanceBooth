import { expect, test } from '@playwright/test';
import { launchBooth } from './launch';

/**
 * Hardware-dependent: needs a real webcam. Opt in with BOOTH_E2E_WEBCAM=1.
 * Verifies real capture + MediaPipe inference produce results at a bounded
 * rate. It does NOT verify pose quality (that needs a person in frame).
 */
test.skip(process.env.BOOTH_E2E_WEBCAM !== '1', 'set BOOTH_E2E_WEBCAM=1 to run with a real camera');

for (const delegate of ['GPU', 'CPU'] as const) test(`webcam capture and pose inference run without backlog (${delegate})`, async () => {
  const booth = await launchBooth({}, { tracking: { delegate } });
  try {
    const p = booth.participant;
    await expect(p.locator('.app.state-attract')).toBeVisible({ timeout: 45_000 });
    await booth.operator.waitForTimeout(8000);
    const text = await booth.operator.locator('.panel').filter({ hasText: 'Camera & tracking' }).innerText();
    console.info(text);
    const hz = Number(/Update rate\s+(\d+)/.exec(text)?.[1] ?? 0);
    const inFlight = Number(/In flight \/ dropped\s+(\d+)/.exec(text)?.[1] ?? 99);
    console.info(`[${delegate}] tracking ${hz} Hz, in-flight ${inFlight}`);
    // The bound on in-flight work must hold for every delegate (no backlog).
    expect(inFlight).toBeLessThanOrEqual(1);
    // Rate is only asserted for the default delegate; GPU is measured and reported.
    if (delegate === 'CPU') expect(hz).toBeGreaterThan(5);
  } finally {
    await booth.close();
  }
});

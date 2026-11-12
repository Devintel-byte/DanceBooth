import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';

const appDir = path.resolve(__dirname, '..');
const electronPath = createRequire(path.join(appDir, 'package.json'))('electron') as unknown as string;

export interface Booth {
  browser: Browser;
  proc: ChildProcess;
  participant: Page;
  operator: Page;
  userData: string;
  pages: () => Page[];
  close: () => Promise<void>;
}

/**
 * Launches the built app (unpackaged) with an isolated profile directory and
 * attaches over the Chrome DevTools Protocol. The main process is not
 * instrumented (Playwright's _electron.launch hook hangs with this Electron
 * version), so tests observe the app only through its windows.
 */
export async function launchBooth(env: Record<string, string> = {}, settings?: object): Promise<Booth> {
  const userData = mkdtempSync(path.join(tmpdir(), 'booth-e2e-'));
  if (settings) writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ schemaVersion: 1, ...settings }));
  const extra = process.getuid?.() === 0 ? ['--no-sandbox'] : [];
  const proc = spawn(electronPath, [appDir, '--remote-debugging-port=0', ...extra], {
    env: { ...process.env, BOOTH_USER_DATA_DIR: userData, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const wsEndpoint = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('DevTools endpoint not announced')), 30_000);
    let buf = '';
    proc.stderr!.on('data', (d: Buffer) => {
      buf += d.toString();
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]!);
      }
    });
    proc.on('exit', (code) => reject(new Error(`electron exited early (${code}): ${buf}`)));
  });
  // CDP attach occasionally stalls while the GPU process starts; retry a few times.
  let browser: Browser | null = null;
  for (let attempt = 1; !browser; attempt++) {
    try {
      browser = await chromium.connectOverCDP(wsEndpoint, { timeout: 20_000 });
    } catch (e) {
      if (attempt >= 3) {
        proc.kill();
        throw e;
      }
    }
  }
  const cdp = browser;
  const pages = () => cdp.contexts().flatMap((c) => c.pages());
  const find = async (host: string): Promise<Page> => {
    for (let i = 0; i < 200; i++) {
      const w = pages().find((p) => p.url().startsWith(`booth-app://${host}`));
      if (w) return w;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`window ${host} did not open`);
  };
  const participant = await find('participant');
  const operator = await find('operator');
  return {
    browser: cdp,
    proc,
    participant,
    operator,
    userData,
    pages,
    close: async () => {
      await cdp.close().catch(() => undefined);
      if (proc.exitCode === null) {
        const exited = new Promise((r) => proc.once('exit', r));
        proc.kill();
        await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
      }
      try {
        rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
      } catch {
        // Child processes may still hold files briefly; a leftover temp dir is harmless.
      }
    },
  };
}

/** Types each player's name on the name screen (physical keyboard) and confirms. */
export async function enterNames(p: Page, names: string[]): Promise<void> {
  await p.locator('.app.state-name_entry').waitFor({ timeout: 10_000 });
  for (const n of names) {
    await p.keyboard.type(n, { delay: 20 });
    await p.keyboard.press('Enter');
  }
}

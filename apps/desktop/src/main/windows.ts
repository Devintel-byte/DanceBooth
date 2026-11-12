import { BrowserWindow, screen, type Display } from 'electron';
import { preloadPath } from './paths';
import type { Role } from './security';

export interface WindowUrls {
  participant: string;
  operator: string;
}

function pickDisplay(preferredId: number | null, avoid?: number): Display {
  const displays = screen.getAllDisplays();
  const preferred = preferredId !== null ? displays.find((d) => d.id === preferredId) : undefined;
  if (preferred) return preferred;
  if (avoid !== undefined) {
    const other = displays.find((d) => d.id !== avoid);
    if (other) return other;
  }
  return screen.getPrimaryDisplay();
}

const baseWebPreferences = {
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  experimentalFeatures: false,
  spellcheck: false,
  navigateOnDragDrop: false,
  devTools: true,
} as const;

export function createParticipantWindow(opts: {
  url: string;
  displayId: number | null;
  kiosk: boolean;
  devTools: boolean;
}): BrowserWindow {
  const display = pickDisplay(opts.displayId);
  const { x, y, width, height } = display.bounds;
  const win = new BrowserWindow({
    x,
    y,
    width: opts.kiosk ? width : Math.min(width, 1600),
    height: opts.kiosk ? height : Math.min(height, 900),
    show: false,
    backgroundColor: '#0b0420',
    title: 'Maltina Dance All',
    autoHideMenuBar: true,
    kiosk: opts.kiosk,
    fullscreen: opts.kiosk,
    webPreferences: {
      ...baseWebPreferences,
      devTools: opts.devTools,
      preload: preloadPath('participant'),
      // Booth audio must start without a click; the participant UI is never remote content.
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: false,
    },
  });
  if (!opts.kiosk) win.center();
  win.once('ready-to-show', () => win.show());
  void win.loadURL(opts.url);
  return win;
}

export function createOperatorWindow(opts: {
  url: string;
  displayId: number | null;
  avoidDisplayId: number;
  devTools: boolean;
}): BrowserWindow {
  const display = pickDisplay(opts.displayId, opts.avoidDisplayId);
  const { x, y, width, height } = display.workArea;
  const win = new BrowserWindow({
    x: x + Math.max(0, Math.floor((width - 1280) / 2)),
    y: y + Math.max(0, Math.floor((height - 820) / 2)),
    width: Math.min(width, 1280),
    height: Math.min(height, 820),
    show: false,
    backgroundColor: '#11131a',
    title: 'Maltina Dance All — Operator',
    autoHideMenuBar: true,
    webPreferences: {
      ...baseWebPreferences,
      devTools: opts.devTools,
      preload: preloadPath('operator'),
    },
  });
  win.once('ready-to-show', () => win.show());
  void win.loadURL(opts.url);
  return win;
}

/** Moves a window back onto an existing display if its display disappeared. */
export function ensureOnDisplay(win: BrowserWindow | null, role: Role): void {
  if (!win || win.isDestroyed()) return;
  const bounds = win.getBounds();
  const displays = screen.getAllDisplays();
  const visible = displays.some((d) => {
    const a = d.bounds;
    return bounds.x < a.x + a.width && bounds.x + bounds.width > a.x && bounds.y < a.y + a.height && bounds.y + bounds.height > a.y;
  });
  if (visible) return;
  const primary = screen.getPrimaryDisplay();
  const wasKiosk = win.isKiosk();
  if (wasKiosk) win.setKiosk(false);
  win.setBounds({ ...primary.workArea, width: Math.min(bounds.width, primary.workArea.width), height: Math.min(bounds.height, primary.workArea.height) });
  if (role === 'participant' && wasKiosk) win.setKiosk(true);
}

/** Read-only public leaderboard; may be fullscreened and moved to another display. */
export function createLeaderboardWindow(opts: {
  url: string;
  displayId: number | null;
  avoidDisplayId: number | null;
  devTools: boolean;
}): BrowserWindow {
  const display = pickDisplay(opts.displayId, opts.avoidDisplayId ?? undefined);
  const { x, y, width, height } = display.workArea;
  const w = Math.min(width - 80, 1280);
  const h = Math.min(height - 80, 800);
  const win = new BrowserWindow({
    x: x + Math.floor((width - w) / 2),
    y: y + Math.floor((height - h) / 2),
    width: w,
    height: h,
    show: false,
    backgroundColor: '#23150f',
    title: 'Maltina Dance All Leaderboard',
    autoHideMenuBar: true,
    fullscreenable: true,
    webPreferences: {
      ...baseWebPreferences,
      devTools: opts.devTools,
      preload: preloadPath('leaderboard'),
    },
  });
  win.once('ready-to-show', () => win.show());
  void win.loadURL(opts.url);
  return win;
}

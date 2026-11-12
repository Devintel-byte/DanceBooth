import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, clipboard, ipcMain, powerSaveBlocker, safeStorage, screen, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import started from 'electron-squirrel-startup';
import {
  IPC,
  bootstrapDataSchema,
  effectiveCaptureBackend,
  type BoothSettings,
  type BootstrapData,
  type PlayerEntryView,
  type PlayerNumberLookup,
  type DisplayInfo,
  type FeedLogEntry,
  type FeedStatusInfo,
  type FeedToast,
  type Leaderboard,
  type LeaderboardWindowCommand,
  type ParticipantStatus,
} from '@booth/contracts';
import { loadContent, type LoadedContent } from '@booth/content';
import { checkIpc, type PolicedChannel } from './ipc-policy';
import { Logger } from './logger';
import { assetsRoot, dataDir, rendererRoot } from './paths';
import { ASSET_BASE_URL, APP_SCHEME, handleProtocols, registerSchemesAsPrivileged } from './protocol';
import { RestartPolicy } from './restart-policy';
import { SessionRecords } from './records';
import { installSecurity, senderRole, type Role } from './security';
import { applyPatch, loadSettings, saveSettings } from './settings';
import { buildLeaderboard, countedRecords, localDay, readRecords, type StoredRecord } from './leaderboard';
import { PlayerRegistry } from './players';
import { describeSentRecord, toFeedRecord, type FeedRecord } from './feed-records';
import { PlayerListCache, resolvePlayerEntries } from './player-list';
import { lanAddresses, ScoreFeedServer, type FeedClientInfo, type FeedEvent } from './score-feed';
import { migrateUserData } from './user-data-migration';
import { CentralService, type SecretBox } from './central/service';
import { createLeaderboardWindow, createOperatorWindow, createParticipantWindow, ensureOnDisplay } from './windows';

if (started) app.quit();

const isDevServer = typeof PARTICIPANT_VITE_DEV_SERVER_URL === 'string' && PARTICIPANT_VITE_DEV_SERVER_URL.length > 0;

// Test/dev isolation: allow a separate profile directory, never in packaged builds.
if (!app.isPackaged && process.env.BOOTH_USER_DATA_DIR) {
  app.setPath('userData', path.resolve(process.env.BOOTH_USER_DATA_DIR));
}

// Renamed from "DanceOff Booth": carry settings, player ids and records over to the new data folder once.
let migratedUserData: string[] = [];
if (!process.env.BOOTH_USER_DATA_DIR) {
  try {
    migratedUserData = migrateUserData(path.join(app.getPath('appData'), 'DanceOff Booth'), app.getPath('userData'));
  } catch (e) {
    console.error('user-data migration failed', e);
  }
}

registerSchemesAsPrivileged();

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

/**
 * Windows camera path, chosen before Chromium starts (it cannot change at runtime).
 * Depth cameras such as the Azure Kinect time out under Media Foundation
 * ("Timeout starting video source" after 10 s); DirectShow, as OBS uses, works.
 */
const activeCaptureBackend: 'media-foundation' | 'directshow' = (() => {
  if (process.platform !== 'win32') return 'media-foundation';
  let camera: { captureBackend?: string; label?: string | null } | undefined;
  try {
    camera = (JSON.parse(readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf-8')) as { camera?: typeof camera }).camera;
  } catch {
    camera = undefined;
  }
  const backend = effectiveCaptureBackend(camera);
  if (backend === 'directshow') app.commandLine.appendSwitch('disable-features', 'MediaFoundationVideoCapture');
  return backend;
})();

const windowUrls = {
  participant: isDevServer ? PARTICIPANT_VITE_DEV_SERVER_URL : `${APP_SCHEME}://participant/index.html`,
  operator: isDevServer ? OPERATOR_VITE_DEV_SERVER_URL : `${APP_SCHEME}://operator/index.html`,
  leaderboard: isDevServer ? LEADERBOARD_VITE_DEV_SERVER_URL : `${APP_SCHEME}://leaderboard/index.html`,
};
/** Custom schemes may report an opaque origin via URL; normalise to scheme://host. */
function originFor(url: string, role: Role): string {
  const u = new URL(url);
  return u.protocol === `${APP_SCHEME}:` ? `${APP_SCHEME}://${role}` : u.origin;
}
const expectedOrigin = (role: Role) => originFor(windowUrls[role], role);

let logger: Logger;
let records: SessionRecords;
let settings: BoothSettings;
let content: LoadedContent;
let participant: BrowserWindow | null = null;
let operator: BrowserWindow | null = null;
let leaderboardWin: BrowserWindow | null = null;
let storedRecords: StoredRecord[] = [];
let registry: PlayerRegistry | null = null;
let feed: ScoreFeedServer | null = null;
let central: CentralService | null = null;
let centralStatusTimer: ReturnType<typeof setTimeout> | null = null;
let lastStatus: ParticipantStatus | null = null;
let powerBlockerId: number | null = null;
const participantRestarts = new RestartPolicy(3, 10 * 60_000);
const settingsFile = () => dataDir('settings.json');

function roleOf(wc: Electron.WebContents): Role | null {
  if (participant && !participant.isDestroyed() && wc.id === participant.webContents.id) return 'participant';
  if (operator && !operator.isDestroyed() && wc.id === operator.webContents.id) return 'operator';
  if (leaderboardWin && !leaderboardWin.isDestroyed() && wc.id === leaderboardWin.webContents.id) return 'leaderboard';
  return null;
}

function buildBootstrap(): BootstrapData {
  const profile =
    content.profiles.find((p) => p.id === settings.activeProfileId) ?? content.profiles[0];
  if (!profile) throw new Error('No valid event profile available');
  // Keep the profile's order: the first enabled routine is the default.
  const routines = profile.enabledRoutines
    .map((id) => content.routines.find((r) => r.id === id))
    .filter((r): r is NonNullable<typeof r> => !!r);
  const characters = content.characters ?? { schemaVersion: 1 as const, characters: [] };
  return bootstrapDataSchema.parse({
    app: {
      version: app.getVersion(),
      isPackaged: app.isPackaged,
      devTools: !app.isPackaged,
      assetBaseUrl: ASSET_BASE_URL,
      startInReplay: !app.isPackaged && process.env.BOOTH_FORCE_REPLAY === '1',
      replayFixture: 'fixtures/demo-synthetic.json',
      captureBackend: activeCaptureBackend,
    },
    settings: rendererSettings(),
    profile,
    profiles: content.profiles.map((p) => ({ id: p.id, eventName: p.eventName })),
    routines,
    characters: {
      ...characters,
      // Profile order is the character-select order.
      characters: profile.enabledCharacters
        .map((id) => characters.characters.find((c) => c.id === id))
        .filter((c): c is NonNullable<typeof c> => !!c),
    },
    contentIssues: content.issues,
  });
}

function activeProfile() {
  return content.profiles.find((p) => p.id === settings.activeProfileId) ?? content.profiles[0];
}

/** Player registry for the active event (one id sequence per event). */
function players(): PlayerRegistry {
  const eventId = settings.activeProfileId;
  if (!registry || registryEvent !== eventId) {
    const known = storedRecords.filter((r) => r.eventId === eventId).flatMap((r) => r.scores.map((s) => s.playerId ?? ''));
    registry = new PlayerRegistry(dataDir('players'), eventId, known);
    registryEvent = eventId;
  }
  return registry;
}
let registryEvent = '';

function currentLeaderboard(): Leaderboard {
  const profile = activeProfile();
  return buildLeaderboard(storedRecords, {
    eventId: profile?.id ?? settings.activeProfileId,
    eventName: profile?.eventName ?? '',
    day: localDay(),
    titles: Object.fromEntries(content.routines.map((r) => [r.id, r.title])),
    nameOf: (id) => players().nameOf(id),
  });
}

/** Globally unique player key across booths and events. */
const uidOf = (playerId: string) => `${settings.scoreFeed.boothId}:${settings.activeProfileId}:${playerId}`;

const feedContext = () => ({
  boothId: settings.scoreFeed.boothId,
  routineTitle: (id: string) => content.routines.find((x) => x.id === id)?.title ?? id,
  nameOf: (id: string) => players().nameOf(id),
});

/** Every completed session of the current event and day, oldest first (what `snapshot` carries). */
function feedRecords(): FeedRecord[] {
  return countedRecords(storedRecords, settings.activeProfileId, localDay())
    .map((r) => toFeedRecord(r, feedContext()))
    .filter((r): r is FeedRecord => r !== null);
}

/** The booth's own leaderboard, for scoreboards other than the main leaderboard. */
function feedScoreboardExtras() {
  const board = currentLeaderboard();
  return { leaderboard: { ...board, entries: board.entries.map((e) => ({ ...e, uid: uidOf(e.playerId) })) } };
}

// ---- Main leaderboard connection: status, log, toasts ----
let playerList: PlayerListCache | null = null;
const feedLog: FeedLogEntry[] = [];
let lastSessionSentAt: string | null = null;
let feedStartError: string | null = null;

function feedLogEntry(level: FeedLogEntry['level'], message: string): void {
  feedLog.unshift({ at: new Date().toISOString(), level, message });
  if (feedLog.length > 100) feedLog.length = 100;
  logger.log(level, `score feed: ${message}`, level === 'error' ? { code: 'UNKNOWN' } : undefined);
}

function feedToast(level: FeedToast['level'], message: string): void {
  if (operator && !operator.isDestroyed()) operator.webContents.send(IPC.feedToast, { level, message } satisfies FeedToast);
}

const firewallCommand = (port: number) =>
  `netsh advfirewall firewall add rule name="Booth score feed" dir=in action=allow protocol=TCP localport=${port} profile=private`;

function onFeedEvent(e: FeedEvent): void {
  const who = (c: FeedClientInfo) => (c.kind === 'main-leaderboard' ? `Main leaderboard (${c.ip})` : `Scoreboard (${c.ip})`);
  switch (e.type) {
    case 'started':
      feedLogEntry('info', `Feed started on port ${e.port} · ${e.addresses.map((a) => `${a}:${e.port}`).join(', ') || 'no network address yet'}`);
      break;
    case 'stopped':
      feedLogEntry('info', `Feed stopped (port ${e.port})`);
      break;
    case 'start-failed':
      feedLogEntry('error', `Feed could not start: ${e.message}`);
      feedToast('bad', /in use/.test(e.message) ? 'Feed could not start: port in use' : `Feed could not start: ${e.message}`);
      break;
    case 'client-connected':
      feedLogEntry('info', `${who(e.client)} connected`);
      if (e.client.kind === 'main-leaderboard') feedToast('good', 'Main leaderboard connected');
      break;
    case 'client-disconnected':
      feedLogEntry(e.client.kind === 'main-leaderboard' ? 'warn' : 'info', `${who(e.client)} disconnected`);
      if (e.client.kind === 'main-leaderboard') feedToast('warn', 'Main leaderboard disconnected');
      break;
    case 'rejected':
      if (e.reason === 'wrong-key') {
        // IP only: the key that was tried is never logged.
        feedLogEntry('warn', `Rejected a connection with a wrong key from ${e.ip}`);
        feedToast('bad', `Rejected a connection with a wrong key from ${e.ip}`);
      } else if (e.reason === 'busy') feedLogEntry('warn', `Refused a connection from ${e.ip}: too many connections`);
      break;
    case 'resync':
      feedLogEntry('info', `${who(e.client)} asked for a resync; sent all of today's sessions`);
      break;
    case 'registry':
      feedLogEntry('info', `Player list received from ${who(e.client)}: ${e.players} registered player(s)`);
      break;
    case 'registry-invalid':
      feedLogEntry('warn', `Ignored a malformed player list from ${who(e.client)}`);
      break;
    case 'error':
      feedLogEntry('error', e.message);
      break;
  }
}
function feedStatus(): FeedStatusInfo {
  const s = feed?.status();
  const cfg = settings.scoreFeed;
  const port = s?.port ?? cfg.port;
  const main = s?.clients.find((c) => c.kind === 'main-leaderboard') ?? null;
  const problem = cfg.enabled && !s?.listening ? (s?.lastError ?? feedStartError ?? (cfg.sharedKey ? 'Could not start the feed' : 'No shared key yet')) : null;
  const list = playerList?.status();
  return {
    enabled: cfg.enabled,
    listening: s?.listening ?? false,
    port,
    boothId: cfg.boothId,
    state: !cfg.enabled ? 'off' : problem ? 'problem' : main ? 'connected' : 'waiting',
    problem,
    mainLeaderboard: main ? { ip: main.ip, connectedAt: main.connectedAt } : null,
    scoreboards: (s?.clients ?? []).filter((c) => c.kind === 'scoreboard').map((c) => ({ ip: c.ip, connectedAt: c.connectedAt })),
    addresses: (s?.addresses ?? lanAddresses()).map((a) => `${a}:${port}`),
    hasKey: !!cfg.sharedKey,
    lastSessionSentAt,
    playerList: list?.receivedAt ? { count: list.count, receivedAt: list.receivedAt, title: list.title } : null,
    firewallCommand: firewallCommand(port),
  };
}

/** (Re)starts or stops the LAN score feed to match settings. */
async function syncFeed(): Promise<void> {
  if (feed) {
    await feed.stop();
    feed = null;
  }
  feedStartError = null;
  const cfg = settings.scoreFeed;
  if (!cfg.enabled || !cfg.sharedKey) return;
  const server = new ScoreFeedServer({
    port: cfg.port,
    sharedKey: cfg.sharedKey,
    boothId: cfg.boothId,
    eventId: () => settings.activeProfileId,
    records: feedRecords,
    scoreboardExtras: feedScoreboardExtras,
    onRegistry: (data) => {
      if (!playerList) throw new Error('player list unavailable');
      return playerList.replace(data);
    },
    onEvent: onFeedEvent,
  });
  try {
    await server.start();
    feed = server;
  } catch (e) {
    feedStartError = (e as Error).message;
  }
}

/** Settings as renderers see them: the feed secret never leaves the main process. */
function rendererSettings(): BoothSettings {
  return { ...settings, scoreFeed: { ...settings.scoreFeed, sharedKey: null } };
}

function persistSettings(): void {
  try {
    saveSettings(settingsFile(), settings);
  } catch (e) {
    logger.error(`settings save failed: ${(e as Error).message}`, { code: 'DISK_WRITE_FAILED' });
  }
}

function broadcastLeaderboard(): void {
  const board = currentLeaderboard();
  for (const w of [participant, operator, leaderboardWin]) {
    if (w && !w.isDestroyed()) w.webContents.send(IPC.leaderboardUpdated, board);
  }
}

function listDisplays(): DisplayInfo[] {
  const primary = screen.getPrimaryDisplay().id;
  const host = leaderboardWin && !leaderboardWin.isDestroyed() ? screen.getDisplayMatching(leaderboardWin.getBounds()).id : null;
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    label: d.label || `Display ${i + 1}`,
    primary: d.id === primary,
    width: d.size.width,
    height: d.size.height,
    hostsLeaderboard: d.id === host,
  }));
}

function openLeaderboard(): void {
  if (leaderboardWin && !leaderboardWin.isDestroyed()) {
    leaderboardWin.show();
    leaderboardWin.focus();
    return;
  }
  const participantDisplay = participant ? screen.getDisplayMatching(participant.getBounds()).id : null;
  leaderboardWin = createLeaderboardWindow({
    url: windowUrls.leaderboard,
    displayId: settings.displays.leaderboardDisplayId,
    avoidDisplayId: participantDisplay,
    devTools: !app.isPackaged,
  });
  leaderboardWin.webContents.on('render-process-gone', (_e, d) => logger.error(`leaderboard renderer gone: ${d.reason}`, { code: 'RENDERER_CRASHED' }));
  leaderboardWin.on('closed', () => {
    leaderboardWin = null;
  });
  logger.info('leaderboard window opened');
}

function leaderboardWindowCommand(cmd: LeaderboardWindowCommand): void {
  const w = leaderboardWin;
  if (!w || w.isDestroyed()) return;
  switch (cmd.type) {
    case 'fullscreen':
      w.setFullScreen(cmd.enabled);
      break;
    case 'move-to-display': {
      const d = screen.getAllDisplays().find((x) => x.id === cmd.displayId);
      if (!d) return;
      const wasFull = w.isFullScreen();
      if (wasFull) w.setFullScreen(false);
      const { x, y, width, height } = d.workArea;
      w.setBounds({ x: x + 40, y: y + 40, width: Math.min(1280, width - 80), height: Math.min(800, height - 80) });
      if (wasFull) w.setFullScreen(true);
      settings = { ...settings, displays: { ...settings.displays, leaderboardDisplayId: d.id } };
      try {
        saveSettings(settingsFile(), settings);
      } catch (e) {
        logger.error(`settings save failed: ${(e as Error).message}`, { code: 'DISK_WRITE_FAILED' });
      }
      break;
    }
    case 'close':
      w.close();
      break;
  }
}

function broadcastSettings(): void {
  for (const w of [participant, operator, leaderboardWin]) {
    if (w && !w.isDestroyed()) w.webContents.send(IPC.settingsChanged, rendererSettings());
  }
}

/** Status changes can come in bursts (sending, reconciling): coalesce them for the operator window. */
function broadcastCentralStatus(): void {
  if (centralStatusTimer) return;
  centralStatusTimer = setTimeout(() => {
    centralStatusTimer = null;
    if (central && operator && !operator.isDestroyed()) operator.webContents.send(IPC.centralStatusChanged, central.status());
  }, 150);
}

/** Electron safeStorage (DPAPI on Windows) for the central source credential. */
function secretBox(): SecretBox {
  const available = safeStorage.isEncryptionAvailable();
  return {
    available,
    encrypt: (plain) => (available ? safeStorage.encryptString(plain) : Buffer.from(`plain:${plain}`, 'utf8')),
    decrypt: (data) => {
      const text = data.toString('utf8');
      if (text.startsWith('plain:')) return text.slice(6);
      return safeStorage.decryptString(data);
    },
  };
}

function sendToOperator(status: ParticipantStatus): void {
  if (operator && !operator.isDestroyed()) operator.webContents.send(IPC.operatorStatus, status);
}

function rendererDownStatus(message: string): ParticipantStatus {
  return {
    ...(lastStatus ?? {
      state: 'UNKNOWN',
      sessionId: 0,
      mode: null,
      routineId: null,
      songTimeSec: null,
      durationSec: null,
      inputSource: 'none',
      players: [],
      tracking: {
        status: 'unknown',
        delegate: null,
        updateRateHz: 0,
        lastInferenceMs: null,
        latestResultAgeMs: null,
        inFlight: 0,
        framesDroppedBusy: 0,
        framesDroppedStale: 0,
        framesCompleted: 0,
      },
      render: { fps: 0, frameMsP50: null, frameMsP95: null, frameMsP99: null },
      memory: { jsHeapUsedMB: null },
      cameras: [],
      activeCameraId: null,
    }),
    state: 'RENDERER_DOWN',
    lastError: { code: 'RENDERER_CRASHED', message, recoverable: false },
  };
}

/** Registers a validated handler. Rejected calls are logged, never executed. */
function on<C extends PolicedChannel>(channel: C, handler: (payload: never, role: Role) => void): void {
  ipcMain.on(channel, (event: IpcMainEvent, payload: unknown) => {
    const role = senderRole(event.sender, event.senderFrame, { roleOf, expectedOrigin });
    const r = checkIpc(channel, role, payload);
    if (!r.ok) {
      logger.warn(`IPC rejected on ${channel}: ${r.reason}`, { code: 'IPC_REJECTED' });
      return;
    }
    handler(r.payload as never, role!);
  });
}

function handle<C extends PolicedChannel, R>(channel: C, handler: (payload: never, role: Role) => R | Promise<R>): void {
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, payload: unknown) => {
    const role = senderRole(event.sender, event.senderFrame, { roleOf, expectedOrigin });
    const r = checkIpc(channel, role, payload);
    if (!r.ok) {
      logger.warn(`IPC rejected on ${channel}: ${r.reason}`, { code: 'IPC_REJECTED' });
      throw new Error('IPC_REJECTED');
    }
    return handler(r.payload as never, role!);
  });
}

function exportDiagnostics(): { ok: true; path: string } | { ok: false; error: string } {
  try {
    const dir = dataDir('diagnostics');
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    const bundle = {
      exportedAt: new Date().toISOString(),
      note: 'Contains no images or participant-identifying data.',
      app: {
        version: app.getVersion(),
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
        isPackaged: app.isPackaged,
      },
      system: {
        platform: process.platform,
        release: os.release(),
        arch: process.arch,
        cpus: os.cpus().length,
        cpuModel: os.cpus()[0]?.model ?? null,
        totalMemMB: Math.round(os.totalmem() / 1e6),
        freeMemMB: Math.round(os.freemem() / 1e6),
        gpuFeatureStatus: app.getGPUFeatureStatus(),
        displays: screen.getAllDisplays().map((d) => ({ id: d.id, bounds: d.bounds, scaleFactor: d.scaleFactor })),
      },
      appMetrics: app.getAppMetrics().map((m) => ({ type: m.type, cpu: m.cpu.percentCPUUsage, memoryKB: m.memory.workingSetSize })),
      settings,
      contentIssues: content.issues,
      lastParticipantStatus: lastStatus,
      errorHistory: logger.errors,
      recentLog: logger.tail(500),
    };
    writeFileSync(file, JSON.stringify(bundle, null, 2));
    logger.info('diagnostics exported', { file });
    return { ok: true, path: file };
  } catch (e) {
    logger.error(`diagnostics export failed: ${(e as Error).message}`, { code: 'DISK_WRITE_FAILED' });
    return { ok: false, error: (e as Error).message };
  }
}

function registerIpc(): void {
  handle(IPC.getBootstrap, () => buildBootstrap());

  on(IPC.log, (entry: { level: 'debug' | 'info' | 'warn' | 'error'; message: string; code?: string; context?: Record<string, unknown> }, role) => {
    logger.log(entry.level, entry.message, { source: role, code: entry.code, ...entry.context });
  });

  on(IPC.participantStatus, (status: ParticipantStatus) => {
    // "Next player": the booth went back to the attract screen, so official participants are cleared.
    // ("Play again" goes straight from results to calibration and keeps them.)
    if (status.state === 'ATTRACT' && lastStatus && lastStatus.state !== 'ATTRACT') central?.clearAll();
    lastStatus = status;
    sendToOperator(status);
  });

  on(IPC.sessionRecord, (record: Omit<StoredRecord, 'at' | 'eventId' | 'recordId'>) => {
    try {
      // Only ids this booth issued may appear in results. The player's number is kept with the session (`code`).
      const scores: StoredRecord['scores'] = record.scores.map((s) => {
        if (s.playerId && !players().has(s.playerId)) {
          logger.warn(`session record referenced unknown ${s.playerId}; dropped`, { code: 'IPC_REJECTED' });
          const { playerId: _drop, ...rest } = s;
          return rest;
        }
        const code = s.playerId ? players().codeOf(s.playerId) : null;
        return code ? { ...s, code } : s;
      });
      const stored: StoredRecord = { ...record, scores, recordId: randomUUID(), at: new Date().toISOString(), eventId: settings.activeProfileId };
      records.append(stored);
      storedRecords.push(stored);
      // Central registry: one result per player for completed, live, judged attempts (same exclusions as the board).
      if (central && stored.endedReason === 'completed' && stored.inputSource === 'webcam') {
        const attempts = stored.scores
          .filter((s) => s.judgedMoves > 0)
          .map((s) => ({
            slot: s.slot as 1 | 2,
            points: s.points ?? 0,
            localPlayerId: s.playerId ?? null,
            displayName: s.playerId ? players().nameOf(s.playerId) : null,
            legacyUid: s.playerId ? uidOf(s.playerId) : null,
          }));
        if (attempts.length) {
          try {
            central.recordSession({ recordId: stored.recordId!, sessionId: stored.sessionId, routineId: stored.routineId, mode: stored.mode, completedAt: stored.at, attempts });
          } catch (e) {
            logger.error(`central result could not be saved: ${(e as Error).message}`, { code: 'DISK_WRITE_FAILED' });
          }
        }
      }
      broadcastLeaderboard();
      const sent = toFeedRecord(stored, feedContext());
      if (feed && sent) {
        feed.broadcast('session.completed', sent);
        feed.broadcast('leaderboard.updated', feedScoreboardExtras().leaderboard, 'scoreboard');
        lastSessionSentAt = new Date().toISOString();
        feedLogEntry('info', describeSentRecord(sent));
      }
    } catch (e) {
      logger.error(`session record write failed: ${(e as Error).message}`, { code: 'DISK_WRITE_FAILED' });
    }
  });

  on(IPC.operatorCommand, (command: { type: string }) => {
    logger.info(`operator command: ${command.type}`);
    if (participant && !participant.isDestroyed()) participant.webContents.send(IPC.participantCommand, command);
  });

  handle(IPC.updateSettings, async (patch: Parameters<typeof applyPatch>[1]) => {
    const feedBefore = JSON.stringify(settings.scoreFeed);
    settings = applyPatch(settings, patch);
    try {
      saveSettings(settingsFile(), settings);
    } catch (e) {
      logger.error(`settings save failed: ${(e as Error).message}`, { code: 'DISK_WRITE_FAILED' });
    }
    logger.setRetention(settings.retention);
    records.setRetention(settings.retention.sessionRecordDays);
    if (participant && !participant.isDestroyed() && participant.isKiosk() !== settings.kiosk) {
      participant.setKiosk(settings.kiosk);
    }
    broadcastSettings();
    if (JSON.stringify(settings.scoreFeed) !== feedBefore) await syncFeed();
    const wantBackend = effectiveCaptureBackend(settings.camera);
    if (process.platform === 'win32' && wantBackend !== activeCaptureBackend) {
      logger.info(`camera driver ${activeCaptureBackend} -> ${wantBackend}: restarting the app`);
      setTimeout(() => {
        app.relaunch();
        app.exit(0);
      }, 800);
    }
    return rendererSettings();
  });

  handle(IPC.exportDiagnostics, () => exportDiagnostics());
  handle(IPC.openLeaderboard, () => openLeaderboard());
  handle(IPC.getLeaderboard, () => currentLeaderboard());
  handle(IPC.registerPlayers, (p: { players: { name?: string; number?: string }[] }) => {
    const entries = resolvePlayerEntries(p.players, (n) => playerList?.lookup(n) ?? { status: 'invalid' });
    const out = players().register(entries.map(({ name, number }) => ({ name, ...(number ? { code: number } : {}) })));
    // Player numbers are not logged (staff-only data).
    logger.info(`registered ${out.map((x, i) => `${x.playerId}${entries[i]!.number ? (entries[i]!.recognised ? ' (player number, registered)' : ' (player number, not in list)') : ' (guest)'}`).join(', ')}`);
    return out.map((x, i) => ({ ...x, numberRecognised: entries[i]!.recognised }));
  });
  handle(IPC.lookupPlayerNumber, (p: { slot: 1 | 2; number: string }): PlayerNumberLookup => {
    const res: PlayerNumberLookup = p.number ? (playerList?.lookup(p.number) ?? { status: 'invalid' }) : { status: 'invalid' };
    // The operator checks the shown name with the player (a 4-digit number is easy to mistype).
    const view: PlayerEntryView =
      res.status === 'invalid'
        ? { slot: p.slot, number: null, status: 'none', name: null }
        : { slot: p.slot, number: res.number, status: res.status, name: res.status === 'known' ? res.name : null };
    if (operator && !operator.isDestroyed()) operator.webContents.send(IPC.playerEntry, view);
    return res;
  });
  handle(IPC.revealFeedKey, () => {
    feedLogEntry('info', 'Shared key shown on the operator console');
    return settings.scoreFeed.sharedKey;
  });
  handle(IPC.copyFeedKey, () => {
    if (!settings.scoreFeed.sharedKey) return false;
    clipboard.writeText(settings.scoreFeed.sharedKey);
    feedLogEntry('info', 'Shared key copied to the clipboard');
    return true;
  });
  handle(IPC.copyText, (p: { text: string }) => {
    clipboard.writeText(p.text);
  });
  handle(IPC.getFeedLog, () => feedLog);
  handle(IPC.getFeedStatus, () => feedStatus());
  handle(IPC.regenerateFeedKey, async () => {
    settings = { ...settings, scoreFeed: { ...settings.scoreFeed, sharedKey: randomBytes(18).toString('base64url') } };
    persistSettings();
    await syncFeed();
    feedLogEntry('warn', 'New shared key created: the main leaderboard must be updated with it');
    feedToast('info', 'New key created');
    return feedStatus();
  });
  handle(IPC.clearLeaderboard, () => {
    players().clearNames();
    logger.info('leaderboard cleared: player names removed for the active event');
    broadcastLeaderboard();
    feed?.broadcast('leaderboard.updated', feedScoreboardExtras().leaderboard, 'scoreboard');
  });
  handle(IPC.leaderboardWindow, (cmd: LeaderboardWindowCommand) => leaderboardWindowCommand(cmd));
  handle(IPC.listDisplays, () => listDisplays());
  handle(IPC.getErrorHistory, () => logger.errors.slice(-100));
  // ---- central registry (event-results/1) ----
  const c = () => {
    if (!central) throw new Error('central registry unavailable');
    return central;
  };
  const attempt = async <T,>(fn: () => Promise<T> | T): Promise<{ ok: true } & T | { ok: false; error: string }> => {
    try {
      return { ok: true, ...((await fn()) ?? {}) } as { ok: true } & T;
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  };
  handle(IPC.centralGetStatus, () => c().status());
  handle(IPC.centralUpdateConfig, (patch: Parameters<CentralService['updateConfig']>[0]) => {
    c().updateConfig(patch);
    return c().status();
  });
  handle(IPC.centralSetCredential, (p: { credential: string }) => {
    c().setCredential(p.credential);
    logger.info('central source credential replaced');
    return c().status();
  });
  handle(IPC.centralTestConnection, () => c().testConnection());
  handle(IPC.centralResolve, (p: { slot: 1 | 2; code: string }) => attempt(async () => ({ candidate: await c().resolve(p.slot, p.code) })));
  handle(IPC.centralConfirm, (p: { slot: 1 | 2 }) => attempt(() => (c().confirm(p.slot), {})));
  handle(IPC.centralClearSlot, (p: { slot: 1 | 2 }) => c().clearSlot(p.slot));
  handle(IPC.centralRetry, (p: { resultId?: string }) => c().retry(p.resultId));
  handle(IPC.centralReconcile, () => c().reconcile('manual'));
  handle(IPC.centralEditResult, (p: Parameters<CentralService['editResult']>[0]) => attempt(() => (c().editResult(p), {})));
  handle(IPC.centralResolveUnresolved, (p: { resultId: string; code: string }) => attempt(async () => ({ displayName: await c().resolveUnresolved(p.resultId, p.code) })));
  handle(IPC.centralGetPlayers, () => c().playersView());

  handle(IPC.reloadParticipant, () => {
    participantRestarts.reset();
    if (participant && !participant.isDestroyed()) participant.webContents.reload();
    else openParticipant();
  });
}

function openParticipant(): void {
  participant = createParticipantWindow({
    url: windowUrls.participant,
    displayId: settings.displays.participantDisplayId,
    kiosk: settings.kiosk,
    devTools: !app.isPackaged,
  });
  const wc = participant.webContents;

  wc.on('render-process-gone', (_e, details) => {
    logger.error(`participant renderer gone: ${details.reason} (${details.exitCode})`, { code: 'RENDERER_CRASHED' });
    if (details.reason === 'clean-exit') return;
    if (participantRestarts.tryRestart(Date.now())) {
      logger.warn('reloading participant renderer', { code: 'RENDERER_CRASHED' });
      wc.reload();
    } else {
      logger.error('participant renderer crash limit reached; maintenance required', { code: 'RENDERER_CRASHED' });
      sendToOperator(rendererDownStatus('Participant screen crashed repeatedly. Use "Reload participant" after checking logs.'));
    }
  });
  wc.on('unresponsive', () => logger.warn('participant renderer unresponsive', { code: 'RENDERER_CRASHED' }));
  wc.on('responsive', () => logger.info('participant renderer responsive again'));
  wc.on('preload-error', (_e, p, err) => logger.error(`participant preload error ${p}: ${err.message}`));
  wc.on('did-fail-load', (_e, code, desc, url) => logger.error(`participant failed to load ${url}: ${code} ${desc}`));

  // Maintenance escape from kiosk: Ctrl+Shift+Alt+M leaves kiosk and focuses the operator console.
  wc.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.control && input.shift && input.alt && input.key.toLowerCase() === 'm') {
      event.preventDefault();
      if (participant?.isKiosk()) participant.setKiosk(false);
      if (!operator || operator.isDestroyed()) openOperator();
      operator?.show();
      operator?.focus();
    }
  });

  participant.on('closed', () => {
    participant = null;
  });
}

function openOperator(): void {
  const participantDisplay = participant
    ? screen.getDisplayMatching(participant.getBounds()).id
    : screen.getPrimaryDisplay().id;
  operator = createOperatorWindow({
    url: windowUrls.operator,
    displayId: settings.displays.operatorDisplayId,
    avoidDisplayId: participantDisplay,
    devTools: !app.isPackaged,
  });
  operator.webContents.on('render-process-gone', (_e, d) => {
    logger.error(`operator renderer gone: ${d.reason}`, { code: 'RENDERER_CRASHED' });
    if (d.reason !== 'clean-exit') operator?.webContents.reload();
  });
  operator.on('closed', () => {
    operator = null;
  });
}

app.on('second-instance', () => {
  operator?.show();
  operator?.focus();
});

app.whenReady().then(() => {
  logger = new Logger(dataDir('logs'), { logDays: 14, maxLogBytes: 50_000_000 });
  logger.info('app starting', { version: app.getVersion(), packaged: app.isPackaged, electron: process.versions.electron });
  if (migratedUserData.length) logger.info('copied data from the previous "DanceOff Booth" folder', { entries: migratedUserData });
  settings = loadSettings(settingsFile(), (m) => logger.warn(m, { code: 'CONTENT_INVALID' }));
  logger.setRetention(settings.retention);
  records = new SessionRecords(dataDir('records'), settings.retention.sessionRecordDays);
  records.prune();
  storedRecords = readRecords(dataDir('records'));
  if (!settings.scoreFeed.sharedKey) {
    settings = { ...settings, scoreFeed: { ...settings.scoreFeed, sharedKey: randomBytes(18).toString('base64url') } };
    persistSettings();
  }
  playerList = new PlayerListCache(path.join(dataDir('feed'), 'player-list.json'));
  void syncFeed();
  try {
    central = new CentralService({
      dir: dataDir('central'),
      secrets: secretBox(),
      log: (level, message) => logger.log(level, message),
      onChange: broadcastCentralStatus,
      onPlayersChange: (view) => {
        if (participant && !participant.isDestroyed()) participant.webContents.send(IPC.centralPlayersChanged, view);
      },
    });
    central.start();
  } catch (e) {
    logger.error(`central registry integration could not start: ${(e as Error).message}`, { code: 'UNKNOWN' });
  }

  const root = assetsRoot();
  content = loadContent(root, { verifyIntegrity: true });
  for (const issue of content.issues) logger.warn(`content issue ${issue.file}: ${issue.message}`, { code: 'CONTENT_INVALID' });
  for (const n of content.notices) logger.info(`content notice ${n.file}: ${n.message}`);
  logger.info('content loaded', { assetsRoot: root, routines: content.routines.length, profiles: content.profiles.length });

  const devOrigins = () =>
    isDevServer ? (['participant', 'operator', 'leaderboard'] as const).map((r) => new URL(windowUrls[r]).origin) : [];
  installSecurity({
    isDev: isDevServer,
    devOrigins,
    roleOf,
    expectedOrigin,
    onBlocked: (what, detail) => logger.warn(`blocked ${what}: ${detail}`),
  });
  handleProtocols({
    assetsRoot: root,
    rendererRoot: rendererRoot(),
    isDev: isDevServer,
    allowedOrigins: () => [expectedOrigin('participant'), expectedOrigin('operator'), expectedOrigin('leaderboard'), ...devOrigins()],
  });
  registerIpc();

  powerBlockerId = powerSaveBlocker.start('prevent-display-sleep');
  openParticipant();
  openOperator();

  screen.on('display-removed', () => {
    logger.warn('display removed; relocating windows if needed');
    ensureOnDisplay(participant, 'participant');
    ensureOnDisplay(operator, 'operator');
    ensureOnDisplay(leaderboardWin, 'leaderboard');
  });
  screen.on('display-added', () => logger.info('display added'));
}).catch((e: unknown) => {
  console.error('fatal startup error', e);
  app.exit(1);
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  void feed?.stop();
  central?.stop();
  if (powerBlockerId !== null && powerSaveBlocker.isStarted(powerBlockerId)) powerSaveBlocker.stop(powerBlockerId);
  logger?.info('app quitting', { lastState: lastStatus?.state ?? null });
});

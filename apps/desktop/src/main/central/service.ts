import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  SCORING_VERSION,
  centralConfigSchema,
  centralManifestSchema,
  centralParticipantSchema,
  type CentralCandidate,
  type CentralConfig,
  type CentralConfigPatch,
  type CentralConnection,
  type CentralManifest,
  type CentralParticipant,
  type CentralPlayersView,
  type CentralResultRow,
  type CentralSlotState,
  type CentralStatus,
} from '@booth/contracts';
import { contentHash, sha256 } from './canonical';
import { CentralClient, CentralError, validateServerUrl } from './client';
import { CentralStore, type OutboxEntry, type ResultBody, type StoreData, type StoredResult } from './store';

/** Encrypts the source credential at rest (Electron safeStorage / Windows DPAPI in the app). */
export interface SecretBox {
  readonly available: boolean;
  encrypt(plain: string): Buffer;
  decrypt(data: Buffer): string;
}

export interface CentralDeps {
  /** Folder for central-config.json, central-credential.bin and central-store.json. */
  dir: string;
  secrets: SecretBox;
  log: (level: 'info' | 'warn' | 'error', message: string) => void;
  /** Called whenever the operator-visible status changes. */
  onChange?: () => void;
  /** Called when the official player names change (participant screen). */
  onPlayersChange?: (view: CentralPlayersView) => void;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  random?: () => number;
  /** Timers (tests drive the sender manually with `autoSend: false`). */
  autoSend?: boolean;
}

/** One completed attempt of one player, as the booth knows it. */
export interface CompletedAttempt {
  slot: 1 | 2;
  points: number;
  localPlayerId: string | null;
  displayName: string | null;
  /** Legacy feed uid (boothId:eventId:playerId), for de-duplication with imports from the old feed. */
  legacyUid: string | null;
}

export interface CompletedSession {
  /** Legacy session record id (danceoff.scorefeed v1 recordId). */
  recordId: string;
  sessionId: number;
  routineId: string;
  mode: 'single' | 'duo';
  completedAt: string;
  attempts: CompletedAttempt[];
}

const MAX_BACKOFF_MS = 5 * 60_000;
const BASE_BACKOFF_MS = 2_000;
const RECONCILE_PAGE = 200;

/** Extracts a registration code from a typed code or a scanned QR payload (plain code, URL with ?code= / ?registrationCode=, or JSON). */
export function parseRegistrationCode(raw: string): string {
  const s = raw.trim();
  if (s.startsWith('{')) {
    try {
      const j = JSON.parse(s) as { registrationCode?: unknown; code?: unknown };
      const c = j.registrationCode ?? j.code;
      if (typeof c === 'string' && c.trim()) return c.trim();
    } catch {
      // not JSON: use as typed
    }
  }
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      const c = u.searchParams.get('registrationCode') ?? u.searchParams.get('code');
      if (c) return c.trim();
      const last = u.pathname.split('/').filter(Boolean).pop();
      if (last) return decodeURIComponent(last);
    } catch {
      // fall through
    }
  }
  return s;
}

export class CentralService {
  private config: CentralConfig;
  private credential: string | null = null;
  readonly store: CentralStore;
  private connection: CentralConnection = 'unknown';
  private lastError: string | null = null;
  private slots = new Map<1 | 2, CentralSlotState>();
  private candidates = new Map<1 | 2, CentralCandidate>();
  private sending = false;
  private sendTimer: ReturnType<typeof setTimeout> | null = null;
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;
  private reconciling = false;
  private readonly now: () => Date;
  private readonly random: () => number;

  constructor(private readonly deps: CentralDeps) {
    mkdirSync(deps.dir, { recursive: true });
    this.now = deps.now ?? (() => new Date());
    this.random = deps.random ?? Math.random;
    this.config = this.readConfig();
    this.credential = this.readCredential();
    this.store = new CentralStore(path.join(deps.dir, 'central-store.json'));
    this.prune();
    this.refreshConnectionState();
  }

  // ---------------- configuration and credential ----------------

  private get configFile() {
    return path.join(this.deps.dir, 'central-config.json');
  }
  private get credentialFile() {
    return path.join(this.deps.dir, 'central-credential.bin');
  }

  private readConfig(): CentralConfig {
    try {
      if (existsSync(this.configFile)) return centralConfigSchema.parse(JSON.parse(readFileSync(this.configFile, 'utf-8')));
    } catch (e) {
      this.deps.log('warn', `central config unreadable, using defaults: ${(e as Error).message}`);
    }
    return centralConfigSchema.parse({});
  }

  private writeConfig(): void {
    const tmp = `${this.configFile}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.config, null, 2));
    renameSync(tmp, this.configFile);
  }

  private readCredential(): string | null {
    try {
      if (!existsSync(this.credentialFile)) return null;
      return this.deps.secrets.decrypt(readFileSync(this.credentialFile));
    } catch (e) {
      this.deps.log('error', `central credential unreadable: ${(e as Error).message}`);
      return null;
    }
  }

  getConfig(): CentralConfig {
    return this.config;
  }

  /** Operator change. Scope fields only ever change here, never automatically. */
  updateConfig(patch: CentralConfigPatch): void {
    const next = centralConfigSchema.parse({ ...this.config, ...patch });
    if (next.serverUrl) {
      const problem = validateServerUrl(next.serverUrl, next.allowPlainHttp);
      if (problem) throw new Error(problem);
    }
    const scopeChanged = next.competitionId !== this.config.competitionId || next.roundId !== this.config.roundId;
    this.config = next;
    this.writeConfig();
    if (scopeChanged) this.deps.log('info', `central scope set by operator: competition ${next.competitionId || '-'} / round ${next.roundId || '-'}`);
    if (patch.serverUrl !== undefined || patch.allowPlainHttp !== undefined) this.connection = 'unknown';
    this.refreshConnectionState();
    this.restartTimers();
    this.changed();
    this.kick();
  }

  /** Stores (replaces) the source credential, encrypted at rest. Never returned to any renderer. */
  setCredential(credential: string): void {
    const data = this.deps.secrets.encrypt(credential);
    const tmp = `${this.credentialFile}.tmp`;
    writeFileSync(tmp, data, { mode: 0o600 });
    renameSync(tmp, this.credentialFile);
    this.credential = credential;
    if (this.connection === 'auth-failed') this.connection = 'unknown';
    this.refreshConnectionState();
    this.changed();
    this.kick();
  }

  private configured(): boolean {
    const c = this.config;
    return c.enabled && !!c.serverUrl && !!c.sourceId && !!c.gameId && !!this.credential;
  }

  private refreshConnectionState(): void {
    if (!this.config.enabled) this.connection = 'disabled';
    else if (!this.configured()) this.connection = 'not-configured';
    else if (this.connection === 'disabled' || this.connection === 'not-configured') this.connection = 'unknown';
  }

  private client(): CentralClient {
    return new CentralClient({
      serverUrl: this.config.serverUrl,
      allowPlainHttp: this.config.allowPlainHttp,
      credential: this.credential,
      ...(this.deps.fetchImpl ? { fetchImpl: this.deps.fetchImpl } : {}),
    });
  }

  private changed(): void {
    this.deps.onChange?.();
  }

  private noteSuccess(): void {
    const wasDown = this.connection === 'offline' || this.connection === 'unknown';
    this.connection = 'online';
    this.lastError = null;
    if (wasDown && this.deps.autoSend !== false && !this.reconciling) void this.reconcile('reconnect').catch(() => undefined);
  }

  private noteFailure(e: CentralError): void {
    this.lastError = e.message;
    if (e.kind === 'auth') this.connection = 'auth-failed';
    else if (e.kind === 'transient') this.connection = 'offline';
  }

  // ---------------- manifest ----------------

  private manifestPath(): string {
    return `/api/v1/competitions/${encodeURIComponent(this.config.competitionId)}/manifest`;
  }

  async refreshManifest(): Promise<CentralManifest> {
    if (!this.config.competitionId) throw new Error('Set the competition id first');
    try {
      const raw = await this.client().request<unknown>('GET', this.manifestPath());
      const data = centralManifestSchema.parse(raw);
      if (data.competitionId !== this.config.competitionId) throw new CentralError(`Manifest is for competition ${data.competitionId}, not ${this.config.competitionId}`, 'permanent', null);
      this.store.transaction((d) => {
        d.manifest = { data, retrievedAt: this.now().toISOString() };
      });
      this.noteSuccess();
      return data;
    } catch (e) {
      if (e instanceof CentralError) this.noteFailure(e);
      throw e;
    } finally {
      this.changed();
    }
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    if (!this.config.serverUrl) return { ok: false, message: 'Set the main server URL' };
    if (!this.credential) return { ok: false, message: 'Set the source credential' };
    if (!this.config.competitionId) return { ok: false, message: 'Set the competition id' };
    try {
      const m = await this.refreshManifest();
      const game = m.games.find((g) => g.gameId === this.config.gameId);
      return {
        ok: true,
        message: `Connected. Competition ${m.competitionId}, ${m.rounds.length} rounds, registry revision ${m.registryRevision ?? '?'}${game ? '' : `; game "${this.config.gameId}" is not in the manifest`}`,
      };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  /** Problems the operator must see (never fixed automatically). */
  warnings(): string[] {
    const w: string[] = [];
    const c = this.config;
    if (!c.enabled) return w;
    if (!this.deps.secrets.available) w.push('Credential encryption is not available on this PC; the credential file is protected only by file permissions.');
    if (!c.competitionId || !c.roundId) w.push('Competition and round are not set: completed sessions are not sent.');
    if (c.scoringVersion !== SCORING_VERSION) w.push(`This booth scores with "${SCORING_VERSION}" but "${c.scoringVersion}" is selected. Results would be labelled with the wrong scoring rules.`);
    const m = this.store.state.manifest?.data;
    if (m && c.competitionId && m.competitionId === c.competitionId) {
      if (c.roundId && m.rounds.length && !m.rounds.some((r) => r.roundId === c.roundId)) w.push(`Round "${c.roundId}" is not in the latest manifest. Check the round selection.`);
      const game = m.games.find((g) => g.gameId === c.gameId);
      if (m.games.length && !game) w.push(`Game "${c.gameId}" is not enabled in the manifest.`);
      if (game && game.scoringVersions.length && !game.scoringVersions.includes(c.scoringVersion))
        w.push(`Scoring version "${c.scoringVersion}" is not approved in the manifest (${game.scoringVersions.join(', ')}).`);
    }
    if (this.connection === 'auth-failed') w.push('The main server rejected the source credential. Sending is paused until it is replaced or you press Retry.');
    return w;
  }

  // ---------------- participants ----------------

  private allowSameParticipantMultipleSlots(): boolean {
    return this.store.state.manifest?.data.config?.['allowSameParticipantMultipleSlots'] === true;
  }

  /**
   * Resolves a typed or scanned registration code. Online: through the
   * central registry (and caches the verified record). If the registry is
   * unreachable and the offline policy allows it: from the cache of
   * previously verified participants. Unknown codes never create identities.
   */
  async lookup(rawCode: string): Promise<{ participant: CentralParticipant; offline: boolean; retrievedAt: string }> {
    const c = this.config;
    if (!c.enabled) throw new Error('Central registry is switched off');
    if (!c.competitionId) throw new Error('Set the competition id first');
    const code = parseRegistrationCode(rawCode);
    const codeHash = sha256(`${c.competitionId}\u0000${code}`);
    try {
      const raw = await this.client().request<unknown>(
        'POST',
        `/api/v1/competitions/${encodeURIComponent(c.competitionId)}/participants/resolve`,
        { registrationCode: code },
      );
      const p = centralParticipantSchema.parse(raw);
      if (p.competitionId !== c.competitionId) throw new Error(`Participant belongs to competition ${p.competitionId}`);
      if (p.status !== 'active') throw new Error(`Participant status is "${p.status}", not active`);
      const retrievedAt = this.now().toISOString();
      this.store.transaction((d) => {
        d.participants[p.participantId] = { ...p, codeHash, retrievedAt };
      });
      this.noteSuccess();
      return { participant: p, offline: false, retrievedAt };
    } catch (e) {
      if (!(e instanceof CentralError)) throw e;
      this.noteFailure(e);
      if (e.kind !== 'transient') throw new Error(e.status === 404 ? 'Unknown registration code' : e.message, { cause: e });
      // Registry unreachable: offline policy.
      if (c.offlinePolicy !== 'allow-cached') throw new Error('Central registry is unreachable and the offline policy does not allow cached participants', { cause: e });
      const cached = Object.values(this.store.state.participants).find((p) => p.codeHash === codeHash && p.competitionId === c.competitionId);
      if (!cached) throw new Error('Central registry is unreachable and this code has not been verified on this booth before. It cannot be used offline.', { cause: e });
      const { codeHash: _h, retrievedAt, ...participant } = cached;
      return { participant, offline: true, retrievedAt };
    } finally {
      this.changed();
    }
  }

  async resolve(slot: 1 | 2, rawCode: string): Promise<CentralCandidate> {
    const r = await this.lookup(rawCode);
    const cand: CentralCandidate = { slot, participant: r.participant, offline: r.offline, retrievedAt: r.retrievedAt };
    this.candidates.set(slot, cand);
    this.changed();
    return cand;
  }

  /** Operator confirmation: the candidate becomes the slot's official participant. */
  confirm(slot: 1 | 2): void {
    const cand = this.candidates.get(slot);
    if (!cand) throw new Error('Resolve a registration code first');
    const other = this.slots.get(slot === 1 ? 2 : 1);
    if (other && other.participantId === cand.participant.participantId && !this.allowSameParticipantMultipleSlots())
      throw new Error(`${cand.participant.displayName} is already Player ${other.slot}. One participant cannot play both slots.`);
    this.slots.set(slot, {
      slot,
      participantId: cand.participant.participantId,
      displayName: cand.participant.displayName,
      offline: cand.offline,
      confirmedAt: this.now().toISOString(),
    });
    this.candidates.delete(slot);
    this.deps.log('info', `central participant confirmed for P${slot}: ${cand.participant.participantId}${cand.offline ? ' (offline, cached)' : ''}`);
    this.playersChanged();
  }

  clearSlot(slot: 1 | 2): void {
    this.slots.delete(slot);
    this.candidates.delete(slot);
    this.playersChanged();
  }

  /** "Next player": clears every association (play again keeps them). */
  clearAll(): void {
    if (!this.slots.size && !this.candidates.size) return;
    this.slots.clear();
    this.candidates.clear();
    this.playersChanged();
  }

  private playersChanged(): void {
    this.changed();
    this.deps.onPlayersChange?.(this.playersView());
  }

  playersView(): CentralPlayersView {
    return {
      official: this.config.enabled,
      slots: [...this.slots.values()].map((s) => ({ slot: s.slot, displayName: s.displayName, offline: s.offline })),
    };
  }

  // ---------------- results ----------------

  private wireFor(body: ResultBody, messageId: string, sourceSequence: number, sentAt: string): string {
    return JSON.stringify({
      protocol: 'event-results',
      version: 1,
      messageId,
      sourceId: this.config.sourceId,
      sourceSequence,
      sentAt,
      result: body,
    });
  }

  /** Adds a revision and its outbound message to `d` (call inside a transaction). */
  private addRevision(d: StoreData, rec: StoredResult, body: ResultBody, reason: 'original' | 'correction' | 'void' | 'resolved'): void {
    const messageId = randomUUID();
    const seq = CentralStore.allocateSequence(d);
    const at = this.now().toISOString();
    rec.revisions.push({ revision: body.revision, body, contentHash: contentHash(body), messageId, sourceSequence: seq, wire: this.wireFor(body, messageId, seq, at), createdAt: at, reason });
    d.outbox.push({
      messageId,
      resultId: body.resultId,
      revision: body.revision,
      sourceSequence: seq,
      state: 'pending',
      attempts: 0,
      nextAttemptAt: at,
      lastError: null,
      lastAttemptAt: null,
      deliveredAt: null,
      outcome: null,
      storedRevision: null,
    });
  }

  /**
   * Records one completed, eligible session: one result per player, each
   * with a new resultId, revision 1, the confirmed participant (frozen now),
   * and the configured scope. Players without a confirmed participant are
   * kept as unresolved (never sent until an operator resolves them).
   * Result and outbound message are written in one transaction.
   */
  recordSession(session: CompletedSession): string[] {
    const c = this.config;
    if (!c.enabled) return [];
    if (!c.competitionId || !c.roundId || !c.sourceId) {
      this.deps.log('warn', `central: session ${session.sessionId} not recorded for submission (competition/round/source not set)`);
      return [];
    }
    const ids: string[] = [];
    this.store.transaction((d) => {
      for (const a of session.attempts) {
        const resultId = randomUUID();
        ids.push(resultId);
        const official = this.slots.get(a.slot);
        const draft = {
          resultId,
          competitionId: c.competitionId,
          roundId: c.roundId,
          gameId: c.gameId,
          ...(a.localPlayerId ? { localPlayerId: a.localPlayerId } : {}),
          sessionId: `local-session-${session.sessionId}-${session.recordId.slice(0, 8)}`,
          completedAt: session.completedAt,
          points: Math.max(0, Math.round(a.points)),
          scoringVersion: c.scoringVersion,
          metadata: { routineId: session.routineId, mode: session.mode, slot: a.slot, legacyRecordId: session.recordId },
        };
        const rec: StoredResult = {
          resultId,
          legacy: { recordId: session.recordId, uid: a.legacyUid, localPlayerId: a.localPlayerId },
          displayName: official?.displayName ?? a.displayName,
          revisions: [],
          unresolved: null,
        };
        d.results[resultId] = rec;
        if (official) {
          this.addRevision(d, rec, { ...draft, revision: 1, status: 'valid', participantId: official.participantId }, 'original');
        } else {
          rec.unresolved = { draft, createdAt: this.now().toISOString(), reason: 'No confirmed central participant for this slot' };
        }
      }
    });
    this.changed();
    this.kick();
    return ids;
  }

  /** Gives an unresolved local result its participant (operator action) and queues revision 1. */
  async resolveUnresolved(resultId: string, rawCode: string): Promise<string> {
    const rec = this.store.state.results[resultId];
    if (!rec?.unresolved) throw new Error('This result is not waiting for a participant');
    const { participant } = await this.lookup(rawCode);
    if (participant.competitionId !== rec.unresolved.draft.competitionId) throw new Error('Participant is from a different competition than this result');
    this.store.transaction((d) => {
      const r = d.results[resultId]!;
      const draft = r.unresolved!.draft;
      r.unresolved = null;
      r.displayName = participant.displayName;
      this.addRevision(d, r, { ...draft, revision: 1, status: 'valid', participantId: participant.participantId }, 'resolved');
    });
    this.deps.log('info', `central: unresolved result ${resultId} assigned to ${participant.participantId} by operator`);
    this.changed();
    this.kick();
    return participant.displayName;
  }

  /** Correction (new points) or void: a new, higher revision. Identity and scope never change. */
  editResult(edit: { kind: 'void'; resultId: string } | { kind: 'correct'; resultId: string; points: number }): void {
    const rec = this.store.state.results[edit.resultId];
    if (!rec || !rec.revisions.length) throw new Error('Unknown result (or not yet resolved)');
    const latest = rec.revisions[rec.revisions.length - 1]!.body;
    if (latest.status === 'void') throw new Error('This result is void');
    const body: ResultBody =
      edit.kind === 'void'
        ? { ...latest, revision: latest.revision + 1, status: 'void' }
        : { ...latest, revision: latest.revision + 1, points: Math.max(0, Math.round(edit.points)) };
    this.store.transaction((d) => this.addRevision(d, d.results[edit.resultId]!, body, edit.kind === 'void' ? 'void' : 'correction'));
    this.deps.log('info', `central: result ${edit.resultId} ${edit.kind === 'void' ? 'voided' : `corrected to ${body.points} points`} (revision ${body.revision})`);
    this.changed();
    this.kick();
  }

  // ---------------- sending ----------------

  private backoffMs(attempts: number, retryAfterSec: number | null): number {
    const exp = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1));
    const jittered = exp * (0.5 + this.random());
    return Math.max(jittered, (retryAfterSec ?? 0) * 1000);
  }

  private nextDue(): OutboxEntry | null {
    const now = this.now().getTime();
    return (
      this.store.state.outbox
        .filter((e) => e.state === 'pending')
        .sort((a, b) => a.sourceSequence - b.sourceSequence)
        .find((e) => Date.parse(e.nextAttemptAt) <= now) ?? null
    );
  }

  /** Starts the sender if it is idle (safe to call any time). */
  kick(): void {
    if (this.deps.autoSend === false) return;
    void this.sendDue();
  }

  /**
   * Sends due messages one at a time, in sourceSequence order (a single
   * worker, so revisions of one result never race each other). Returns how
   * many were acknowledged.
   */
  async sendDue(): Promise<number> {
    if (this.sending || !this.configured() || this.connection === 'auth-failed') return 0;
    this.sending = true;
    let delivered = 0;
    try {
      for (let e = this.nextDue(); e; e = this.nextDue()) {
        const r = await this.sendOne(e);
        if (r === 'delivered') delivered++;
        else if (r === 'stop') break;
      }
    } finally {
      this.sending = false;
      this.scheduleNext();
      this.changed();
    }
    return delivered;
  }

  /** 'delivered'; 'blocked' (move on to the next message); 'stop' (transient or auth: try later). */
  private async sendOne(entry: OutboxEntry): Promise<'delivered' | 'blocked' | 'stop'> {
    const rec = this.store.state.results[entry.resultId];
    const rev = rec?.revisions.find((r) => r.revision === entry.revision);
    if (!rev) {
      this.store.transaction((d) => {
        const e = d.outbox.find((x) => x.messageId === entry.messageId)!;
        e.state = 'blocked';
        e.lastError = 'Local revision missing';
      });
      return 'blocked';
    }
    const at = this.now().toISOString();
    try {
      const ack = await this.client().request<{ messageId?: unknown; resultId?: unknown; storedRevision?: unknown; outcome?: unknown }>('POST', '/api/v1/result-events', rev.wire);
      const outcome = typeof ack.outcome === 'string' ? ack.outcome : '';
      if (ack.messageId !== entry.messageId || ack.resultId !== entry.resultId || !['accepted', 'duplicate', 'stale'].includes(outcome) || !Number.isInteger(ack.storedRevision)) {
        throw new CentralError(`Acknowledgement did not match the message (outcome "${outcome}")`, 'transient', null);
      }
      this.store.transaction((d) => {
        const e = d.outbox.find((x) => x.messageId === entry.messageId)!;
        e.state = 'delivered';
        e.attempts += 1;
        e.lastAttemptAt = at;
        e.deliveredAt = at;
        e.outcome = outcome;
        e.storedRevision = ack.storedRevision as number;
        e.lastError = null;
        d.lastAckAt = at;
      });
      this.noteSuccess();
      return 'delivered';
    } catch (err) {
      const e = err instanceof CentralError ? err : new CentralError(String(err), 'transient', null);
      this.noteFailure(e);
      this.store.transaction((d) => {
        const x = d.outbox.find((y) => y.messageId === entry.messageId)!;
        x.attempts += 1;
        x.lastAttemptAt = at;
        x.lastError = e.message;
        if (e.kind === 'permanent') {
          x.state = 'blocked';
          if (e.status === 409) d.conflicts.push({ resultId: entry.resultId, detail: `Server reported a conflict for revision ${entry.revision}: ${e.message}`, at });
        } else if (e.kind === 'transient') {
          x.nextAttemptAt = new Date(this.now().getTime() + this.backoffMs(x.attempts, e.retryAfterSec)).toISOString();
        }
        // auth: stays pending, unchanged schedule; sending is paused until the credential changes or Retry.
      });
      if (e.kind === 'permanent') {
        this.deps.log('error', `central: result ${entry.resultId} rev ${entry.revision} blocked: ${e.message}`);
        return 'blocked'; // keep going with the next message
      }
      return 'stop';
    }
  }

  private scheduleNext(): void {
    if (this.deps.autoSend === false) return;
    if (this.sendTimer) clearTimeout(this.sendTimer);
    this.sendTimer = null;
    if (!this.configured() || this.connection === 'auth-failed') return;
    const next = this.store.state.outbox.filter((e) => e.state === 'pending').map((e) => Date.parse(e.nextAttemptAt));
    if (!next.length) return;
    const wait = Math.max(500, Math.min(...next) - this.now().getTime());
    this.sendTimer = setTimeout(() => this.kick(), wait);
  }

  /** Operator retry: blocked messages go back to pending (same messageId, same body), auth pause is lifted. */
  retry(resultId?: string): void {
    this.store.transaction((d) => {
      for (const e of d.outbox) {
        if (resultId && e.resultId !== resultId) continue;
        if (e.state === 'blocked' || e.state === 'pending') {
          e.state = 'pending';
          e.nextAttemptAt = this.now().toISOString();
        }
      }
    });
    if (this.connection === 'auth-failed') this.connection = 'unknown';
    this.changed();
    this.kick();
  }

  // ---------------- reconciliation ----------------

  /**
   * Compares this source's inventory (latest revision + content hash of every
   * submitted result) with the main application in bounded pages, then
   * re-submits what the server is missing through the normal idempotent
   * ingestion path. Conflicts are flagged for the operator. Absence never
   * voids anything. Protocol: docs/central-integration.md.
   */
  async reconcile(trigger: 'manual' | 'periodic' | 'reconnect' = 'manual'): Promise<{ ok: boolean; message: string }> {
    if (!this.configured()) return { ok: false, message: 'Central registry is not configured' };
    if (this.reconciling) return { ok: false, message: 'Reconciliation already running' };
    this.reconciling = true;
    try {
      const items = Object.values(this.store.state.results)
        .filter((r) => r.revisions.length > 0)
        .map((r) => {
          const last = r.revisions[r.revisions.length - 1]!;
          return { resultId: r.resultId, revision: last.revision, contentHash: last.contentHash };
        })
        .sort((a, b) => a.resultId.localeCompare(b.resultId));
      const runId = randomUUID();
      const pages = Math.max(1, Math.ceil(items.length / RECONCILE_PAGE));
      const missing = new Set<string>();
      const conflicts: { resultId: string; detail: string }[] = [];
      const pathname = this.config.reconcilePath.replace('{sourceId}', encodeURIComponent(this.config.sourceId));
      for (let page = 0; page < pages; page++) {
        const final = page === pages - 1;
        const res = await this.client().request<{ runId?: unknown; missing?: unknown; conflicts?: unknown; complete?: unknown }>('POST', pathname, {
          protocol: 'event-results',
          version: 1,
          sourceId: this.config.sourceId,
          runId,
          page,
          pageSize: RECONCILE_PAGE,
          final,
          items: items.slice(page * RECONCILE_PAGE, (page + 1) * RECONCILE_PAGE),
        });
        if (res.runId !== runId) throw new CentralError('Reconciliation response for a different run', 'transient', null);
        for (const id of Array.isArray(res.missing) ? res.missing : []) if (typeof id === 'string') missing.add(id);
        for (const c of Array.isArray(res.conflicts) ? res.conflicts : []) {
          const cc = c as { resultId?: unknown; centralRevision?: unknown; centralContentHash?: unknown };
          if (typeof cc.resultId === 'string') conflicts.push({ resultId: cc.resultId, detail: `Central has revision ${String(cc.centralRevision ?? '?')} with different content` });
        }
        if (final && res.complete !== true) throw new CentralError('Server did not confirm reconciliation completion', 'transient', null);
      }
      const at = this.now().toISOString();
      let requeued = 0;
      this.store.transaction((d) => {
        for (const id of missing) {
          const r = d.results[id];
          if (!r || !r.revisions.length) continue;
          const latest = r.revisions[r.revisions.length - 1]!;
          const e = d.outbox.find((x) => x.messageId === latest.messageId);
          if (e && e.state !== 'pending') {
            e.state = 'pending';
            e.nextAttemptAt = at;
            requeued++;
          }
        }
        for (const c of conflicts) d.conflicts.push({ ...c, at });
        d.lastReconcileAt = at;
        d.lastReconcileSummary = `${trigger}: ${items.length} results compared, ${missing.size} missing on server (${requeued} re-queued), ${conflicts.length} conflicts`;
      });
      this.noteSuccess();
      this.kick();
      return { ok: conflicts.length === 0, message: this.store.state.lastReconcileSummary! };
    } catch (e) {
      if (e instanceof CentralError) this.noteFailure(e);
      return { ok: false, message: `Reconciliation failed: ${(e as Error).message}` };
    } finally {
      this.reconciling = false;
      this.changed();
    }
  }

  // ---------------- lifecycle ----------------

  start(): void {
    this.restartTimers();
    this.kick();
  }

  stop(): void {
    if (this.sendTimer) clearTimeout(this.sendTimer);
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    this.sendTimer = this.reconcileTimer = null;
  }

  private restartTimers(): void {
    if (this.deps.autoSend === false) return;
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    this.reconcileTimer = null;
    if (this.config.enabled && this.config.reconcileEveryMin > 0) {
      this.reconcileTimer = setInterval(() => void this.reconcile('periodic'), this.config.reconcileEveryMin * 60_000);
    }
  }

  /** Drops delivered history older than the retention window. Never pending, blocked or unresolved data. */
  prune(): number {
    const cutoff = this.now().getTime() - this.config.retentionDays * 86_400_000;
    const d = this.store.state;
    const removable = Object.values(d.results).filter((r) => {
      if (r.unresolved || !r.revisions.length) return false;
      const msgs = d.outbox.filter((e) => e.resultId === r.resultId);
      if (msgs.some((e) => e.state !== 'delivered')) return false;
      return Date.parse(r.revisions[r.revisions.length - 1]!.createdAt) < cutoff;
    });
    if (!removable.length) return 0;
    const ids = new Set(removable.map((r) => r.resultId));
    this.store.transaction((s) => {
      for (const id of ids) delete s.results[id];
      s.outbox = s.outbox.filter((e) => !ids.has(e.resultId));
    });
    this.deps.log('info', `central: pruned ${ids.size} delivered results older than ${this.config.retentionDays} days`);
    return ids.size;
  }

  // ---------------- status ----------------

  status(): CentralStatus {
    const d = this.store.state;
    const counts = { pending: 0, delivered: 0, blocked: 0, unresolved: 0 };
    for (const e of d.outbox) counts[e.state]++;
    const recent: CentralResultRow[] = Object.values(d.results)
      .map((r) => {
        const last = r.revisions[r.revisions.length - 1];
        if (!last) {
          counts.unresolved++;
          const u = r.unresolved!;
          return {
            resultId: r.resultId,
            revision: 0,
            status: 'valid' as const,
            points: u.draft.points,
            participantId: null,
            displayName: r.displayName,
            slot: u.draft.metadata.slot,
            completedAt: u.draft.completedAt,
            roundId: u.draft.roundId,
            state: 'unresolved' as const,
            lastError: u.reason,
            attempts: 0,
          };
        }
        const msg = d.outbox.find((e) => e.messageId === last.messageId);
        return {
          resultId: r.resultId,
          revision: last.revision,
          status: last.body.status,
          points: last.body.points,
          participantId: last.body.participantId,
          displayName: r.displayName,
          slot: last.body.metadata.slot,
          completedAt: last.body.completedAt,
          roundId: last.body.roundId,
          state: msg?.state ?? 'delivered',
          lastError: msg?.lastError ?? null,
          attempts: msg?.attempts ?? 0,
        };
      })
      .sort((a, b) => b.completedAt.localeCompare(a.completedAt))
      .slice(0, 40);
    return {
      config: this.config,
      credentialConfigured: !!this.credential,
      connection: this.connection,
      lastError: this.lastError,
      counts,
      lastAckAt: d.lastAckAt,
      lastReconcileAt: d.lastReconcileAt,
      lastReconcileSummary: d.lastReconcileSummary,
      conflicts: d.conflicts.slice(-20).map((c) => ({ resultId: c.resultId, detail: c.detail })),
      manifest: d.manifest?.data ?? null,
      manifestRetrievedAt: d.manifest?.retrievedAt ?? null,
      warnings: this.warnings(),
      slots: [...this.slots.values()],
      candidates: [...this.candidates.values()],
      recent,
    };
  }
}

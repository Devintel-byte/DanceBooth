import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs';
import path from 'node:path';
import type { CentralManifest, CentralParticipant } from '@booth/contracts';

/**
 * Durable local state for the central integration: result history, the
 * outgoing queue (outbox), the persistent source sequence, and the cached
 * manifest and verified participants.
 *
 * It is one JSON document replaced atomically (write temp file, fsync,
 * rename) on every change, so each `transaction()` is all-or-nothing: a
 * completed result and its outbound message are always saved together.
 * The previous file is kept as `.bak` for recovery. No native database
 * module is needed (the booth ships without native modules).
 */

export const STORE_SCHEMA_VERSION = 1;

/** The `result` object exactly as sent (contract event-results/1). */
export interface ResultBody {
  resultId: string;
  revision: number;
  competitionId: string;
  roundId: string;
  gameId: string;
  participantId: string;
  localPlayerId?: string;
  sessionId: string;
  completedAt: string;
  status: 'valid' | 'void';
  points: number;
  scoringVersion: string;
  metadata: { routineId: string; mode: 'single' | 'duo'; slot: number; [k: string]: unknown };
}

export interface StoredRevision {
  revision: number;
  body: ResultBody;
  contentHash: string;
  messageId: string;
  sourceSequence: number;
  /** Exact request body (string) sent for this revision; retries resend it byte for byte. */
  wire: string;
  createdAt: string;
  reason: 'original' | 'correction' | 'void' | 'resolved';
}

export interface StoredResult {
  resultId: string;
  /** Mapping to the legacy feed (danceoff.scorefeed v1): recordId + player uid. */
  legacy: { recordId: string | null; uid: string | null; localPlayerId: string | null };
  displayName: string | null;
  revisions: StoredRevision[];
  /** A completed attempt with no confirmed participant: kept locally, never sent until an operator resolves it. */
  unresolved: null | {
    draft: Omit<ResultBody, 'participantId' | 'revision' | 'status'>;
    createdAt: string;
    reason: string;
  };
}

export type OutboxState = 'pending' | 'delivered' | 'blocked';

export interface OutboxEntry {
  messageId: string;
  resultId: string;
  revision: number;
  sourceSequence: number;
  state: OutboxState;
  attempts: number;
  nextAttemptAt: string;
  lastError: string | null;
  lastAttemptAt: string | null;
  deliveredAt: string | null;
  /** accepted | duplicate | stale (from the acknowledgement). */
  outcome: string | null;
  storedRevision: number | null;
}

export interface CachedParticipant extends CentralParticipant {
  /** sha256 of the registration code (codes themselves are not stored). */
  codeHash: string;
  retrievedAt: string;
}

export interface StoreData {
  schemaVersion: number;
  /** Next sourceSequence to allocate (strictly increasing, never reused). */
  nextSequence: number;
  results: Record<string, StoredResult>;
  outbox: OutboxEntry[];
  participants: Record<string, CachedParticipant>;
  manifest: { data: CentralManifest; retrievedAt: string } | null;
  lastAckAt: string | null;
  lastReconcileAt: string | null;
  lastReconcileSummary: string | null;
  conflicts: { resultId: string; detail: string; at: string }[];
}

export function emptyStore(): StoreData {
  return {
    schemaVersion: STORE_SCHEMA_VERSION,
    nextSequence: 1,
    results: {},
    outbox: [],
    participants: {},
    manifest: null,
    lastAckAt: null,
    lastReconcileAt: null,
    lastReconcileSummary: null,
    conflicts: [],
  };
}

/** Migrations from older store layouts. v0 (none) -> v1: initial layout. */
export function migrateStore(raw: unknown): StoreData {
  const base = emptyStore();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<StoreData> & { schemaVersion?: number };
  const v = typeof r.schemaVersion === 'number' ? r.schemaVersion : 0;
  if (v > STORE_SCHEMA_VERSION) throw new Error(`central store version ${v} is newer than this app (${STORE_SCHEMA_VERSION})`);
  return {
    ...base,
    ...r,
    schemaVersion: STORE_SCHEMA_VERSION,
    results: r.results ?? {},
    outbox: r.outbox ?? [],
    participants: r.participants ?? {},
    conflicts: r.conflicts ?? [],
  };
}

function writeAtomic(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  const fd = openSync(tmp, 'w');
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  if (existsSync(file)) {
    try {
      renameSync(file, `${file}.bak`);
    } catch {
      // best effort; the rename below still replaces atomically
    }
  }
  renameSync(tmp, file);
}

export class CentralStore {
  private data: StoreData;

  constructor(private readonly file: string) {
    this.data = CentralStore.read(file);
  }

  private static read(file: string): StoreData {
    for (const f of [file, `${file}.bak`]) {
      if (!existsSync(f)) continue;
      try {
        return migrateStore(JSON.parse(readFileSync(f, 'utf-8')));
      } catch (e) {
        if (e instanceof Error && /newer than this app/.test(e.message)) throw e;
        // corrupt: try the backup
      }
    }
    return emptyStore();
  }

  /** Read-only view (callers must not mutate it; use transaction()). */
  get state(): Readonly<StoreData> {
    return this.data;
  }

  /**
   * Applies `fn` to a copy and persists it atomically; the in-memory state
   * changes only if the write succeeded.
   */
  transaction<T>(fn: (d: StoreData) => T): T {
    const draft = structuredClone(this.data);
    const out = fn(draft);
    writeAtomic(this.file, JSON.stringify(draft));
    this.data = draft;
    return out;
  }

  /** Allocates the next persistent sourceSequence inside a transaction. */
  static allocateSequence(d: StoreData): number {
    const n = d.nextSequence;
    d.nextSequence = n + 1;
    return n;
  }
}

import { z } from 'zod';

/**
 * Central participant registry and aggregate leaderboard (contract
 * "event-results/1"). The booth resolves registered participants, and sends
 * one result per player per completed session to the main application.
 * See docs/central-integration.md.
 */

const idSchema = z.string().trim().min(1).max(128);

/**
 * Identifies the booth's scoring rules. Sent with every central result;
 * change it whenever points would come out differently for the same
 * performance. v2 (2026-11-04): rest-relative, held pose, own-delay timing,
 * mirror or same-side.
 */
export const SCORING_VERSION = 'danceoff-points-v3';

export const centralConfigSchema = z.object({
  enabled: z.boolean().default(false),
  /** Main application base URL, e.g. https://scores.event.local. */
  serverUrl: z.string().max(300).default(''),
  /** Allow http:// (trusted event LAN only). https:// is always allowed. */
  allowPlainHttp: z.boolean().default(false),
  /** Issued centrally for this installation. */
  sourceId: z.string().max(128).default(''),
  gameId: z.string().max(128).default('danceoff'),
  competitionId: z.string().max(128).default(''),
  roundId: z.string().max(128).default(''),
  scoringVersion: z.string().max(64).default(SCORING_VERSION),
  /** Outage behaviour: previously verified (cached) participants may play, or nobody may be resolved. */
  offlinePolicy: z.enum(['allow-cached', 'deny']).default('allow-cached'),
  /** Reconciliation endpoint (see docs); {sourceId} is replaced. */
  reconcilePath: z.string().max(200).default('/api/v1/sources/{sourceId}/reconciliation'),
  /** Minutes between automatic reconciliations (0 = only on reconnect and on request). */
  reconcileEveryMin: z.number().int().min(0).max(1440).default(30),
  /** Delivered results older than this are pruned from local history. Pending, blocked and unresolved data is never pruned. */
  retentionDays: z.number().int().min(7).max(3650).default(180),
});
export type CentralConfig = z.infer<typeof centralConfigSchema>;

export const centralConfigPatchSchema = centralConfigSchema.partial().strict();
export type CentralConfigPatch = z.infer<typeof centralConfigPatchSchema>;

export const centralSlotSchema = z.union([z.literal(1), z.literal(2)]);

export const centralParticipantSchema = z.object({
  participantId: idSchema,
  displayName: z.string().min(1).max(80),
  competitionId: idSchema,
  status: z.string().max(40),
  registryRevision: z.number().int().nonnegative(),
});
export type CentralParticipant = z.infer<typeof centralParticipantSchema>;

export const centralManifestSchema = z
  .object({
    competitionId: idSchema,
    registryRevision: z.number().int().nonnegative().optional(),
    rounds: z.array(z.object({ roundId: idSchema, name: z.string().max(120).optional(), active: z.boolean().optional() }).passthrough()).default([]),
    games: z
      .array(
        z
          .object({
            gameId: idSchema,
            enabled: z.boolean().optional(),
            scoringVersions: z.array(z.string().max(64)).default([]),
          })
          .passthrough(),
      )
      .default([]),
    /** Competition rules (passthrough). Known: allowSameParticipantMultipleSlots. */
    config: z.record(z.string(), z.unknown()).default({}),
  })
  .passthrough();
export type CentralManifest = z.infer<typeof centralManifestSchema>;

/** A participant offered for a slot after resolving a code; becomes the slot's identity only after confirmation. */
export const centralCandidateSchema = z.object({
  slot: centralSlotSchema,
  participant: centralParticipantSchema,
  /** Resolved from the local cache because the central registry was unreachable. */
  offline: z.boolean(),
  retrievedAt: z.string(),
});
export type CentralCandidate = z.infer<typeof centralCandidateSchema>;

export const centralSlotStateSchema = z.object({
  slot: centralSlotSchema,
  participantId: z.string(),
  displayName: z.string(),
  offline: z.boolean(),
  confirmedAt: z.string(),
});
export type CentralSlotState = z.infer<typeof centralSlotStateSchema>;

export type CentralConnection = 'disabled' | 'not-configured' | 'unknown' | 'online' | 'offline' | 'auth-failed';

export interface CentralResultRow {
  resultId: string;
  revision: number;
  status: 'valid' | 'void';
  points: number;
  participantId: string | null;
  displayName: string | null;
  slot: number;
  completedAt: string;
  roundId: string;
  /** pending | delivered | blocked | unresolved (no participant yet, never sent) */
  state: 'pending' | 'delivered' | 'blocked' | 'unresolved';
  lastError: string | null;
  attempts: number;
}

export interface CentralStatus {
  config: CentralConfig;
  credentialConfigured: boolean;
  connection: CentralConnection;
  lastError: string | null;
  counts: { pending: number; delivered: number; blocked: number; unresolved: number };
  lastAckAt: string | null;
  lastReconcileAt: string | null;
  lastReconcileSummary: string | null;
  conflicts: { resultId: string; detail: string }[];
  manifest: CentralManifest | null;
  manifestRetrievedAt: string | null;
  warnings: string[];
  slots: CentralSlotState[];
  candidates: CentralCandidate[];
  recent: CentralResultRow[];
}

/** What the participant screen may know: names for the official players, nothing else. */
export interface CentralPlayersView {
  official: boolean;
  slots: { slot: 1 | 2; displayName: string; offline: boolean }[];
}

export const centralResolveRequestSchema = z.object({ slot: centralSlotSchema, code: z.string().trim().min(1).max(500) });
export const centralSlotRequestSchema = z.object({ slot: centralSlotSchema });
export const centralCredentialSchema = z.object({ credential: z.string().min(8).max(4096) });
export const centralResultEditSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('void'), resultId: z.string().uuid() }),
  z.object({ kind: z.literal('correct'), resultId: z.string().uuid(), points: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }),
]);
export const centralResolveUnresolvedSchema = z.object({ resultId: z.string().uuid(), code: z.string().trim().min(1).max(500) });
export const centralRetrySchema = z.object({ resultId: z.string().uuid().optional() });

import { z } from 'zod';
import {
  IPC,
  leaderboardWindowCommandSchema,
  logEntrySchema,
  operatorCommandSchema,
  participantStatusSchema,
  registerPlayersSchema,
  lookupPlayerNumberSchema,
  sessionRecordSchema,
  settingsPatchSchema,
  centralConfigPatchSchema,
  centralCredentialSchema,
  centralResolveRequestSchema,
  centralSlotRequestSchema,
  centralRetrySchema,
  centralResultEditSchema,
  centralResolveUnresolvedSchema,
} from '@booth/contracts';
import type { Role } from './security';

/** Which roles may use each renderer->main channel, and the payload schema. */
export const IPC_POLICY = {
  [IPC.getBootstrap]: { roles: ['participant', 'operator', 'leaderboard'], schema: z.undefined() },
  [IPC.log]: { roles: ['participant', 'operator', 'leaderboard'], schema: logEntrySchema },
  [IPC.participantStatus]: { roles: ['participant'], schema: participantStatusSchema },
  [IPC.sessionRecord]: { roles: ['participant'], schema: sessionRecordSchema },
  [IPC.operatorCommand]: { roles: ['operator'], schema: operatorCommandSchema },
  [IPC.updateSettings]: { roles: ['operator'], schema: settingsPatchSchema },
  [IPC.exportDiagnostics]: { roles: ['operator'], schema: z.undefined() },
  [IPC.getErrorHistory]: { roles: ['operator'], schema: z.undefined() },
  [IPC.reloadParticipant]: { roles: ['operator'], schema: z.undefined() },
  [IPC.openLeaderboard]: { roles: ['participant', 'operator'], schema: z.undefined() },
  [IPC.getLeaderboard]: { roles: ['participant', 'operator', 'leaderboard'], schema: z.undefined() },
  [IPC.leaderboardWindow]: { roles: ['leaderboard', 'operator'], schema: leaderboardWindowCommandSchema },
  [IPC.listDisplays]: { roles: ['leaderboard', 'operator'], schema: z.undefined() },
  [IPC.registerPlayers]: { roles: ['participant'], schema: registerPlayersSchema },
  [IPC.getFeedStatus]: { roles: ['operator'], schema: z.undefined() },
  [IPC.regenerateFeedKey]: { roles: ['operator'], schema: z.undefined() },
  [IPC.revealFeedKey]: { roles: ['operator'], schema: z.undefined() },
  [IPC.copyFeedKey]: { roles: ['operator'], schema: z.undefined() },
  [IPC.copyText]: { roles: ['operator'], schema: z.object({ text: z.string().max(50_000) }) },
  [IPC.getFeedLog]: { roles: ['operator'], schema: z.undefined() },
  [IPC.lookupPlayerNumber]: { roles: ['participant'], schema: lookupPlayerNumberSchema },
  [IPC.clearLeaderboard]: { roles: ['operator'], schema: z.undefined() },
  [IPC.centralGetStatus]: { roles: ['operator'], schema: z.undefined() },
  [IPC.centralUpdateConfig]: { roles: ['operator'], schema: centralConfigPatchSchema },
  [IPC.centralSetCredential]: { roles: ['operator'], schema: centralCredentialSchema },
  [IPC.centralTestConnection]: { roles: ['operator'], schema: z.undefined() },
  [IPC.centralResolve]: { roles: ['operator'], schema: centralResolveRequestSchema },
  [IPC.centralConfirm]: { roles: ['operator'], schema: centralSlotRequestSchema },
  [IPC.centralClearSlot]: { roles: ['operator'], schema: centralSlotRequestSchema },
  [IPC.centralRetry]: { roles: ['operator'], schema: centralRetrySchema },
  [IPC.centralReconcile]: { roles: ['operator'], schema: z.undefined() },
  [IPC.centralEditResult]: { roles: ['operator'], schema: centralResultEditSchema },
  [IPC.centralResolveUnresolved]: { roles: ['operator'], schema: centralResolveUnresolvedSchema },
  [IPC.centralGetPlayers]: { roles: ['participant'], schema: z.undefined() },
} as const satisfies Record<string, { roles: readonly Role[]; schema: z.ZodType }>;

export type PolicedChannel = keyof typeof IPC_POLICY;

export type IpcCheck<C extends PolicedChannel> =
  | { ok: true; payload: z.infer<(typeof IPC_POLICY)[C]['schema']> }
  | { ok: false; reason: string };

/** Pure validation: caller role (already origin-checked) + payload schema. */
export function checkIpc<C extends PolicedChannel>(channel: C, role: Role | null, payload: unknown): IpcCheck<C> {
  const policy = IPC_POLICY[channel];
  if (!role) return { ok: false, reason: 'unknown sender' };
  if (!(policy.roles as readonly Role[]).includes(role)) return { ok: false, reason: `role ${role} not allowed` };
  const parsed = policy.schema.safeParse(payload);
  if (!parsed.success) return { ok: false, reason: `invalid payload: ${parsed.error.issues[0]?.message ?? '?'}` };
  return { ok: true, payload: parsed.data as z.infer<(typeof IPC_POLICY)[C]['schema']> };
}

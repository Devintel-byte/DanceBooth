import { z } from 'zod';

/**
 * Player numbers: 4 digits printed on the player's card by the registration
 * desk ("Player number", e.g. 0377). Always handled as text: leading zeros
 * matter (0377 is not 377). Entry ignores spaces and dashes.
 */
export const PLAYER_NUMBER_LENGTH = 4;

/** The digits of an entry, with spaces and dashes ignored (other characters make it invalid). */
export function playerNumberDigits(input: string): string | null {
  const s = input.replace(/[\s-]/g, '');
  return /^\d*$/.test(s) ? s : null;
}

/** Exactly 4 digits as text, or null. */
export function normalizePlayerNumber(input: string): string | null {
  const d = playerNumberDigits(input);
  return d !== null && d.length === PLAYER_NUMBER_LENGTH ? d : null;
}

/** `registry` message data sent down the feed by the main leaderboard (`ref` is accepted and ignored). */
export const playerRegistrySchema = z.object({
  competitionId: z.string().max(200).optional(),
  title: z.string().max(200).optional(),
  revision: z.union([z.string(), z.number()]).optional(),
  sentAt: z.string().max(64).optional(),
  players: z
    .array(
      z.object({
        code: z.string().min(1).max(64),
        name: z.string().min(1).max(120),
      }),
    )
    .max(50_000),
});
export type PlayerRegistryData = z.infer<typeof playerRegistrySchema>;

/** Result of looking up a typed player number at the booth. */
export type PlayerNumberLookup =
  | { status: 'known'; number: string; name: string }
  | { status: 'unknown'; number: string }
  /** No player list has been received yet: the main leaderboard checks the number. */
  | { status: 'no-list'; number: string }
  | { status: 'invalid' };

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { normalizePlayerNumber, playerNameSchema, playerRegistrySchema, type PlayerNumberLookup, type PlayerRegistryData } from '@booth/contracts';

interface StoredList {
  competitionId: string | null;
  title: string | null;
  revision: string | null;
  sentAt: string | null;
  /** When this booth received the list. */
  receivedAt: string;
  players: { number: string; name: string }[];
}

export interface PlayerListStatus {
  count: number;
  receivedAt: string | null;
  title: string | null;
  competitionId: string | null;
}

/**
 * The event's registered players (4-digit player number -> name), sent down
 * the score feed by the main leaderboard. Each message is the full list and
 * replaces the cache; it is written to disk (atomically) so numbers still work
 * after a restart or while the network is down. Staff-only data: numbers are
 * never logged and the list never leaves the main process; the participant
 * screen can only look up the one number that was typed.
 */
export class PlayerListCache {
  private list: StoredList | null = null;
  private byNumber = new Map<string, string>();

  constructor(private readonly file: string) {
    try {
      if (existsSync(file)) {
        const stored = JSON.parse(readFileSync(file, 'utf-8')) as StoredList;
        if (Array.isArray(stored.players) && stored.players.every((p) => typeof p.number === 'string')) this.index(stored);
      }
    } catch {
      // Unreadable cache: start empty; the main leaderboard re-sends the list on connect.
      this.list = null;
    }
  }

  private index(list: StoredList): void {
    this.list = list;
    this.byNumber = new Map(list.players.map((p) => [p.number, p.name]));
  }

  /** Replaces the cache with a `registry` message's data. Returns the number of valid players; throws on a malformed message. */
  replace(data: unknown, now = new Date()): number {
    const parsed: PlayerRegistryData = playerRegistrySchema.parse(data);
    const players: StoredList['players'] = [];
    for (const p of parsed.players) {
      const number = normalizePlayerNumber(p.code);
      if (number) players.push({ number, name: p.name.trim() });
    }
    const list: StoredList = {
      competitionId: parsed.competitionId ?? null,
      title: parsed.title ?? null,
      revision: parsed.revision === undefined ? null : String(parsed.revision),
      sentAt: parsed.sentAt ?? null,
      receivedAt: now.toISOString(),
      players,
    };
    mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(list));
    renameSync(tmp, this.file);
    this.index(list);
    return players.length;
  }

  lookup(input: string): PlayerNumberLookup {
    const number = normalizePlayerNumber(input);
    if (!number) return { status: 'invalid' };
    if (!this.list) return { status: 'no-list', number };
    const name = this.byNumber.get(number);
    return name ? { status: 'known', number, name } : { status: 'unknown', number };
  }

  status(): PlayerListStatus {
    return {
      count: this.list?.players.length ?? 0,
      receivedAt: this.list?.receivedAt ?? null,
      title: this.list?.title ?? null,
      competitionId: this.list?.competitionId ?? null,
    };
  }
}

export interface ResolvedEntry {
  name: string;
  /** The 4-digit player number (also for numbers not in the list: the main leaderboard may know them). */
  number?: string;
  /** The number is in the booth's player list (registered competitor, registered name used). */
  recognised: boolean;
}

/**
 * Player entry rules: a recognised number plays under its registered name; an
 * unrecognised number is still kept and sent (with the typed name); no number
 * means a guest with the typed name. Throws a short message for the player
 * when a number is incomplete or a needed name is invalid.
 */
export function resolvePlayerEntries(entries: readonly { name?: string; number?: string }[], lookup: (number: string) => PlayerNumberLookup): ResolvedEntry[] {
  return entries.map((e, i) => {
    const who = entries.length > 1 ? `Player ${i + 1}: ` : '';
    const found = e.number ? lookup(e.number) : null;
    if (found && found.status === 'invalid') throw new Error(`${who}player numbers have 4 digits`);
    if (found?.status === 'known') return { name: found.name, number: found.number, recognised: true };
    const name = playerNameSchema.safeParse(e.name ?? '');
    if (!name.success) throw new Error(`${who}${name.error.issues[0]?.message ?? 'Enter a name'}`);
    return { name: name.data, ...(found && 'number' in found ? { number: found.number } : {}), recognised: false };
  });
}

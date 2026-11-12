import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { RegisteredPlayer } from '@booth/contracts';

interface RegistryFile {
  eventId: string;
  nextSeq: number;
  players: Record<string, { name: string; createdAt: string; code?: string }>;
}

/**
 * Serial player ids per event: player-001, player-002, ... Every name entry
 * gets a NEW id (two people called "Sam" stay distinct); "Play again" reuses
 * the ids it already has. The counter is persisted with an atomic write, so
 * ids are never reused across app restarts within an event.
 */
export class PlayerRegistry {
  private data: RegistryFile;
  private readonly file: string;

  /** `knownIds` are ids already used in stored session records; numbering always continues after them. */
  constructor(dir: string, eventId: string, knownIds: readonly string[] = []) {
    mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, `players-${eventId}.json`);
    this.data = { eventId, nextSeq: 1, players: {} };
    if (existsSync(this.file)) {
      try {
        const parsed = JSON.parse(readFileSync(this.file, 'utf-8')) as RegistryFile;
        if (parsed.eventId === eventId && Number.isInteger(parsed.nextSeq) && parsed.players) this.data = parsed;
      } catch {
        // Corrupt registry: keep it for diagnosis; numbering continues after the highest known id.
        renameSync(this.file, `${this.file}.corrupt-${Date.now()}`);
      }
    }
    const maxKnown = Math.max(0, ...knownIds.map((id) => Number(/^player-(\d+)$/.exec(id)?.[1] ?? 0)));
    this.data.nextSeq = Math.max(this.data.nextSeq, maxKnown + 1);
  }

  /** `code`: the player's 4-digit player number, when they gave one (stored as text). */
  register(entries: readonly (string | { name: string; code?: string })[]): RegisteredPlayer[] {
    const out: RegisteredPlayer[] = [];
    for (const e of entries) {
      const { name, code } = typeof e === 'string' ? { name: e, code: undefined } : e;
      const playerId = `player-${String(this.data.nextSeq).padStart(3, '0')}`;
      this.data.nextSeq++;
      this.data.players[playerId] = { name, createdAt: new Date().toISOString(), ...(code ? { code } : {}) };
      out.push({ playerId, name, ...(code ? { number: code } : {}) });
    }
    this.save();
    return out;
  }

  /** The player number a player gave (kept with their stored sessions too, as `code`). */
  codeOf(playerId: string): string | null {
    return this.data.players[playerId]?.code ?? null;
  }

  nameOf(playerId: string): string | null {
    return this.data.players[playerId]?.name ?? null;
  }

  has(playerId: string): boolean {
    return playerId in this.data.players;
  }

  /** Removes all names (privacy: end of event / operator clear). Numbering continues. */
  clearNames(): void {
    this.data.players = {};
    this.save();
  }

  private save(): void {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 1));
    renameSync(tmp, this.file);
  }
}

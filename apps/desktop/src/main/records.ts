import { appendFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import type { StoredRecord } from './leaderboard';

/**
 * Session results (no images). Players are referenced by their serial player
 * id; their names live in the player registry and can be cleared there. One
 * JSON-lines file per day; files older than the retention period are
 * deleted. Retention 0 disables storage entirely.
 */
export class SessionRecords {
  constructor(
    private readonly dir: string,
    private retentionDays: number,
  ) {}

  setRetention(days: number): void {
    this.retentionDays = days;
    this.prune();
  }

  append(record: StoredRecord): void {
    if (this.retentionDays <= 0) return;
    mkdirSync(this.dir, { recursive: true });
    const day = record.at.slice(0, 10);
    appendFileSync(path.join(this.dir, `sessions-${day}.jsonl`), JSON.stringify(record) + '\n');
  }

  prune(): void {
    try {
      const cutoff = Date.now() - this.retentionDays * 86_400_000;
      for (const name of readdirSync(this.dir)) {
        const m = /^sessions-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(name);
        if (m && Date.parse(m[1]!) < cutoff) unlinkSync(path.join(this.dir, name));
      }
    } catch {
      // Directory may not exist yet.
    }
  }
}

import { appendFileSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { planLogRetention } from '@booth/diagnostics';

export type Level = 'debug' | 'info' | 'warn' | 'error';

export interface ErrorRecord {
  at: string;
  code: string;
  message: string;
}

const MAX_FILE_BYTES = 5_000_000;
const MAX_ERROR_HISTORY = 200;

/**
 * JSON-lines logger with daily files, per-file size rotation, and age/size
 * retention. Disk failures never throw into callers; they are recorded in
 * the in-memory error history (and surfaced to the operator).
 */
export class Logger {
  private file = '';
  private part = 0;
  private bytes = 0;
  private diskFailed = false;
  readonly errors: ErrorRecord[] = [];

  constructor(
    private readonly dir: string,
    private retention: { logDays: number; maxLogBytes: number },
  ) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      this.diskFailed = true;
    }
    this.rollIfNeeded();
    this.prune();
  }

  setRetention(r: { logDays: number; maxLogBytes: number }): void {
    this.retention = r;
    this.prune();
  }

  get diskWriteFailed(): boolean {
    return this.diskFailed;
  }

  get currentFile(): string {
    return this.file;
  }

  log(level: Level, message: string, fields: Record<string, unknown> = {}): void {
    const at = new Date().toISOString();
    const line = JSON.stringify({ at, level, message, ...fields }) + '\n';
    if (level === 'error' || (level === 'warn' && typeof fields.code === 'string')) {
      this.errors.push({ at, code: typeof fields.code === 'string' ? fields.code : 'UNKNOWN', message });
      if (this.errors.length > MAX_ERROR_HISTORY) this.errors.splice(0, this.errors.length - MAX_ERROR_HISTORY);
    }
    if (level === 'error' || level === 'warn') console.warn(`[${level}] ${message}`);
    this.rollIfNeeded();
    try {
      appendFileSync(this.file, line);
      this.bytes += Buffer.byteLength(line);
      this.diskFailed = false;
    } catch (e) {
      if (!this.diskFailed) {
        this.diskFailed = true;
        this.errors.push({ at, code: 'DISK_WRITE_FAILED', message: `log write failed: ${(e as Error).message}` });
      }
    }
  }

  info(message: string, fields?: Record<string, unknown>): void {
    this.log('info', message, fields);
  }
  warn(message: string, fields?: Record<string, unknown>): void {
    this.log('warn', message, fields);
  }
  error(message: string, fields?: Record<string, unknown>): void {
    this.log('error', message, fields);
  }

  tail(maxLines: number): string[] {
    try {
      const lines = readFileSync(this.file, 'utf-8').split('\n').filter(Boolean);
      return lines.slice(-maxLines);
    } catch {
      return [];
    }
  }

  private rollIfNeeded(): void {
    const day = new Date().toISOString().slice(0, 10);
    const base = path.join(this.dir, `booth-${day}`);
    if (!this.file.startsWith(base)) {
      this.part = 0;
      this.file = `${base}.log`;
      this.bytes = this.sizeOf(this.file);
    }
    while (this.bytes >= MAX_FILE_BYTES) {
      this.part++;
      this.file = `${base}.${this.part}.log`;
      this.bytes = this.sizeOf(this.file);
      this.prune();
    }
  }

  private sizeOf(file: string): number {
    try {
      return statSync(file).size;
    } catch {
      return 0;
    }
  }

  prune(): void {
    try {
      const files = readdirSync(this.dir)
        .filter((n) => n.endsWith('.log'))
        .map((name) => {
          const st = statSync(path.join(this.dir, name));
          return { name, sizeBytes: st.size, modifiedMs: st.mtimeMs };
        });
      const remove = planLogRetention(files, {
        nowMs: Date.now(),
        maxAgeDays: this.retention.logDays,
        maxTotalBytes: this.retention.maxLogBytes,
        activeFile: path.basename(this.file),
      });
      for (const name of remove) unlinkSync(path.join(this.dir, name));
    } catch {
      // Retention is best-effort; a failure here must not stop the booth.
    }
  }
}

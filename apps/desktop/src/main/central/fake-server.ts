import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { contentHash } from './canonical';

/**
 * In-process fake of the main application (contract event-results/1) for
 * tests. Implements the manifest, participant resolution, result ingestion
 * with idempotency by messageId and by (resultId, revision), and the
 * reconciliation endpoint. Failures can be scripted per path.
 */

export interface FakeParticipant {
  participantId: string;
  displayName: string;
  competitionId: string;
  status: string;
  registryRevision: number;
}

export interface Scripted {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** Raw body (overrides `body`). */
  raw?: string;
}

export interface RecordedRequest {
  method: string;
  path: string;
  auth: string | null;
  body: string;
}

export class FakeCentral {
  readonly token = 'test-source-credential-123';
  competitionId = 'comp-2026';
  participants = new Map<string, FakeParticipant>();
  /** resultId -> latest stored revision. */
  results = new Map<string, { revision: number; hash: string; body: Record<string, unknown> }>();
  seenMessages = new Set<string>();
  requests: RecordedRequest[] = [];
  /** Scripted responses, consumed first-in-first-out per path prefix. */
  private script: { prefix: string; res: Scripted }[] = [];
  manifestConfig: Record<string, unknown> = {};
  /** Overrides the reconciliation response (to test incomplete/odd responses). */
  reconcileOverride: ((req: { runId: string; final: boolean }) => unknown) | null = null;
  /** Corrupt the ack (wrong messageId) for the next result event. */
  badAckOnce = false;
  private server: Server | null = null;
  url = '';

  addParticipant(code: string, p: Partial<FakeParticipant> & { participantId: string; displayName: string }): void {
    this.participants.set(code, { competitionId: this.competitionId, status: 'active', registryRevision: 1, ...p });
  }

  /** Next request whose path starts with `prefix` gets this response. */
  fail(prefix: string, res: Scripted, times = 1): void {
    for (let i = 0; i < times; i++) this.script.push({ prefix, res });
  }

  resultPosts(): { messageId: string; sourceSequence: number; result: Record<string, unknown> }[] {
    return this.requests.filter((r) => r.path === '/api/v1/result-events').map((r) => JSON.parse(r.body));
  }

  async start(): Promise<string> {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this.url;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()) ?? resolve());
  }

  private send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks).toString('utf8');
    const path = (req.url ?? '').split('?')[0]!;
    this.requests.push({ method: req.method ?? '', path, auth: req.headers.authorization ?? null, body });

    const i = this.script.findIndex((s) => path.startsWith(s.prefix));
    if (i >= 0) {
      const { res: r } = this.script.splice(i, 1)[0]!;
      return this.send(res, r.status, r.raw ?? r.body ?? { error: 'scripted' }, r.headers);
    }
    if (req.headers.authorization !== `Bearer ${this.token}`) return this.send(res, 401, { error: 'bad credential' });

    const comp = `/api/v1/competitions/${this.competitionId}`;
    if (req.method === 'GET' && path === `${comp}/manifest`) {
      return this.send(res, 200, {
        competitionId: this.competitionId,
        registryRevision: 7,
        rounds: [
          { roundId: 'heats', name: 'Heats', active: true },
          { roundId: 'final', name: 'Final' },
        ],
        games: [{ gameId: 'danceoff', enabled: true, scoringVersions: ['danceoff-points-v3'] }],
        config: this.manifestConfig,
      });
    }
    if (req.method === 'POST' && path === `${comp}/participants/resolve`) {
      const { registrationCode } = JSON.parse(body) as { registrationCode: string };
      const p = this.participants.get(registrationCode);
      return p ? this.send(res, 200, p) : this.send(res, 404, { error: 'unknown registration code' });
    }
    if (req.method === 'POST' && path === '/api/v1/result-events') {
      const msg = JSON.parse(body) as { messageId: string; result: Record<string, unknown> & { resultId: string; revision: number } };
      const { resultId, revision } = msg.result;
      const hash = contentHash(msg.result);
      const stored = this.results.get(resultId);
      let outcome: string;
      if (this.seenMessages.has(msg.messageId)) outcome = 'duplicate';
      else if (stored && revision < stored.revision) outcome = 'stale';
      else if (stored && revision === stored.revision) {
        if (stored.hash !== hash) return this.send(res, 409, { error: 'revision exists with different content' });
        outcome = 'duplicate';
      } else {
        this.results.set(resultId, { revision, hash, body: msg.result });
        outcome = 'accepted';
      }
      this.seenMessages.add(msg.messageId);
      const ackId = this.badAckOnce ? 'not-the-message' : msg.messageId;
      this.badAckOnce = false;
      return this.send(res, 200, { messageId: ackId, resultId, outcome, storedRevision: this.results.get(resultId)!.revision });
    }
    const rec = /^\/api\/v1\/sources\/([^/]+)\/reconciliation$/.exec(path);
    if (req.method === 'POST' && rec) {
      const q = JSON.parse(body) as { runId: string; final: boolean; items: { resultId: string; revision: number; contentHash: string }[] };
      if (this.reconcileOverride) return this.send(res, 200, this.reconcileOverride(q));
      const missing: string[] = [];
      const conflicts: unknown[] = [];
      for (const it of q.items) {
        const s = this.results.get(it.resultId);
        if (!s || s.revision < it.revision) missing.push(it.resultId);
        else if (s.revision > it.revision || s.hash !== it.contentHash) conflicts.push({ resultId: it.resultId, centralRevision: s.revision, centralContentHash: s.hash });
      }
      return this.send(res, 200, { runId: q.runId, missing, conflicts, complete: q.final });
    }
    this.send(res, 404, { error: 'not found' });
  }
}

import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { WebSocketServer, type WebSocket } from 'ws';

/**
 * Read-only LAN score feed (`danceoff.scorefeed` v1) for the event's main
 * leaderboard (LeaderboardHQ) and other scoreboards. The main leaderboard
 * connects TO the booth; the booth never needs its address.
 *
 * - WebSocket  /v1/stream?key=<sharedKey>   (or Authorization: Bearer <key>)
 * - GET        /v1/snapshot                 (Authorization: Bearer <key>)
 * - GET        /v1/health                   (no key; no secrets)
 *
 * Messages are envelopes with a per-booth `seq` that increases by one for
 * every message the booth sends. Clients may send only {"type":"resync"},
 * {"type":"ping"} and {"type":"registry"} (the main leaderboard's player
 * list); anything else gets an `error`. Docs: docs/score-feed-protocol.md.
 */
export const FEED_PROTOCOL = 'danceoff.scorefeed';
export const FEED_VERSION = 1;
/** Inbound message cap for scoreboards. */
export const MAX_CLIENT_MESSAGE = 4096;
/** The main leaderboard's player list is a full list (about 60 bytes a player), so its connection gets more room. */
export const MAX_REGISTRY_MESSAGE = 2 * 1024 * 1024;

export type FeedMessageType = 'hello' | 'snapshot' | 'session.completed' | 'leaderboard.updated' | 'heartbeat' | 'pong' | 'error';

export interface FeedEnvelope<T = unknown> {
  protocol: typeof FEED_PROTOCOL;
  version: typeof FEED_VERSION;
  type: FeedMessageType;
  boothId: string;
  eventId: string;
  seq: number;
  sentAt: string;
  data: T;
}

export type FeedClientKind = 'main-leaderboard' | 'scoreboard';

export interface FeedClientInfo {
  id: number;
  ip: string;
  kind: FeedClientKind;
  connectedAt: string;
}

/** Things the operator console shows (status, toasts, connection log). Never carries the key. */
export type FeedEvent =
  | { type: 'started'; port: number; addresses: string[] }
  | { type: 'stopped'; port: number }
  | { type: 'start-failed'; port: number; message: string }
  | { type: 'client-connected'; client: FeedClientInfo }
  | { type: 'client-disconnected'; client: FeedClientInfo }
  | { type: 'rejected'; ip: string; reason: 'wrong-key' | 'not-found' | 'busy' }
  | { type: 'resync'; client: FeedClientInfo }
  | { type: 'registry'; client: FeedClientInfo; players: number }
  | { type: 'registry-invalid'; client: FeedClientInfo; message: string }
  | { type: 'error'; message: string };

export interface FeedOptions {
  port: number;
  host?: string;
  sharedKey: string;
  boothId: string;
  eventId: () => string;
  /** Every completed session of the current event/day, oldest first. */
  records: () => unknown[];
  /** Extra snapshot data for scoreboards that are not the main leaderboard (e.g. the booth's own leaderboard). */
  scoreboardExtras?: () => Record<string, unknown>;
  /** A `registry` message (the main leaderboard's player list). Returns the number of players kept; throws if malformed. */
  onRegistry?: (data: unknown) => number;
  onEvent?: (event: FeedEvent) => void;
  maxClients?: number;
  heartbeatMs?: number;
}

export interface FeedStatus {
  listening: boolean;
  port: number;
  clients: FeedClientInfo[];
  addresses: string[];
  lastError: string | null;
}

function keyMatches(expected: string, given: string | null | undefined): boolean {
  if (!given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  // Compare in constant time; a different length is still compared against itself so timing does not depend on where it differs.
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

function presentedKey(req: IncomingMessage): string | null {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
  try {
    return new URL(req.url ?? '/', 'http://booth').searchParams.get('key');
  } catch {
    return null;
  }
}

function remoteIp(req: IncomingMessage): string {
  return (req.socket.remoteAddress ?? '?').replace(/^::ffff:/, '');
}

/** Interface names of virtual adapters (Hyper-V, WSL, VirtualBox, VMware, Docker, VPNs). */
const VIRTUAL_ADAPTER = /vethernet|hyper-v|wsl|virtualbox|vmware|vmnet|docker|vbox|loopback|bluetooth|tailscale|zerotier|hamachi|npcap|tap-|tun|utun|bridge|virbr|br-/i;

/** LAN IPv4 addresses for the operator to give the main leaderboard (no loopback, link-local or virtual adapters). */
export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const [name, list] of Object.entries(networkInterfaces())) {
    if (VIRTUAL_ADAPTER.test(name)) continue;
    for (const i of list ?? []) {
      if (i.family !== 'IPv4' || i.internal || i.address.startsWith('169.254.')) continue;
      out.push(i.address);
    }
  }
  return out;
}

/** Plain-language reason a listen() failed. */
export function describeListenError(e: NodeJS.ErrnoException, port: number): string {
  if (e.code === 'EADDRINUSE') return `Port ${port} is already in use`;
  if (e.code === 'EACCES') return `Not allowed to use port ${port}`;
  return `Could not start the feed (${e.message})`;
}

interface Client {
  ws: WebSocket;
  info: FeedClientInfo;
}

export class ScoreFeedServer {
  private http: Server | null = null;
  private wssMain: WebSocketServer | null = null;
  private wssOther: WebSocketServer | null = null;
  private clients = new Map<WebSocket, Client>();
  private nextClientId = 1;
  private seq = 0;
  private heartbeat: NodeJS.Timeout | null = null;
  private lastError: string | null = null;

  constructor(private opts: FeedOptions) {}

  get port(): number {
    const addr = this.http?.address();
    return typeof addr === 'object' && addr ? addr.port : this.opts.port;
  }

  status(): FeedStatus {
    return {
      listening: !!this.http?.listening,
      port: this.port,
      clients: [...this.clients.values()].map((c) => c.info),
      addresses: lanAddresses(),
      lastError: this.lastError,
    };
  }

  private emit(e: FeedEvent): void {
    try {
      this.opts.onEvent?.(e);
    } catch {
      // A broken listener must not break the feed.
    }
  }

  private envelope<T>(type: FeedMessageType, data: T): FeedEnvelope<T> {
    return {
      protocol: FEED_PROTOCOL,
      version: FEED_VERSION,
      type,
      boothId: this.opts.boothId,
      eventId: this.opts.eventId(),
      seq: ++this.seq,
      sentAt: new Date().toISOString(),
      data,
    };
  }

  private snapshotFor(kind: FeedClientKind): Record<string, unknown> {
    const records = this.opts.records();
    return kind === 'main-leaderboard' ? { records } : { ...(this.opts.scoreboardExtras?.() ?? {}), records };
  }

  async start(): Promise<void> {
    if (this.http) return;
    const http = createServer((req, res) => this.handleHttp(req, res));
    const wssMain = new WebSocketServer({ noServer: true, maxPayload: MAX_REGISTRY_MESSAGE });
    const wssOther = new WebSocketServer({ noServer: true, maxPayload: MAX_CLIENT_MESSAGE });
    http.on('upgrade', (req, socket, head) => {
      const ip = remoteIp(req);
      let url: URL;
      try {
        url = new URL(req.url ?? '/', 'http://booth');
      } catch {
        socket.destroy();
        return;
      }
      if (url.pathname !== '/v1/stream') {
        socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
        socket.destroy();
        this.emit({ type: 'rejected', ip, reason: 'not-found' });
        return;
      }
      if (!keyMatches(this.opts.sharedKey, presentedKey(req))) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        this.emit({ type: 'rejected', ip, reason: 'wrong-key' });
        return;
      }
      if (this.clients.size >= (this.opts.maxClients ?? 8)) {
        socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
        socket.destroy();
        this.emit({ type: 'rejected', ip, reason: 'busy' });
        return;
      }
      const kind: FeedClientKind = (url.searchParams.get('client') ?? '').toLowerCase() === 'leaderboardhq' ? 'main-leaderboard' : 'scoreboard';
      (kind === 'main-leaderboard' ? wssMain : wssOther).handleUpgrade(req, socket, head, (ws) => this.onClient(ws, ip, kind));
    });
    await new Promise<void>((resolve, reject) => {
      http.once('error', reject);
      http.listen(this.opts.port, this.opts.host ?? '0.0.0.0', () => {
        http.off('error', reject);
        resolve();
      });
    }).catch((e: unknown) => {
      this.lastError = describeListenError(e as NodeJS.ErrnoException, this.opts.port);
      this.emit({ type: 'start-failed', port: this.opts.port, message: this.lastError });
      throw new Error(this.lastError);
    });
    http.on('error', (e) => {
      this.lastError = e.message;
      this.emit({ type: 'error', message: e.message });
    });
    this.http = http;
    this.wssMain = wssMain;
    this.wssOther = wssOther;
    this.lastError = null;
    this.heartbeat = setInterval(() => this.broadcast('heartbeat', { clients: this.clients.size }), this.opts.heartbeatMs ?? 15_000);
    this.emit({ type: 'started', port: this.port, addresses: lanAddresses() });
  }

  async stop(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    const wasListening = !!this.http;
    for (const c of this.clients.values()) c.ws.terminate();
    this.wssMain?.close();
    this.wssOther?.close();
    await new Promise<void>((r) => (this.http ? this.http.close(() => r()) : r()));
    const port = this.port;
    this.http = null;
    this.wssMain = null;
    this.wssOther = null;
    if (wasListening) this.emit({ type: 'stopped', port });
  }

  /** Pushes an event to every connected client (`only` limits it to one kind). Returns how many received it. */
  broadcast(type: FeedMessageType, data: unknown, only?: FeedClientKind): number {
    let n = 0;
    for (const c of this.clients.values()) {
      if (only && c.info.kind !== only) continue;
      if (this.send(c.ws, type, data)) n++;
    }
    return n;
  }

  private send(ws: WebSocket, type: FeedMessageType, data: unknown): boolean {
    if (ws.readyState !== ws.OPEN) return false;
    ws.send(JSON.stringify(this.envelope(type, data)));
    return true;
  }

  private onClient(ws: WebSocket, ip: string, kind: FeedClientKind): void {
    const info: FeedClientInfo = { id: this.nextClientId++, ip, kind, connectedAt: new Date().toISOString() };
    this.clients.set(ws, { ws, info });
    this.emit({ type: 'client-connected', client: info });
    this.send(ws, 'hello', { protocol: FEED_PROTOCOL, version: FEED_VERSION, capabilities: ['registry'] });
    this.send(ws, 'snapshot', this.snapshotFor(kind));
    ws.on('message', (raw, isBinary) => {
      const text = isBinary ? '' : String(raw);
      let msg: { type?: unknown; data?: unknown };
      try {
        msg = JSON.parse(text) as { type?: unknown; data?: unknown };
      } catch {
        this.send(ws, 'error', { message: 'invalid JSON' });
        return;
      }
      if (msg?.type === 'registry') {
        try {
          const players = this.opts.onRegistry ? this.opts.onRegistry(msg.data) : 0;
          this.emit({ type: 'registry', client: info, players });
        } catch (e) {
          // Not answered with an `error` (spec); shown to the operator instead.
          this.emit({ type: 'registry-invalid', client: info, message: (e as Error).message.slice(0, 200) });
        }
        return;
      }
      if (text.length > MAX_CLIENT_MESSAGE) {
        this.send(ws, 'error', { message: 'message too large' });
        return;
      }
      if (msg?.type === 'resync') {
        this.emit({ type: 'resync', client: info });
        this.send(ws, 'snapshot', this.snapshotFor(kind));
      } else if (msg?.type === 'ping') this.send(ws, 'pong', {});
      else this.send(ws, 'error', { message: 'unsupported message; the feed is read-only' });
    });
    ws.on('close', () => {
      if (this.clients.delete(ws)) this.emit({ type: 'client-disconnected', client: info });
    });
    ws.on('error', () => undefined);
  }

  private handleHttp(req: IncomingMessage, res: ServerResponse): void {
    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://booth');
    } catch {
      res.writeHead(400).end();
      return;
    }
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'GET') return json(405, { error: 'method not allowed' });
    if (url.pathname === '/v1/health') return json(200, { ok: true, protocol: FEED_PROTOCOL, version: FEED_VERSION, boothId: this.opts.boothId });
    if (!keyMatches(this.opts.sharedKey, presentedKey(req))) {
      this.emit({ type: 'rejected', ip: remoteIp(req), reason: 'wrong-key' });
      return json(401, { error: 'missing or wrong key' });
    }
    const kind: FeedClientKind = (url.searchParams.get('client') ?? '').toLowerCase() === 'leaderboardhq' ? 'main-leaderboard' : 'scoreboard';
    if (url.pathname === '/v1/snapshot') return json(200, this.envelope('snapshot', this.snapshotFor(kind)));
    // Older scoreboards used these paths for the same data.
    if (url.pathname === '/v1/leaderboard' || url.pathname === '/v1/records') return json(200, this.envelope('snapshot', this.snapshotFor('scoreboard')));
    return json(404, { error: 'not found' });
  }
}

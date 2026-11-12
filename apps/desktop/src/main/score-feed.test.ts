import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { toFeedRecord } from './feed-records';
import type { StoredRecord } from './leaderboard';
import { PlayerListCache } from './player-list';
import { ScoreFeedServer, type FeedEnvelope, type FeedEvent } from './score-feed';

const KEY = 'test-key-0123456789abcdef';
let server: ScoreFeedServer;
let records: unknown[] = [];
const events: FeedEvent[] = [];
const listFile = path.join(mkdtempSync(path.join(tmpdir(), 'feed-')), 'player-list.json');
const list = new PlayerListCache(listFile);

beforeAll(async () => {
  server = new ScoreFeedServer({
    port: 0,
    host: '127.0.0.1',
    sharedKey: KEY,
    boothId: 'booth-1',
    eventId: () => 'maltina',
    records: () => records,
    scoreboardExtras: () => ({ leaderboard: { entries: [] } }),
    onRegistry: (d) => list.replace(d),
    onEvent: (e) => events.push(e),
    heartbeatMs: 60_000,
    maxClients: 4,
  });
  await server.start();
});
afterAll(() => server.stop());

const base = () => `127.0.0.1:${server.port}`;

function connect(key: string, client = 'leaderboardhq'): Promise<{ ws: WebSocket; messages: FeedEnvelope[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${base()}/v1/stream?key=${encodeURIComponent(key)}${client ? `&client=${client}` : ''}`);
    const messages: FeedEnvelope[] = [];
    ws.on('message', (m) => messages.push(JSON.parse(String(m)) as FeedEnvelope));
    ws.on('open', () => resolve({ ws, messages }));
    ws.on('error', reject);
    ws.on('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
  });
}
const until = async (cond: () => boolean) => {
  for (let i = 0; i < 150 && !cond(); i++) await new Promise((r) => setTimeout(r, 20));
};

describe('score feed (danceoff.scorefeed v1)', () => {
  it('answers 401 to a wrong or missing key, over HTTP and WebSocket, and logs the IP only', async () => {
    await expect(connect('guessed-key-zq81')).rejects.toThrow('401');
    expect((await fetch(`http://${base()}/v1/snapshot`)).status).toBe(401);
    expect((await fetch(`http://${base()}/v1/snapshot`, { headers: { authorization: 'Bearer nope' } })).status).toBe(401);
    const rejected = events.filter((e) => e.type === 'rejected');
    expect(rejected.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(rejected)).not.toContain('guessed-key-zq81');
  });

  it('accepts the key as a bearer header on the stream too', async () => {
    const ws = new WebSocket(`ws://${base()}/v1/stream`, { headers: { authorization: `Bearer ${KEY}` } });
    await new Promise((r, j) => {
      ws.on('open', r);
      ws.on('error', j);
    });
    ws.close();
  });

  it('health needs no key and exposes no key', async () => {
    const res = await fetch(`http://${base()}/v1/health`);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: true, protocol: 'danceoff.scorefeed', version: 1, boothId: 'booth-1' });
    expect(text).not.toContain(KEY);
  });

  it('sends hello (with the registry capability) then a snapshot of the records on connect, and marks the main leaderboard', async () => {
    records = [{ recordId: 'r0', at: '2026-11-04T10:00:00.000Z', sessionId: 1, players: [] }];
    const { ws, messages } = await connect(KEY);
    await until(() => messages.length >= 2);
    expect(messages[0]).toMatchObject({ protocol: 'danceoff.scorefeed', version: 1, type: 'hello', boothId: 'booth-1', eventId: 'maltina', data: { protocol: 'danceoff.scorefeed', version: 1, capabilities: ['registry'] } });
    expect(messages[1]).toMatchObject({ type: 'snapshot', data: { records } });
    // The main leaderboard gets exactly { records }.
    expect(Object.keys(messages[1]!.data as object)).toEqual(['records']);
    expect(server.status().clients.some((c) => c.kind === 'main-leaderboard')).toBe(true);
    expect(events.some((e) => e.type === 'client-connected' && e.client.kind === 'main-leaderboard')).toBe(true);
    ws.close();
    await until(() => events.some((e) => e.type === 'client-disconnected'));
  });

  it('pushes session.completed live, with seq increasing by one per message', async () => {
    const { ws, messages } = await connect(KEY);
    await until(() => messages.length >= 2);
    server.broadcast('session.completed', { recordId: 'r1' });
    ws.send(JSON.stringify({ type: 'ping' }));
    await until(() => messages.length >= 4);
    expect(messages[2]).toMatchObject({ type: 'session.completed', data: { recordId: 'r1' } });
    expect(messages[3]).toMatchObject({ type: 'pong', data: {} });
    for (let i = 1; i < messages.length; i++) expect(messages[i]!.seq).toBe(messages[i - 1]!.seq + 1);
    ws.close();
  });

  it('answers resync with a snapshot, and non-JSON or unknown messages with error', async () => {
    const { ws, messages } = await connect(KEY);
    await until(() => messages.length >= 2);
    ws.send(JSON.stringify({ type: 'resync' }));
    await until(() => messages.length >= 3);
    expect(messages[2]!.type).toBe('snapshot');
    ws.send('not json');
    ws.send(JSON.stringify({ type: 'delete-everything' }));
    await until(() => messages.length >= 5);
    expect(messages[3]).toMatchObject({ type: 'error', data: { message: expect.any(String) } });
    expect(messages[4]!.type).toBe('error');
    expect(events.some((e) => e.type === 'resync')).toBe(true);
    ws.close();
  });

  it('a registry message replaces and persists the player list, and gets no reply', async () => {
    const { ws, messages } = await connect(KEY);
    await until(() => messages.length >= 2);
    // A realistic list is over 4 KB: the main leaderboard's connection allows it.
    const players = Array.from({ length: 300 }, (_, i) => ({ code: String(1000 + i), name: `Player ${i}` }));
    players.push({ code: '0377', name: 'Tolu Adeyemi' });
    ws.send(JSON.stringify({ type: 'registry', data: { competitionId: 'maltina_2026', title: 'Maltina Arcade Night', revision: '1', sentAt: new Date().toISOString(), players } }));
    await until(() => list.status().count === 301);
    expect(list.lookup('0377')).toEqual({ status: 'known', number: '0377', name: 'Tolu Adeyemi' });
    ws.send(JSON.stringify({ type: 'registry', data: { players: [{ code: '1204', name: 'Femi', ref: 'ignored' }] } }));
    await until(() => list.status().count === 1);
    expect(list.lookup('0377').status).toBe('unknown');
    expect(new PlayerListCache(listFile).lookup('1204')).toMatchObject({ status: 'known', name: 'Femi' });
    await new Promise((r) => setTimeout(r, 100));
    expect(messages.filter((m) => m.type === 'error')).toEqual([]);
    ws.close();
  });

  it('caps messages from other scoreboards at 4 KB', async () => {
    const { ws } = await connect(KEY, '');
    const closed = new Promise<number>((r) => ws.on('close', (code) => r(code)));
    ws.send(JSON.stringify({ type: 'ping', pad: 'x'.repeat(5000) }));
    expect(await closed).toBe(1009);
  });

  it('refuses connections beyond the limit with 503', async () => {
    const open = await Promise.all([connect(KEY), connect(KEY), connect(KEY), connect(KEY)]);
    await expect(connect(KEY)).rejects.toThrow('503');
    for (const c of open) c.ws.close();
  });

  it('serves the snapshot over HTTP with a bearer key', async () => {
    const res = await fetch(`http://${base()}/v1/snapshot?client=leaderboardhq`, { headers: { authorization: `Bearer ${KEY}` } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ type: 'snapshot', data: { records } });
  });
});

describe('feed records', () => {
  const stored: StoredRecord = {
    recordId: '1b6f0d1e-6a1f-4bd7-9d1c-2a8e9b2d3c4f',
    at: '2026-11-04T18:00:00.000Z',
    eventId: 'maltina',
    sessionId: 12,
    routineId: 'maltina-theme',
    mode: 'duo',
    difficulty: 'easy',
    endedReason: 'completed',
    durationSec: 45,
    inputSource: 'webcam',
    scores: [
      { slot: 1, playerId: 'player-014', score: 81.6, points: 2060, judgedMoves: 22, insufficientEvidence: 0, code: '0377' },
      { slot: 2, playerId: 'player-015', score: 70.2, points: 1840, judgedMoves: 22, insufficientEvidence: 1 },
    ],
  };
  const names: Record<string, string> = { 'player-014': 'Tolu Adeyemi', 'player-015': 'Femi' };
  const ctx = { boothId: 'booth-1', routineTitle: () => 'Maltina Theme Song', nameOf: (id: string) => names[id] ?? null };

  it('carries uid, name, the 4-digit player number as text (numbered players only) and integer points', () => {
    const f = toFeedRecord(stored, ctx)!;
    expect(f).toMatchObject({ recordId: stored.recordId, at: stored.at, sessionId: 12 });
    expect(f.players[0]).toMatchObject({ uid: 'booth-1:maltina:player-014', playerId: 'player-014', name: 'Tolu Adeyemi', code: '0377', slot: 1, points: 2060 });
    expect(JSON.stringify(f)).toContain('"code":"0377"');
    expect(f.players[1]).toMatchObject({ uid: 'booth-1:maltina:player-015', name: 'Femi', slot: 2, points: 1840 });
    expect('code' in f.players[1]!).toBe(false);
    for (const p of f.players) expect(Number.isInteger(p.points)).toBe(true);
  });

  it('is identical for the same stored session (live, snapshot, after a restart)', () => {
    const reloaded = JSON.parse(JSON.stringify(stored)) as StoredRecord;
    expect(toFeedRecord(reloaded, ctx)).toEqual(toFeedRecord(stored, ctx));
  });

  it('rounds points and never sends demo, aborted or unreadable runs', () => {
    const odd = { ...stored, scores: [{ ...stored.scores[0]!, points: 10.6 as unknown as number }] };
    expect(toFeedRecord(odd, ctx)!.players[0]!.points).toBe(11);
    expect(toFeedRecord({ ...stored, inputSource: 'replay' }, ctx)).toBeNull();
    expect(toFeedRecord({ ...stored, endedReason: 'aborted' }, ctx)).toBeNull();
    expect(toFeedRecord({ ...stored, scores: stored.scores.map((s) => ({ ...s, judgedMoves: 0 })) }, ctx)).toBeNull();
  });

  it('keeps uid and recordId but leaves the name out once names were cleared', () => {
    const f = toFeedRecord(stored, { ...ctx, nameOf: () => null })!;
    expect(f.players[0]).toMatchObject({ uid: 'booth-1:maltina:player-014', code: '0377' });
    expect('name' in f.players[0]!).toBe(false);
  });
});

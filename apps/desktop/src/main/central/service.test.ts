import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { canonicalJson, contentHash } from './canonical';
import { CentralClient, CentralError, validateServerUrl } from './client';
import { FakeCentral } from './fake-server';
import { CentralService, parseRegistrationCode, type CompletedSession, type SecretBox } from './service';
import { CentralStore, migrateStore, STORE_SCHEMA_VERSION } from './store';

/** Reversible stand-in for safeStorage: the plaintext never appears on disk. */
const secrets: SecretBox = {
  available: true,
  encrypt: (s) => Buffer.from(Buffer.from(s, 'utf8').map((b) => b ^ 0x5a)),
  decrypt: (b) => Buffer.from(b.map((x) => x ^ 0x5a)).toString('utf8'),
};

let dir: string;
let server: FakeCentral;
let clock: number;
const logs: string[] = [];

function make(over: Partial<ConstructorParameters<typeof CentralService>[0]> = {}): CentralService {
  return new CentralService({
    dir,
    secrets,
    log: (l, m) => logs.push(`${l}: ${m}`),
    autoSend: false,
    now: () => new Date(clock),
    random: () => 0.5, // jitter factor exactly 1
    ...over,
  });
}

async function configured(over: Partial<ConstructorParameters<typeof CentralService>[0]> = {}): Promise<CentralService> {
  const svc = make(over);
  svc.updateConfig({ enabled: true, serverUrl: server.url, allowPlainHttp: true, sourceId: 'booth-1', competitionId: server.competitionId, roundId: 'heats' });
  svc.setCredential(server.token);
  await svc.refreshManifest();
  return svc;
}

let seq = 0;
function session(attempts: CompletedSession['attempts'], extra: Partial<CompletedSession> = {}): CompletedSession {
  seq++;
  return {
    recordId: `rec-${seq}-0000-0000`,
    sessionId: seq,
    routineId: 'unlock-me',
    mode: attempts.length > 1 ? 'duo' : 'single',
    completedAt: new Date(clock).toISOString(),
    attempts,
    ...extra,
  };
}
const attempt = (slot: 1 | 2, points: number) => ({ slot, points, localPlayerId: `local-${slot}`, displayName: `Typed ${slot}`, legacyUid: `booth-1:ev:p${slot}` });

async function confirmPlayer(svc: CentralService, slot: 1 | 2, code: string) {
  await svc.resolve(slot, code);
  svc.confirm(slot);
}

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'central-'));
  clock = Date.parse('2026-11-03T10:00:00Z');
  logs.length = 0;
  server = new FakeCentral();
  server.addParticipant('ADA-1', { participantId: 'p-ada', displayName: 'Ada' });
  server.addParticipant('BOLA-2', { participantId: 'p-bola', displayName: 'Bola' });
  server.addParticipant('GONE-3', { participantId: 'p-gone', displayName: 'Gone', status: 'withdrawn' });
  await server.start();
});

afterEach(async () => {
  await server.stop();
  rmSync(dir, { recursive: true, force: true });
});

describe('canonical JSON and hashes', () => {
  it('sorts keys at every level and ignores key order', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: 'x' } })).toBe('{"a":{"c":"x","d":[1,{"y":2,"z":1}]},"b":1}');
    expect(contentHash({ a: 1, b: 2 })).toBe(contentHash({ b: 2, a: 1 }));
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: 2 }));
  });
  it('omits undefined members and rejects non-finite numbers', () => {
    expect(canonicalJson({ a: undefined, b: null })).toBe('{"b":null}');
    expect(() => canonicalJson({ a: NaN })).toThrow();
  });
});

describe('registration codes', () => {
  it('accepts plain codes and common QR payloads', () => {
    expect(parseRegistrationCode('  ADA-1 ')).toBe('ADA-1');
    expect(parseRegistrationCode('https://reg.example.com/p?code=ADA-1')).toBe('ADA-1');
    expect(parseRegistrationCode('https://reg.example.com/p?registrationCode=ADA-1')).toBe('ADA-1');
    expect(parseRegistrationCode('https://reg.example.com/r/ADA-1')).toBe('ADA-1');
    expect(parseRegistrationCode('{"registrationCode":"ADA-1"}')).toBe('ADA-1');
  });
});

describe('transport security', () => {
  it('requires https unless trusted-LAN http is switched on', () => {
    expect(validateServerUrl('https://x.example', false)).toBeNull();
    expect(validateServerUrl('http://x.example', false)).toMatch(/https/);
    expect(validateServerUrl('http://x.example', true)).toBeNull();
    expect(validateServerUrl('ftp://x', true)).not.toBeNull();
    const svc = make();
    expect(() => svc.updateConfig({ serverUrl: 'http://192.168.1.5' })).toThrow(/https/);
  });
  it('classifies failures', async () => {
    const c = new CentralClient({ serverUrl: server.url, allowPlainHttp: true, credential: server.token });
    server.fail('/x', { status: 503, headers: { 'Retry-After': '7' } });
    await expect(c.request('GET', '/x')).rejects.toMatchObject({ kind: 'transient', status: 503, retryAfterSec: 7 });
    server.fail('/x', { status: 403 });
    await expect(c.request('GET', '/x')).rejects.toMatchObject({ kind: 'auth' });
    server.fail('/x', { status: 422 });
    await expect(c.request('GET', '/x')).rejects.toMatchObject({ kind: 'permanent' });
    const dead = new CentralClient({ serverUrl: 'http://127.0.0.1:1', allowPlainHttp: true, credential: 'x'.repeat(8) });
    await expect(dead.request('GET', '/x')).rejects.toBeInstanceOf(CentralError);
  });
});

describe('credential storage', () => {
  it('is encrypted at rest and never part of the status sent to renderers', async () => {
    const svc = await configured();
    const onDisk = readFileSync(path.join(dir, 'central-credential.bin'));
    expect(onDisk.toString('utf8')).not.toContain(server.token);
    expect(JSON.stringify(svc.status())).not.toContain(server.token);
    expect(svc.status().credentialConfigured).toBe(true);
    expect(readFileSync(path.join(dir, 'central-config.json'), 'utf8')).not.toContain(server.token);
    // survives a restart
    expect(make().status().credentialConfigured).toBe(true);
  });
  it('warns when OS encryption is unavailable', async () => {
    const svc = await configured({ secrets: { ...secrets, available: false } });
    expect(svc.warnings().join(' ')).toMatch(/encryption is not available/);
  });
});

describe('manifest', () => {
  it('loads rounds, games and scoring versions and flags mismatches', async () => {
    const svc = await configured();
    expect(svc.status().manifest?.rounds.map((r) => r.roundId)).toEqual(['heats', 'final']);
    expect(svc.warnings()).toEqual([]);
    svc.updateConfig({ roundId: 'semi' });
    expect(svc.warnings().join(' ')).toMatch(/Round "semi" is not in the latest manifest/);
    svc.updateConfig({ roundId: 'heats', scoringVersion: 'danceoff-points-v9' });
    expect(svc.warnings().join(' ')).toMatch(/not approved/);
  });
  it('rejects a manifest for another competition', async () => {
    const svc = await configured();
    server.competitionId = 'other';
    svc.updateConfig({ competitionId: 'comp-2026' });
    await expect(svc.refreshManifest()).rejects.toThrow();
  });
  it('test connection reports the result', async () => {
    const svc = await configured();
    expect((await svc.testConnection()).ok).toBe(true);
    svc.setCredential('wrong-credential');
    const r = await svc.testConnection();
    expect(r.ok).toBe(false);
    expect(svc.status().connection).toBe('auth-failed');
  });
});

describe('participant selection', () => {
  it('resolves a code, waits for confirmation, and exposes only the name to the participant screen', async () => {
    const players: unknown[] = [];
    const svc = await configured({ onPlayersChange: (v) => players.push(v) });
    const cand = await svc.resolve(1, 'https://reg.example.com/p?code=ADA-1');
    expect(cand.participant.participantId).toBe('p-ada');
    expect(svc.playersView().slots).toEqual([]); // not official until confirmed
    svc.confirm(1);
    expect(svc.playersView()).toEqual({ official: true, slots: [{ slot: 1, displayName: 'Ada', offline: false }] });
    expect(players.length).toBe(1);
  });
  it('unknown and inactive codes never create an identity', async () => {
    const svc = await configured();
    await expect(svc.resolve(1, 'NOPE')).rejects.toThrow(/Unknown registration code/);
    await expect(svc.resolve(1, 'GONE-3')).rejects.toThrow(/withdrawn/);
    expect(() => svc.confirm(1)).toThrow(/Resolve a registration code first/);
    expect(Object.keys(svc.store.state.participants)).toEqual([]);
  });
  it('does not allow one participant in both slots unless the manifest allows it', async () => {
    const svc = await configured();
    await confirmPlayer(svc, 1, 'ADA-1');
    await svc.resolve(2, 'ADA-1');
    expect(() => svc.confirm(2)).toThrow(/cannot play both slots/);
    server.manifestConfig = { allowSameParticipantMultipleSlots: true };
    await svc.refreshManifest();
    svc.confirm(2);
    expect(svc.playersView().slots.length).toBe(2);
  });
  it('resolves each slot independently', async () => {
    const svc = await configured();
    await confirmPlayer(svc, 2, 'BOLA-2');
    await confirmPlayer(svc, 1, 'ADA-1');
    expect(svc.status().slots.map((s) => [s.slot, s.participantId]).sort()).toEqual([
      [1, 'p-ada'],
      [2, 'p-bola'],
    ]);
    svc.clearSlot(2);
    expect(svc.status().slots.map((s) => s.slot)).toEqual([1]);
  });
  it('play again keeps the participant; next player clears it', async () => {
    const svc = await configured();
    await confirmPlayer(svc, 1, 'ADA-1');
    const [a] = svc.recordSession(session([attempt(1, 900)]));
    const [b] = svc.recordSession(session([attempt(1, 1200)])); // play again
    svc.clearAll(); // next player
    const [c] = svc.recordSession(session([attempt(1, 500)]));
    const r = svc.store.state.results;
    expect(r[a!]!.revisions[0]!.body.participantId).toBe('p-ada');
    expect(r[b!]!.revisions[0]!.body.participantId).toBe('p-ada');
    expect(r[c!]!.revisions).toEqual([]);
    expect(r[c!]!.unresolved).not.toBeNull();
  });
});

describe('offline participant cache', () => {
  it('uses a previously verified participant when the registry is unreachable, and says so', async () => {
    const svc = await configured();
    await svc.resolve(1, 'ADA-1');
    svc.clearAll();
    server.fail('/api/v1/competitions', { status: 503 });
    const cand = await svc.resolve(1, 'ADA-1');
    expect(cand.offline).toBe(true);
    expect(cand.participant.participantId).toBe('p-ada');
    expect(svc.status().connection).toBe('offline');
  });
  it('refuses codes never verified on this booth, and refuses all when the policy is deny', async () => {
    const svc = await configured();
    await svc.resolve(1, 'ADA-1');
    server.fail('/api/v1/competitions', { status: 503 });
    await expect(svc.resolve(2, 'BOLA-2')).rejects.toThrow(/cannot be used offline/);
    svc.updateConfig({ offlinePolicy: 'deny' });
    server.fail('/api/v1/competitions', { status: 503 });
    await expect(svc.resolve(1, 'ADA-1')).rejects.toThrow(/offline policy/);
  });
  it('stores only a hash of the code', async () => {
    const svc = await configured();
    await svc.resolve(1, 'ADA-1');
    expect(readFileSync(path.join(dir, 'central-store.json'), 'utf8')).not.toContain('ADA-1');
  });
});

describe('recording results', () => {
  it('creates one result per participant: new UUID, revision 1, raw integer points, scope frozen at completion', async () => {
    const svc = await configured();
    await confirmPlayer(svc, 1, 'ADA-1');
    await confirmPlayer(svc, 2, 'BOLA-2');
    const ids = svc.recordSession(session([attempt(1, 1234.4), attempt(2, 980)]));
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f-]{36}$/);
    svc.updateConfig({ roundId: 'final' }); // later operator change must not touch the queued results
    const bodies = ids.map((id) => svc.store.state.results[id]!.revisions[0]!.body);
    expect(bodies.map((b) => [b.participantId, b.points, b.revision, b.status, b.roundId, b.scoringVersion])).toEqual([
      ['p-ada', 1234, 1, 'valid', 'heats', 'danceoff-points-v3'],
      ['p-bola', 980, 1, 'valid', 'heats', 'danceoff-points-v3'],
    ]);
    expect(bodies.every((b) => Number.isInteger(b.points))).toBe(true);
    expect(JSON.stringify(bodies)).not.toMatch(/percent/i);
  });
  it('writes the result and its outbound message together, durably', async () => {
    const svc = await configured();
    await confirmPlayer(svc, 1, 'ADA-1');
    const [id] = svc.recordSession(session([attempt(1, 700)]));
    const reopened = new CentralStore(path.join(dir, 'central-store.json')).state;
    expect(reopened.results[id!]!.revisions).toHaveLength(1);
    expect(reopened.outbox.filter((e) => e.resultId === id && e.state === 'pending')).toHaveLength(1);
    expect(reopened.outbox[0]!.messageId).toBe(reopened.results[id!]!.revisions[0]!.messageId);
  });
  it('keeps the legacy feed mapping (recordId / uid)', async () => {
    const svc = await configured();
    await confirmPlayer(svc, 1, 'ADA-1');
    const s = session([attempt(1, 700)]);
    const [id] = svc.recordSession(s);
    expect(svc.store.state.results[id!]!.legacy).toEqual({ recordId: s.recordId, uid: 'booth-1:ev:p1', localPlayerId: 'local-1' });
    expect(svc.store.state.results[id!]!.revisions[0]!.body.metadata.legacyRecordId).toBe(s.recordId);
  });
  it('records nothing when the competition or round is not set', async () => {
    const svc = await configured();
    svc.updateConfig({ roundId: '' });
    expect(svc.recordSession(session([attempt(1, 10)]))).toEqual([]);
    expect(svc.warnings().join(' ')).toMatch(/not set/);
  });
  it('allocates strictly increasing sourceSequence across restarts', async () => {
    let svc = await configured();
    await confirmPlayer(svc, 1, 'ADA-1');
    svc.recordSession(session([attempt(1, 1)]));
    svc.recordSession(session([attempt(1, 2)]));
    svc = make();
    await confirmPlayer(svc, 1, 'ADA-1');
    svc.recordSession(session([attempt(1, 3)]));
    expect(svc.store.state.outbox.map((e) => e.sourceSequence)).toEqual([1, 2, 3]);
  });
});

describe('unresolved local sessions', () => {
  it('are kept locally, never sent, and sent once an operator assigns a participant', async () => {
    const svc = await configured();
    const [id] = svc.recordSession(session([attempt(1, 640)]));
    expect(await svc.sendDue()).toBe(0);
    expect(server.resultPosts()).toHaveLength(0);
    expect(svc.status().counts.unresolved).toBe(1);
    await expect(svc.resolveUnresolved(id!, 'NOPE')).rejects.toThrow(/Unknown/);
    expect(await svc.resolveUnresolved(id!, 'BOLA-2')).toBe('Bola');
    expect(await svc.sendDue()).toBe(1);
    const sent = server.resultPosts()[0]!.result;
    expect(sent).toMatchObject({ resultId: id, revision: 1, participantId: 'p-bola', points: 640 });
    await expect(svc.resolveUnresolved(id!, 'ADA-1')).rejects.toThrow(/not waiting/);
  });
});

describe('delivery', () => {
  it('sends in sequence order with the Bearer credential and records the acknowledgement', async () => {
    const svc = await configured();
    await confirmPlayer(svc, 1, 'ADA-1');
    await confirmPlayer(svc, 2, 'BOLA-2');
    svc.recordSession(session([attempt(1, 100), attempt(2, 200)]));
    expect(await svc.sendDue()).toBe(2);
    const posts = server.requests.filter((r) => r.path === '/api/v1/result-events');
    expect(posts.every((p) => p.auth === `Bearer ${server.token}`)).toBe(true);
    const msgs = server.resultPosts();
    expect(msgs.map((m) => m.sourceSequence)).toEqual([1, 2]);
    expect(msgs[0]).toMatchObject({ protocol: 'event-results', version: 1, sourceId: 'booth-1' });
    const st = svc.status();
    expect(st.counts).toMatchObject({ pending: 0, delivered: 2 });
    expect(st.lastAckAt).toBe(new Date(clock).toISOString());
    expect(svc.store.state.outbox.map((e) => e.outcome)).toEqual(['accepted', 'accepted']);
  });
  it('retries transient failures with identical bytes, exponential backoff and Retry-After', async () => {
    const svc = await configured();
    await confirmPlayer(svc, 1, 'ADA-1');
    svc.recordSession(session([attempt(1, 100)]));
    server.fail('/api/v1/result-events', { status: 503 });
    expect(await svc.sendDue()).toBe(0);
    let e = svc.store.state.outbox[0]!;
    expect(e.state).toBe('pending');
    expect(Date.parse(e.nextAttemptAt) - clock).toBe(2000); // 2 s * 2^0 * jitter 1
    expect(await svc.sendDue()).toBe(0); // not due yet: nothing sent
    clock += 2000;
    server.fail('/api/v1/result-events', { status: 429, headers: { 'Retry-After': '30' } });
    await svc.sendDue();
    e = svc.store.state.outbox[0]!;
    expect(Date.parse(e.nextAttemptAt) - clock).toBe(30_000); // Retry-After beats the 4 s backoff
    clock += 30_000;
    expect(await svc.sendDue()).toBe(1);
    const bodies = server.requests.filter((r) => r.path === '/api/v1/result-events').map((r) => r.body);
    expect(bodies).toHaveLength(3);
    expect(new Set(bodies).size).toBe(1);
  });
  it('caps backoff at five minutes', async () => {
    const svc = await configured();
    await confirmPlayer(svc, 1, 'ADA-1');
    svc.recordSession(session([attempt(1, 100)]));
    for (let i = 0; i < 12; i++) {
      server.fail('/api/v1/result-events', { status: 500 });
      await svc.sendDue();
      clock = Date.parse(svc.store.state.outbox[0]!.nextAttemptAt);
    }
    const e = svc.store.state.outbox[0]!;
    expect(e.attempts).toBe(12);
    expect(Date.parse(e.nextAttemptAt) - Date.parse(e.lastAttemptAt!)).toBe(300_000);
  });
  it('treats duplicate acknowledgements as delivered (lost ack, restart)', async () => {
    let svc = await configured();
    await confirmPlayer(svc, 1, 'ADA-1');
    svc.recordSession(session([attempt(1, 100)]));
    await svc.sendDue();
    // Simulate a crash before the ack was saved: put the message back to pending.
    svc.store.transaction((d) => {
      d.outbox[0]!.state = 'pending';
    });
    svc = make();
    expect(await svc.sendDue()).toBe(1);
    expect(svc.store.state.outbox[0]!.outcome).toBe('duplicate');
    expect(server.results.size).toBe(1);
  });
  it('rejects an acknowledgement that does not match the message', async () => {
    const svc = await configured();
    await confirmPlayer(svc, 1, 'ADA-1');
    svc.recordSession(session([attempt(1, 100)]));
    server.badAckOnce = true;
    expect(await svc.sendDue()).toBe(0);
    expect(svc.store.state.outbox[0]!.state).toBe('pending');
  });
  it('pauses on rejected credentials without a retry storm, and resumes with a new credential', async () => {
    const svc = await configured();
    await confirmPlayer(svc, 1, 'ADA-1');
    svc.recordSession(session([attempt(1, 100)]));
    svc.setCredential('a-wrong-credential');
    expect(await svc.sendDue()).toBe(0);
    expect(await svc.sendDue()).toBe(0);
    expect(server.requests.filter((r) => r.path === '/api/v1/result-events')).toHaveLength(1);
    expect(svc.status().connection).toBe('auth-failed');
    expect(svc.store.state.outbox[0]!.state).toBe('pending');
    svc.setCredential(server.token);
    expect(await svc.sendDue()).toBe(1);
  });
  it('blocks permanent failures for the operator and keeps sending the rest', async () => {
    const svc = await configured();
    await confirmPlayer(svc, 1, 'ADA-1');
    await confirmPlayer(svc, 2, 'BOLA-2');
    const [first] = svc.recordSession(session([attempt(1, 100), attempt(2, 200)]));
    server.fail('/api/v1/result-events', { status: 422, body: { error: 'participant not in round' } });
    expect(await svc.sendDue()).toBe(1);
    expect(svc.status().counts).toMatchObject({ blocked: 1, delivered: 1 });
    const row = svc.status().recent.find((r) => r.resultId === first)!;
    expect(row.state).toBe('blocked');
    expect(row.lastError).toMatch(/participant not in round/);
    expect(logs.some((l) => l.startsWith('error') && l.includes(first!))).toBe(true);
    svc.retry(first);
    expect(await svc.sendDue()).toBe(1);
    expect(svc.status().counts).toMatchObject({ blocked: 0, delivered: 2 });
  });
});

describe('corrections and voids', () => {
  it('are new revisions of the same result with the same identity and scope', async () => {
    const svc = await configured();
    await confirmPlayer(svc, 1, 'ADA-1');
    const [id] = svc.recordSession(session([attempt(1, 100)]));
    svc.editResult({ kind: 'correct', resultId: id!, points: 150 });
    svc.editResult({ kind: 'void', resultId: id! });
    expect(() => svc.editResult({ kind: 'correct', resultId: id!, points: 1 })).toThrow(/void/);
    expect(await svc.sendDue()).toBe(3);
    const sent = server.resultPosts().map((m) => m.result);
    expect(sent.map((r) => [r.resultId, r.revision, r.points, r.status, r.participantId])).toEqual([
      [id, 1, 100, 'valid', 'p-ada'],
      [id, 2, 150, 'valid', 'p-ada'],
      [id, 3, 150, 'void', 'p-ada'],
    ]);
    expect(server.results.get(id!)!.revision).toBe(3);
  });
  it('stale acknowledgements are recorded, not retried', async () => {
    const svc = await configured();
    await confirmPlayer(svc, 1, 'ADA-1');
    const [id] = svc.recordSession(session([attempt(1, 100)]));
    svc.editResult({ kind: 'correct', resultId: id!, points: 150 });
    // The server already has revision 2 (e.g. from another path): revision 1 arrives late.
    const rev2 = svc.store.state.results[id!]!.revisions[1]!;
    server.results.set(id!, { revision: 2, hash: rev2.contentHash, body: rev2.body as unknown as Record<string, unknown> });
    expect(await svc.sendDue()).toBe(2);
    expect(svc.store.state.outbox.map((e) => e.outcome)).toEqual(['stale', 'duplicate']);
  });
});

describe('reconciliation', () => {
  it('re-submits what the server is missing and reports completion', async () => {
    const svc = await configured();
    await confirmPlayer(svc, 1, 'ADA-1');
    const [a] = svc.recordSession(session([attempt(1, 100)]));
    svc.recordSession(session([attempt(1, 200)]));
    await svc.sendDue();
    server.results.delete(a!); // server lost one
    server.seenMessages.clear();
    const r = await svc.reconcile();
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/2 results compared, 1 missing on server \(1 re-queued\), 0 conflicts/);
    expect(await svc.sendDue()).toBe(1);
    expect(server.results.has(a!)).toBe(true);
    expect(svc.status().lastReconcileAt).not.toBeNull();
    const body = JSON.parse(server.requests.find((q) => q.path.endsWith('/reconciliation'))!.body);
    expect(body).toMatchObject({ protocol: 'event-results', version: 1, sourceId: 'booth-1', page: 0, final: true });
    expect(body.items[0]).toHaveProperty('contentHash');
  });
  it('flags conflicts for the operator and never voids anything', async () => {
    const svc = await configured();
    await confirmPlayer(svc, 1, 'ADA-1');
    const [a] = svc.recordSession(session([attempt(1, 100)]));
    await svc.sendDue();
    server.results.set(a!, { revision: 1, hash: 'different', body: {} });
    const r = await svc.reconcile();
    expect(r.ok).toBe(false);
    expect(svc.status().conflicts[0]!.resultId).toBe(a);
    expect(svc.store.state.results[a!]!.revisions).toHaveLength(1);
  });
  it('fails when the server does not confirm completion', async () => {
    const svc = await configured();
    server.reconcileOverride = (q) => ({ runId: q.runId, missing: [], conflicts: [] });
    const r = await svc.reconcile();
    expect(r.ok).toBe(false);
    expect(svc.status().lastReconcileAt).toBeNull();
  });
  it('pages large inventories', async () => {
    const svc = await configured();
    await confirmPlayer(svc, 1, 'ADA-1');
    for (let i = 0; i < 450; i++) svc.recordSession(session([attempt(1, i)]));
    await svc.sendDue();
    await svc.reconcile();
    const pages = server.requests.filter((q) => q.path.endsWith('/reconciliation')).map((q) => JSON.parse(q.body));
    expect(pages.map((p) => [p.page, p.items.length, p.final])).toEqual([
      [0, 200, false],
      [1, 200, false],
      [2, 50, true],
    ]);
    expect(new Set(pages.map((p) => p.runId)).size).toBe(1);
  }, 30_000);
});

describe('store', () => {
  it('migrates an unversioned store and refuses a newer one', () => {
    const m = migrateStore({ nextSequence: 5, results: {} });
    expect(m.schemaVersion).toBe(STORE_SCHEMA_VERSION);
    expect(m.nextSequence).toBe(5);
    expect(m.outbox).toEqual([]);
    expect(() => migrateStore({ schemaVersion: STORE_SCHEMA_VERSION + 1 })).toThrow(/newer/);
  });
  it('falls back to the backup when the main file is corrupt', async () => {
    const svc = await configured();
    await confirmPlayer(svc, 1, 'ADA-1');
    svc.recordSession(session([attempt(1, 1)]));
    svc.recordSession(session([attempt(1, 2)]));
    writeFileSync(path.join(dir, 'central-store.json'), '{ truncated');
    const s = new CentralStore(path.join(dir, 'central-store.json')).state;
    expect(Object.keys(s.results).length).toBe(1); // the .bak from before the last write
  });
  it('prunes only delivered history past retention', async () => {
    const svc = await configured();
    await confirmPlayer(svc, 1, 'ADA-1');
    svc.recordSession(session([attempt(1, 1)]));
    await svc.sendDue();
    svc.recordSession(session([attempt(1, 2)])); // pending
    svc.clearAll();
    svc.recordSession(session([attempt(1, 3)])); // unresolved
    clock += 200 * 86_400_000;
    expect(svc.prune()).toBe(1);
    expect(Object.keys(svc.store.state.results)).toHaveLength(2);
  });
});

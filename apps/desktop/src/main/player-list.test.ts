import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizePlayerNumber, playerNumberDigits } from '@booth/contracts';
import { nameOrIdState } from '../renderer/participant/ui/NameEntry';
import { PlayerListCache, resolvePlayerEntries } from './player-list';

const file = () => path.join(mkdtempSync(path.join(tmpdir(), 'plist-')), 'player-list.json');

describe('player numbers', () => {
  it('are exactly 4 digits as text: leading zeros kept, spaces and dashes ignored', () => {
    expect(normalizePlayerNumber('0377')).toBe('0377');
    expect(normalizePlayerNumber(' 03-77 ')).toBe('0377');
    expect(normalizePlayerNumber('377')).toBeNull();
    expect(normalizePlayerNumber('03770')).toBeNull();
    expect(normalizePlayerNumber('03a7')).toBeNull();
    expect(playerNumberDigits('0 3')).toBe('03');
  });
});

describe('PlayerListCache', () => {
  it('has no list until the main leaderboard sends one', () => {
    const c = new PlayerListCache(file());
    expect(c.lookup('0377')).toEqual({ status: 'no-list', number: '0377' });
    expect(c.lookup('37')).toEqual({ status: 'invalid' });
  });

  it('replaces (never merges) the list on every registry message and persists it across restarts', () => {
    const f = file();
    const c = new PlayerListCache(f);
    c.replace({ competitionId: 'maltina_2026', title: 'Maltina Arcade Night', revision: 'r1', players: [{ code: '0377', name: 'Tolu Adeyemi', ref: 'CMTE' }, { code: '1204', name: 'Femi' }] });
    expect(c.lookup('0377')).toEqual({ status: 'known', number: '0377', name: 'Tolu Adeyemi' });
    // 0377 is not 377: a 3-digit entry never matches.
    expect(c.lookup('377')).toEqual({ status: 'invalid' });
    expect(c.status()).toMatchObject({ count: 2, title: 'Maltina Arcade Night' });
    c.replace({ revision: 'r2', players: [{ code: '1204', name: 'Femi O.' }] });
    expect(c.lookup('0377')).toEqual({ status: 'unknown', number: '0377' });
    expect(c.lookup('12 04')).toMatchObject({ status: 'known', name: 'Femi O.' });
    const again = new PlayerListCache(f);
    expect(again.lookup('1204')).toMatchObject({ status: 'known', name: 'Femi O.' });
    expect(JSON.parse(readFileSync(f, 'utf-8')).players).toEqual([{ number: '1204', name: 'Femi O.' }]);
  });

  it('skips entries that are not 4 digits, and rejects malformed messages keeping the old list', () => {
    const c = new PlayerListCache(file());
    expect(c.replace({ players: [{ code: '1204', name: 'Femi' }, { code: '377', name: 'Short' }] })).toBe(1);
    expect(() => c.replace({ players: 'nope' })).toThrow();
    expect(c.lookup('1204').status).toBe('known');
  });
});

describe('player entry with player numbers', () => {
  const c = new PlayerListCache(file());
  c.replace({ players: [{ code: '0377', name: 'Tolu Adeyemi' }] });
  const lookup = (n: string) => c.lookup(n);

  it('a known number plays under the registered name (whatever was typed)', () => {
    expect(resolvePlayerEntries([{ number: '0377', name: 'Typed' }], lookup)).toEqual([{ name: 'Tolu Adeyemi', number: '0377', recognised: true }]);
    expect(resolvePlayerEntries([{ number: '0377' }], lookup)[0]!.name).toBe('Tolu Adeyemi');
  });

  it('an unknown number is kept and still sent, with the typed name', () => {
    expect(resolvePlayerEntries([{ number: '9999', name: 'Femi' }], lookup)).toEqual([{ name: 'Femi', number: '9999', recognised: false }]);
    expect(() => resolvePlayerEntries([{ number: '9999' }], lookup)).toThrow(/name/i);
  });

  it('no number is a guest; a short number is refused', () => {
    expect(resolvePlayerEntries([{ name: 'Ada' }], lookup)).toEqual([{ name: 'Ada', recognised: false }]);
    expect(() => resolvePlayerEntries([{ number: '377', name: 'Ada' }], lookup)).toThrow(/4 digits/);
  });

  it('before any list arrives, numbers are kept for the main leaderboard to check', () => {
    const empty = new PlayerListCache(file());
    expect(resolvePlayerEntries([{ number: '0377', name: 'Tolu' }], (x) => empty.lookup(x))).toEqual([{ name: 'Tolu', number: '0377', recognised: false }]);
  });
});

describe('player entry screen states', () => {
  it('distinguishes names, complete IDs, partial IDs, and registry lookup results', () => {
    expect(nameOrIdState('Tolu Adeyemi', null).kind).toBe('name');
    expect(nameOrIdState('', null).kind).toBe('empty');
    expect(nameOrIdState('037', null).kind).toBe('partial-id');
    expect(nameOrIdState('0377', null).kind).toBe('checking');
    expect(nameOrIdState('0377', { status: 'known', number: '0377', name: 'Tolu Adeyemi' })).toEqual({ kind: 'known', message: 'Tolu Adeyemi · registered player' });
    expect(nameOrIdState('9999', { status: 'unknown', number: '9999' }).kind).toBe('unknown');
  });
});

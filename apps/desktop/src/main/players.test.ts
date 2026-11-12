import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PlayerRegistry } from './players';

const dir = mkdtempSync(path.join(tmpdir(), 'booth-players-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('PlayerRegistry', () => {
  it('assigns serial ids, distinct even for identical names', () => {
    const r = new PlayerRegistry(dir, 'ev1');
    expect(r.register(['Sam', 'Sam'])).toEqual([
      { playerId: 'player-001', name: 'Sam' },
      { playerId: 'player-002', name: 'Sam' },
    ]);
    expect(r.register(['Ada'])[0]!.playerId).toBe('player-003');
  });

  it('never reuses ids after a restart, even after names are cleared', () => {
    const again = new PlayerRegistry(dir, 'ev1');
    expect(again.nameOf('player-003')).toBe('Ada');
    again.clearNames();
    expect(again.has('player-001')).toBe(false);
    expect(new PlayerRegistry(dir, 'ev1').register(['Zoe'])[0]!.playerId).toBe('player-004');
  });

  it('numbers each event separately and survives a corrupt file', () => {
    expect(new PlayerRegistry(dir, 'ev2').register(['A'])[0]!.playerId).toBe('player-001');
    writeFileSync(path.join(dir, 'players-ev3.json'), '{ broken');
    // Ids already used in stored records are never handed out again.
    expect(new PlayerRegistry(dir, 'ev3', ['player-007']).register(['B'])[0]!.playerId).toBe('player-008');
  });
});

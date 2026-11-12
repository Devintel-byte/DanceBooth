import { describe, expect, it } from 'vitest';
import { IPC } from '@booth/contracts';
import { checkIpc } from './ipc-policy';

describe('IPC policy', () => {
  it('rejects unknown senders and wrong roles', () => {
    expect(checkIpc(IPC.operatorCommand, null, { type: 'abort' }).ok).toBe(false);
    expect(checkIpc(IPC.operatorCommand, 'participant', { type: 'abort' }).ok).toBe(false);
    expect(checkIpc(IPC.participantStatus, 'operator', {}).ok).toBe(false);
    expect(checkIpc(IPC.updateSettings, 'participant', { quality: 'low' }).ok).toBe(false);
  });

  it('accepts valid operator commands', () => {
    const r = checkIpc(IPC.operatorCommand, 'operator', { type: 'start', mode: 'duo', routineId: 'dev-groove' });
    expect(r.ok).toBe(true);
  });

  it.each([
    { type: 'rm-rf' },
    { type: 'start', mode: 'trio' },
    { type: 'start', mode: 'single', routineId: '../../x' },
    { type: 'select-camera', deviceId: 'x'.repeat(10_000) },
    null,
    'abort',
  ])('rejects malformed operator command %j', (payload) => {
    expect(checkIpc(IPC.operatorCommand, 'operator', payload).ok).toBe(false);
  });

  it('rejects settings patches with unknown keys or out-of-range values', () => {
    expect(checkIpc(IPC.updateSettings, 'operator', { quality: 'ultra' }).ok).toBe(false);
    expect(checkIpc(IPC.updateSettings, 'operator', { assetsDir: 'C:/' }).ok).toBe(false);
    expect(checkIpc(IPC.updateSettings, 'operator', { calibrationOffsetMs: 9999 }).ok).toBe(false);
    expect(checkIpc(IPC.updateSettings, 'operator', { tracking: { delegate: 'CPU' } }).ok).toBe(true);
  });

  it('rejects oversized log entries and arguments on no-arg channels', () => {
    expect(checkIpc(IPC.log, 'participant', { level: 'info', message: 'x'.repeat(5000) }).ok).toBe(false);
    expect(checkIpc(IPC.exportDiagnostics, 'operator', { path: 'C:/x' }).ok).toBe(false);
    expect(checkIpc(IPC.exportDiagnostics, 'operator', undefined).ok).toBe(true);
  });
});

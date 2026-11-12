import { describe, expect, it } from 'vitest';
import { effectiveCaptureBackend } from '@booth/contracts';
import { cameraAttempts, chooseCamera } from './camera-choice';

// Device list as enumerated on the development laptop (ids shortened).
const DEV_LAPTOP = [
  { deviceId: 'v1', label: 'Devintel 14C (Windows Virtual Camera)' },
  { deviceId: 'i1', label: 'Integrated Webcam (0bda:5673)' },
  { deviceId: 'o1', label: 'OBS Virtual Camera' },
];

describe('chooseCamera', () => {
  it('prefers the integrated webcam over virtual cameras listed first', () => {
    expect(chooseCamera(DEV_LAPTOP, null).deviceId).toBe('i1');
  });

  it('keeps the operator-selected camera when it is connected', () => {
    expect(chooseCamera(DEV_LAPTOP, 'o1')).toEqual({ deviceId: 'o1', reason: 'saved' });
  });

  it('falls back to the integrated webcam when the saved camera is gone', () => {
    expect(chooseCamera(DEV_LAPTOP, 'unplugged').deviceId).toBe('i1');
  });

  it('uses the first physical camera, then the system default', () => {
    expect(chooseCamera([{ deviceId: 'v', label: 'OBS Virtual Camera' }, { deviceId: 'u', label: 'Logitech BRIO' }], null).deviceId).toBe('u');
    expect(chooseCamera([{ deviceId: 'v', label: 'OBS Virtual Camera' }], null).deviceId).toBeNull();
  });
});

describe('cameraAttempts', () => {
  it('tries the configured size, then the Azure Kinect-friendly 1280x720, then the device default', () => {
    const a = cameraAttempts({ width: 960, height: 540, frameRate: 30 });
    expect(a.map((x) => x.label)).toEqual(['960x540@30 (preferred)', '1280x720@30', '1280x720 exact', 'device default']);
    expect(a.at(-1)!.video).toEqual({});
  });
  it('does not repeat 1280x720 when it is already the preference', () => {
    expect(cameraAttempts({ width: 1280, height: 720, frameRate: 30 })).toHaveLength(3);
  });
});

describe('Azure Kinect support', () => {
  it('finds a camera by its saved name when it comes back with a new id', () => {
    const list = [{ deviceId: 'i1', label: 'Integrated Webcam (0bda:555d)' }, { deviceId: 'k2', label: 'Azure Kinect 4K Camera' }];
    expect(chooseCamera(list, 'k1-old', 'Azure Kinect 4K Camera')).toEqual({ deviceId: 'k2', reason: 'saved camera (matched by name)' });
  });
  it('uses DirectShow for depth cameras in auto mode, and honours an explicit choice', () => {
    expect(effectiveCaptureBackend({ captureBackend: 'auto', label: 'Azure Kinect 4K Camera' })).toBe('directshow');
    expect(effectiveCaptureBackend({ captureBackend: 'auto', label: 'Orbbec Femto Bolt RGB' })).toBe('directshow');
    expect(effectiveCaptureBackend({ captureBackend: 'auto', label: 'Logitech BRIO' })).toBe('media-foundation');
    expect(effectiveCaptureBackend({ captureBackend: 'media-foundation', label: 'Azure Kinect 4K Camera' })).toBe('media-foundation');
    expect(effectiveCaptureBackend({ captureBackend: 'directshow', label: 'Logitech BRIO' })).toBe('directshow');
    expect(effectiveCaptureBackend(undefined)).toBe('media-foundation');
  });
});

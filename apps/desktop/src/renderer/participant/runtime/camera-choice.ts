export interface CameraOption {
  deviceId: string;
  label: string;
}

/** Software/virtual cameras that should never be picked automatically. */
const VIRTUAL = /virtual|obs|droidcam|snap camera|xsplit|manycam|epoccam|iriun|ndi|nvidia broadcast|phone link|windows virtual camera/i;
/** Labels typical of a laptop's built-in camera. */
const BUILT_IN = /integrated|built-?in|internal|facetime|hd (web)?cam|front camera|user facing/i;

/**
 * Picks the camera to open:
 * 1. the operator's saved device if it is still connected;
 * 2. otherwise the PC's integrated webcam;
 * 3. otherwise the first physical (non-virtual) camera;
 * 4. otherwise null, which lets the OS choose.
 * Device ids can change after driver updates or replugging, so a stale saved
 * id falls through to the defaults instead of failing.
 */
export function chooseCamera(cameras: readonly CameraOption[], savedId: string | null, savedLabel: string | null = null): { deviceId: string | null; reason: string } {
  if (savedId && cameras.some((c) => c.deviceId === savedId)) return { deviceId: savedId, reason: 'saved' };
  // Some devices (Azure Kinect) come back with a new id after a reset: find them by name.
  const byLabel = savedLabel ? cameras.find((c) => c.label === savedLabel) : undefined;
  if (byLabel) return { deviceId: byLabel.deviceId, reason: 'saved camera (matched by name)' };
  const physical = cameras.filter((c) => !VIRTUAL.test(c.label));
  const builtIn = physical.find((c) => BUILT_IN.test(c.label));
  if (builtIn) return { deviceId: builtIn.deviceId, reason: savedId ? 'saved camera missing; integrated webcam' : 'integrated webcam' };
  if (physical[0]) return { deviceId: physical[0].deviceId, reason: 'first physical camera' };
  return { deviceId: null, reason: 'system default' };
}

export interface CameraRequest {
  width: number;
  height: number;
  frameRate: number;
}

/**
 * The sizes to ask a camera for, in order. Most webcams accept the configured
 * size. Some devices only offer a few fixed modes and start slowly (Azure Kinect's
 * colour camera: 1280x720 and larger, nothing smaller); for those, ask for the
 * common 1280x720 mode exactly, then let the device pick its own default.
 */
export function cameraAttempts(want: CameraRequest): { label: string; video: MediaTrackConstraints }[] {
  const out: { label: string; video: MediaTrackConstraints }[] = [
    { label: `${want.width}x${want.height}@${want.frameRate} (preferred)`, video: { width: { ideal: want.width }, height: { ideal: want.height }, frameRate: { ideal: want.frameRate } } },
  ];
  if (want.width !== 1280 || want.height !== 720) {
    out.push({ label: '1280x720@30', video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } });
  }
  out.push({ label: '1280x720 exact', video: { width: { exact: 1280 }, height: { exact: 720 } } });
  out.push({ label: 'device default', video: {} });
  return out;
}

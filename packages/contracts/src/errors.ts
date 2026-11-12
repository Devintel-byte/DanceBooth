/** Stable error codes shared by main, renderers, logs and the operator console. */
export const ERROR_CODES = [
  'CAMERA_NOT_FOUND',
  'CAMERA_PERMISSION_DENIED',
  'CAMERA_IN_USE',
  'CAMERA_TIMEOUT',
  'CAMERA_DISCONNECTED',
  'MODEL_MISSING',
  'MODEL_INIT_FAILED',
  'TRACKING_WORKER_CRASHED',
  'AUDIO_LOAD_FAILED',
  'AUDIO_CONTEXT_FAILED',
  'CONTENT_INVALID',
  'CONTENT_MISSING',
  'RENDERER_CRASHED',
  'DISK_WRITE_FAILED',
  'IPC_REJECTED',
  'UNKNOWN',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface BoothError {
  code: ErrorCode;
  message: string;
  /** Whether automatic retry is allowed before escalating to maintenance. */
  recoverable: boolean;
  detail?: string;
}

/** Participant-facing text. Never contains technical detail. */
export const PARTICIPANT_MESSAGES: Record<ErrorCode, string> = {
  CAMERA_NOT_FOUND: 'The camera is taking a break. A team member will help you shortly.',
  CAMERA_PERMISSION_DENIED: 'The camera is not available right now. Please ask a team member.',
  CAMERA_IN_USE: 'The camera is busy. A team member will sort it out.',
  CAMERA_TIMEOUT: 'The camera is warming up slowly. Hang tight!',
  CAMERA_DISCONNECTED: 'We lost the camera. A team member is on it.',
  MODEL_MISSING: 'The dance tracker is unavailable. Please ask a team member.',
  MODEL_INIT_FAILED: 'The dance tracker could not start. Please ask a team member.',
  TRACKING_WORKER_CRASHED: 'The dance tracker hiccuped. Restarting...',
  AUDIO_LOAD_FAILED: 'The music could not load. Please ask a team member.',
  AUDIO_CONTEXT_FAILED: 'Sound is unavailable. Please ask a team member.',
  CONTENT_INVALID: 'This dance is unavailable right now.',
  CONTENT_MISSING: 'This dance is unavailable right now.',
  RENDERER_CRASHED: 'Restarting the stage...',
  DISK_WRITE_FAILED: 'Something went wrong. Please ask a team member.',
  IPC_REJECTED: 'Something went wrong. Please ask a team member.',
  UNKNOWN: 'Something went wrong. Please ask a team member.',
};

export function boothError(
  code: ErrorCode,
  message: string,
  recoverable = false,
  detail?: string,
): BoothError {
  return detail === undefined
    ? { code, message, recoverable }
    : { code, message, recoverable, detail };
}

/** Maps a getUserMedia DOMException name to a booth error code. */
export function cameraErrorCode(domExceptionName: string): ErrorCode {
  switch (domExceptionName) {
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'CAMERA_NOT_FOUND';
    case 'NotAllowedError':
    case 'SecurityError':
      return 'CAMERA_PERMISSION_DENIED';
    case 'NotReadableError':
    case 'AbortError':
      return 'CAMERA_IN_USE';
    default:
      return 'UNKNOWN';
  }
}

/**
 * Canonical body landmark definitions.
 *
 * Indices follow the 33-point BlazePose topology produced by MediaPipe Pose
 * Landmarker, so webcam results need no re-indexing. Other tracking providers
 * must map into this topology before results enter the app.
 *
 * "left"/"right" are always the tracked person's anatomical sides, never the
 * side of the image they appear on.
 */
export const LANDMARK = {
  nose: 0,
  leftEyeInner: 1,
  leftEye: 2,
  leftEyeOuter: 3,
  rightEyeInner: 4,
  rightEye: 5,
  rightEyeOuter: 6,
  leftEar: 7,
  rightEar: 8,
  mouthLeft: 9,
  mouthRight: 10,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftPinky: 17,
  rightPinky: 18,
  leftIndex: 19,
  rightIndex: 20,
  leftThumb: 21,
  rightThumb: 22,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftFootIndex: 31,
  rightFootIndex: 32,
} as const;

export type LandmarkName = keyof typeof LANDMARK;
export const LANDMARK_COUNT = 33;

export interface Landmark {
  x: number;
  y: number;
  z: number;
  /** Probability the landmark is visible (not occluded), 0..1, when the provider supplies it. */
  visibility?: number;
  /** Probability the landmark is present in the frame, 0..1, when the provider supplies it. */
  presence?: number;
}

/**
 * Coordinate spaces are explicit so image and world estimates are never mixed.
 *
 * - `image-normalized`: x right, y DOWN, both 0..1 of the source frame as captured
 *   (NOT mirrored). z is relative depth with roughly the scale of x.
 * - `world-meters`: provider-estimated metric coordinates centred on the hips.
 */
export type CoordinateSpace = 'image-normalized' | 'world-meters';

/** Virtual joints derived from pairs of landmarks. */
export type VirtualJoint = 'hipCenter' | 'shoulderCenter';
export type JointName = LandmarkName | VirtualJoint;

/**
 * Body segments used by scoring and retargeting. Each is a directed bone
 * from `from` to `to`, named after the anatomical side.
 */
export const SEGMENTS = {
  leftUpperArm: ['leftShoulder', 'leftElbow'],
  leftForearm: ['leftElbow', 'leftWrist'],
  rightUpperArm: ['rightShoulder', 'rightElbow'],
  rightForearm: ['rightElbow', 'rightWrist'],
  leftThigh: ['leftHip', 'leftKnee'],
  leftShin: ['leftKnee', 'leftAnkle'],
  rightThigh: ['rightHip', 'rightKnee'],
  rightShin: ['rightKnee', 'rightAnkle'],
  torso: ['hipCenter', 'shoulderCenter'],
} as const satisfies Record<string, readonly [JointName, JointName]>;

export type SegmentName = keyof typeof SEGMENTS;
export const SEGMENT_NAMES = Object.keys(SEGMENTS) as SegmentName[];

/** Swaps the anatomical side in a segment name (used for mirror mode). */
export function mirrorSegmentName(name: SegmentName): SegmentName {
  if (name.startsWith('left')) return ('right' + name.slice(4)) as SegmentName;
  if (name.startsWith('right')) return ('left' + name.slice(5)) as SegmentName;
  return name;
}

export const JOINT_GROUPS = {
  arms: ['leftUpperArm', 'leftForearm', 'rightUpperArm', 'rightForearm'],
  legs: ['leftThigh', 'leftShin', 'rightThigh', 'rightShin'],
  torso: ['torso'],
} as const satisfies Record<string, readonly SegmentName[]>;

export type JointGroup = keyof typeof JOINT_GROUPS;
export const JOINT_GROUP_NAMES = Object.keys(JOINT_GROUPS) as JointGroup[];

/**
 * A 2D direction in "display space": x to the viewer's right, y UP.
 * Unit length when valid.
 */
export interface Direction2 {
  x: number;
  y: number;
}

/** A body pose expressed as display-space segment directions. */
export type SegmentPose = Partial<Record<SegmentName, Direction2>>;

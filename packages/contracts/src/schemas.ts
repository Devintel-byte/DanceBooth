import { z } from 'zod';
import { ERROR_CODES } from './errors';
import { JOINT_GROUP_NAMES, SEGMENT_NAMES, type JointGroup, type SegmentName } from './landmarks';

/** Content asset paths are relative, forward-slash, and may not escape the assets root. */
export const assetPathSchema = z
  .string()
  .min(1)
  .max(260)
  .regex(/^[A-Za-z0-9_\-./]+$/, 'asset paths may only contain letters, digits, _ - . /')
  .refine((p) => !p.startsWith('/') && !p.split('/').includes('..'), {
    message: 'asset paths must be relative and must not contain ".."',
  });

export const slugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'ids are lowercase letters, digits and dashes');

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'colours are #rrggbb');
const sha256 = z.string().regex(/^[0-9a-f]{64}$/, 'sha256 must be 64 lowercase hex chars');

const segmentNameSchema = z.enum(SEGMENT_NAMES as [SegmentName, ...SegmentName[]]);
const jointGroupSchema = z.enum(JOINT_GROUP_NAMES as [JointGroup, ...JointGroup[]]);

/** A display-space direction [x, y] (x right, y up). Normalised on load. */
const directionSchema = z
  .tuple([z.number().finite(), z.number().finite()])
  .refine(([x, y]) => Math.hypot(x, y) > 1e-6, { message: 'direction must be non-zero' });

export const difficultySchema = z.enum(['easy', 'normal', 'hard']);
export type Difficulty = z.infer<typeof difficultySchema>;

const licenseEntrySchema = z.object({
  source: z.string().min(1),
  license: z.string().min(1),
  attribution: z.string().optional(),
  /** True when the item is development placeholder content, not approved production content. */
  placeholder: z.boolean(),
});

export const routineMoveSchema = z.object({
  /** Song time at which the instructor hits this pose. */
  timeSec: z.number().nonnegative(),
  /** Optional name shown in debug/tutorial UI. */
  label: z.string().max(40).optional(),
  /** Whether this keyframe is judged; transition keyframes can be animation-only. */
  judged: z.boolean().default(true),
  /** Instructor pose as rendered facing the viewer: segment -> [x, y] display-space direction. */
  pose: z.partialRecord(segmentNameSchema, directionSchema),
});
export type RoutineMove = z.infer<typeof routineMoveSchema>;

/**
 * One clip played over a song-time span. Clip time =
 * clipOffsetSec + (songTime - startSec) * timeScale, looped over the clip.
 */
export const animationSegmentSchema = z
  .object({
    clip: z.string().min(1).max(80),
    startSec: z.number().nonnegative(),
    endSec: z.number().positive(),
    timeScale: z.number().positive().max(4).default(1),
    clipOffsetSec: z.number().nonnegative().default(0),
    /** Cross-fade into this segment, seconds. */
    blendSec: z.number().nonnegative().max(2).default(0.25),
  })
  .refine((s) => s.endSec > s.startSec, { message: 'segment must end after it starts' });
export type AnimationSegment = z.infer<typeof animationSegmentSchema>;

export const routineManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: slugSchema,
    contentVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    title: z.string().min(1).max(60),
    subtitle: z.string().max(80).optional(),
    audio: z.object({
      file: assetPathSchema,
      /** Audio offset applied on top of the global calibration offset. */
      offsetMs: z.number().default(0),
    }),
    animation: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('procedural-keyframes') }),
      z.object({
        kind: z.literal('glb-timeline'),
        /** Character (catalog id) whose clips are played; clips may also come from `clipFiles`. */
        character: slugSchema,
        /** Extra animation-only GLB/FBX files (e.g. Mixamo "without skin" exports). */
        clipFiles: z.array(assetPathSchema).default([]),
        segments: z.array(animationSegmentSchema).min(1),
      }),
    ]),
    durationSec: z.number().positive().max(600),
    bpm: z.number().positive().max(300).optional(),
    /** Song time of the first beat; used for beat cues. */
    firstBeatSec: z.number().nonnegative().default(0),
    sections: z
      .array(z.object({ name: z.string().min(1), startSec: z.number().nonnegative() }))
      .default([]),
    difficulty: difficultySchema,
    /**
     * `mirror`: participants copy the instructor like a mirror (instructor's right arm ->
     * participant's left arm). `same-side`: participants use the same anatomical side.
     */
    mirroring: z.enum(['mirror', 'same-side']),
    requiredGroups: z.array(jointGroupSchema).min(1),
    moves: z.array(routineMoveSchema).min(1),
    /**
     * Alternative choreographies for the same song (glb-timeline only). The
     * booth plays a different one each session; `animation.segments` and
     * `moves` above are the default (used for attract and previews).
     */
    variations: z
      .array(
        z.object({
          segments: z.array(animationSegmentSchema).min(1),
          moves: z.array(routineMoveSchema).min(1),
        }),
      )
      .max(32)
      .default([]),
    license: z.object({
      audio: licenseEntrySchema,
      choreography: licenseEntrySchema,
    }),
    /** Optional integrity hashes keyed by asset path. */
    integrity: z.record(assetPathSchema, sha256).default({}),
  })
  .superRefine((m, ctx) => {
    const checkMoves = (moves: readonly { timeSec: number }[], base: (string | number)[]) => {
      let last = -1;
      moves.forEach((move, i) => {
        if (move.timeSec <= last) {
          ctx.addIssue({
            code: 'custom',
            path: [...base, i, 'timeSec'],
            message: 'moves must be in strictly increasing time order',
          });
        }
        if (move.timeSec > m.durationSec) {
          ctx.addIssue({
            code: 'custom',
            path: [...base, i, 'timeSec'],
            message: 'move is after the end of the routine',
          });
        }
        last = move.timeSec;
      });
    };
    checkMoves(m.moves, ['moves']);
    m.variations.forEach((v, i) => checkMoves(v.moves, ['variations', i, 'moves']));
    if (m.variations.length > 0 && m.animation.kind !== 'glb-timeline') {
      ctx.addIssue({ code: 'custom', path: ['variations'], message: 'variations need a glb-timeline animation' });
    }
  });
export type RoutineManifest = z.infer<typeof routineManifestSchema>;

export const paletteSchema = z.object({
  id: slugSchema,
  name: z.string().min(1).max(30),
  primary: hexColor,
  secondary: hexColor,
  accent: hexColor,
  skin: hexColor,
});
export type Palette = z.infer<typeof paletteSchema>;

const boneNameSchema = z.string().min(1).max(64);

/** How a rigged GLB maps onto the canonical segments and palette slots. */
export const characterRigSchema = z.object({
  /** Segment -> [from bone, to bone]; used to extract scoring poses from clips. */
  boneMap: z.partialRecord(segmentNameSchema, z.tuple([boneNameSchema, boneNameSchema])),
  /** Palette field -> material names to recolour. */
  materialSlots: z.partialRecord(z.enum(['primary', 'secondary', 'accent', 'skin']), z.array(z.string().min(1)).min(1)),
  /** Uniform scale so the character is ~1.75 units tall (ignored when heightM is set). */
  scale: z.number().positive().default(1),
  /**
   * Standing height in metres. When set, the scale is worked out from the
   * model's bind-pose bounds on load, so a new Mixamo download needs no tuning.
   */
  heightM: z.number().min(0.5).max(3).optional(),
  /** Rotation about Y (degrees) so the character faces +Z (the camera). */
  yawDeg: z.number().default(0),
  clips: z.object({
    idle: z.string().min(1),
    celebrate: z.string().min(1).optional(),
  }),
  /**
   * Clip files the character needs outside a routine (idle, celebrate), e.g.
   * Mixamo "without skin" FBX exports. Loaded together with a routine's clipFiles.
   */
  clipFiles: z.array(assetPathSchema).default([]),
});

export const characterSchema = z
  .object({
    id: slugSchema,
    displayName: z.string().min(1).max(30),
    /** Rigged GLB or FBX model (the only kind; the procedural stick figure was removed). */
    kind: z.literal('glb'),
    file: assetPathSchema,
    /** Square PNG portrait shown on the character-select card (rendered from the model). */
    thumbnail: assetPathSchema.optional(),
    rig: characterRigSchema,
    palettes: z.array(paletteSchema).min(1),
    placeholder: z.boolean(),
    license: z.object({ source: z.string().min(1), license: z.string().min(1) }).optional(),
    /**
     * The model is downloaded separately (e.g. from Mixamo with the client's
     * account). Until its file is present the character is hidden, not an error.
     */
    optional: z.boolean().default(false),
  });
export type CharacterPreset = z.infer<typeof characterSchema>;

export const characterCatalogSchema = z.object({
  schemaVersion: z.literal(1),
  characters: z.array(characterSchema).min(1),
});
export type CharacterCatalog = z.infer<typeof characterCatalogSchema>;

export const sessionRulesSchema = z.object({
  attractAfterIdleSec: z.number().positive().default(45),
  selectionTimeoutSec: z.number().positive().default(30),
  /** Name entry needs longer than a single selection. */
  nameEntryTimeoutSec: z.number().positive().default(90),
  /**
   * Safety cap on calibration while someone is in view (e.g. a bystander far
   * behind the player). Calibration never ends early while a player is trying.
   */
  calibrationTimeoutSec: z.number().positive().default(180),
  /** After this long without being ready, players are offered "Press START to dance anyway". */
  calibrationHelpSec: z.number().positive().default(15),
  /** Calibration returns to the start only after nobody has been in view for this long. */
  calibrationAwaySec: z.number().positive().default(25),
  tutorialSec: z.number().nonnegative().default(6),
  countdownSec: z.number().int().min(1).max(10).default(3),
  resultsDisplaySec: z.number().positive().default(15),
  /** How long a player may be untracked before the participant is prompted. */
  trackingLostGraceSec: z.number().nonnegative().default(1.5),
  /** How long all players may be untracked before the session pauses. */
  trackingLostPauseSec: z.number().positive().default(5),
  /** How long a paused session waits before it is aborted back to attract. */
  pausedAbortSec: z.number().positive().default(30),
});
export type SessionRules = z.infer<typeof sessionRulesSchema>;

export const themeColorsSchema = z.object({
  brandOrange: hexColor,
  brandOrangeDark: hexColor,
  brandGold: hexColor,
  brandGoldLight: hexColor,
  surfacePage: hexColor,
  surfaceCard: hexColor,
  surfaceWarm: hexColor,
  textPrimary: hexColor,
  textSecondary: hexColor,
  borderSubtle: hexColor,
  stageBackground: hexColor,
  stagePanel: hexColor,
  textOnDark: hexColor,
});
export type ThemeColors = z.infer<typeof themeColorsSchema>;

export const eventProfileSchema = z.object({
  schemaVersion: z.literal(1),
  id: slugSchema,
  productName: z.string().min(1).max(40),
  /** Part of productName shown in the brand orange (e.g. the sponsor's name); the rest uses the normal text colour. */
  productNameAccent: z.string().min(1).max(40).optional(),
  eventName: z.string().min(1).max(60),
  tagline: z.string().max(80).default(''),
  logo: assetPathSchema.optional(),
  /** Theme tokens; mapped 1:1 onto CSS custom properties (see tokens.css). */
  colors: themeColorsSchema,
  fonts: z.object({
    display: z.object({ family: z.string().min(1), file: assetPathSchema.optional() }),
    body: z.object({ family: z.string().min(1), file: assetPathSchema.optional() }),
  }),
  stageTheme: z.enum(['dance-studio', 'neon-club']),
  enabledRoutines: z.array(slugSchema).min(1),
  enabledCharacters: z.array(slugSchema).min(1),
  defaultDifficulty: difficultySchema,
  modes: z.array(z.enum(['single', 'duo'])).min(1),
  session: sessionRulesSchema,
  results: z.object({
    tiers: z
      .array(z.object({ minScore: z.number().min(0).max(100), title: z.string(), message: z.string() }))
      .min(1),
  }),
});
export type EventProfile = z.infer<typeof eventProfileSchema>;

export const qualityPresetSchema = z.enum(['low', 'medium', 'high']);
export type QualityPreset = z.infer<typeof qualityPresetSchema>;

/** Cameras whose colour stream needs the DirectShow path on Windows (matched on the device label). */
export const DEPTH_CAMERA_LABEL = /kinect|femto|orbbec|realsense|astra/i;

/** The capture path the app should run with for these camera settings. */
export function effectiveCaptureBackend(camera: { captureBackend?: string | null; label?: string | null } | null | undefined): 'media-foundation' | 'directshow' {
  const mode = camera?.captureBackend ?? 'auto';
  if (mode === 'directshow' || mode === 'media-foundation') return mode;
  return camera?.label && DEPTH_CAMERA_LABEL.test(camera.label) ? 'directshow' : 'media-foundation';
}

/** Booth-local settings persisted by the main process. */
/** Bump when tracking defaults change; older saved settings are migrated on load. */
export const TRACKING_TUNING_VERSION = 1;
/** Bump when the default event profile changes; saved settings on the old default move once. */
export const PROFILE_DEFAULTS_VERSION = 1;

export const boothSettingsSchema = z.object({
  schemaVersion: z.literal(1),
  activeProfileId: slugSchema.default('maltina'),
  /** Version of the default-profile choice these settings were migrated to (see PROFILE_DEFAULTS_VERSION). */
  profileDefaults: z.number().int().min(0).default(0),
  camera: z
    .object({
      deviceId: z.string().max(512).nullable().default(null),
      label: z.string().max(256).nullable().default(null),
      width: z.number().int().min(320).max(1920).default(1280),
      height: z.number().int().min(240).max(1080).default(720),
      frameRate: z.number().int().min(15).max(60).default(30),
      /**
       * Windows camera driver path. `auto`: Media Foundation, except DirectShow for
       * depth cameras (Azure Kinect, Orbbec Femto, RealSense) whose colour camera
       * does not start through Media Foundation in Chromium. Takes effect on restart.
       */
      captureBackend: z.enum(['auto', 'media-foundation', 'directshow']).default('auto'),
    })
    .default({ deviceId: null, label: null, width: 1280, height: 720, frameRate: 30, captureBackend: 'auto' }),
  tracking: z
    .object({
      // CPU by default: measured faster than GPU on the dev laptop once the 3D studio
      // scene shares the GPU (see docs/decisions/0003). Re-measure on booth hardware.
      delegate: z.enum(['GPU', 'CPU']).default('CPU'),
      model: z.enum(['lite', 'full']).default('lite'),
      targetHz: z.number().int().min(5).max(60).default(30),
      maxInFlight: z.number().int().min(1).max(3).default(1),
      /** Width frames are downscaled to before inference (the model input is far smaller). */
      inputWidth: z.number().int().min(256).max(1920).default(640),
      minPoseDetectionConfidence: z.number().min(0).max(1).default(0.5),
      /** Below this a detected body is dropped. Lower keeps fast-moving dancers instead of flickering out. */
      minPosePresenceConfidence: z.number().min(0).max(1).default(0.35),
      /** Below this MediaPipe re-runs the person detector instead of following the previous frame. */
      minTrackingConfidence: z.number().min(0).max(1).default(0.35),
      /** Duo: track each player in their own (overlapping) half of the frame. Much more robust when players stand close. */
      duoSplit: z.boolean().default(true),
      /** Version of the tracking defaults these values were tuned against (settings migration). */
      tuning: z.number().int().min(0).default(0),
    })
    .default({
      delegate: 'CPU',
      model: 'lite',
      inputWidth: 640,
      targetHz: 30,
      maxInFlight: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.35,
      minTrackingConfidence: 0.35,
      duoSplit: true,
      tuning: TRACKING_TUNING_VERSION,
    }),
  /** Audio/visual latency calibration; positive values delay judging relative to audio. */
  calibrationOffsetMs: z.number().min(-500).max(500).default(0),
  quality: qualityPresetSchema.default('medium'),
  /**
   * Cap on the 3D render rate (0 = display rate). On machines where CPU and GPU
   * share a power budget, rendering less often leaves more CPU for pose inference.
   */
  maxRenderFps: z.number().int().min(0).max(144).default(30),
  showPerfOverlay: z.boolean().default(false),
  reducedMotion: z.boolean().default(false),
  /** Experimental: drive player avatars from live tracking (retargeting proof of concept). */
  liveAvatar: z.boolean().default(false),
  /** Volume of UI sound cues relative to music, 0 disables them. */
  uiSoundVolume: z.number().min(0).max(1).default(0.35),
  displays: z
    .object({
      participantDisplayId: z.number().int().nullable().default(null),
      operatorDisplayId: z.number().int().nullable().default(null),
      leaderboardDisplayId: z.number().int().nullable().default(null),
    })
    .default({ participantDisplayId: null, operatorDisplayId: null, leaderboardDisplayId: null }),
  kiosk: z.boolean().default(false),
  /** Live LAN score feed for the event's main leaderboard (on by default; the key is generated on first run). */
  scoreFeed: z
    .object({
      enabled: z.boolean().default(true),
      port: z.number().int().min(1024).max(65535).default(8787),
      /** Shared secret the scoreboard PC must present; generated on first run. */
      sharedKey: z.string().min(16).max(128).nullable().default(null),
      /** Identifies this booth in the feed so several booths can share one scoreboard. */
      boothId: z
        .string()
        .regex(/^[a-z0-9][a-z0-9-]{0,31}$/)
        .default('booth-1'),
    })
    .default({ enabled: true, port: 8787, sharedKey: null, boothId: 'booth-1' }),
  retention: z
    .object({
      logDays: z.number().int().min(1).max(365).default(14),
      maxLogBytes: z.number().int().min(1_000_000).max(500_000_000).default(50_000_000),
      sessionRecordDays: z.number().int().min(0).max(365).default(30),
    })
    .default({ logDays: 14, maxLogBytes: 50_000_000, sessionRecordDays: 30 }),
});
export type BoothSettings = z.infer<typeof boothSettingsSchema>;

/**
 * Timestamped landmark fixture for deterministic replay (no webcam needed).
 * Landmarks are compact [x, y, z, visibility] tuples in `image-normalized` space.
 */
export const replayFixtureSchema = z.object({
  schemaVersion: z.literal(1),
  id: slugSchema,
  provenance: z.object({
    /** `synthetic` fixtures are generated, not captured from people, and must be labelled as such. */
    kind: z.enum(['synthetic', 'recorded']),
    generator: z.string().min(1),
    createdAt: z.string().min(1),
    description: z.string().min(1),
    routineId: slugSchema.optional(),
    consent: z.string().optional(),
  }),
  sourceWidth: z.number().int().positive(),
  sourceHeight: z.number().int().positive(),
  frames: z
    .array(
      z.object({
        t: z.number().nonnegative(),
        bodies: z.array(z.array(z.tuple([z.number(), z.number(), z.number(), z.number()])).length(33)).max(2),
      }),
    )
    .min(1),
});
export type ReplayFixture = z.infer<typeof replayFixtureSchema>;

export const boothErrorSchema = z.object({
  code: z.enum(ERROR_CODES),
  message: z.string().max(500),
  recoverable: z.boolean(),
  detail: z.string().max(2000).optional(),
});

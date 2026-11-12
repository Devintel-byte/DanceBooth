# Content pipeline and production art contract

All runtime content lives in `assets/` and is validated by `pnpm content:validate`
(the same loader the app runs at startup; invalid items are excluded and shown to
the operator as content issues).

## Routines (`assets/routines/*.json`)

Schema: `routineManifestSchema` in `packages/contracts/src/schemas.ts`.

| Field | Notes |
| --- | --- |
| `schemaVersion`, `id`, `contentVersion` | `id` is a stable slug; bump `contentVersion` on any change |
| `title`, `subtitle` | Participant-facing |
| `audio.file`, `audio.offsetMs` | Relative asset path; per-track offset added to the booth calibration offset |
| `animation` | `procedural-keyframes` (judged poses only, no instructor animation; used by the dev/test routine, which is not enabled in the event profile) or `glb-clip` (`file`, `clip`) |
| `durationSec`, `bpm`, `firstBeatSec`, `sections` | Timeline metadata; beat cues and stage pulses use `bpm` |
| `difficulty` | Default difficulty preset |
| `mirroring` | `mirror` or `same-side` (see decision 0004) |
| `requiredGroups` | `arms`, `legs`, `torso`; legs require full-body framing at calibration |
| `moves[]` | `timeSec`, `label`, `judged`, `pose` (segment → `[x, y]` display-space direction of the instructor facing the viewer) |
| `license.audio`, `license.choreography` | `source`, `license`, `attribution`, `placeholder` |
| `integrity` | Optional SHA-256 per referenced asset, verified at startup |

Authoring rules: poses must read clearly in the frontal plane (2D scoring cannot see depth); keep at least ~0.5 s between judged moves; avoid moves whose key segments overlap the torso from the camera's view.

When a GLB animation is used, the scoring `moves` must still be authored (e.g. sampled from the animation in the frontal plane and reviewed); scoring never compares bone rotations directly.

## Characters (`assets/characters/catalog.json`)

Every character is `kind: "glb"` (GLB or FBX) with `file` and `rig`. The procedural stick figure was removed in session 6. `rig.clipFiles` lists clip files the character needs outside a routine (its idle and celebrate clips).

### GLB art contract (proposal, to be confirmed with the art vendor)

| Item | Requirement |
| --- | --- |
| Format | glTF 2.0 binary (`.glb`), **no Draco/KTX2** until local decoders are added |
| Units / axes | Metres; +Y up; character faces +Z (toward camera); origin between feet on the floor |
| Rest pose | T-pose or A-pose, documented; arms along ±X |
| Skeleton | Mixamo-compatible names: `Hips, Spine, Spine2, Neck, Head, LeftArm, LeftForeArm, LeftHand, RightArm, RightForeArm, RightHand, LeftUpLeg, LeftLeg, LeftFoot, RightUpLeg, RightLeg, RightFoot` (prefix `mixamorig:` tolerated). Validated by `validateRig()` |
| Skinning | ≤ 4 influences per vertex; one skinned mesh preferred |
| Animation | Named clips; 30 fps; in-place (no root motion — root translation is ignored) |
| Materials | PBR metallic-roughness; material slots named `Body`, `Outfit_Primary`, `Outfit_Secondary`, `Accent`, `Skin` so palettes can recolour them |
| Outfits | Palette recolouring of the named slots; optional mesh variants as separate nodes toggled by name |
| Budgets (proposed, to measure) | ≤ 30k triangles per character, ≤ 3 materials, ≤ 2 × 2048² textures, ≤ 8 MB per GLB |

## Replay fixtures (`assets/fixtures/*.json`)

`replayFixtureSchema`: `provenance` (`synthetic` or `recorded`, generator, date, description, consent), source size, frames of `[x, y, z, visibility] × 33` per body. Recorded fixtures require documented consent from the person recorded and must contain landmarks only, never images.

## Event profiles (`assets/profiles/*.json`)

Product/event names (`productName`, optional `productNameAccent`), logo, colours (applied as CSS tokens), fonts, stage theme, enabled routines and characters (in display order), session timing rules, default difficulty, modes, results tiers. Select the active profile in the operator console; it applies after reloading the participant screen. Guide: [rebranding.md](rebranding.md).

## Tracking models

`pnpm assets:models` downloads hash-locked Pose Landmarker models; `pnpm assets:wasm` copies the WASM runtime from the installed npm package. Both are Apache-2.0 (see `assets/tracking-models/LICENSES.md`).

## Rigged characters and clip-driven routines (session 2)

Routines can now use `animation.kind: "glb-timeline"`. This is a list of clip
segments laid out on the song's beat grid. The instructor plays the timeline
deterministically from song time (`ClipPlayer` + `sampleClipTimeline`).
`scripts/build-routines.ts` plays **the same timeline** on the skeleton and
measures the segment directions at each judged beat to build the scoring
reference. What participants see is therefore exactly what is judged, and the
moves come only from licensed animation clips.

Pipeline:

1. `pnpm assets:music` reads the song list in `assets/audio/music.json`, decodes the
   source MP3/WAV files, refines the BPM from the audio, finds the beat phase, and
   writes beat-aligned WAV excerpts plus `assets/audio/tracks.json` (step by step:
   [custom-music.md](custom-music.md)).
2. `pnpm assets:routines` measures each clip's own beat, builds 16 random
   dances per track from the clip pool (each clip phrase starts on a song beat,
   on one of the clip's steps, at the speed that keeps its steps on the beat),
   extracts the moves of each, and writes `assets/routines/<track>.json` (the
   default dance plus `variations`) with integrity hashes. The booth plays a
   different dance each session.
3. `pnpm assets:dev-content` regenerates the synthetic replay fixtures (dev
   routine and funky-chunk).
4. `pnpm content:validate` checks everything.

Segments the camera sees end-on are dropped from a move when less than 40% of
the segment's length is in the frontal plane, because 2D scoring cannot judge
them.

### Importing Mixamo characters and dances (needs the client's Adobe account)

1. On mixamo.com, download the character as **FBX Binary, With Skin, T-pose**.
   Download each dance as **FBX Binary, Without Skin, 30 fps** (with "In Place" if
   offered; otherwise the importer removes the horizontal travel).
2. Put the files in `assets/characters/` (character) and
   `assets/animations/mixamo/` (clips). File names become clip names.
3. Convert the character to GLB (for example Blender: import FBX → export glTF
   binary, no Draco). FBX clips can be loaded directly via `clipFiles`
   (`FBXLoader`).
4. Add a catalog entry with `kind: "glb"`. Its `rig.boneMap` uses Mixamo names
   (`LeftArm→LeftForeArm`, `LeftForeArm→LeftHand`, `LeftUpLeg→LeftLeg`,
   `LeftLeg→LeftFoot`, the same for the right side, and `Hips→Neck`). Set
   `materialSlots` to the model's material names. Set `scale` so the character is
   about 1.75 units tall (Mixamo exports in centimetres, so use about 0.01).
5. Edit `assets/choreography/plan.json`: set `character`, list the clip files in `clipFiles`, and use the clip
   names (file names without `.fbx`) in `pool`. Then run `pnpm assets:routines --dry-run` followed by `pnpm assets:routines`. FBX characters can be used directly, so step 3 is optional. The first real import is Michelle plus 14 clips (session 5); see `assets/choreography/plan.json`. FBX characters with embedded textures load in the build script through a small DOM stub (textures are skipped there).

Adding a character (catalog entry, scale, portrait with `pnpm assets:portraits`,
profile) is described step by step in [rebranding.md](rebranding.md#characters).
To measure a model's height for `rig.scale`, render it once with the portrait tool
or open it in Blender; Mixamo FBX units vary between characters (Michelle 166, Remy 378).

Mixamo's terms allow its characters and animations in commercial projects, but
not redistribution of the raw files. Keep them in the private repository and
installer only.

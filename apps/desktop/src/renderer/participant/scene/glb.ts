import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import type { ClipSample } from '@booth/choreography';
import type { SegmentName } from '@booth/contracts';

/**
 * Rigged character support (GLB characters, GLB/FBX animation clips).
 * Draco/KTX2 decoders are deliberately NOT configured: they would need extra
 * local decoder files. Export GLBs without Draco compression.
 *
 * This module only depends on three.js so the build-time move extractor
 * (scripts/build-routines.ts) uses exactly the same playback and pose code
 * as the participant renderer.
 */

/** Mixamo-compatible canonical skeleton (art contract). Names after three.js sanitising. */
export const CANONICAL_BONES = {
  hips: 'Hips',
  spine: 'Spine',
  chest: 'Spine2',
  neck: 'Neck',
  head: 'Head',
  leftUpperArm: 'LeftArm',
  leftForearm: 'LeftForeArm',
  leftHand: 'LeftHand',
  rightUpperArm: 'RightArm',
  rightForearm: 'RightForeArm',
  rightHand: 'RightHand',
  leftThigh: 'LeftUpLeg',
  leftShin: 'LeftLeg',
  leftFoot: 'LeftFoot',
  rightThigh: 'RightUpLeg',
  rightShin: 'RightLeg',
  rightFoot: 'RightFoot',
} as const;

export type CanonicalBone = keyof typeof CANONICAL_BONES;

export interface RigValidation {
  ok: boolean;
  missing: string[];
  bones: Partial<Record<CanonicalBone, THREE.Bone>>;
}

/**
 * Strips exporter prefixes from bone names: "mixamorig:", "mixamorig" and the
 * numbered variants some Mixamo characters use ("mixamorig4:", "mixamorig12").
 */
export function canonicalBoneName(name: string): string {
  return name.replace(/^mixamorig\d*[:_]?/i, '');
}

/**
 * Makes clips recorded on one Mixamo skeleton drive another whose bones carry
 * a different prefix (e.g. clips on "mixamorig:Hips", character with
 * "mixamorig4:Hips"). Track names are rewritten to the target's actual bone
 * names; clips that already match are returned unchanged.
 */
export function retargetClips(root: THREE.Object3D, clips: readonly THREE.AnimationClip[]): THREE.AnimationClip[] {
  const actual = new Map<string, string>();
  const present = new Set<string>();
  root.traverse((o) => {
    if (!o.name) return;
    present.add(o.name);
    const key = canonicalBoneName(o.name);
    if (!actual.has(key)) actual.set(key, o.name);
  });
  return clips.map((clip) => {
    let changed = false;
    const tracks = clip.tracks.map((t) => {
      const dot = t.name.lastIndexOf('.');
      const node = t.name.slice(0, dot);
      if (present.has(node)) return t;
      const target = actual.get(canonicalBoneName(node));
      if (!target) return t;
      const c = t.clone();
      c.name = `${target}${t.name.slice(dot)}`;
      changed = true;
      return c;
    });
    if (!changed) return clip;
    const out = new THREE.AnimationClip(clip.name, clip.duration, tracks, clip.blendMode);
    return out;
  });
}

/** Checks a skeleton against the canonical Mixamo-style bone set. */
export function validateRig(root: THREE.Object3D): RigValidation {
  const byName = new Map<string, THREE.Bone>();
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) byName.set(canonicalBoneName(o.name), o as THREE.Bone);
  });
  const bones: Partial<Record<CanonicalBone, THREE.Bone>> = {};
  const missing: string[] = [];
  for (const [key, name] of Object.entries(CANONICAL_BONES) as [CanonicalBone, string][]) {
    const b = byName.get(name);
    if (b) bones[key] = b;
    else missing.push(name);
  }
  return { ok: missing.length === 0, missing, bones };
}

export type BoneMap = Partial<Record<SegmentName, readonly [string, string]>>;

/** Segment bone map for Mixamo rigs (prefix "mixamorig:" is tolerated). Copy into catalog.json rig.boneMap. */
export const MIXAMO_BONE_MAP: BoneMap = {
  leftUpperArm: ['LeftArm', 'LeftForeArm'],
  leftForearm: ['LeftForeArm', 'LeftHand'],
  rightUpperArm: ['RightArm', 'RightForeArm'],
  rightForearm: ['RightForeArm', 'RightHand'],
  leftThigh: ['LeftUpLeg', 'LeftLeg'],
  leftShin: ['LeftLeg', 'LeftFoot'],
  rightThigh: ['RightUpLeg', 'RightLeg'],
  rightShin: ['RightLeg', 'RightFoot'],
  torso: ['Hips', 'Neck'],
};

/** Finds bones by (sanitised) name, tolerating Mixamo prefixes. */
function findBone(root: THREE.Object3D, name: string): THREE.Object3D | null {
  const want = canonicalBoneName(THREE.PropertyBinding.sanitizeNodeName(name));
  let found: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (!found && canonicalBoneName(o.name) === want) found = o;
  });
  return found;
}

/** Returns bone names in the map that the model does not contain. */
export function validateBoneMap(root: THREE.Object3D, map: BoneMap): string[] {
  const missing: string[] = [];
  for (const pair of Object.values(map)) for (const n of pair ?? []) if (!findBone(root, n)) missing.push(n);
  return [...new Set(missing)];
}

/** A loaded rigged model: GLB or FBX (Mixamo exports can be used directly). */
export interface LoadedModel {
  scene: THREE.Object3D;
  animations: THREE.AnimationClip[];
}

function fileStem(nameOrUrl: string): string {
  const base = decodeURIComponent(nameOrUrl.split(/[\\/]/).pop() ?? nameOrUrl);
  return base.replace(/\.[^.]+$/, '');
}

/**
 * Mixamo names every exported clip "mixamo.com". Clips are renamed after the
 * file they came from ("Samba Dancing.fbx" -> "Samba Dancing"), and empty
 * clips (FBX "Take 001") are dropped.
 */
export function normaliseClips(clips: readonly THREE.AnimationClip[], source: string): THREE.AnimationClip[] {
  const real = clips.filter((c) => c.duration > 0 && c.tracks.length > 0);
  return real.map((c, i) => {
    if (c.name !== 'mixamo.com' && !/^Take \d+$/.test(c.name)) return c;
    const clone = c.clone();
    clone.name = real.length > 1 ? `${fileStem(source)} ${i + 1}` : fileStem(source);
    return clone;
  });
}

/**
 * Removes horizontal root travel from a clip (keeps the bounce), so dances
 * exported without "In Place" stay on their spot on stage.
 */
export function stripRootMotion(clip: THREE.AnimationClip): THREE.AnimationClip {
  for (const track of clip.tracks) {
    if (!/Hips\.position$/.test(track.name) || track.getValueSize() !== 3) continue;
    const v = track.values;
    const x0 = v[0]!;
    const z0 = v[2]!;
    for (let i = 0; i < v.length; i += 3) {
      v[i] = x0;
      v[i + 2] = z0;
    }
  }
  return clip;
}

/**
 * Mixamo clips store the hips position in the units of the skeleton they
 * were exported on. Played on a character of a different size (e.g. clips
 * made on Michelle, hips 103 cm, played on Remy, hips 209 units) the body
 * would sink or float. This rescales hips translation by the ratio of the
 * character's rest hips height to the hips height in its standing idle clip.
 * Returns new clips (cloned only when scaling is needed; cached clips are
 * shared between characters and must not be mutated).
 */
export function fitHipsToCharacter(
  root: THREE.Object3D,
  clips: readonly THREE.AnimationClip[],
  idleClip: string,
): THREE.AnimationClip[] {
  let hips: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (!hips && canonicalBoneName(o.name) === 'Hips') hips = o;
  });
  const idle = clips.find((c) => c.name === idleClip);
  const hipsTrack = (c: THREE.AnimationClip) => c.tracks.find((t) => /Hips\.position$/.test(t.name) && t.getValueSize() === 3);
  const idleTrack = idle && hipsTrack(idle);
  const restY = (hips as THREE.Object3D | null)?.position.y ?? 0;
  if (!idleTrack || restY <= 0) return [...clips];
  const ys: number[] = [];
  for (let i = 1; i < idleTrack.values.length; i += 3) ys.push(idleTrack.values[i]!);
  ys.sort((a, b) => a - b);
  const clipY = ys[ys.length >> 1]!;
  if (!(clipY > 0)) return [...clips];
  const ratio = restY / clipY;
  if (Math.abs(ratio - 1) < 0.03) return [...clips];
  return clips.map((c) => {
    if (!hipsTrack(c)) return c;
    const clone = c.clone();
    const t = hipsTrack(clone)!;
    t.values = Float32Array.from(t.values, (v) => v * ratio);
    return clone;
  });
}

function parseByType(data: ArrayBuffer, source: string): Promise<LoadedModel> {
  if (/\.fbx$/i.test(source)) {
    const group = new FBXLoader().parse(data, '');
    return Promise.resolve({ scene: group, animations: normaliseClips(group.animations, source).map(stripRootMotion) });
  }
  return new Promise((resolve, reject) =>
    new GLTFLoader().parse(
      data,
      '',
      (g: GLTF) => resolve({ scene: g.scene, animations: normaliseClips(g.animations, source).map(stripRootMotion) }),
      reject,
    ),
  );
}

/** Parses a model from bytes (build scripts); `source` is the file name, used for its type and clip names. */
export function parseModel(data: ArrayBuffer, source: string): Promise<LoadedModel> {
  return parseByType(data, source);
}

/** Loads a GLB or FBX character model with its clips. */
export async function loadModel(url: string): Promise<LoadedModel> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return parseByType(await res.arrayBuffer(), url);
}

/** Loads animation clips from a GLB or FBX (e.g. a Mixamo "without skin" export). */
export async function loadClips(url: string): Promise<THREE.AnimationClip[]> {
  const model = await loadModel(url);
  disposeObject(model.scene);
  return model.animations;
}

/**
 * Deterministic clip playback: clip times and blend weights are set from
 * song time every frame (never advanced by frame deltas), so the instructor
 * stays locked to the music and matches the scoring reference.
 */
export class ClipPlayer {
  readonly mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  readonly durations: Record<string, number> = {};

  constructor(root: THREE.Object3D, clips: readonly THREE.AnimationClip[]) {
    this.mixer = new THREE.AnimationMixer(root);
    for (const clip of clips) {
      const action = this.mixer.clipAction(clip);
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.enabled = true;
      action.setEffectiveWeight(0);
      action.play();
      this.actions.set(clip.name, action);
      this.durations[clip.name] = clip.duration;
    }
  }

  has(clip: string): boolean {
    return this.actions.has(clip);
  }

  apply(samples: readonly ClipSample[]): void {
    for (const a of this.actions.values()) a.setEffectiveWeight(0);
    for (const s of samples) {
      const a = this.actions.get(s.clip);
      if (!a) continue;
      a.time = s.time;
      a.setEffectiveWeight(s.weight);
    }
    this.mixer.update(0);
  }

  /** Plays a single looping clip at an absolute time (idle/celebration). */
  applySingle(clip: string, timeSec: number): void {
    const d = this.durations[clip] ?? 1;
    this.apply([{ clip, time: ((timeSec % d) + d) % d, weight: 1 }]);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mixer.getRoot());
    this.actions.clear();
  }
}

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();

/**
 * Segment directions of the current skeleton pose in display space, as the
 * character appears facing the camera (+Z): x = world +X (character's left on
 * the viewer's right), y = world +Y. Segments strongly foreshortened toward or
 * away from the camera are omitted because 2D scoring cannot judge them.
 */
export function extractSegmentPose(
  root: THREE.Object3D,
  map: BoneMap,
  minFrontalFraction = 0.4,
): Partial<Record<SegmentName, [number, number]>> {
  root.updateMatrixWorld(true);
  const out: Partial<Record<SegmentName, [number, number]>> = {};
  for (const [seg, pair] of Object.entries(map) as [SegmentName, readonly [string, string]][]) {
    const a = findBone(root, pair[0]);
    const b = findBone(root, pair[1]);
    if (!a || !b) continue;
    a.getWorldPosition(tmpA);
    b.getWorldPosition(tmpB);
    const dx = tmpB.x - tmpA.x;
    const dy = tmpB.y - tmpA.y;
    const dz = tmpB.z - tmpA.z;
    const full = Math.hypot(dx, dy, dz);
    const frontal = Math.hypot(dx, dy);
    if (full < 1e-6 || frontal / full < minFrontalFraction) continue;
    out[seg] = [Number((dx / frontal).toFixed(4)), Number((dy / frontal).toFixed(4))];
  }
  return out;
}

/** Recolours named materials (palette slots). Returns cloned materials it owns. */
export function applyPalette(
  root: THREE.Object3D,
  slots: Partial<Record<'primary' | 'secondary' | 'accent' | 'skin', readonly string[]>>,
  colors: Partial<Record<'primary' | 'secondary' | 'accent' | 'skin', string>>,
): THREE.Material[] {
  const owned: THREE.Material[] = [];
  const target = new Map<string, string>();
  for (const [slot, names] of Object.entries(slots)) {
    const c = colors[slot as keyof typeof colors];
    if (c) for (const n of names ?? []) target.set(n, c);
  }
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const next = mats.map((m) => {
      const color = target.get(m.name);
      if (!color || !(m as THREE.MeshStandardMaterial).color) return m;
      const clone = (m as THREE.MeshStandardMaterial).clone();
      clone.color.set(color);
      owned.push(clone);
      return clone;
    });
    mesh.material = Array.isArray(mesh.material) ? next : next[0]!;
  });
  return owned;
}

/** Releases GPU resources owned by an object tree. Idempotent. */
export function disposeObject(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const m of mats) {
      for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
      m.dispose();
    }
  });
}

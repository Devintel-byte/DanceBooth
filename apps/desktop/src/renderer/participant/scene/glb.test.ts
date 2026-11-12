import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CANONICAL_BONES, canonicalBoneName, fitHipsToCharacter, retargetClips, validateRig } from './glb';

function rig(names: string[]): THREE.Object3D {
  const root = new THREE.Group();
  let parent: THREE.Object3D = root;
  for (const n of names) {
    const b = new THREE.Bone();
    b.name = n;
    parent.add(b);
    parent = b;
  }
  return root;
}

describe('validateRig', () => {
  it('accepts a complete Mixamo-style rig with prefixes', () => {
    const r = validateRig(rig(Object.values(CANONICAL_BONES).map((n) => `mixamorig:${n}`)));
    expect(r.ok).toBe(true);
    expect(r.bones.leftForearm?.name).toBe('mixamorig:LeftForeArm');
  });

  it('reports missing bones', () => {
    const r = validateRig(rig(['Hips', 'Spine']));
    expect(r.ok).toBe(false);
    expect(r.missing).toContain('LeftArm');
  });
});

describe('fitHipsToCharacter', () => {
  const clip = (name: string, y: number) =>
    new THREE.AnimationClip(name, 1, [new THREE.VectorKeyframeTrack('mixamorigHips.position', [0, 1], [0, y, 0, 0, y, 0])]);
  const character = (hipsY: number) => {
    const root = rig(['mixamorigHips']);
    root.children[0]!.position.y = hipsY;
    return root;
  };

  it('scales hips translation for a taller character without mutating shared clips', () => {
    const idle = clip('idle', 100);
    const dance = clip('dance', 90);
    const [fIdle, fDance] = fitHipsToCharacter(character(200), [idle, dance], 'idle');
    expect(fIdle!.tracks[0]!.values[1]).toBeCloseTo(200);
    expect(fDance!.tracks[0]!.values[1]).toBeCloseTo(180);
    expect(dance.tracks[0]!.values[1]).toBe(90);
  });

  it('leaves clips untouched when the character matches the clip skeleton', () => {
    const idle = clip('idle', 100);
    expect(fitHipsToCharacter(character(101), [idle], 'idle')[0]).toBe(idle);
  });
});

describe('numbered Mixamo prefixes', () => {
  it('treats mixamorig4: bones as the canonical skeleton', () => {
    expect(canonicalBoneName('mixamorig4Hips')).toBe('Hips');
    expect(canonicalBoneName('mixamorig12:LeftArm')).toBe('LeftArm');
    expect(canonicalBoneName('mixamorigHips')).toBe('Hips');
  });
  it('rebinds clips recorded on "mixamorig" bones to a "mixamorig4" character', () => {
    const root = new THREE.Group();
    const hips = new THREE.Bone();
    hips.name = 'mixamorig4Hips';
    const arm = new THREE.Bone();
    arm.name = 'mixamorig4LeftArm';
    hips.add(arm);
    root.add(hips);
    const clip = new THREE.AnimationClip('dance', 1, [
      new THREE.QuaternionKeyframeTrack('mixamorigLeftArm.quaternion', [0, 1], [0, 0.7071, 0, 0.7071, 0, 0.7071, 0, 0.7071]),
      new THREE.VectorKeyframeTrack('mixamorigHips.position', [0, 1], [0, 100, 0, 0, 95, 0]),
    ]);
    const [out] = retargetClips(root, [clip]);
    expect(out!.tracks.map((t) => t.name)).toEqual(['mixamorig4LeftArm.quaternion', 'mixamorig4Hips.position']);
    const mixer = new THREE.AnimationMixer(root);
    mixer.clipAction(out!).play();
    mixer.setTime(0.5);
    expect(arm.quaternion.y).toBeCloseTo(0.7071, 3);
    // A matching skeleton keeps the very same clip object.
    hips.name = 'mixamorigHips';
    arm.name = 'mixamorigLeftArm';
    expect(retargetClips(root, [clip])[0]).toBe(clip);
  });
});

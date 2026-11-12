import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ClipPlayer, MIXAMO_BONE_MAP, extractSegmentPose, normaliseClips, parseModel, stripRootMotion, validateBoneMap } from './glb';

/**
 * Mixamo import path. The FBX test is opt-in: point BOOTH_TEST_FBX at any
 * Mixamo "with skin" dance export (not committed; Mixamo files may not be
 * redistributed). The pure helpers are always tested.
 */
const fbx = process.env.BOOTH_TEST_FBX;

describe('Mixamo clip helpers', () => {
  it('renames generic Mixamo clip names after the source file and drops empty takes', () => {
    const track = new THREE.VectorKeyframeTrack('mixamorigHips.position', [0, 1], [0, 1, 0, 5, 1, 3]);
    const clips = [new THREE.AnimationClip('mixamo.com', 1, [track]), new THREE.AnimationClip('Take 001', 0, [])];
    const out = normaliseClips(clips, 'assets/animations/mixamo/Hip Hop Dancing.fbx');
    expect(out.map((c) => c.name)).toEqual(['Hip Hop Dancing']);
  });

  it('removes horizontal root travel but keeps vertical bounce', () => {
    const track = new THREE.VectorKeyframeTrack('mixamorigHips.position', [0, 1], [0, 90, 0, 40, 95, -30]);
    const clip = stripRootMotion(new THREE.AnimationClip('x', 1, [track]));
    expect(Array.from(clip.tracks[0]!.values)).toEqual([0, 90, 0, 0, 95, 0]);
  });
});

describe.skipIf(!fbx || !existsSync(fbx))('Mixamo FBX end to end', () => {
  it('loads, maps bones, plays and extracts frontal-plane poses', async () => {
    const b = readFileSync(fbx!);
    const model = await parseModel(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, fbx!);
    expect(validateBoneMap(model.scene, MIXAMO_BONE_MAP)).toEqual([]);
    expect(model.animations.length).toBeGreaterThan(0);
    const player = new ClipPlayer(model.scene, model.animations);
    const clip = model.animations[0]!;
    const poses = [0.25, 0.5, 0.75].map((f) => {
      player.applySingle(clip.name, clip.duration * f);
      return extractSegmentPose(model.scene, MIXAMO_BONE_MAP);
    });
    for (const p of poses) expect(Object.keys(p).length).toBeGreaterThanOrEqual(6);
    // The dance actually moves: poses at different times differ.
    expect(JSON.stringify(poses[0])).not.toBe(JSON.stringify(poses[2]));
    player.dispose();
  });
});

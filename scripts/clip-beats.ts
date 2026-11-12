// Measures a dance clip's own beat from its motion, so the routine builder can
// stretch each clip until its steps land on the song's beats.
//
// The signal is the dancer's bounce: the hips dropping as the knees bend on
// each step. (Hand speed was tried too; it peaks between poses and pulled the
// grid off the beat.) For every beat length
// between MIN_BEAT and MAX_BEAT seconds a comb is laid over the signal at
// every phase; the beat length and phase whose teeth hit the most bounce win.
// The downbeat is the first tooth: the clip time of a step.
import * as THREE from 'three';
import { canonicalBoneName, type ClipPlayer } from '../apps/desktop/src/renderer/participant/scene/glb';

export interface ClipBeat {
  /** Seconds per beat in the clip as authored. */
  beatSec: number;
  /** Clip time of the first step on the beat grid, seconds (0 <= downbeat < beatSec). */
  downbeatSec: number;
  /** Whole beats from the downbeat to the end of the clip. */
  beats: number;
  /** Comb strength (z-score units); below ~0.25 the motion has no clear pulse. */
  confidence: number;
  /**
   * The clip is a seamless loop holding a whole number of beats (beatSec was
   * nudged to fit), so it can keep playing past its end and stay on the beat.
   */
  loops: boolean;
}

/** About 143 to 91 BPM: the range the booth's songs and Mixamo dances sit in. */
const MIN_BEAT = 0.42;
const MAX_BEAT = 0.66;
const FPS = 60;

function normalise(a: number[]): number[] {
  const m = a.reduce((s, x) => s + x, 0) / a.length;
  const sd = Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length) || 1;
  return a.map((x) => (x - m) / sd);
}

export function measureClipBeat(player: ClipPlayer, scene: THREE.Object3D, clip: string): ClipBeat {
  const dur = player.durations[clip] ?? 0;
  const find = (n: string): THREE.Object3D | null => {
    let found: THREE.Object3D | null = null;
    scene.traverse((o) => {
      if (!found && canonicalBoneName(o.name) === n) found = o;
    });
    return found;
  };
  const hips = find('Hips');
  if (!hips || dur < MIN_BEAT * 3) {
    return { beatSec: 0.5, downbeatSec: 0, beats: Math.max(1, Math.floor(dur / 0.5)), confidence: 0, loops: false };
  }
  const n = Math.max(2, Math.floor(dur * FPS));
  const hipY: number[] = [];
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    player.applySingle(clip, i / FPS);
    scene.updateMatrixWorld(true);
    hipY.push(hips.getWorldPosition(v).y);
  }
  const sig = normalise(hipY).map((x) => -x);
  const at = (t: number) => {
    const f = t * FPS;
    const i = Math.min(n - 2, Math.floor(f));
    const r = f - i;
    return sig[i]! * (1 - r) + sig[i + 1]! * r;
  };

  let best = { s: -Infinity, beat: 0.5, ph: 0 };
  for (let beat = MIN_BEAT; beat <= MAX_BEAT + 1e-9; beat += 0.002) {
    if (dur < beat * 3) continue;
    for (let ph = 0; ph < beat; ph += 1 / FPS) {
      let s = 0;
      let m = 0;
      for (let t = ph; t < dur - 1 / FPS; t += beat) {
        s += at(t);
        m++;
      }
      // Off-beat penalty: a true beat grid has its quiet moments half-way between the teeth.
      let off = 0;
      let k = 0;
      for (let t = ph + beat / 2; t < dur - 1 / FPS; t += beat) {
        off += at(t);
        k++;
      }
      const score = s / m - (k ? off / k : 0) * 0.5;
      if (score > best.s) best = { s: score, beat, ph };
    }
  }
  // A loop whose start and end poses meet and that holds (nearly) whole beats.
  player.applySingle(clip, 0);
  scene.updateMatrixWorld(true);
  const first = hips.getWorldPosition(new THREE.Vector3());
  player.applySingle(clip, dur - 1e-3);
  scene.updateMatrixWorld(true);
  const gap = first.distanceTo(hips.getWorldPosition(new THREE.Vector3()));
  const seamless = gap < 0.08;
  const whole = Math.round(dur / best.beat);
  const loops = seamless && whole >= 2 && Math.abs(dur / best.beat - whole) < 0.2;
  const beatSec = loops ? dur / whole : best.beat;
  return {
    beatSec: +beatSec.toFixed(4),
    downbeatSec: +(best.ph % beatSec).toFixed(4),
    beats: Math.floor((dur - (best.ph % beatSec)) / beatSec + 1e-6),
    confidence: +best.s.toFixed(3),
    loops,
  };
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { sampleClipTimeline } from '@booth/choreography';
import type { AnimationSegment, CharacterPreset, Palette } from '@booth/contracts';
import { log } from '../../shared/booth';
import { ClipPlayer, applyPalette, disposeObject, fitHipsToCharacter, loadClips, loadModel, retargetClips, type LoadedModel } from './glb';

/** One load per URL; instances are skinned clones. Cleared on page unload. */
const cache = new Map<string, Promise<LoadedModel>>();
const clipCache = new Map<string, Promise<THREE.AnimationClip[]>>();
function loadCached(url: string): Promise<LoadedModel> {
  let p = cache.get(url);
  if (!p) {
    p = loadModel(url);
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return p;
}
function loadClipsCached(url: string): Promise<THREE.AnimationClip[]> {
  let p = clipCache.get(url);
  if (!p) {
    p = loadClips(url);
    p.catch(() => clipCache.delete(url));
    clipCache.set(url, p);
  }
  return p;
}

export type CharacterDrive =
  /** Authored choreography locked to song time. */
  | { kind: 'timeline'; segments: readonly AnimationSegment[]; getTime: () => number }
  /** Looping idle, with an optional celebration triggered by real scoring feedback. */
  | { kind: 'idle'; getCelebrateSeq?: () => number }
  /** A single clip looping on the wall clock (e.g. celebrating on the results screen). */
  | { kind: 'loop'; clip: string };

export interface GlbCharacterProps {
  preset: CharacterPreset;
  palette: Palette;
  assetBaseUrl: string;
  extraClipFiles?: readonly string[];
  position: [number, number, number];
  scale?: number;
  drive: CharacterDrive;
  onError?: (message: string) => void;
}

export function GlbCharacter(props: GlbCharacterProps) {
  const rig = props.preset.rig;
  const url = `${props.assetBaseUrl}${props.preset.file}`;
  const [model, setModel] = useState<{ root: THREE.Object3D; player: ClipPlayer; owned: THREE.Material[]; fit: number } | null>(null);
  const celebrate = useRef<{ seq: number; until: number }>({ seq: 0, until: 0 });
  // Latest values for the loader without making them effect dependencies.
  const latest = useRef({ palette: props.palette, onError: props.onError });
  latest.current = { palette: props.palette, onError: props.onError };
  const clipKey = [...new Set(props.extraClipFiles ?? [])].join('|');
  const clipFiles = useMemo(() => (clipKey ? clipKey.split('|') : []), [clipKey]);

  useEffect(() => {
    let cancelled = false;
    let built: { root: THREE.Object3D; player: ClipPlayer; owned: THREE.Material[]; fit: number } | null = null;
    Promise.all([loadCached(url), ...clipFiles.map((f) => loadClipsCached(`${props.assetBaseUrl}${f}`))])
      .then(([gltf, ...extra]) => {
        if (cancelled) return;
        const root = cloneSkinned(gltf.scene);
        const owned = applyPalette(root, rig.materialSlots, latest.current.palette);
        // Clips may come from a skeleton with a different bone-name prefix: bind them to this one.
        const clips = fitHipsToCharacter(root, retargetClips(root, [...gltf.animations, ...extra.flat()]), rig.clips.idle);
        built = { root, player: new ClipPlayer(root, clips), owned, fit: rig.heightM ? autoScale(root, rig.heightM) : rig.scale };
        setModel(built);
      })
      .catch((e: unknown) => {
        const msg = `character ${props.preset.id} failed to load: ${String(e)}`;
        log('error', msg, 'CONTENT_MISSING');
        latest.current.onError?.(msg);
      });
    return () => {
      cancelled = true;
      if (built) {
        built.player.dispose();
        built.owned.forEach((m) => m.dispose());
        // Geometry is shared with the cached source; only dispose owned materials.
        built.root.removeFromParent();
      }
      setModel(null);
    };
  }, [url, clipFiles, props.assetBaseUrl, props.preset.id, props.palette.id, rig.materialSlots, rig.clips.idle, rig.heightM, rig.scale]);

  useFrame(({ clock }) => {
    if (!model) return;
    const d = props.drive;
    if (d.kind === 'timeline') {
      model.player.apply(sampleClipTimeline(d.segments, d.getTime(), model.player.durations));
      return;
    }
    const now = clock.elapsedTime;
    if (d.kind === 'loop') {
      model.player.applySingle(model.player.has(d.clip) ? d.clip : rig.clips.idle, now);
      return;
    }
    const seq = d.getCelebrateSeq?.() ?? 0;
    const celebrateClip = rig.clips.celebrate;
    if (celebrateClip && seq !== celebrate.current.seq) {
      celebrate.current = { seq, until: now + (model.player.durations[celebrateClip] ?? 1.5) };
    }
    if (celebrateClip && now < celebrate.current.until) {
      const d0 = model.player.durations[celebrateClip] ?? 1.5;
      model.player.applySingle(celebrateClip, d0 - (celebrate.current.until - now));
    } else {
      model.player.applySingle(rig.clips.idle, now);
    }
  });

  if (!model) return null;
  const s = (props.scale ?? 1) * model.fit;
  return (
    <group position={props.position} rotation-y={(rig.yawDeg * Math.PI) / 180} scale={[s, s, s]}>
      <primitive object={model.root} />
    </group>
  );
}

/** Scale that makes the model `heightM` tall, measured from its bind pose (unskinned bounds). */
function autoScale(root: THREE.Object3D, heightM: number): number {
  root.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  return size.y > 1e-6 ? heightM / size.y : 1;
}

/** Frees every cached GLB (used on participant teardown). */
export async function clearCharacterCache(): Promise<void> {
  for (const p of cache.values()) {
    try {
      disposeObject((await p).scene);
    } catch {
      // failed loads have nothing to free
    }
  }
  cache.clear();
  clipCache.clear();
}

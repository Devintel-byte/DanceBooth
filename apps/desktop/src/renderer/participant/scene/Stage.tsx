import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { CharacterPreset, EventProfile, QualityPreset, RoutineManifest } from '@booth/contracts';
import type { BoothRuntime } from '../runtime/runtime';
import { GlbCharacter } from './GlbCharacter';
import { BrandHall } from './BrandHall';

export interface StagePlayer {
  slot: 1 | 2;
  preset: CharacterPreset;
  paletteId: string;
}

export interface StageProps {
  runtime: BoothRuntime;
  profile: EventProfile;
  assetBaseUrl: string;
  quality: QualityPreset;
  reducedMotion: boolean;
  /** Routine driving the instructor (session routine, or the attract demo routine). */
  routine: RoutineManifest | null;
  characters: readonly CharacterPreset[];
  players: StagePlayer[];
  /** Show the players' chosen characters (one dancer per player) instead of the default dancer. */
  showPlayers: boolean;
  /** Results: dancers play their celebration clip. */
  celebrate: boolean;
  /** Render-rate cap in fps (0 = uncapped). */
  maxFps: number;
  /** Camera framing: 'wide' for gameplay, 'hero' for the attract/select screens. */
  framing: 'hero' | 'wide';
}

/** Internal render resolution and lighting budget per quality preset. */
const QUALITY: Record<QualityPreset, { dpr: number; shadows: boolean; antialias: boolean }> = {
  low: { dpr: 0.75, shadows: false, antialias: false },
  medium: { dpr: 1, shadows: false, antialias: true },
  high: { dpr: Math.min(1.5, window.devicePixelRatio || 1), shadows: true, antialias: true },
};

const FRAMING = {
  // Hero: the dancer sits right of centre, leaving room for the onboarding panel on the left.
  hero: { pos: new THREE.Vector3(-1.5, 1.25, 4.8), look: new THREE.Vector3(-1.5, 1.0, 0) },
  wide: { pos: new THREE.Vector3(0, 1.55, 6.6), look: new THREE.Vector3(0, 1.0, 0) },
};

/**
 * Drives an on-demand canvas at a capped rate. Animation is time-based (song
 * clock), so a lower render rate never changes timing, only smoothness.
 */
function FrameCap({ fps }: { fps: number }) {
  const { invalidate } = useThree();
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const interval = fps > 0 ? 1000 / fps : 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - last >= interval - 1) {
        last = t;
        invalidate();
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [fps, invalidate]);
  return null;
}

function RenderMeter({ runtime }: { runtime: BoothRuntime }) {
  useFrame(() => runtime.noteSceneFrame(performance.now()));
  return null;
}

/** Eases the camera between framings (instant with reduced motion). */
function CameraRig({ framing, reducedMotion }: { framing: 'hero' | 'wide'; reducedMotion: boolean }) {
  const { camera } = useThree();
  const look = useRef(FRAMING[framing].look.clone());
  useFrame((_, dt) => {
    const f = FRAMING[framing];
    const k = reducedMotion ? 1 : 1 - Math.pow(0.02, dt);
    camera.position.lerp(f.pos, k);
    look.current.lerp(f.look, k);
    camera.lookAt(look.current);
  });
  return null;
}

function paletteOf(preset: CharacterPreset, id: string) {
  return preset.palettes.find((p) => p.id === id) ?? preset.palettes[0]!;
}

export function Stage(props: StageProps) {
  const q = QUALITY[props.quality];
  const { colors } = props.profile;
  const rt = props.runtime;
  const routine = props.routine;
  const animation = routine?.animation;
  const instructorPreset =
    (animation?.kind === 'glb-timeline' ? props.characters.find((c) => c.id === animation.character) : undefined) ??
    props.characters[0]!;
  // Default dancer (attract / mode select) wears the event's gold palette.
  const instructorPalette = useMemo(
    () => ({ ...paletteOf(instructorPreset, 'gold'), primary: colors.brandGold, accent: colors.stageBackground }),
    [instructorPreset, colors.brandGold, colors.stageBackground],
  );
  const segments = animation?.kind === 'glb-timeline' ? animation.segments : null;
  const clipFiles = animation?.kind === 'glb-timeline' ? animation.clipFiles : undefined;

  /**
   * One dancer per player, each wearing that player's chosen character and
   * outfit and performing the routine the player follows: solo shows ONE
   * dancer, duo shows TWO. With no players yet (attract), one default dancer.
   */
  const dancers = props.showPlayers && props.players.length > 0
    ? props.players.map((pl, i, all) => ({
        key: `p${pl.slot}`,
        preset: pl.preset,
        palette: paletteOf(pl.preset, pl.paletteId),
        x: all.length === 2 ? (i === 0 ? -1.25 : 1.25) : 0,
      }))
    : [{ key: 'default', preset: instructorPreset, palette: instructorPalette, x: 0 }];
  const spots = dancers.map((d) => d.x);
  const hallColors = useMemo(
    () => ({
      orange: colors.brandOrange,
      orangeDark: colors.brandOrangeDark,
      gold: colors.brandGold,
      goldLight: colors.brandGoldLight,
      background: colors.stageBackground,
      panel: colors.stagePanel,
    }),
    [colors.brandOrange, colors.brandOrangeDark, colors.brandGold, colors.brandGoldLight, colors.stageBackground, colors.stagePanel],
  );

  return (
    <Canvas
      className="stage-canvas"
      dpr={q.dpr}
      frameloop="demand"
      shadows={q.shadows}
      gl={{ antialias: q.antialias, powerPreference: 'high-performance' }}
      camera={{ position: FRAMING[props.framing].pos.toArray(), fov: 38 }}
      onCreated={({ gl, scene }) => {
        gl.setClearColor(colors.stageBackground);
        // Procedural room reflections (no HDRI download) for mirrors and materials.
        const pmrem = new THREE.PMREMGenerator(gl);
        const room = new RoomEnvironment();
        scene.environment = pmrem.fromScene(room, 0.04).texture;
        scene.environmentIntensity = 0.35;
        room.dispose();
        pmrem.dispose();
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
      }}
    >
      <FrameCap fps={props.maxFps} />
      <RenderMeter runtime={rt} />
      <CameraRig framing={props.framing} reducedMotion={props.reducedMotion} />
      <fog attach="fog" args={[colors.stageBackground, 9, 18]} />
      <BrandHall
        layout={dancers.length === 2 ? 'duo' : 'solo'}
        quality={props.quality}
        reducedMotion={props.reducedMotion}
        dancers={spots}
        beatPhase={() => rt.frame.beatPhase}
        colors={hallColors}
      />
      {dancers.map((d) => (
        <GlbCharacter
          key={`${d.key}-${d.preset.id}-${d.palette.id}`}
          preset={d.preset}
          palette={d.palette}
          assetBaseUrl={props.assetBaseUrl}
          extraClipFiles={[...d.preset.rig.clipFiles, ...(clipFiles ?? [])]}
          position={[d.x, 0, 0]}
          drive={
            props.celebrate && d.preset.rig.clips.celebrate
              ? { kind: 'loop', clip: d.preset.rig.clips.celebrate }
              : segments
                ? { kind: 'timeline', segments, getTime: () => rt.frame.animTimeSec }
                : { kind: 'idle' }
          }
        />
      ))}
    </Canvas>
  );
}

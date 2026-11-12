import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { QualityPreset } from '@booth/contracts';

/**
 * Procedural dance studio: warm oak floor, mirrored back wall with a ballet
 * barre, ceiling truss and stage spotlights. Everything is generated at
 * runtime (no texture downloads), and all GPU resources are disposed on unmount.
 */
export interface StudioProps {
  quality: QualityPreset;
  reducedMotion: boolean;
  /** Spotlight targets on the floor (x positions). */
  spots: number[];
  beatPhase: () => number;
  warm: string;
  accent: string;
}

function woodTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 1024;
  const g = c.getContext('2d')!;
  const planks = 8;
  const w = c.width / planks;
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < planks; i++) {
    // Start one row above so the staggered planks cover the whole tile.
    for (let j = -1; j < 4; j++) {
      const y = j * 256 + (i % 2) * 128;
      const tone = 150 + rnd() * 40;
      g.fillStyle = `rgb(${tone + 40}, ${tone - 10}, ${tone - 70})`;
      g.fillRect(i * w, y, w, 256);
      g.globalAlpha = 0.12;
      for (let k = 0; k < 30; k++) {
        g.strokeStyle = rnd() > 0.5 ? '#5a3418' : '#e8b07a';
        g.beginPath();
        const x = i * w + rnd() * w;
        g.moveTo(x, y);
        g.bezierCurveTo(x + rnd() * 10 - 5, y + 80, x + rnd() * 10 - 5, y + 170, x, y + 256);
        g.stroke();
      }
      g.globalAlpha = 1;
      g.fillStyle = 'rgba(60,32,14,0.35)';
      g.fillRect(i * w, y, 2, 256);
      g.fillRect(i * w, y, w, 2);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 3);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

let poolTexture: THREE.CanvasTexture | null = null;
/** Soft radial light pool used to fake spotlights on the floor at low quality. */
function lightPool(): THREE.CanvasTexture {
  if (poolTexture) return poolTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  poolTexture = new THREE.CanvasTexture(c);
  return poolTexture;
}

interface SpotProps {
  x: number;
  color: string;
  shadows: boolean;
  reducedMotion: boolean;
  beatPhase: () => number;
  index: number;
  /** A real SpotLight (costs per-pixel shading) or a fake floor pool (low quality). */
  real: boolean;
  /** Inactive spots stay in the scene at zero intensity so shaders never recompile. */
  active: boolean;
}

function Spotlight({ x, color, shadows, reducedMotion, beatPhase, index, real, active }: SpotProps) {
  const light = useRef<THREE.SpotLight>(null);
  const cone = useRef<THREE.Mesh>(null);
  const target = useMemo(() => {
    const o = new THREE.Object3D();
    o.position.set(x, 0, 0.2);
    return o;
  }, [x]);
  const coneGeo = useMemo(() => new THREE.ConeGeometry(1.15, 4.6, 32, 1, true), []);
  const coneMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
    [color],
  );
  useEffect(() => () => [coneGeo, coneMat].forEach((r) => r.dispose()), [coneGeo, coneMat]);
  useEffect(() => {
    if (light.current) light.current.target = target;
  }, [target]);
  const poolMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color, map: lightPool(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55 }),
    [color],
  );
  useEffect(() => () => poolMat.dispose(), [poolMat]);
  useFrame(() => {
    // Gentle beat breathing only; never strobing.
    const pulse = reducedMotion ? 0 : (1 - beatPhase()) * 0.15 * (index % 2 ? 1 : 0.6);
    if (light.current) light.current.intensity = active ? 55 * (1 + pulse) : 0;
    if (cone.current) (cone.current.material as THREE.MeshBasicMaterial).opacity = active ? 0.06 + pulse * 0.08 : 0;
    poolMat.opacity = active ? 0.45 + pulse : 0;
  });
  return (
    <group>
      <primitive object={target} />
      {real ? (
      <spotLight
        ref={light}
        position={[x, 4.6, 1.2]}
        angle={0.36}
        penumbra={0.6}
        distance={12}
        decay={1.6}
        color={color}
        castShadow={shadows}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-bias={-0.0004}
      />
      ) : (
        <mesh rotation-x={-Math.PI / 2} position={[x, 0.01, 0.3]} material={poolMat}>
          <circleGeometry args={[1.3, 32]} />
        </mesh>
      )}
      <mesh ref={cone} geometry={coneGeo} material={coneMat} position={[x, 2.3, 0.7]} rotation-x={0.1} />
      <mesh position={[x, 4.62, 1.2]}>
        <cylinderGeometry args={[0.12, 0.16, 0.3, 16]} />
        <meshStandardMaterial color="#1b120d" metalness={0.6} roughness={0.4} />
      </mesh>
    </group>
  );
}

/** Fixed spot positions (centre, left, right); the light count never changes at runtime. */
const SPOT_X = [0, -2.1, 2.1];

export function StudioEnvironment(p: StudioProps) {
  const shadows = p.quality === 'high';
  // Low quality: one real light (centre) and fake pools elsewhere, to leave CPU/GPU budget for tracking.
  const wood = useMemo(() => woodTexture(), []);
  const floorMat = useMemo(() => new THREE.MeshStandardMaterial({ map: wood, roughness: 0.5, metalness: 0.05 }), [wood]);
  const wallMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#e8d6c2', roughness: 0.9 }), []);
  const mirrorMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#cfd6da', metalness: 0.9, roughness: 0.08, envMapIntensity: 1.2 }), []);
  const brass = useMemo(() => new THREE.MeshStandardMaterial({ color: '#c9a25a', metalness: 0.8, roughness: 0.3 }), []);
  const truss = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2a1d16', metalness: 0.5, roughness: 0.5 }), []);
  useEffect(() => () => [wood, floorMat, wallMat, mirrorMat, brass, truss].forEach((r) => r.dispose()), [wood, floorMat, wallMat, mirrorMat, brass, truss]);

  return (
    <group>
      <hemisphereLight args={['#fff1dc', '#3a2418', 0.55]} />
      <ambientLight intensity={0.25} color="#ffe2a0" />
      <directionalLight position={[3, 6, 5]} intensity={0.6} color="#fff3e0" />
      {/* floor */}
      <mesh rotation-x={-Math.PI / 2} receiveShadow material={floorMat}>
        <planeGeometry args={[16, 10]} />
      </mesh>
      {/* back wall with mirrors and barre */}
      <mesh position={[0, 2.5, -3]} material={wallMat} receiveShadow>
        <planeGeometry args={[16, 5]} />
      </mesh>
      {[-4.5, -1.5, 1.5, 4.5].map((x) => (
        <mesh key={x} position={[x, 1.75, -2.98]} material={mirrorMat}>
          <planeGeometry args={[2.8, 2.6]} />
        </mesh>
      ))}
      <mesh position={[0, 1.05, -2.8]} rotation-z={Math.PI / 2} material={brass}>
        <cylinderGeometry args={[0.035, 0.035, 14, 12]} />
      </mesh>
      {[-6, -3, 0, 3, 6].map((x) => (
        <mesh key={x} position={[x, 0.53, -2.88]} material={brass}>
          <cylinderGeometry args={[0.02, 0.02, 1.06, 8]} />
        </mesh>
      ))}
      {/* skirting and side walls */}
      <mesh position={[0, 0.06, -2.97]} material={truss}>
        <boxGeometry args={[16, 0.12, 0.04]} />
      </mesh>
      <mesh position={[-7, 2.5, 1]} rotation-y={Math.PI / 2} material={wallMat}>
        <planeGeometry args={[8, 5]} />
      </mesh>
      <mesh position={[7, 2.5, 1]} rotation-y={-Math.PI / 2} material={wallMat}>
        <planeGeometry args={[8, 5]} />
      </mesh>
      {/* lighting truss */}
      <mesh position={[0, 4.8, 1.2]} material={truss}>
        <boxGeometry args={[9, 0.14, 0.14]} />
      </mesh>
      {SPOT_X.map((x, i) => (
        <Spotlight
          key={x}
          index={i}
          x={x}
          color={i === 0 ? p.warm : p.accent}
          shadows={shadows && i === 0}
          reducedMotion={p.reducedMotion}
          beatPhase={p.beatPhase}
          real={i === 0 || p.quality !== 'low'}
          active={p.spots.some((s) => Math.abs(s - x) < 0.6)}
        />
      ))}
    </group>
  );
}

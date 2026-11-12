import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { QualityPreset } from '@booth/contracts';

/**
 * The Dance All, in two layouts:
 *
 * - `solo`: one dancer framed by a large frosted-glass panel, warm orange and
 *   gold ribbons flowing across the back wall behind the glass, one rug.
 * - `duo`: the wall splits into an orange half (Player 1) and a gold half
 *   (Player 2) with a lit divider between them, a glass panel and a rug for
 *   each player.
 *
 * Branding is carried by the event colours and ribbon shapes only. The logo
 * itself is never put in the scene: brand rules forbid showing it
 * transparent, recoloured or as a watermark (docs/rebranding.md); it stays
 * unaltered in the participant UI.
 *
 * Everything is generated at runtime from canvases (no downloads). Glass is
 * faked cheaply: each panel shows a pre-blurred copy of the wall behind it,
 * a white tint and a bright edge, so it costs no extra render passes.
 */
export type HallLayout = 'solo' | 'duo';

export interface HallColors {
  orange: string;
  orangeDark: string;
  gold: string;
  goldLight: string;
  background: string;
  panel: string;
}

export interface BrandHallProps {
  layout: HallLayout;
  quality: QualityPreset;
  reducedMotion: boolean;
  /** Dancer x positions: a rug and a spotlight for each. */
  dancers: number[];
  beatPhase: () => number;
  colors: HallColors;
}

/** Back wall: plane size in metres and texture resolution (same 16:5 aspect). */
const WALL = { w: 16, h: 5, z: -3, px: 2560, py: 800 };
const PX_PER_M = WALL.px / WALL.w;

interface Rect {
  /** Centre x and y in metres (wall coordinates: x across, y up from the floor). */
  x: number;
  y: number;
  w: number;
  h: number;
}

function panelsFor(layout: HallLayout, dancers: number[]): Rect[] {
  if (layout === 'duo') {
    return [
      ...dancers.map((x) => ({ x, y: 2.05, w: 2.2, h: 2.7 })),
      { x: -4.6, y: 1.95, w: 1.4, h: 2.0 },
      { x: 4.6, y: 1.95, w: 1.4, h: 2.0 },
    ];
  }
  return [
    { x: 0, y: 2.05, w: 2.8, h: 2.8 },
    { x: -3.3, y: 1.95, w: 1.5, h: 2.1 },
    { x: 3.3, y: 1.95, w: 1.5, h: 2.1 },
  ];
}

const toCanvas = (r: Rect) => ({
  x: (r.x - r.w / 2 + WALL.w / 2) * PX_PER_M,
  y: (WALL.h - (r.y + r.h / 2)) * PX_PER_M,
  w: r.w * PX_PER_M,
  h: r.h * PX_PER_M,
});

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function withAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/**
 * One flowing ribbon: a band between two cubic curves whose thickness swells
 * in the middle, filled with a gradient. `dir` flips it horizontally.
 */
function ribbon(g: CanvasRenderingContext2D, o: { x0: number; x1: number; y: number; amp: number; thick: number; from: string; to: string; alpha: number; dir: 1 | -1; phase: number }) {
  const { x0, x1, y, amp, thick } = o;
  const mid = (x0 + x1) / 2;
  const span = x1 - x0;
  const top = (t: number) => y - amp * Math.sin(Math.PI * (t * 1.6 + o.phase)) * o.dir;
  const grad = g.createLinearGradient(x0, 0, x1, 0);
  grad.addColorStop(0, withAlpha(o.from, 0));
  grad.addColorStop(0.18, withAlpha(o.from, o.alpha));
  grad.addColorStop(0.7, withAlpha(o.to, o.alpha));
  grad.addColorStop(1, withAlpha(o.to, 0));
  g.fillStyle = grad;
  g.beginPath();
  const steps = 48;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const px = x0 + span * t;
    const py = top(t);
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  for (let i = steps; i >= 0; i--) {
    const t = i / steps;
    const swell = Math.sin(Math.PI * t);
    g.lineTo(x0 + span * t, top(t) + thick * (0.35 + 0.65 * swell));
  }
  g.closePath();
  g.fill();
  // Fine highlight along the upper edge, as on a satin ribbon.
  g.strokeStyle = withAlpha('#ffffff', o.alpha * 0.25);
  g.lineWidth = 2;
  g.beginPath();
  for (let i = 4; i <= steps - 4; i++) {
    const t = i / steps;
    const px = x0 + span * t;
    if (i === 4) g.moveTo(px, top(t) + 3);
    else g.lineTo(px, top(t) + 3);
  }
  g.stroke();
  void mid;
}

function drawWall(layout: HallLayout, c: HallColors): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = WALL.px;
  cv.height = WALL.py;
  const g = cv.getContext('2d')!;
  const { px: W, py: H } = WALL;
  // Base: deep brown, slightly lighter towards the middle and the top light cove.
  const base = g.createLinearGradient(0, 0, 0, H);
  base.addColorStop(0, c.panel);
  base.addColorStop(0.55, c.background);
  base.addColorStop(1, '#170a02');
  g.fillStyle = base;
  g.fillRect(0, 0, W, H);
  const glow = g.createRadialGradient(W / 2, H * 0.55, 20, W / 2, H * 0.55, W * 0.45);
  glow.addColorStop(0, withAlpha(c.orange, layout === 'duo' ? 0.08 : 0.12));
  glow.addColorStop(1, withAlpha(c.orange, 0));
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);

  g.save();
  g.shadowBlur = 30;
  if (layout === 'solo') {
    g.shadowColor = withAlpha(c.orange, 0.6);
    ribbon(g, { x0: W * 0.05, x1: W * 0.98, y: H * 0.42, amp: H * 0.14, thick: H * 0.13, from: c.orangeDark, to: c.orange, alpha: 0.5, dir: 1, phase: 0.1 });
    g.shadowColor = withAlpha(c.gold, 0.6);
    ribbon(g, { x0: W * 0.0, x1: W * 0.92, y: H * 0.56, amp: H * 0.12, thick: H * 0.07, from: c.gold, to: c.goldLight, alpha: 0.43, dir: -1, phase: 0.35 });
    ribbon(g, { x0: W * 0.12, x1: W * 1.0, y: H * 0.68, amp: H * 0.08, thick: H * 0.035, from: c.orange, to: c.gold, alpha: 0.32, dir: 1, phase: 0.6 });
  } else {
    // Player 1 half: orange ribbons flowing in from the left; Player 2 half: gold from the right.
    g.shadowColor = withAlpha(c.orange, 0.6);
    ribbon(g, { x0: -W * 0.02, x1: W * 0.5, y: H * 0.42, amp: H * 0.12, thick: H * 0.12, from: c.orangeDark, to: c.orange, alpha: 0.52, dir: 1, phase: 0.05 });
    ribbon(g, { x0: W * 0.02, x1: W * 0.48, y: H * 0.62, amp: H * 0.08, thick: H * 0.04, from: c.orange, to: c.goldLight, alpha: 0.32, dir: -1, phase: 0.4 });
    g.shadowColor = withAlpha(c.gold, 0.6);
    ribbon(g, { x0: W * 0.5, x1: W * 1.02, y: H * 0.42, amp: H * 0.12, thick: H * 0.12, from: c.gold, to: c.goldLight, alpha: 0.5, dir: -1, phase: 0.05 });
    ribbon(g, { x0: W * 0.52, x1: W * 0.98, y: H * 0.62, amp: H * 0.08, thick: H * 0.04, from: c.goldLight, to: c.orange, alpha: 0.3, dir: 1, phase: 0.4 });
  }
  g.restore();

  // Fine vertical slats for texture (very faint).
  g.fillStyle = 'rgba(255,255,255,0.018)';
  for (let x = 0; x < W; x += 24) g.fillRect(x, 0, 2, H);
  return cv;
}

/** A frosted-glass panel: blurred copy of the wall behind it, white tint, bright edge. */
function drawPanel(wall: HTMLCanvasElement, r: Rect): HTMLCanvasElement {
  const p = toCanvas(r);
  const pad = 40;
  const cv = document.createElement('canvas');
  cv.width = Math.round(p.w);
  cv.height = Math.round(p.h);
  const g = cv.getContext('2d')!;
  const radius = Math.min(p.w, p.h) * 0.08;
  roundRect(g, 0, 0, p.w, p.h, radius);
  g.save();
  g.clip();
  g.filter = 'blur(22px) saturate(1.25)';
  g.drawImage(wall, p.x - pad, p.y - pad, p.w + pad * 2, p.h + pad * 2, -pad, -pad, p.w + pad * 2, p.h + pad * 2);
  g.filter = 'none';
  const tint = g.createLinearGradient(0, 0, p.w * 0.4, p.h);
  tint.addColorStop(0, 'rgba(255,255,255,0.22)');
  tint.addColorStop(0.5, 'rgba(255,255,255,0.09)');
  tint.addColorStop(1, 'rgba(255,255,255,0.05)');
  g.fillStyle = tint;
  g.fillRect(0, 0, p.w, p.h);
  // Soft diagonal sheen.
  const sheen = g.createLinearGradient(0, 0, p.w, p.h * 0.6);
  sheen.addColorStop(0.25, 'rgba(255,255,255,0)');
  sheen.addColorStop(0.32, 'rgba(255,255,255,0.10)');
  sheen.addColorStop(0.4, 'rgba(255,255,255,0)');
  g.fillStyle = sheen;
  g.fillRect(0, 0, p.w, p.h);
  g.restore();
  roundRect(g, 1.5, 1.5, p.w - 3, p.h - 3, radius);
  g.strokeStyle = 'rgba(255,255,255,0.45)';
  g.lineWidth = 3;
  g.stroke();
  return cv;
}

/** Round rug in the event colours: a patterned border, a field and a centre medallion. */
function drawRug(field: string, trim: string, dark: string, light: string): HTMLCanvasElement {
  const S = 1024;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d')!;
  const c = S / 2;
  const ring = (r: number, color: string) => {
    g.beginPath();
    g.arc(c, c, r, 0, Math.PI * 2);
    g.fillStyle = color;
    g.fill();
  };
  ring(c, dark);
  ring(c * 0.93, trim);
  ring(c * 0.88, dark);
  // Zig-zag band (woven-cloth style triangles).
  const n = 48;
  g.fillStyle = trim;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 0.5) / n) * Math.PI * 2;
    const a2 = ((i + 1) / n) * Math.PI * 2;
    g.beginPath();
    g.moveTo(c + Math.cos(a0) * c * 0.86, c + Math.sin(a0) * c * 0.86);
    g.lineTo(c + Math.cos(a1) * c * 0.74, c + Math.sin(a1) * c * 0.74);
    g.lineTo(c + Math.cos(a2) * c * 0.86, c + Math.sin(a2) * c * 0.86);
    g.closePath();
    g.fill();
  }
  ring(c * 0.72, field);
  // Field: soft radial shading and faint rays.
  const shade = g.createRadialGradient(c, c, 10, c, c, c * 0.72);
  shade.addColorStop(0, 'rgba(255,255,255,0.10)');
  shade.addColorStop(1, 'rgba(0,0,0,0.18)');
  g.fillStyle = shade;
  g.beginPath();
  g.arc(c, c, c * 0.72, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.07)';
  g.lineWidth = 6;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    g.beginPath();
    g.moveTo(c + Math.cos(a) * c * 0.3, c + Math.sin(a) * c * 0.3);
    g.lineTo(c + Math.cos(a) * c * 0.68, c + Math.sin(a) * c * 0.68);
    g.stroke();
  }
  // Medallion: diamond ring.
  ring(c * 0.27, dark);
  g.fillStyle = light;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const x = c + Math.cos(a) * c * 0.2;
    const y = c + Math.sin(a) * c * 0.2;
    g.beginPath();
    g.moveTo(x, y - 18);
    g.lineTo(x + 12, y);
    g.lineTo(x, y + 18);
    g.lineTo(x - 12, y);
    g.closePath();
    g.fill();
  }
  ring(c * 0.11, trim);
  // Pile texture: fine noise.
  const img = g.getImageData(0, 0, S, S);
  let seed = 7;
  for (let i = 0; i < img.data.length; i += 4) {
    seed = (seed * 16807) % 2147483647;
    const d = ((seed / 2147483647) - 0.5) * 18;
    img.data[i] = Math.max(0, Math.min(255, img.data[i]! + d));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1]! + d));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2]! + d));
  }
  g.putImageData(img, 0, 0);
  return cv;
}

function floorTexture(): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 1024;
  const g = cv.getContext('2d')!;
  const planks = 8;
  const w = cv.width / planks;
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < planks; i++) {
    for (let j = -1; j < 4; j++) {
      const y = j * 256 + (i % 2) * 128;
      const tone = 46 + rnd() * 16;
      g.fillStyle = `rgb(${tone + 38}, ${tone + 8}, ${tone - 22})`;
      g.fillRect(i * w, y, w, 256);
      g.globalAlpha = 0.1;
      for (let k = 0; k < 24; k++) {
        g.strokeStyle = rnd() > 0.5 ? '#120802' : '#6b3d1c';
        g.beginPath();
        const x = i * w + rnd() * w;
        g.moveTo(x, y);
        g.bezierCurveTo(x + rnd() * 10 - 5, y + 80, x + rnd() * 10 - 5, y + 170, x, y + 256);
        g.stroke();
      }
      g.globalAlpha = 1;
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.fillRect(i * w, y, 1, 256);
      g.fillRect(i * w, y, w, 1);
    }
  }
  return cv;
}

function canvasTexture(cv: HTMLCanvasElement, repeat?: [number, number]): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
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
  real: boolean;
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
  const poolMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color, map: lightPool(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55 }),
    [color],
  );
  useEffect(() => () => [coneGeo, coneMat, poolMat].forEach((r) => r.dispose()), [coneGeo, coneMat, poolMat]);
  useEffect(() => {
    if (light.current) light.current.target = target;
  }, [target]);
  useFrame(() => {
    // Gentle beat breathing only; never strobing.
    const pulse = reducedMotion ? 0 : (1 - beatPhase()) * 0.15 * (index % 2 ? 1 : 0.6);
    if (light.current) light.current.intensity = active ? 55 * (1 + pulse) : 0;
    if (cone.current) (cone.current.material as THREE.MeshBasicMaterial).opacity = active ? 0.05 + pulse * 0.07 : 0;
    poolMat.opacity = active ? 0.4 + pulse : 0;
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
        <mesh rotation-x={-Math.PI / 2} position={[x, 0.012, 0.3]} material={poolMat}>
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

/** Fixed spot positions; the light count never changes at runtime (no shader recompiles). */
const SPOT_X = [0, -1.25, 1.25];

/** Thin glowing strip (LED cove light); unlit so it reads as a light source. */
function Strip({ from, to, y, z, color, width = 0.03 }: { from: number; to: number; y: number; z: number; color: string; width?: number }) {
  return (
    <mesh position={[(from + to) / 2, y, z]}>
      <boxGeometry args={[to - from, width, 0.02]} />
      <meshBasicMaterial color={color} toneMapped={false} />
    </mesh>
  );
}

export function BrandHall(p: BrandHallProps) {
  const { colors: c, layout } = p;
  const shadows = p.quality === 'high';
  const dancerKey = p.dancers.join(',');

  const built = useMemo(() => {
    const wallCanvas = drawWall(layout, c);
    const wall = canvasTexture(wallCanvas);
    const panels = panelsFor(layout, dancerKey ? dancerKey.split(',').map(Number) : [0]).map((r) => ({ r, tex: canvasTexture(drawPanel(wallCanvas, r)) }));
    const floor = canvasTexture(floorTexture(), [5, 2.5]);
    return { wall, panels, floor };
    // colours are strings; recompute when any changes
  }, [layout, c.orange, c.orangeDark, c.gold, c.goldLight, c.background, c.panel, dancerKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const rugs = useMemo(
    () => ({
      orange: canvasTexture(drawRug(c.orange, c.gold, c.panel, c.goldLight)),
      gold: canvasTexture(drawRug(c.gold, c.orange, c.panel, '#ffffff')),
    }),
    [c.orange, c.gold, c.panel, c.goldLight],
  );

  useEffect(
    () => () => {
      built.wall.dispose();
      built.floor.dispose();
      built.panels.forEach((x) => x.tex.dispose());
    },
    [built],
  );
  useEffect(() => () => Object.values(rugs).forEach((t) => t.dispose()), [rugs]);

  // Player 1 dances on orange, Player 2 on gold (their badge colours).
  const rugFor = (i: number) => (layout === 'duo' && i === 1 ? rugs.gold : rugs.orange);

  return (
    <group>
      <hemisphereLight args={['#fff1dc', '#2a1408', 0.5]} />
      <ambientLight intensity={0.22} color="#ffe2a0" />
      <directionalLight position={[3, 6, 5]} intensity={0.55} color="#fff3e0" />

      {/* polished dark floor */}
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[16, 10]} />
        <meshStandardMaterial map={built.floor} roughness={0.38} metalness={0.02} envMapIntensity={0.5} />
      </mesh>

      {/* branded back wall (unlit so the colours stay true) */}
      <mesh position={[0, WALL.h / 2, WALL.z]}>
        <planeGeometry args={[WALL.w, WALL.h]} />
        <meshBasicMaterial map={built.wall} toneMapped={false} />
      </mesh>
      {/* frosted glass panels */}
      {built.panels.map(({ r, tex }, i) => (
        <mesh key={i} position={[r.x, r.y, WALL.z + 0.18]}>
          <planeGeometry args={[r.w, r.h]} />
          <meshBasicMaterial map={tex} transparent toneMapped={false} />
        </mesh>
      ))}

      {/* side walls */}
      <mesh position={[-7, 2.5, 1]} rotation-y={Math.PI / 2}>
        <planeGeometry args={[8, 5]} />
        <meshStandardMaterial color={c.background} roughness={0.9} />
      </mesh>
      <mesh position={[7, 2.5, 1]} rotation-y={-Math.PI / 2}>
        <planeGeometry args={[8, 5]} />
        <meshStandardMaterial color={c.background} roughness={0.9} />
      </mesh>

      {/* LED cove lines along the base and top of the wall */}
      {layout === 'duo' ? (
        <>
          <Strip from={-8} to={-0.05} y={0.06} z={WALL.z + 0.05} color={c.orange} />
          <Strip from={0.05} to={8} y={0.06} z={WALL.z + 0.05} color={c.gold} />
          <Strip from={-8} to={-0.05} y={4.35} z={WALL.z + 0.05} color={c.orange} width={0.02} />
          <Strip from={0.05} to={8} y={4.35} z={WALL.z + 0.05} color={c.gold} width={0.02} />
          {/* centre divider between the two players */}
          <mesh position={[0, 2.2, WALL.z + 0.2]}>
            <boxGeometry args={[0.06, 4.4, 0.04]} />
            <meshBasicMaterial color={c.goldLight} toneMapped={false} />
          </mesh>
          <mesh rotation-x={-Math.PI / 2} position={[0, 0.004, -0.4]}>
            <planeGeometry args={[0.035, 5.2]} />
            <meshBasicMaterial color={c.goldLight} transparent opacity={0.55} toneMapped={false} />
          </mesh>
        </>
      ) : (
        <>
          <Strip from={-8} to={8} y={0.06} z={WALL.z + 0.05} color={c.orange} />
          <Strip from={-8} to={8} y={4.35} z={WALL.z + 0.05} color={c.gold} width={0.02} />
        </>
      )}

      {/* a rug under each dancer */}
      {p.dancers.map((x, i) => (
        <mesh key={`rug-${i}-${x}`} rotation-x={-Math.PI / 2} position={[x, 0.008, 0.05]} receiveShadow>
          <circleGeometry args={[layout === 'duo' ? 0.9 : 1.05, 64]} />
          <meshStandardMaterial map={rugFor(i)} roughness={1} metalness={0} />
        </mesh>
      ))}

      {/* lighting truss */}
      <mesh position={[0, 4.8, 1.2]}>
        <boxGeometry args={[9, 0.14, 0.14]} />
        <meshStandardMaterial color="#1b120d" metalness={0.5} roughness={0.5} />
      </mesh>
      {SPOT_X.map((x, i) => (
        <Spotlight
          key={x}
          index={i}
          x={x}
          color={i === 0 ? c.goldLight : i === 1 ? c.orange : c.gold}
          shadows={shadows && i === 0}
          reducedMotion={p.reducedMotion}
          beatPhase={p.beatPhase}
          real={i === 0 || p.quality !== 'low'}
          active={p.dancers.some((s) => Math.abs(s - x) < 0.6)}
        />
      ))}
    </group>
  );
}

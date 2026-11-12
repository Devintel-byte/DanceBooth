import { useEffect, useRef } from 'react';
import { LANDMARK } from '@booth/contracts';
import type { BoothRuntime } from '../runtime/runtime';

type J = keyof typeof LANDMARK;
/** Limbs and torso (thick). */
const BONES: [J, J][] = [
  ['leftShoulder', 'rightShoulder'],
  ['leftHip', 'rightHip'],
  ['leftShoulder', 'leftHip'],
  ['rightShoulder', 'rightHip'],
  ['leftShoulder', 'leftElbow'],
  ['leftElbow', 'leftWrist'],
  ['rightShoulder', 'rightElbow'],
  ['rightElbow', 'rightWrist'],
  ['leftHip', 'leftKnee'],
  ['leftKnee', 'leftAnkle'],
  ['rightHip', 'rightKnee'],
  ['rightKnee', 'rightAnkle'],
];
/** Hands and feet (thin). */
const EXTREMITIES: [J, J][] = [
  ['leftWrist', 'leftIndex'],
  ['leftWrist', 'leftPinky'],
  ['leftIndex', 'leftPinky'],
  ['leftWrist', 'leftThumb'],
  ['rightWrist', 'rightIndex'],
  ['rightWrist', 'rightPinky'],
  ['rightIndex', 'rightPinky'],
  ['rightWrist', 'rightThumb'],
  ['leftAnkle', 'leftHeel'],
  ['leftHeel', 'leftFootIndex'],
  ['leftAnkle', 'leftFootIndex'],
  ['rightAnkle', 'rightHeel'],
  ['rightHeel', 'rightFootIndex'],
  ['rightAnkle', 'rightFootIndex'],
];
const JOINTS: J[] = ['leftShoulder', 'rightShoulder', 'leftElbow', 'rightElbow', 'leftWrist', 'rightWrist', 'leftHip', 'rightHip', 'leftKnee', 'rightKnee', 'leftAnkle', 'rightAnkle'];
/** Fully drawn at or above SURE; drawn faint between SEEN and SURE (uncertain joints still show where tracking thinks they are). */
const SURE = 0.5;
const SEEN = 0.3;

/**
 * Mirrored 2D skeleton of the tracked players (body-position feedback).
 * Drawn from the runtime's per-frame state on its own rAF; no React updates.
 * This shows actual tracking output, never canned animation.
 */
export function SkeletonOverlay({ runtime, compact = false, zones = 0 }: { runtime: BoothRuntime; compact?: boolean; zones?: 0 | 1 | 2 }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    const styles = getComputedStyle(document.documentElement);
    const panel = styles.getPropertyValue('--stage-panel').trim() || 'black';
    const onDark = styles.getPropertyValue('--text-on-dark').trim() || 'white';
    const colors = [styles.getPropertyValue('--brand-orange').trim() || '#f36b21', styles.getPropertyValue('--brand-gold').trim() || '#f7b928'];
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = canvas.current;
      if (!c) return;
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
      const g = c.getContext('2d');
      if (!g) return;
      g.clearRect(0, 0, w, h);
      // Fit the camera aspect inside the box.
      const aspect = runtime.frame.sourceAspect;
      let bw = w;
      let bh = w / aspect;
      if (bh > h) {
        bh = h;
        bw = h * aspect;
      }
      const ox = (w - bw) / 2;
      const oy = (h - bh) / 2;
      g.fillStyle = panel;
      g.fillRect(ox, oy, bw, bh);
      // Standing zones (display space): one centred, or left/right halves for two players.
      if (zones > 0) {
        g.setLineDash([10, 8]);
        g.lineWidth = 3;
        for (let z = 0; z < zones; z++) {
          const zw = zones === 1 ? bw * 0.5 : bw * 0.42;
          const zx = zones === 1 ? ox + bw * 0.25 : ox + (z === 0 ? bw * 0.05 : bw * 0.53);
          g.strokeStyle = colors[z] ?? '#fff';
          g.strokeRect(zx, oy + bh * 0.06, zw, bh * 0.88);
          g.fillStyle = onDark;
          g.font = `700 ${Math.max(14, bh * 0.05)}px Manrope, sans-serif`;
          g.fillText(zones === 1 ? 'Stand here' : `Player ${z + 1}`, zx + 10, oy + bh * 0.06 + Math.max(18, bh * 0.06));
        }
        g.setLineDash([]);
      }
      for (const p of runtime.frame.players) {
        if (!p.landmarks) continue;
        const color = colors[p.slot - 1] ?? '#fff';
        g.strokeStyle = color;
        g.fillStyle = color;
        g.globalAlpha = p.tracked ? 1 : 0.35;
        g.lineWidth = compact ? 4 : 7;
        g.lineCap = 'round';
        const pt = (name: keyof typeof LANDMARK) => {
          const l = p.landmarks![LANDMARK[name]]!;
          // Mirror horizontally so it behaves like a mirror for the participant.
          return { x: ox + (1 - l.x) * bw, y: oy + l.y * bh, v: l.visibility ?? 1 };
        };
        const base = p.tracked ? 1 : 0.35;
        const alphaOf = (v: number) => (v >= SURE ? base : v >= SEEN ? base * 0.4 : 0);
        const line = (pairs: [J, J][], width: number) => {
          g.lineWidth = width;
          for (const [a, b] of pairs) {
            const pa = pt(a);
            const pb = pt(b);
            const alpha = alphaOf(Math.min(pa.v, pb.v));
            if (!alpha) continue;
            g.globalAlpha = alpha;
            g.beginPath();
            g.moveTo(pa.x, pa.y);
            g.lineTo(pb.x, pb.y);
            g.stroke();
          }
        };
        const thick = compact ? 4 : 7;
        line(BONES, thick);
        line(EXTREMITIES, Math.max(2, thick * 0.45));
        // Neck: shoulder centre to the head.
        const ls = pt('leftShoulder');
        const rs = pt('rightShoulder');
        const nose = pt('nose');
        const neck = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2, v: Math.min(ls.v, rs.v) };
        const neckAlpha = alphaOf(Math.min(neck.v, nose.v));
        if (neckAlpha) {
          g.globalAlpha = neckAlpha;
          g.lineWidth = thick;
          g.beginPath();
          g.moveTo(neck.x, neck.y);
          g.lineTo(nose.x, nose.y);
          g.stroke();
        }
        // Head: circle sized from the ear (or eye) spacing, so it scales with distance.
        const le = pt('leftEar');
        const re = pt('rightEar');
        const headAlpha = alphaOf(nose.v);
        if (headAlpha) {
          const span = Math.min(le.v, re.v) >= SEEN ? Math.hypot(le.x - re.x, le.y - re.y) : Math.hypot(ls.x - rs.x, ls.y - rs.y) * 0.45;
          const r = Math.max(compact ? 6 : 10, span * 0.65);
          g.globalAlpha = headAlpha;
          g.lineWidth = Math.max(2, thick * 0.6);
          g.beginPath();
          g.arc(nose.x, nose.y, r, 0, Math.PI * 2);
          g.stroke();
          for (const eye of ['leftEye', 'rightEye'] as const) {
            const e = pt(eye);
            if (e.v < SEEN) continue;
            g.beginPath();
            g.arc(e.x, e.y, Math.max(2, r * 0.12), 0, Math.PI * 2);
            g.fill();
          }
        }
        // Joints.
        for (const j of JOINTS) {
          const q = pt(j);
          const alpha = alphaOf(q.v);
          if (!alpha) continue;
          g.globalAlpha = alpha;
          g.beginPath();
          g.arc(q.x, q.y, thick * 0.85, 0, Math.PI * 2);
          g.fill();
        }
        g.globalAlpha = 1;
        // Player tag above the head (duo): colour, number, name, and a lock once identity is locked in.
        if (runtime.frame.players.length > 1 || zones === 2) {
          const head = pt('nose');
          const top = Math.min(...(['leftEye', 'rightEye', 'nose', 'leftShoulder', 'rightShoulder'] as const).map((k) => pt(k).y));
          const label = `${p.locked ? '\u{1F512} ' : ''}${p.tag}`;
          const fs = compact ? 11 : Math.max(14, bh * 0.034);
          g.font = `800 ${fs}px Manrope, sans-serif`;
          const tw = g.measureText(label).width;
          const bx = Math.min(Math.max(ox, head.x - tw / 2 - 8), ox + bw - tw - 16);
          const by = Math.max(oy, top - fs * 3.2);
          g.globalAlpha = p.tracked ? 0.95 : 0.5;
          g.fillStyle = color;
          g.beginPath();
          g.roundRect(bx, by, tw + 16, fs * 1.6, fs * 0.5);
          g.fill();
          g.fillStyle = '#1b0e05';
          g.fillText(label, bx + 8, by + fs * 1.15);
          g.globalAlpha = 1;
        }
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [runtime, compact, zones]);
  return <canvas ref={canvas} className={`skeleton-overlay ${compact ? 'compact' : 'full'}`} aria-hidden="true" />;
}

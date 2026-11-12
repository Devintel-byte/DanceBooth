// Generates the ORIGINAL development test track used by the dev routine.
// Pure synthesis (kick, hat, bass, chord stabs) at a fixed BPM; no samples,
// no third-party audio. Deterministic output. Not production music.
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'assets', 'audio', 'dev-groove-120bpm.wav');

const SR = 22050;
const BPM = 120;
const BEATS = 64; // 32 s
const beat = 60 / BPM;
const lead = 0; // first beat at 0 s
const duration = BEATS * beat + 1;
const n = Math.floor(SR * duration);
const buf = new Float32Array(n);

let seed = 12345;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;

function add(startSec, lenSec, fn) {
  const s0 = Math.floor(startSec * SR);
  const len = Math.floor(lenSec * SR);
  for (let i = 0; i < len && s0 + i < n; i++) buf[s0 + i] += fn(i / SR);
}

const bassNotes = [55, 55, 65.41, 49]; // A1 A1 C2 G1 per bar
const chord = [220, 277.18, 329.63]; // A major-ish stab

for (let b = 0; b < BEATS; b++) {
  const t = lead + b * beat;
  const bar = Math.floor(b / 4);
  const intro = b < 4;
  // kick on every beat
  add(t, 0.25, (x) => Math.sin(2 * Math.PI * (50 + 90 * Math.exp(-x * 30)) * x) * Math.exp(-x * 12) * 0.8);
  // accent click on bar downbeats so the count-in is obvious
  if (b % 4 === 0) add(t, 0.04, (x) => Math.sin(2 * Math.PI * 1760 * x) * Math.exp(-x * 80) * 0.35);
  if (intro) continue;
  // off-beat hats
  add(t + beat / 2, 0.06, (x) => rand() * Math.exp(-x * 60) * 0.18);
  // bass
  const f = bassNotes[bar % 4];
  add(t, beat * 0.9, (x) => Math.sign(Math.sin(2 * Math.PI * f * x)) * 0.12 * Math.exp(-x * 2));
  // chord stab on beat 2 and 4
  if (b % 2 === 1) {
    add(t, 0.18, (x) => chord.reduce((s, cf) => s + Math.sin(2 * Math.PI * cf * x), 0) * 0.07 * Math.exp(-x * 14));
  }
}

// soft limiter + 16-bit PCM WAV
const pcm = Buffer.alloc(44 + n * 2);
pcm.write('RIFF', 0);
pcm.writeUInt32LE(36 + n * 2, 4);
pcm.write('WAVE', 8);
pcm.write('fmt ', 12);
pcm.writeUInt32LE(16, 16);
pcm.writeUInt16LE(1, 20);
pcm.writeUInt16LE(1, 22);
pcm.writeUInt32LE(SR, 24);
pcm.writeUInt32LE(SR * 2, 28);
pcm.writeUInt16LE(2, 32);
pcm.writeUInt16LE(16, 34);
pcm.write('data', 36);
pcm.writeUInt32LE(n * 2, 40);
for (let i = 0; i < n; i++) {
  const v = Math.tanh(buf[i] * 1.2);
  pcm.writeInt16LE(Math.round(v * 32000), 44 + i * 2);
}
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, pcm);
console.info(`wrote ${out} (${duration.toFixed(1)} s, ${BPM} BPM)`);

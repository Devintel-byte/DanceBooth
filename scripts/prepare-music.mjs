// Prepares licensed songs for booth routines.
//
// Reads the song list from assets/audio/music.json. For each song it decodes
// the source file (assets/audio/source/<file>, MP3 or 16-bit PCM WAV; source
// files are not committed), refines the BPM and finds the beat phase from an
// onset envelope, cuts a beat-aligned excerpt with short fades, and writes a
// 16-bit stereo WAV (assets/audio/<id>.wav) plus assets/audio/tracks.json.
//
// Usage: pnpm assets:music [--only <id>]
// A song whose source file is missing keeps its existing WAV and tracks.json
// entry, so adding one new song does not need every old source file.
// See docs/custom-music.md.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MPEGDecoder } from 'mpg123-decoder';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'assets', 'audio', 'source');
const outDir = path.join(root, 'assets', 'audio');
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;

const { tracks: TRACKS } = JSON.parse(readFileSync(path.join(outDir, 'music.json'), 'utf-8'));
for (const t of TRACKS) {
  for (const k of ['id', 'title', 'artist', 'file', 'bpm', 'startNear', 'beats', 'license']) {
    if (t[k] === undefined) throw new Error(`music.json: track ${t.id ?? '?'} is missing "${k}"`);
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(t.id)) throw new Error(`music.json: id "${t.id}" must be lowercase letters, digits and dashes`);
}
const previous = existsSync(path.join(outDir, 'tracks.json')) ? JSON.parse(readFileSync(path.join(outDir, 'tracks.json'), 'utf-8')) : [];

const HOP = 0.01; // 10 ms envelope hop

function onsetEnvelope(mono, sr) {
  const hop = Math.round(sr * HOP);
  const n = Math.floor(mono.length / hop);
  const energy = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = i * hop; j < (i + 1) * hop; j++) s += mono[j] * mono[j];
    energy[i] = Math.log(1e-9 + s / hop);
  }
  const env = new Float64Array(n);
  for (let i = 1; i < n; i++) env[i] = Math.max(0, energy[i] - energy[i - 1]);
  return env;
}

/**
 * Onset envelope of the low end only (kick drum, bass): two one-pole low-pass
 * filters at ~120 Hz before the energy flux. In Afrobeats and amapiano the
 * hi-hats and snares sit on the off-beats and dominate a full-band envelope;
 * dancers step to the kick, so the beat phase is taken from the low end.
 */
function lowOnsetEnvelope(mono, sr) {
  const a = Math.exp((-2 * Math.PI * 120) / sr);
  const low = new Float32Array(mono.length);
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < mono.length; i++) {
    y1 = (1 - a) * mono[i] + a * y1;
    y2 = (1 - a) * y1 + a * y2;
    low[i] = y2;
  }
  return onsetEnvelope(low, sr);
}

function combScore(env, periodHops, phaseHops, from, to) {
  let s = 0;
  for (let t = phaseHops + from; t < to; t += periodHops) {
    const i = Math.floor(t);
    const f = t - i;
    s += (env[i] ?? 0) * (1 - f) + (env[i + 1] ?? 0) * f;
  }
  return s;
}

/** Refines BPM (±1.5) and phase over the analysis window [from, to) in hops. */
function findBeatGrid(env, bpm, from, to) {
  let best = { score: -1, bpm, phase: 0 };
  for (let b = bpm - 1.5; b <= bpm + 1.5; b += 0.01) {
    const period = 60 / b / HOP;
    for (let ph = 0; ph < period; ph += 0.5) {
      const s = combScore(env, period, ph, from, to);
      if (s > best.score) best = { score: s, bpm: b, phase: ph };
    }
  }
  return best;
}

function writeWav(file, left, right, sr) {
  const n = left.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(left[i] * 32767))), 44 + i * 4);
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(right[i] * 32767))), 46 + i * 4);
  }
  writeFileSync(file, buf);
}

/** Decodes a 16-bit PCM WAV into float channels. */
function decodeWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a WAV file');
  let o = 12;
  let fmt = null;
  while (o + 8 <= buf.length) {
    const id = buf.toString('ascii', o, o + 4);
    const size = buf.readUInt32LE(o + 4);
    if (id === 'fmt ') fmt = { format: buf.readUInt16LE(o + 8), channels: buf.readUInt16LE(o + 10), sampleRate: buf.readUInt32LE(o + 12), bits: buf.readUInt16LE(o + 22) };
    if (id === 'data') {
      if (!fmt || fmt.format !== 1 || fmt.bits !== 16) throw new Error('only 16-bit PCM WAV is supported; export the song as MP3 or 16-bit WAV');
      const frames = Math.floor(size / (2 * fmt.channels));
      const L = new Float32Array(frames);
      const R = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        const p = o + 8 + i * 2 * fmt.channels;
        L[i] = buf.readInt16LE(p) / 32768;
        R[i] = fmt.channels > 1 ? buf.readInt16LE(p + 2) / 32768 : L[i];
      }
      return { L, R, sr: fmt.sampleRate };
    }
    o += 8 + size + (size % 2);
  }
  throw new Error('WAV has no data chunk');
}

const decoder = new MPEGDecoder();
await decoder.ready;

async function decodeMp3(bytes) {
  await decoder.reset();
  // Feed the decoder in chunks; one large buffer makes mpg123 report errors.
  const partsL = [];
  const partsR = [];
  let sr = 44100;
  for (let i = 0; i < bytes.length; i += 16384) {
    const r = decoder.decode(bytes.subarray(i, i + 16384));
    if (r.samplesDecoded === 0) continue;
    sr = r.sampleRate;
    partsL.push(r.channelData[0]);
    partsR.push(r.channelData[1] ?? r.channelData[0]);
  }
  const concat = (parts) => {
    const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  };
  return { L: concat(partsL), R: concat(partsR), sr };
}

const meta = [];
for (const t of TRACKS) {
  const srcFile = path.join(srcDir, t.file);
  const prev = previous.find((p) => p.id === t.id);
  if ((only && only !== t.id) || !existsSync(srcFile)) {
    if (prev && existsSync(path.join(outDir, `${t.id}.wav`))) {
      meta.push(prev);
      if (!only || only === t.id) console.info(`${t.title}: source not found, keeping the existing excerpt`);
      continue;
    }
    throw new Error(`${t.title}: source file not found: assets/audio/source/${t.file}`);
  }
  const raw = readFileSync(srcFile);
  const { L, R, sr } = /\.wav$/i.test(t.file) ? decodeWav(raw) : await decodeMp3(new Uint8Array(raw));
  const mono = new Float32Array(L.length);
  for (let i = 0; i < L.length; i++) mono[i] = (L[i] + R[i]) / 2;
  const env = onsetEnvelope(mono, sr);

  // Analyse the window we intend to use (plus margin) so the grid fits that part of the song.
  const approxBeat = 60 / t.bpm;
  const winFrom = Math.max(0, Math.round((t.startNear - 2) / HOP));
  const winTo = Math.round((t.startNear + t.beats * approxBeat + 2) / HOP);
  if (winTo * HOP > L.length / sr) throw new Error(`${t.title}: the song is too short for startNear ${t.startNear} s + ${t.beats} beats`);
  const grid = findBeatGrid(env, t.bpm, winFrom, winTo);
  const beatSec = 60 / grid.bpm;
  // Tempo from the full mix; beat position from the kick (see lowOnsetEnvelope).
  const lowEnv = lowOnsetEnvelope(mono, sr);
  const periodHops = beatSec / HOP;
  let bestPhase = { s: -1, ph: grid.phase };
  for (let ph = 0; ph < periodHops; ph += 0.5) {
    const s = combScore(lowEnv, periodHops, ph, winFrom, winTo);
    if (s > bestPhase.s) bestPhase = { s, ph };
  }
  const phaseSec = bestPhase.ph * HOP;
  // First beat at or after startNear, on the beat grid (relative to the window start).
  const k = Math.ceil((t.startNear - winFrom * HOP - phaseSec) / beatSec);
  const cutStart = winFrom * HOP + phaseSec + k * beatSec;
  // Begin one beat early so the first beat is not clipped by the fade-in.
  const segStart = Math.max(0, cutStart - beatSec);
  const segLen = (t.beats + 2) * beatSec;
  const s0 = Math.round(segStart * sr);
  const n = Math.round(segLen * sr);
  const left = L.slice(s0, s0 + n);
  const right = R.slice(s0, s0 + n);
  const fadeIn = Math.round(0.03 * sr);
  const fadeOut = Math.round(2 * sr);
  for (let i = 0; i < n; i++) {
    const g = Math.min(1, i / fadeIn, (n - i) / fadeOut);
    left[i] *= g;
    right[i] *= g;
  }
  const outFile = `${t.id}.wav`;
  writeWav(path.join(outDir, outFile), left, right, sr);
  const m = {
    id: t.id,
    title: t.title,
    artist: t.artist,
    file: `audio/${outFile}`,
    bpm: Number(grid.bpm.toFixed(2)),
    firstBeatSec: Number((cutStart - segStart).toFixed(4)),
    durationSec: Number(segLen.toFixed(3)),
    beats: t.beats,
    sourceStartSec: Number(segStart.toFixed(3)),
    license: {
      source: t.license.source,
      license: t.license.license,
      attribution: `${t.license.attribution ?? `"${t.title}" by ${t.artist}, ${t.license.license}.`} Cut to a ${segLen.toFixed(0)} s excerpt with fades.`,
      placeholder: t.license.placeholder ?? false,
    },
  };
  meta.push(m);
  console.info(`${t.title}: bpm ${m.bpm} (given ${t.bpm}), excerpt from ${segStart.toFixed(2)} s, ${segLen.toFixed(1)} s`);
}
decoder.free();
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'tracks.json'), JSON.stringify(meta, null, 2) + '\n');
console.info(`tracks.json: ${meta.length} songs. Next: add new ids to assets/choreography/plan.json "difficulty" (optional) and the event profile's enabledRoutines, then run pnpm assets:routines.`);

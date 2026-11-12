// Prints each dance clip's measured beat (see clip-beats.ts). Usage: pnpm exec tsx scripts/analyse-clips.ts
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type * as THREE from 'three';
import { ClipPlayer, fitHipsToCharacter, parseModel, retargetClips } from '../apps/desktop/src/renderer/participant/scene/glb';
import { measureClipBeat } from './clip-beats';
const g = globalThis as { document?: unknown };
g.document ??= { createElementNS: () => ({ style: {}, addEventListener() {}, removeEventListener() {}, setAttribute() {} }) };
const assets = path.resolve('assets');
const bytes = (f: string) => { const b = readFileSync(path.join(assets, f)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const model = await parseModel(bytes('characters/Michelle.fbx'), 'Michelle.fbx');
const dir = process.argv[2] ?? 'animations/mixamo';
const clips: THREE.AnimationClip[] = [];
for (const f of readdirSync(path.join(assets, dir)).filter((f) => f.endsWith('.fbx'))) clips.push(...(await parseModel(bytes(`${dir}/${f}`), f)).animations);
const player = new ClipPlayer(model.scene, fitHipsToCharacter(model.scene, retargetClips(model.scene, clips), 'happy-idle'));
for (const c of clips) {
  const b = measureClipBeat(player, model.scene, c.name);
  console.info(`${c.name.padEnd(22)} ${c.duration.toFixed(2)}s  beat ${b.beatSec.toFixed(3)}s (${(60 / b.beatSec).toFixed(1)} bpm)  downbeat ${b.downbeatSec.toFixed(2)}s  ${b.beats} beats  conf ${b.confidence}${b.loops ? "  loops" : ""}`);
}

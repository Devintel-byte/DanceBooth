# 0001 — Stack and pinned versions

**Context.** Fresh repository (no legacy code, no lockfile). Spec requires Electron + Forge + Vite, React, Three/R3F, MediaPipe Tasks Vision, XState, Zod, Vitest, ESLint.

**Decision.** pnpm workspace (pnpm 12.5.1), exact versions:

| Package | Version | Note |
| --- | --- | --- |
| electron | 45.2.1 | Binary is downloaded on first use (no postinstall in this major); run `node node_modules/electron/install.js` if missing |
| @electron-forge/* | 8.0.1 | Main/preload emitted as `.cjs`; Vite template merged into plugin-vite |
| vite | 8.3.5 | |
| typescript | 6.0.3 | **Not 7.x**: typescript-eslint 8.72 supports `<6.1` |
| react / react-dom | 19.3.1 | R3F 9.8 peer range `<19.4` |
| three / @types/three | 0.187.0 | |
| @react-three/fiber | 9.8.2 | Drei **not used** (its GLTF helpers default to CDN Draco decoders) |
| @mediapipe/tasks-vision | 1.2.0 | |
| xstate / @xstate/react | 5.33.3 / 6.1.0 | |
| zod | 4.6.7 | |
| vitest | 5.0.5 | |
| @playwright/test | 1.64.1 | |

`nodeLinker: hoisted` because Forge packaging expects a flat `node_modules`.
`allowBuilds` whitelists electron, electron-winstaller, esbuild (pnpm blocks other install scripts).
`@vitejs/plugin-react@6.2.1` was younger than pnpm's minimum release age and is explicitly excluded in `pnpm-workspace.yaml`; revisit when updating.

Workspace packages are consumed as TypeScript source (`exports: ./src/index.ts`) and bundled by Vite; no separate package build step.

No native modules and no SQLite (JSON/JSONL suffices for settings, content and anonymous records), so there are no Electron ABI rebuild concerns.

**Consequences.** Upgrading TS to 7 waits on typescript-eslint. Electron binary download must be part of machine setup (documented in the release checklist).

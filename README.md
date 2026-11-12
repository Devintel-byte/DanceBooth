# Maltina Dance All

Offline, Windows-first dance game for a staffed event booth, built by Moving
Surface Interactive Media for Maltina. Players pick a 3D dancer, follow a
choreographed routine to the music, and a webcam with pose tracking (MediaPipe Pose
Landmarker) scores how well they match. Solo and two-player sessions, player names
and ids, a separate operator console, a live leaderboard window, and a LAN score
feed for the event's main leaderboard (with player numbers for registered players; see
[docs/score-feed-protocol.md](docs/score-feed-protocol.md)).

Event content is data, not code: the Maltina branding is an event profile
(`assets/profiles/maltina.json`), and characters, songs and dances are files in
`assets/`. See [docs/rebranding.md](docs/rebranding.md) and
[docs/custom-music.md](docs/custom-music.md).

> **Status:** feature-complete for a first event. Not yet validated with real
> players at booth distance or on the final booth PC; see
> [docs/progress.md](docs/progress.md) for what is verified.

## Quick start (Windows)

Prerequisites: Node.js 24+, pnpm 12 (`corepack enable` or the standalone installer), Git.

```bash
pnpm install
pnpm setup:assets
pnpm dev
```

`setup:assets` copies the MediaPipe WASM runtime out of `node_modules` and downloads the
Pose Landmarker models (hash-locked in `assets/tracking-models/models.lock.json`).
It is the only step that needs the internet; the app itself never does.

`pnpm dev` opens the participant window and the operator console. With no camera, the
self-check fails into maintenance; choose **Use replay (demo)** then **Exit maintenance**
in the operator console, or start with `BOOTH_FORCE_REPLAY=1` (dev builds only).

**If `pnpm dev` shows old screens, a blank participant window, or logs
`Cannot read properties of null (reading 'useMemo')`:** close the app and run
`pnpm dev:clean`, which clears Vite's caches before starting.

## Build the installer

```bash
pnpm check
pnpm make:win
```

→ `apps/desktop/out/make/squirrel.windows/x64/MaltinaDanceAllSetup.exe`.
Full steps, signing and booth-PC setup: [docs/release-checklist.md](docs/release-checklist.md).

## Scripts

| Script | What it does |
| --- | --- |
| `pnpm dev` | Electron Forge dev mode (Vite dev servers, hot reload) |
| `pnpm dev:clean` | Clears Vite caches, then `pnpm dev` |
| `pnpm check` | typecheck + lint + tests + content validation |
| `pnpm typecheck` / `lint` / `test` | The parts of `check` on their own |
| `pnpm format` / `format:check` | Prettier |
| `pnpm content:validate` | Validates profiles, routines, characters, fixtures, models (same loader as the app) |
| `pnpm test:e2e` | Builds the production bundle, then Playwright E2E against Electron in replay mode |
| `pnpm build` | `electron-forge package` → `apps/desktop/out/Maltina Dance All-win32-x64/` |
| `pnpm make:win` | Squirrel installer + zip for Windows |
| `pnpm setup:assets` | `assets:wasm` + `assets:models` |
| `pnpm assets:music` | Cuts beat-aligned excerpts of the songs in `assets/audio/music.json` |
| `pnpm assets:routines` | Builds each song's routine (16 random on-beat dances + their scoring moves) from `assets/choreography/plan.json` |
| `pnpm assets:songs` | `assets:music` + `assets:routines` + `assets:dev-content`: rebuild every song, routine and test fixture after changing music or dances |
| `pnpm assets:portraits` | Renders character-select portraits from the 3D characters |
| `pnpm assets:prune` | Deletes characters, clips, songs, routines and fixtures nothing uses (`--dry-run` to list) |
| `pnpm assets:dev-audio` / `assets:dev-content` | Regenerate the test track / dev routine + synthetic fixtures |

Hardware-dependent E2E: `BOOTH_E2E_WEBCAM=1 pnpm --filter @booth/desktop exec playwright test e2e/webcam-smoke.spec.ts`.
Screenshots: `BOOTH_E2E_SCREENSHOTS=1 ... e2e/screenshots.spec.ts` (writes `docs/screenshots/`).

## Repository layout

```
apps/desktop/          Electron app (Forge + Vite)
  src/main/            lifecycle, windows, protocols, security, IPC, settings, logs, score feed
  src/preload/         narrow role-specific bridges (participant / operator / leaderboard)
  src/renderer/        participant UI + 3D stage, operator console, leaderboard
  src/workers/         MediaPipe pose worker
  e2e/                 Playwright Electron tests
packages/
  contracts/           shared types, Zod schemas, IPC channels, error codes
  session/             XState session machine
  tracking/            provider interface, replay, player assignment, smoothing, frame gate, calibration
  scoring/             pure geometric scoring + synthetic pose generator
  choreography/        audio-clock song timeline, clip timeline sampling
  content/             content loading/validation, safe asset paths
  diagnostics/         rolling stats, log retention planning
assets/                content served at runtime via booth-asset://
  profiles/            event profile (maltina)
  branding/            logos and fonts
  characters/          Mixamo characters, catalog.json, portraits
  animations/mixamo/   dance clips
  audio/               song excerpts, music.json, tracks.json (source/ is not committed)
  choreography/        plan.json (which clips the dances are made from)
  routines/            generated routines
docs/                  guides, architecture, decisions, runbooks, progress
scripts/               asset/content tooling
```

## Documentation

- [Rebranding, events and characters](docs/rebranding.md)
- [Adding your own music](docs/custom-music.md)
- [Content pipeline and art contract](docs/content-pipeline.md)
- [Building the installer and releasing](docs/release-checklist.md)
- [Operator runbook](docs/operator-runbook.md)
- [Hardware qualification](docs/hardware-qualification.md)
- [Score feed protocol](docs/score-feed-protocol.md)
- [Central registry and results (event-results/1)](docs/central-integration.md)
- [Privacy](docs/privacy.md)
- [Asset and font licences](docs/asset-licenses.md)
- [UI design guide](docs/ui-design-guide.md) and [visual QA checklist](docs/visual-qa-checklist.md)
- [Architecture](docs/architecture.md) and [decision log](docs/decisions/)
- [Progress log](docs/progress.md)

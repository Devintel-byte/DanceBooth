# Building the installer and releasing

## Build machine (Windows)

* Windows 10/11 x64, Node.js 24+, pnpm 12, Git.
* In the project folder (`E:\dancebooth`):

  ```bash
  pnpm install
  pnpm setup:assets
  ```

  `setup:assets` copies the MediaPipe WASM runtime and downloads the hash-locked pose
  models. If `pnpm install` did not download the Electron binary, run
  `node node_modules/electron/install.js`.

## Before building: tidy `assets/`

Everything in `assets/` is copied into the installer (except `assets/audio/source/`
and the development test routine, which the build removes). Run

```bash
pnpm assets:prune --dry-run
pnpm assets:prune
```

to delete characters, clips, songs, routines and fixtures that nothing uses, and
remove by hand anything else that does not belong (a stray `assets/Michelle.fbx` at the
top of `assets/`, 0-byte failed downloads, old test exports). Mixamo files must not be
redistributed, so keep the installer private to the client's booths.

## Build

```bash
pnpm check
```

Typecheck, lint, unit tests and content validation. All must pass.

```bash
pnpm make:win
```

Takes a few minutes. Output in `apps/desktop/out/make/`:

* `squirrel.windows/x64/MaltinaDanceAllSetup.exe`: the installer to run on booth PCs.
* `zip/win32/x64/Maltina Dance All-win32-x64-<version>.zip`: portable copy (unzip and
  run `maltina-dance-hall.exe`), useful for a quick test.

Optional, before a release: `pnpm test:e2e` (builds and drives the app in replay mode).

### Version number

Bump `"version"` in `apps/desktop/package.json` (the first production release is
`1.0.0`; next `1.0.1`, `1.1.0`…) before each build you give out, so installers can be
told apart and Squirrel upgrades in place.

### Code signing

Unsigned installers work but Windows SmartScreen shows "Windows protected your PC"
→ **More info** → **Run anyway**. For client handover, sign with an Authenticode
certificate (EV avoids SmartScreen warm-up): set `WINDOWS_CERTIFICATE_FILE` and
`WINDOWS_CERTIFICATE_PASSWORD` before `pnpm make:win`. Never commit them.

## Install on a booth PC

1. Copy `MaltinaDanceAllSetup.exe` to the PC and run it. Squirrel installs per user
   into `%LOCALAPPDATA%\MaltinaDanceAll` and starts the app; a Start-menu and desktop
   shortcut named **Maltina Dance All** are created.
2. The participant window opens full screen, the operator console in a window.
   Operator console → **Event profile** should read **Maltina**.
3. Allow camera access if Windows asks (Settings → Privacy → Camera → desktop apps).
4. Follow [operator-runbook.md](operator-runbook.md) "Daily start" and run one solo and
   one duo session.

Data (settings, player ids, records, logs) is in `%APPDATA%\Maltina Dance All`. On
the first start the app copies settings, player ids, records and logs from an older
`%APPDATA%\DanceOff Booth` folder if one exists; the old folder is left as it was.

Uninstall: **Settings → Apps → Maltina Dance All → Uninstall**. The data folder is kept.

## Release gates

- [ ] `pnpm assets:songs` run after the last music or dance change; `pnpm assets:prune` run
- [ ] `pnpm check` green; E2E green; content validation green
- [ ] Central registry (if used): the main application approves scoring version `danceoff-points-v3`
- [ ] All routine/character/audio/brand assets recorded in `docs/asset-licenses.md`, with `placeholder: false`
- [ ] Music cleared for live public use at this event (see [custom-music.md](custom-music.md))
- [ ] Brand colours, logo and name approved by the client
- [ ] Third-party notices include Apache-2.0 text for the MediaPipe model and WASM
- [ ] Hardware qualification H1–H15 recorded on the actual booth PC
- [ ] Installer tested on a clean Windows account; offline start verified (unplug network)
- [ ] Previous known-good installer archived with its version and SHA-256 (`certutil -hashfile MaltinaDanceAllSetup.exe SHA256`)
- [ ] Rollback tested: uninstall, reinstall previous installer, settings preserved
- [ ] Security review of any change to main/preload/protocol/IPC

## Rollback

Keep every released installer and its SHA-256. To roll back: uninstall the current
version, run the previous installer. Settings and records live in the data folder and
survive. Auto-update is not enabled; any future updater must only install in an
operator-approved maintenance window, never during a session.

## Troubleshooting the build

| Symptom | Fix |
| --- | --- |
| `pnpm make:win` fails at "Making for target squirrel" | Close every running copy of the app and any Explorer window open on `apps/desktop/out`, delete `apps/desktop/out`, run again |
| Installer runs but the app shows "Back in a moment · MODEL_MISSING" | `pnpm setup:assets` was not run before building |
| `app.asar` is 0 bytes / app does not start | A previous build was interrupted. Delete `apps/desktop/out` and `apps/desktop/.vite`, rebuild |
| Old screens in `pnpm dev` | `pnpm dev:clean` (clears Vite caches) |

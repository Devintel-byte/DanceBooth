# 0007 — E2E tests attach over CDP

Playwright 1.64 `_electron.launch()` hung against Electron 45.2.1 (it attached the Node inspector and DevTools but never resolved). Instead `e2e/launch.ts` spawns Electron with `--remote-debugging-port=0`, reads the announced endpoint, and uses `chromium.connectOverCDP()`. Tests drive and inspect the two windows; the main process is observed only through them and the log files.

E2E runs against the **production bundle in `.vite/`** (unpackaged, unfused) so `BOOTH_USER_DATA_DIR` and `BOOTH_FORCE_REPLAY` can be honoured; both are ignored when `app.isPackaged`. `pnpm test:e2e` rebuilds first because `electron-forge start` overwrites `.vite/` with dev-server URLs.

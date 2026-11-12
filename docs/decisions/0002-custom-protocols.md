# 0002 — Custom protocols instead of file://

**Context.** The renderer must load GLB, audio (decode + seek), WASM, MediaPipe models and a module worker, offline, from packaged resources, without disabling web security.

**Decision.** Register two privileged standard/secure schemes before `ready`:

* `booth-app://<role>/…` serves the built renderer for each window. Hosts give each window a distinct origin; IPC and permission checks compare against it.
* `booth-asset://content/…` serves the `assets/` tree (dev: repository; packaged: `resources/assets` via Forge `extraResource`). `supportFetchAPI`, `corsEnabled`, `stream`; responses carry explicit MIME types, `nosniff`, byte-range support, and CORS only for app/dev origins. Paths go through `resolveAssetPath()`.

In dev the renderers come from the Vite dev server (http://localhost) and fetch assets cross-origin from `booth-asset://` with CORS.

**Alternatives rejected.** `file://` (opaque origins, no CORS, weak isolation); disabling `webSecurity`; bundling models/WASM into the renderer build (duplicates large binaries and couples content to code).

**Verified.** Packaged build: worker + WASM + model loaded via `booth-asset://` and inference ran on the integrated webcam. E2E: `%2e%2e` traversal returns 404.

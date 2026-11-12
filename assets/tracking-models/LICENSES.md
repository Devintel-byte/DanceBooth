# Tracking model and runtime licences

| File | Source | Licence |
| --- | --- | --- |
| `pose_landmarker_lite.task`, `pose_landmarker_full.task` | Google MediaPipe model storage (`storage.googleapis.com/mediapipe-models/pose_landmarker/...`, version 1, float16). URLs and SHA-256 in `models.lock.json`. | Apache License 2.0 (MediaPipe Pose Landmarker model card) |
| `wasm/*` | Copied from the `@mediapipe/tasks-vision` npm package (version in `wasm/VERSION`) | Apache License 2.0 |

Both are fetched/copied at build time by `pnpm assets:models` and `pnpm assets:wasm`
and bundled into the packaged app. The app never downloads them at runtime.
Before a commercial release, re-check the model card terms and include the
Apache-2.0 licence text and NOTICE in the installer's third-party notices.

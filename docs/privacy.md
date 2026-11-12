# Privacy

> **Change on 2026-11-03, at the client's request:** players now enter a
> **display name** before playing. The name is shown on the leaderboard and sent
> to the event scoreboard PC over the LAN score feed. The name screen tells
> players this and asks them not to use their full name. Names are stored in
> `players/players-<event>.json` under the app's user-data folder, next to a
> serial player id. **Clear leaderboard names** in the operator console deletes
> them on the booth; copies already sent to the scoreboard PC must be deleted
> there. Before a public event, confirm with the client the lawful basis and
> notice wording that apply (for example under Nigeria's NDPA 2023), how long
> names are kept, and who runs the scoreboard PC. The rest of this page
> describes the original, name-free defaults; everything else in it still
> applies.

> **Central registry (optional, off by default).** When an operator switches
> it on, the booth looks up official players by registration code with the
> event's main application and sends each verified player's points, round and
> time there over HTTPS. Stored on the booth under `central/`: participant id,
> display name, status and a **hash** of the code (not the code), result
> history and the outgoing queue; delivered results are deleted after
> `retentionDays` (default 180). The source credential is encrypted with
> Windows DPAPI. No images, landmarks or outfit colours are sent. The main
> application's operator is responsible for the registry data and its
> notice. See [central-integration.md](central-integration.md). The "No
> network" default below applies whenever it is off.

Defaults (enforced in code, not just policy):

* **No recording.** Camera frames exist only in the participant renderer and the pose worker, as transient ImageBitmaps that are closed after inference. Video never crosses IPC, never touches disk, never leaves the PC.
* **No face recognition, no identity.** Pose landmarks only; players are "P1/P2" slots for the duration of one session.
* **No network.** No telemetry, analytics, uploads or update checks. The CSP forbids remote content.
* **No participant fields.** No names, emails, photos or QR sharing.

Stored locally (under the app's user-data folder):

| Data | Content | Retention |
| --- | --- | --- |
| `records/sessions-YYYY-MM-DD.jsonl` | session counter, event profile id, routine, mode, difficulty, end reason, duration, input source, per-slot score and counts | `retention.sessionRecordDays` (default 30; 0 disables) |
| `logs/booth-*.log` | operational events and errors, no images or landmarks | `retention.logDays` (default 14) and `retention.maxLogBytes` (default 50 MB) |
| `diagnostics/*.json` | exported on operator request: versions, settings, metrics, recent log | Manual |
| `settings.json` | booth configuration | Until changed |

Participant UI state (selections, scores, calibration) is cleared on every reset.

Replay fixtures shipped with the app are synthetic. Any recorded landmark fixture must come from consenting testers, contain landmarks only, and document consent in its provenance.

A future photo/QR sharing feature is a separate consent and data-lifecycle project and must not be added implicitly.

# Operator runbook

## Daily start

1. Power on the booth PC; the app starts (see Booth PC configuration).
2. The participant screen shows "Warming up…" during self-check (content, audio, camera, tracker).
3. Operator console: the title reads **Maltina Dance All · Operator** and **Event profile** shows **Maltina**; the state pill shows **ATTRACT**, Camera & tracking shows `MediaPipe GPU|CPU` with an update rate above ~15 Hz.
4. Press **Play audio test**; confirm three rising tones on the speakers.
5. Stand in the play area and run one solo session end to end.

## During the event

| Need | Action |
| --- | --- |
| Start for a guest | Guests press START (Enter / gamepad A), or use **Start solo / Start duo** |
| Change the song | Pick it in **Song** in the console: every new session starts with it (until the app restarts; then it is the first song in the event profile). Guests can change it themselves on the character screen with the **Song** list at the top left, or LB / RB on the controller (Page Up / Page Down on a keyboard) |
| Guest cannot calibrate | Coach them using the on-screen hint. After 15 s the screen offers **Press START to dance anyway**; you can also **Skip calibration**. Calibration never gives up while someone is in view; it returns to the start only after nobody has been seen for 25 s (countdown shown) |
| Pause / resume | **Pause**, **Resume** (resume has a 1 s lead-in) |
| Anything wrong mid-song | **Abort & reset** (works in every active state) |
| Tracking frozen / low rate | **Restart tracking** |
| Switch camera | Pick it in **Camera**; the choice is saved |
| Connect the main leaderboard | **Main leaderboard connection**: give the main leaderboard the **Address** (`IP:port`) and the **Shared key** (Copy). The status bar at the top turns green: "Connected to the main leaderboard". Amber means it has not connected yet; red shows the problem. See [score-feed-protocol.md](score-feed-protocol.md) |
| Player numbers | Players type their 4-digit player number before their name (optional). While they type, the console shows the number and the registered name: **check the name with the player before starting**. "Number not recognised" means check it, or they play as a guest (the number is still sent). The public screen shows the number as dots. **Player list** in the console shows how many registered players the booth knows |
| Azure Kinect will not start | Check **Camera driver** says Active: DirectShow (Auto switches when you pick the Kinect, after a restart). Use its own power supply and a USB 3 port on the PC; close Azure Kinect Viewer and other Kinect apps; **Restart tracking**. Details: [hardware-qualification.md](hardware-qualification.md#azure-kinect-dk) |
| Camera unavailable | **Use replay (demo)** to keep the attract loop alive, fix the camera, then **Use live camera** |
| Sound out of sync | Adjust **A/V offset** in 10 ms steps (positive = judge later) |
| Participant screen frozen/crashed | **Reload participant screen** (automatic reload happens up to 3× per 10 min first) |
| Report a problem | **Export diagnostics**; the path is shown (no images inside) |
| Different event / brand | **Event profile** in Maintenance, then **Reload participant screen** (starts that event's own leaderboard) |
| Duo players get mixed up | Make sure **Duo: track each half separately** is ticked (Camera & tracking). Ask the pair to stand in their own boxes until both are "Locked in"; different-coloured tops help most |
| Official competition player | **Central registry → Players for the next game**: type the player number, check the name with the person, **Confirm**. Play again keeps them; finishing clears them. See [central-integration.md](central-integration.md) |
| Result shows "blocked" or "unresolved" | Read the reason on the row. Fix the cause, then **Retry**; for unresolved, **Assign player…** with their code. Wrong score: **Correct…** or **Void** (never edit files) |
| Show the leaderboard | **Open leaderboard window** (Leaderboard panel), then **Move to next display** and **Fullscreen** on the leaderboard itself or in the console |

Maintenance: **Enter maintenance** stops sessions and shows "Back in a moment"; **Exit maintenance** re-runs the self-check.

Kiosk escape on the participant screen: **Ctrl+Shift+Alt+M** leaves kiosk and focuses the operator console.

## Error states

| Participant sees | Likely cause | Operator action |
| --- | --- | --- |
| "Back in a moment" + console banner `CAMERA_*` | Camera unplugged, used by another app, or permission | Reconnect / close other app, **Exit maintenance** |
| `MODEL_MISSING` / `MODEL_INIT_FAILED` | Missing or corrupt model files | Reinstall known-good build |
| `AUDIO_LOAD_FAILED` | Missing/corrupt song | Content validation; reinstall |
| `CONTENT_INVALID` banner | Invalid manifest/profile | Fix content, rerun `pnpm content:validate` |
| "We can't see you!" (paused) | Everyone left the frame for 5 s | Guest steps back in; **Resume** |
| Repeated "One moment…" then maintenance | 3 automatic recoveries failed | Export diagnostics, then fix |

## Booth PC configuration

Kiosk mode is a window feature, not a security boundary. For an unattended booth:

* Dedicated local Windows account with auto-logon; app in that account's startup (shortcut in `shell:startup`) or Task Scheduler "At log on".
* Windows **Assigned Access** / Shell Launcher (Windows Pro/Enterprise) to restrict the account to the app, if required.
* Disable sleep/screen saver in power settings (the app also blocks display sleep while running), disable Windows Update active hours conflicts, notifications (Focus assist), and touch/edge gestures.
* Camera privacy: Settings → Privacy → Camera → allow desktop apps.
* External watchdog for total process failure (the app cannot restart itself after the main process dies): Task Scheduler task "If the task fails, restart every 1 minute, up to 3 times", or a small service wrapper. Do not loop forever.
* Wired audio output set as default device; set volume and disable audio enhancements.
* Data folder: `%APPDATA%\Maltina Dance All` (settings, player ids, records, logs). Back it up after each event day if the leaderboard or player list matters.

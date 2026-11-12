# Progress log

## Session 14c — 2026-11-04 (scoring eased a little)

* Match bar 0.72 → 0.68, close bar 0.58 → 0.52, easy angle tolerance 22°/72° → 24°/76°. Real-style followers gain 1–4 points per 100; random fast waving on easy goes from about 7 % to 10 %; standing still still scores 0. Details in [decision 0007](decisions/0007-fair-scoring.md).

## Session 14b — 2026-11-04 (player numbers instead of badge codes)

* **No QR codes, camera or scanner**: the scan button, camera image access and the QR library were removed.
* **Player numbers**: 4 digits printed on the player's card ("Player number", e.g. `0377`), handled as text (leading zeros kept). One short field, **Player number (optional)** (`inputmode="numeric"`, digits only, max 4, spaces and dashes ignored), looked up as soon as 4 digits are typed. Known → name filled and locked, "✓ Tolu Adeyemi · competing for the prize"; unknown → "Number not recognised. Check it, or play as a guest." (still sent); none → guest. `players[].code` in records and the `registry` message is the 4-digit string; `ref` is ignored.
* **Numbers kept private**: the public screen shows the number as dots and the boards show names only (Guest tag for players without a number). The operator console shows the number and the registered name during entry, to check with the player.
* Entry screen simplified: number and name side by side, no long hints or footnotes.

## Session 14 — 2026-11-04 (main leaderboard connection, badge codes)

* **Score feed brought up to the LeaderboardHQ spec** (`danceoff.scorefeed` v1, DanceHall = `booth-1`, port 8787). `hello` advertises `capabilities: ["registry"]`; `snapshot` carries `{ records }` (completed sessions of the day, oldest first); records have integer `points`, `code` for badge players, the registered or entered `name`, stable `uid`/`recordId`; demo, aborted and unreadable runs are never sent. The main leaderboard is recognised by `client=leaderboardhq`; other scoreboards still get the booth's own board. Keys compared in constant time, 401/503 as specified, 4 KB inbound cap (2 MB on the main leaderboard's connection, because the player list is a full list). The feed is now on by default.
* **Player list and badge codes.** The main leaderboard's `registry` message replaces a cached, persisted player list (codes never logged; the participant screen can only look up the code that was entered). Player entry asks for an optional badge code first: typed, handheld scanner, or **Scan badge** with the booth camera (QR, jsQR). Recognised code → registered name locked with "✓ name · #ref · competing for the prize"; unknown → warning, still sent; none → guest. The code is stored with the player's sessions. The booth leaderboard shows a **Guest** tag.
* **Operator console.** New **Main leaderboard connection** panel (enable, port, booth id; `IP:port` addresses with Copy; key Show/Copy/New key with confirmation; player list status; firewall command with Copy; connection log of the last 100 entries with Copy log), an always-visible status bar (Off / Waiting / Connected (IP) / Problem, last session sent) and toasts. The shared key no longer reaches the console unless the operator clicks Show (Copy works in the main process).
* Tests: feed (14), player list and entry rules (10), end-to-end badge flow and console status. Docs: [score-feed-protocol.md](score-feed-protocol.md), operator runbook.

## Session 13 — 2026-11-04 (simple moves only, no points for taking part, production 1.0.0)

* **Simple moves only.** The client removed the hip-hop isolation moves (Robot, Arms, Wave, Body Wave) as too hard. 15 more Mixamo dances were downloaded and every clip was measured (hand and foot speed, squats); the pool is now 12 moves anyone can copy: Just Listening, Twist, Silly Twist, Cabbage Patch, Raise the Roof, YMCA, Macarena, Chicken Dance, Arm Wave, Rumba (basic step), Shimmy and Step Hip Hop. Rejected: fast footwork (salsa, jazz square, Gangnam Style, Northern Soul, slide step, shopping cart), Hokey Pokey (turns away from the camera), Booty Step (not for a family brand). `beatOverrides` can now mark a clip as a loop (used for Rumba).
* **Scoring v3 (`danceoff-points-v3`): 10 for a match, 4 for close, 0 otherwise.** No points for just moving, standing still or being out of frame; stricter match/close bars; the builder judges each move at the dancer's stillest moment. Random movement scores 2–7 % (was 15–30 % with the "made a move" points); a perfect copy of the 3D dancer 92–100 % on easy. Details and numbers: [decision 0007](decisions/0007-fair-scoring.md). The central registry must approve `danceoff-points-v3`.
* **Content synced with the client's cleanup.** Songs: Maltina Theme, Unlock Me, My Bebe, The Hills, Afro Trap Fusion, Funkorama (Funky Chunk, Disco Medusae and Amatry removed; the profile still listed Amatry and not Funkorama, fixed). Robo character and the development profile removed.
* **Production prep.** Version 1.0.0. `pnpm assets:prune` (replaces `assets:prune-characters`) deletes characters, clips, songs, routines and fixtures nothing uses. The installer no longer ships the development routine, its audio or test fixture. Replay/demo mode uses a fixture of the default song (`fixtures/demo-synthetic.json`). Docs updated (assets README, licences, release checklist).

## Session 12b — 2026-11-04 (song choice, simpler moves)

* **Song switching fixed.** The song chosen in the operator console only applied when the operator pressed Start; a guest pressing START always got the first song. Now the console's **Song** choice is the song every new session starts with (new `select-routine` command, `SET_DEFAULT_ROUTINE` in the session machine), and the attract dancer follows it.
* **Song list on the character screen** (top left): tap to open the list, or LB / RB on a controller (Page Up / Page Down or `[` `]` on a keyboard). Checked with a new end-to-end test (`e2e/song-picker.spec.ts`).
* **Simpler moves.** The dance pool is now 12 simple, repeating steps: Side to Side and Step Hip Hop (the basic steps, picked most often), Raise the Roof, Chicken Dance, Arm Wave, Macarena, YMCA, Shimmy, Body Wave, Wave Hip Hop, Arms Hip Hop and Robot Hip Hop. Each is held longer (8 or 16 beats, mostly 16). The fast-footwork clips (the samba styles, Running Man, Shuffling, Kick Step, African Noodle and African Rainbow) were measured at 2–4× the foot speed of the others; they stay in `assets/animations/mixamo/` but are not used. All characters dance the same timeline, so Elizabeth, David, Lewis, Michelle and Remy all do these moves.

## Session 12 — 2026-11-04 (new characters dance, on-beat dances, a new dance every session)

* **Elizabeth, David and Lewis dance.** Their skeletons use numbered bone names (`mixamorig4:Hips`, `mixamorig10:Hips`), so the dance clips (`mixamorig:Hips`) did not move them. Clips are now retargeted to the character's own bone names when loaded (`retargetClips` in `glb.ts`; also in the routine builder and the portrait renderer). Checked by rendering David and Lewis mid-dance.
* **Theme song beat.** The beat grid of the Maltina theme song was half a beat late: the full-mix onsets locked on to the hi-hats and snares, which sit on the off-beats in Afrobeats. `prepare-music.mjs` now keeps the tempo from the full mix but takes the beat position from the kick and bass (below about 120 Hz). The theme's first beat moved from 0.425 s to 0.160 s; the other eight songs did not change.
* **Dances on the beat.** The routine builder measures each clip's own beat from the dancer's hip bounce (`scripts/clip-beats.ts`; `scripts/analyse-clips.ts` prints it). Every phrase starts on a song beat, on one of the clip's steps, played at the speed that puts its steps on the song's beats (a very fast clip plays at half time). Measured on the instructor: hip dips on the beat went from about 50 % to about 70 % (random would be 37 %); the rest are arm-led moves with little bounce. A clip whose beat is measured wrong can be fixed with `beatOverrides` in `plan.json`.
* **A new dance every session.** `plan.json` now lists a clip `pool` instead of fixed phrases. The builder makes 16 different random dances per song (`variations` in the routine). The booth plays a different one each session, never the one just played (`pickDance` / `withDance` in `@booth/choreography`). Every dance of a song judges the same number of moves, so points stay comparable on the leaderboard.
* **More dances.** 11 new Mixamo clips: five samba styles (Olodum, Afoxé, Pocotó, Gandy, Pagode — Afro-Brazilian), Shimmy, Body Wave, Shuffling, Running Man, Wave Hip Hop and Step Hip Hop. The African and Afro-Brazilian clips come up twice as often. Mixamo has no clip labelled "Afrobeat"; these are the closest it offers. ("Groove Side to Side" turned out to be the same animation as Side to Side and was not added.)

## Session 11c — 2026-11-04 (Azure Kinect, old characters removed)

* **Azure Kinect, from the booth log:** every attempt failed after exactly 10 s with Chromium's own "AbortError: Timeout starting video source" (Media Foundation capture), several starts ran at once (camera select + restart tracking + self-check) and fought over the device (NotReadableError, PC lag), and after a failed start the Kinect re-enumerated with a new id (OverconstrainedError on retries).
  * Fixes: camera starts are single-flight (requests merge); the camera is re-found by name before each attempt; new **Camera driver** setting (Auto / Media Foundation / DirectShow). Auto uses DirectShow, the path OBS uses, for Azure Kinect, Orbbec Femto and RealSense cameras (Chromium switch `disable-features=MediaFoundationVideoCapture`, set at startup). Selecting such a camera asks to restart and the app relaunches with the right driver. Still to be confirmed on the booth PC with the Kinect.
* **Characters:** Kaya, Ty and Sophie removed from the catalog, files and docs. New `pnpm assets:prune-characters` deletes unused character models and portraits.

## Session 11b — 2026-11-04 (Maltina theme song)

* Added the client's **Maltina Theme Song** (`maltina-theme`, 113 BPM, 45.7 s from the start, 38 moves, 31 judged) and made it the default song in the Maltina profile. Run `pnpm assets:songs` on the booth PC to build its audio and routine.

## Session 11 — 2026-11-04 (Black African characters, branded halls, Azure Kinect)

* **Characters:** Kaya, Ty and Sophie are replaced by Mixamo's **Elizabeth**, **David** and **Lewis** (with Michelle and Remy). The Sketchfab models suggested were checked: "Attractive African woman 236" is CC-BY but a posed photo-scan with no skeleton (cannot dance without rebuilding); "AFRO" is not downloadable (2.4 M polygons); "Zuri" is not downloadable and is built for NSFW content, unsuitable for a brand booth. Other free rigged options on Sketchfab were low quality or inappropriate. The three Mixamo files must be downloaded with the client's Adobe account (see rebranding.md); until then they are hidden, not an error.
  * New catalog options: `optional` (hidden until installed), `rig.heightM` (automatic scale from the model's height), portraits picked up automatically.
* **Dance Alls:** the studio is replaced by two branded halls (`BrandHall.tsx`): **solo** (one frosted-glass panel framing the dancer, orange and gold ribbons behind the glass, one rug) and **duo** (orange half for Player 1, gold half for Player 2, lit divider, a glass panel and a rug per player). Polished dark wood floor, LED cove lines, beat-breathing spotlights. Branding uses the event colours and ribbon shapes; the logo itself is not put in the scene (brand rules: never transparent, recoloured or a watermark). All generated in code; glass is a pre-blurred texture, so no extra render cost.
* **Azure Kinect:** camera start waits up to 20 s for a real first frame (was 8 s to open + 5 s to play), retries with 1280×720 and then the device default, pauses between attempts so the device can reset, names Kinect apps when the camera is busy, and logs every attempt. Not tested with a Kinect here.
* Checks: typecheck, lint, tests (232 passed, 1 skipped), content validation OK.

## Session 10 — 2026-11-04 (fair scoring, calibration that does not give up)

* **Scoring was biased toward not dancing.** Standing still earned 44–61 % of the maximum on most songs; idle swaying 46–62 % and dancing a different routine 47–58 % under real tracking. New rules (scoring version **danceoff-points-v2**, [decision 0007](decisions/0007-fair-scoring.md)): scored relative to standing still, moving limbs weighted most, pose must be held ~0.17 s, timing judged against the player's own steady delay, mirror or same-side copying accepted. Real tracking of a rendered dancer: idle 0–3 %, other routine 17–25 %, correct dance 81–92 % (same-side 73–86 %, 0.6 s late 80–92 %).
  * Moves that look like standing still are no longer judged (about 45 % of moves in the bundled songs), so there are fewer per-move pop-ups (about 17–24 judged moves per 45 s song, so the maximum is about 170–240 points).
  * Per-move feedback arrives about 0.9 s after the move (was 0.35 s) because late copiers are now waited for.
  * Points are lower for everyone than before: clear today's leaderboard before the next event so old and new scores are not mixed. Central default scoring version is now `danceoff-points-v2`.
  * New tests: fairness over every bundled routine with simulated performers (expert, loose, late, same-side, half-hearted, arm-pumping, random waving, still) at all difficulties.
* **Points ladder** (client's request): each move earns **10** for a match, **5** for a close match, **2** for at least making a move, otherwise 0. Real tracking: correct dance mostly 10s (79–97 % of the maximum), idle 0 on every move, a different routine mostly 2s (23–33 %). HUD shows "+10 / +5 / +2" with "Perfect match! / Close! / Keep moving!"; the tutorial explains the ladder.
* **Calibration no longer quits after 40 s.** It keeps going while anyone is in view; after 15 s it offers "Press START to dance anyway"; it returns to the start only after nobody has been seen for 25 s, with a countdown. Safety cap 3 minutes. Profile fields `calibrationHelpSec`, `calibrationAwaySec`; `calibrationTimeoutSec` is now 180.
* Results tiers re-cut for the new scale: legend 75 %, smooth mover 50 %, rising star 25 % (was 85 / 65 / 40).
* Calibration hints in solo mode now start with a capital letter.
* Checks: typecheck, lint, tests (229 passed, 1 skipped), content validation OK.

## Session 9 — 2026-11-03 (no song names, HUD hide, points only, central registry)

* **Participant screen:** the song title and artist are no longer shown (HUD, tutorial). The small camera view at the top right has a **Hide view / Show view** button (also the V key); the choice is remembered on the booth.
* **Points, not percentages:** the HUD, results, leaderboard and operator console show points. The leaderboard ranks by points (ties: earliest wins). The results tier is still chosen internally.
* **Central registry (event-results/1):** operator panel to configure the main application (URL, write-only credential encrypted with DPAPI, source/game id, competition, round and scoring version from the manifest, offline policy), verify players by QR/code with operator confirmation, and see queue counts, last acknowledgement and reconciliation, warnings, conflicts and recent results (Correct, Void, Assign player, Retry). One result per verified player per attempt with raw integer points, written atomically with its outgoing message; durable queue with backoff, Retry-After, auth pause, blocked queue; periodic, reconnect and on-demand reconciliation. LAN score feed unchanged; legacy recordId/uid kept per result. Details: [central-integration.md](central-integration.md).
  * The reconciliation wire format is not fixed by the contract: the booth's proposal is documented there and must be agreed with the main application team.
  * Tests: 40 against an in-process fake server. One bug found and fixed by them (a blocked message was counted as delivered).

## Session 8 — 2026-11-03 (duo tracking, identity lock, Afrobeats, timer)

* **Duo tracking rebuilt.** One MediaPipe landmarker asked for two people merges or drops one of them when they stand close. Duo now cuts the frame at a split line between the players (following their midpoint) and gives each side, plus a 4.5 % overlap, to its own landmarker looking for one person; a body whose torso lies on the other side of the line is ignored. Both landmarkers live in the one worker (MediaPipe's WASM factory is kept so the second can be created). Operator toggle: **Duo: track each half separately** (on by default).
  * Measured with the real worker on a rendered clip of two dancers 0.7 m apart (240 frames, VIDEO mode): both players tracked in 0 of 240 frames before, 240 of 240 after, no identity swaps. Still images at 0.45–1.0 m apart: 16 of 16 at every spacing (whole frame: 2–8 of 16), with about half the joint error.
  * Cost: about +30 % inference time in duo (lite model).
* **Assigner:** duplicate detections of one person are dropped; Player 1/2 crossing sides costs extra.
* **Identity lock.** While both duo players stand ready in calibration, each player's clothing colour histogram (torso and upper legs, 40 numbers, computed in the worker; no image kept) is averaged; when calibration completes, each identity is locked to it. During the song the outfit match is part of the assignment, re-identifies a player after occlusion or a collision (even on the other side), and slowly follows lighting. "Locked in" shows on each score card and the skeleton shows a tag ("🔒 P1 · name"). Tested: collision with a real side swap; player leaving and returning.
* **Timer:** a digital stoppage-time-style board (DSEG7 font, OFL) top-left counts down the song; red and pulsing in the last 10 s. Replaces the progress bar.
* **Songs:** five Afrobeats/amapiano instrumentals from Pixabay (Unlock Me, Amatry, My Bebe, The Hills, Afro Trap Fusion; 104–125 BPM, grid found exactly), enabled in the Maltina profile. Every song, including the Kevin MacLeod ones, is now cut to about 45 s.
* Checks: typecheck, lint, tests (175 passed, 1 skipped), content validation OK.

## Session 7 — 2026-11-03 (Maltina Dance All release prep, music pipeline, docs)

* **App renamed to Maltina Dance All:** package `productName`, window and page titles, executable `maltina-dance-hall.exe`, installer `MaltinaDanceAllSetup.exe` (Squirrel id `MaltinaDanceAll`), author/copyright Moving Surface Interactive Media Limited.
* **Data folder moves** to `%APPDATA%\Maltina Dance All`. On first start the app copies settings, player ids, records, logs and diagnostics from `%APPDATA%\DanceOff Booth` (never overwrites, leaves the old folder; `user-data-migration.ts`, tested).
* **Maltina is the default event profile.** Settings still on the old `dev-showcase` default switch to `maltina` once (`profileDefaults`); an operator's later choice is kept. This is why the branding had not appeared on Kome's PC: the saved settings were still on the dev profile.
* **Character order** on the select screen now follows the profile's `enabledCharacters`.
* **3D stage error boundary:** if WebGL fails, the menus, calibration and scoring keep working over a plain brand background (previously the whole participant screen went blank). Found while smoke-testing the packaged app without a GPU.
* **Name pill:** "Maltina Dance All" sits on a malt-brown pill so it stays readable over the light dance studio.
* **Music pipeline is data-driven:** songs are listed in `assets/audio/music.json` (title, artist, file, BPM estimate, start, length, licence); `pnpm assets:music` accepts MP3 or 16-bit WAV, `--only <id>`, and keeps excerpts whose source file is absent. Tested with a synthetic 120 BPM WAV (grid found exactly). Routine subtitles are the artist; the tutorial and HUD show "title · artist".
* **Song sources are no longer shipped:** a Forge `postPackage` hook removes `assets/audio/source` from packages.
* **`pnpm assets:portraits`** renders character-select portraits with Electron (no extra tools).
* **`pnpm dev:clean`** clears Vite caches (stale screens, blank window, duplicate-React `useMemo` error).
* **Docs:** new [rebranding.md](rebranding.md) and [custom-music.md](custom-music.md); README, release checklist (build, install, troubleshooting), operator runbook, content pipeline, UI guide, score feed and licences updated.
* Checks: typecheck, lint, tests pass (170 passed, 1 skipped). Linux `electron-forge package` built and the packaged app started (Maltina profile, header, logo, character on stage; maintenance only because the cloud machine has no camera). The Windows installer itself must be built on Windows (`pnpm make:win`).

## Session 6d — 2026-11-03 (Maltina Dance All name and logo)

* The Maltina profile's product name is **Maltina Dance All**. New optional profile field `productNameAccent` colours part of the name in the brand orange (`Wordmark` component); here "Maltina" is orange and "Dance All" is white on the dark stage.
* The supplied logo (`assets/branding/maltina.png`) is shown top-right on the participant screens and next to the title on the leaderboard. The file has a white field behind the artwork, so it sits on a plain white rounded card; only its transparent top and bottom margin is trimmed for display (`object-view-box`), the artwork itself is never altered or stretched.
* The installer, window class and data folder are still named "DanceOff Booth" (renaming the package would move the saved settings, player ids and records); the visible app name comes from the profile.
* Checks: typecheck, lint, tests pass (167 passed, 1 skipped). Header and leaderboard checked in a headless browser.

## Session 6c — 2026-11-03 (Maltina brand profile)

* New event profile `assets/profiles/maltina.json` (select it in the operator console; it becomes the event id for player ids and the leaderboard).
  * Colours from the Maltina 50th-anniversary refresh as supplied by Kome: orange `#FF6600`, gold `#D4AF37`, malt brown `#4A2306` (text and stage panels), white surfaces and text on dark.
  * Derived shades, needed for readability: `#B34700` dark orange for primary buttons (white on `#FF6600` is only 2.9:1, below WCAG AA), `#2A1403` deeper stage background, `#6E4A2E` secondary text, `#F3E2A6` light gold, `#FFF1E5` warm surface, `#EAD9C8` borders.
  * Font: Plus Jakarta Sans (OFL, local variable woff2, Latin subset; other scripts fall back to Segoe UI per glyph). Display text is bold.
* New test `packages/content/src/profile-contrast.test.ts` checks every profile's colours against the UI's text/background pairs.
* **To confirm with the client:** the hex values came from third-party summaries, not the official brand book. No Maltina logo was supplied, so none is shown (never redraw or imitate it; when supplied, place it on a plain background, not as a watermark, never stretched).

## Session 6b — 2026-11-03 (selection icons)

* **Character select** shows a portrait card per character (rendered from the actual 3D model in its idle pose, `catalog.json` `thumbnail`, 320 px PNGs in `assets/characters/thumbs/`) instead of a colour swatch. Selected card: orange glow and a check badge. Duo shows both players' lists with smaller cards. A character without a portrait falls back to its initial.
* **Mode select:** Phosphor (MIT) dancer icons: one orange dancer for Solo, an orange and a gold dancer for Two players (player colours). Player badges use a person icon instead of the circle/diamond shapes.
* Portraits were rendered with a headless three.js page (same loader, happy-idle at 0.6 s, hips fitted). Re-render them when a character is added.
* Checks: typecheck, lint, tests pass (145 passed, 1 skipped). Screens checked in a headless browser at 1920×1080 (mode, solo, duo).

## Session 6 — 2026-11-03 (tracking robustness, stick figure removed, five Mixamo dancers)

* **Tracking no longer drops dancers so easily.**
  * MediaPipe presence and tracking confidence 0.5 → 0.35 (detection stays 0.5). The worker previously passed the detection value as presence confidence; presence now has its own setting.
  * Saved settings from before this tune are migrated once (`tracking.tuning`); later operator changes are kept.
  * Player assignment: a body counts as a person if either the shoulder pair or the hip pair is clearly seen (previously all four averaged, so cropped or blurred hips dropped the dancer). Speed gate 1.2 → 3 widths/s, jitter allowance 0.08 → 0.15. Solo reacquires the only visible body after 300 ms lost.
  * Calibration: visibility threshold 0.6 → 0.5, and blips under 400 ms pause the hold instead of restarting it.
  * One Euro smoothing per player (`LandmarkSmoother`) removes jitter on hands, feet and head while keeping fast moves sharp; visibility rises fast and falls slowly so a joint doesn't vanish for one bad frame. Smoothed landmarks feed the overlay, the avatar, calibration and scoring alike.
  * A briefly lost player's skeleton stays on screen (dimmed) for the grace period instead of blinking out.
  * Frames are downscaled with medium instead of low quality before inference.
* **Skeleton overlay:** hands (wrist, index, pinky, thumb), feet (ankle, heel, toe), neck, a head circle sized from the ears, eyes, and joint dots. Uncertain joints are drawn faint instead of hidden.
* **Stick figure removed.** `ProceduralCharacter`, the `procedural-demo` kind, `bodyStyle`, the instructor pose sampler and the `demo-bot` entry are gone; every character is a rigged GLB/FBX. Characters get their idle and celebrate clips from `rig.clipFiles`, so they animate outside routines too. The dev test routine (no animation) is no longer enabled in the event profile; it stays for tests.
* **Characters:** Michelle, Remy, Sophie, Ty, Kaya (all Mixamo, same skeleton, same routines). Rendered together headlessly: all stand on the floor and animate.
* Checks: typecheck, lint, tests pass (145 passed, 1 skipped).
* **Not yet verified with people:** whether the new thresholds fix the drop-outs at booth distance and lighting. If a bystander steals solo tracking, the next step is detecting two poses in solo and keeping the one in the play zone. The `full` pose model (operator setting) is more accurate for hands and feet but costs about twice the CPU; measure on the booth PC.

## Session 5b — 2026-11-03 (FBX served to the app, second character Remy)

* **Bug: characters were invisible in the app.** The `booth-asset://` protocol only serves file types in its MIME allow-list, which had `.glb` but not `.fbx`, so every Mixamo character load failed with HTTP 415 (logged as `character michelle failed to load`). `.fbx` is now served as `application/octet-stream`, with a test.
* **Remy** (Mixamo, FBX, with skin) is added to the catalog and the profile (`michelle`, `remy`, `demo-bot`). His model is in different units (hips 209 vs Michelle's 103), scale 0.00463.
* **Hips fitting.** Mixamo clips store hips height in the units of the skeleton they were exported on (Michelle). `fitHipsToCharacter()` rescales hips translation by the character's rest hips height divided by the hips height in its idle clip. Without it Remy sank about half a metre into the floor. It clones clips (the clip cache is shared) and does nothing when the ratio is within 3%, so Michelle and the routines are unchanged.
* Checks: typecheck, lint and tests pass (136 passed, 1 skipped). Routines rebuilt with identical output.

## Session 5 — 2026-11-03 (Mixamo character and dances wired in)

* **Assets.** Michelle (FBX binary, with skin, T-pose) and 14 Mixamo clips (FBX, without skin, 30 fps) were downloaded from the client's Adobe account into `assets/characters/Michelle.fbx` and `assets/animations/mixamo/`. Mixamo offered no "In Place" option, so the importer's root-motion strip keeps the dancer on her spot.
* **Catalog.** New `michelle` entry: Mixamo bone map, scale 0.0105 (the model is 166 cm, so about 1.75 units on stage), idle `happy-idle`, celebrate `cheering`. Her single textured material is not recoloured (`materialSlots` empty, one "Original outfit" palette), because tinting it would tint skin and clothes together.
* **Profile.** `dev-showcase` now enables `michelle` and `demo-bot`. `robo-dancer` stays in the catalog but is disabled: the routines now play Mixamo clip names, which its skeleton does not have.
* **Choreography.** `plan.json` uses four phrases built from the 12 dance clips (YMCA, Macarena, Raise the Roof, African Rainbow, Chicken Dance, Waving Arms, Arm Wave, Robot Hip Hop, Kick Step, Arms Hip Hop, Side to Side, African Noodle). Long clips play their opening bars at natural speed.
* **Routines rebuilt.** funky-chunk 36/44 judged moves, disco-medusae 34/44, funkorama 31/40 (previously 25/44 with the robot).
* **Build script.** `build-routines.ts` installs a tiny `document` stub so FBX files with embedded textures parse in Node.

| Command | Result |
| --- | --- |
| `pnpm assets:routines --dry-run`, then `pnpm assets:routines` | Pass |
| `pnpm typecheck`, `pnpm lint`, `pnpm test` | Pass (134 passed, 1 skipped) |
| `pnpm content:validate` | Content OK. Only the tracking-model files were reported missing, and only in the cloud mirror |
| Headless WebGL render of Michelle in six clip poses | Correct facing, scale, texture and skinning |

**Not yet checked:** Michelle in the running Electron app on the booth PC (load time of the 21 MB FBX, frame rate with two dancers) and live scoring of the new moves with people.

## Session 4 — 2026-11-03 (player names, player ids, LAN score feed)

* **Name entry.**
  * A new typed `NAME_ENTRY` state sits just before calibration and is also reached by an operator start. Every player in solo and duo enters a name using a physical keyboard, the on-screen keyboard with arrows or a gamepad, or the mouse.
  * Names are 1–16 letters or digits, plus space . ' - in any script, validated by the same schema in the renderer and the main process.
  * The machine guard requires a name and a unique id for every player. "Play again" keeps the same names and ids.
  * The name-entry timeout is 90 s.
* **Player ids.**
  * The main-process `PlayerRegistry` assigns `player-001`, `player-002`, … per event, with persisted atomic writes.
  * Ids are never reused after a restart, a corrupt file or a name clear (numbering continues after any id found in stored records).
  * The same name typed twice gets distinct ids.
  * Session records now carry `playerId`, `points` and a persistent `recordId` (UUID). Ids the booth didn't issue are dropped.
* **Leaderboard.** One row per player id (best score today), ranked by match %, then points, then who scored first. It shows names and ids. Cleared names drop off the board.
* **LAN score feed.**
  * `ScoreFeedServer` in the main process (the `ws` library) provides a WebSocket push stream (`hello`, `snapshot`, `session.completed`, `leaderboard.updated`, `heartbeat`) and an HTTP snapshot and health endpoint.
  * Access needs a shared key (timing-safe compare). The feed is read-only, with `seq` numbers and a `resync` request.
  * `uid = boothId:eventId:playerId` is the cross-booth unique key.
  * Off by default. The key is generated on first run and **redacted from every renderer**.
  * The operator panel has enable, port, booth id, connect URLs, show/rotate key and clear names (confirmed).
  * Protocol: `docs/score-feed-protocol.md`.
* **Privacy:** `docs/privacy.md` updated. Names are now personal data shown on the board and sent to the scoreboard PC, with a notice on the name screen.

| Command | Result |
| --- | --- |
| `pnpm vitest run` | **134 passed**, 1 skipped (adds name-entry machine tests, registry, leaderboard-by-player, and feed server tests with a real WebSocket client: auth, snapshot, live events, resync, HTTP) |
| `pnpm typecheck`, `pnpm lint` | clean |
| `pnpm test:e2e` | **7 passed**: full journey including typing a name, operator start → name → abort, duo name cycles, serial ids and server-side name validation, the feed reachable on its port with the key only (401 without), replay never sent, key not visible to renderers |
| Screenshots | `03b-name-entry` (fits 1584×861 after a layout fix), results show "Ada · player-001" |

**Not verified:** a scoreboard PC on a real second machine, so cross-machine networking and the Windows Firewall rule are untested (only loopback was tested). Live `session.completed` events from real webcam sessions are covered by unit tests but not end to end, because replay sessions are deliberately excluded from the feed.

## Session 3b — 2026-11-03 (Daniel's feedback: solo characters, scoring clarity, default camera)

* **Stage:** each player now has exactly one dancer, so solo shows ONE character and duo shows TWO. Each dancer wears that player's chosen character and outfit and performs the routine, then celebrates on the results screen. There is no longer a separate instructor next to the player's character. With no players (attract), one default dancer appears. The experimental live-avatar toggle was removed from the operator console. The setting stays in the schema but is unused.
* **Scoring clarity:** each move is worth up to 100 points in proportion to how closely it is matched, and timing can take off at most 10–25%. Results show total points and the average match %. The HUD shows "+N · N% match" after every move, and the tutorial explains the rule. See the update in decision 0004.
* **Default camera:** the integrated webcam is chosen automatically, and virtual cameras are skipped ("Windows Virtual Camera" and "OBS" on this laptop). A saved operator choice is kept while it is connected, and the app falls back if it is unplugged. The operator status shows why a camera was chosen. The operator dropdown now reports the same device id it lists, which addresses the session-1 mismatch.
* **Verified:** `pnpm vitest run` gives 125 passed and 1 skipped (new camera-choice and points-proportionality tests). Typecheck and lint are clean. `pnpm test:e2e` gives 5 passed. The webcam smoke test picked "Camera: integrated webcam", tracking at 14 Hz in attract. New screenshots show one dancer in solo gameplay (`05-playing`) and two in duo (`10-duo-playing`).

## Session 3 — 2026-11-03 (work while waiting for Mixamo files)

### What changed

* **Gameplay performance.**
  * Added a new perf benchmark (`e2e/perf-bench.spec.ts`, opt in with `BOOTH_E2E_PERF=1`). It measures tracking and 3D render rates while the gameplay scene is on screen, using the real webcam. It skips calibration through the operator console, so no person is needed.
  * Added a 3D frame cap (`maxRenderFps`, default 30, set in the operator console). The canvas renders on demand, and animation stays time-based.
  * Frames are now downscaled before inference (`tracking.inputWidth`, default 640).
  * The light count is now constant, so shaders no longer recompile when the player spots turn on. At "low" quality, a single real spotlight is used with fake floor pools elsewhere.
  * The operator now sees the actual rate of rendered 3D frames.
* **Mixamo-ready import.**
  * GLB **or FBX** characters and clips load directly (`loadModel` / `parseModel`). No Blender conversion is required.
  * Mixamo's generic "mixamo.com" clip names are renamed after the file, and empty takes are dropped.
  * Horizontal root motion is stripped.
  * Added `MIXAMO_BONE_MAP`.
  * The routine builder is now driven by `assets/choreography/plan.json` (character, clip files, phrases, difficulty) and has a `--dry-run` option.
  * Verified end to end with a sample Mixamo FBX: it loads, the bone map resolves, it plays, and it yields distinct frontal-plane poses (`mixamo-import.test.ts`, opt in with `BOOTH_TEST_FBX`). The sample file is not committed.
* **Move quality.** A move whose pose is within 12° (mean) of the previous judged move becomes animation-only. Judged moves per song went from 44/44/40 to 25/23/23.
* **Two-player calibration.** New `wrong-side` check (each player must stay in their own half) and `too-close` check (identity-swap risk), with participant prompts.

### Commands and results

| Command | Result |
| --- | --- |
| `BOOTH_E2E_PERF=1 playwright test e2e/perf-bench.spec.ts` (i7-10610U, Intel UHD, nobody in frame) | Before the changes, during play: CPU at 1280 px input with medium quality gave **5.5 Hz**, 166 ms inference, and a 3D rate of only 27 fps uncapped. After: CPU, low quality, 30 fps cap gave **7.3 Hz**, 117 ms, 29 fps; CPU, medium, 30 cap gave 6.8 Hz, 129 ms, 28 fps. GPU stayed at 0–3 Hz. In ATTRACT it was about 12 Hz and 54–62 ms, so inference is about 2× slower while the scene renders. This is consistent with a 15 W CPU and iGPU sharing one power budget |
| `pnpm exec tsx scripts/build-routines.ts` | 25/44, 23/44, 23/40 judged moves |
| `BOOTH_TEST_FBX=… vitest run …/scene` | 5 passed (including the FBX end-to-end test) |
| `pnpm check` | typecheck and lint clean; **120 passed, 1 skipped (opt-in FBX test)**; content OK |
| `pnpm test:e2e` | package built; **5 passed**, 4 skipped (opt-in hardware, screenshot and benchmark specs) |

### Honest status

* About 7 Hz tracking on this laptop is still far below the 20–30 Hz target. A booth PC with a desktop CPU and a discrete GPU is needed, and must be measured with `perf-bench`. Scoring still works at 7 Hz (several samples fall in each move's timing window), but feedback will feel less responsive.
* I have not checked that an FBX character renders correctly inside the app; only loading, bone mapping, playback and pose extraction are tested.
* The two-player checks are unit-tested with synthetic poses only.

## Session 2 — 2026-11-02 (realistic content, warm UI redesign, leaderboard, Phase 2 polish)

### What changed

* **Music.** Three upbeat funk/disco tracks by Kevin MacLeod (incompetech.com, CC BY 4.0): Funky Chunk, Disco Medusae, Funkorama. `scripts/prepare-music.mjs` decodes the MP3s, refines the BPM from the audio (115.01, 114.99 and 101.00), finds the beat phase from an onset envelope, and writes beat-aligned excerpts of about 51 s. The attribution is in each routine manifest and in `docs/asset-licenses.md`.
* **Characters.** One real rigged GLB character, RobotExpressive (CC0, 14 clips), with palette recolouring through named material slots. The catalog now carries a rig contract (bone map, material slots, scale, idle and celebrate clips). The original stick rig remains as a fallback and for the live-avatar experiment.
* **Choreography pipeline.** A new `glb-timeline` routine type lays clip segments on the beat grid. `scripts/build-routines.ts` extracts the scoring reference by playing the same timeline on the skeleton (44, 44 and 40 judged moves). The instructor plays it deterministically from song time. Mixamo import steps are documented, but Mixamo files are still waiting on the client (they need an Adobe sign-in).
* **Dance studio environment.** Procedural oak floor, mirrored back wall with a ballet barre, side walls, a lighting truss, and spotlights with soft beat breathing (never strobing). There is a procedural room environment map for reflections, ACES tone mapping and quality-tiered shadows. The camera eases between a "hero" framing (attract and mode select) and a "wide" framing (gameplay). Players' chosen characters stand under their own spotlights in solo and duo. They idle, and celebrate only on real "perfect"/"great" judgements.
* **UI redesign** using a provisional Maltina-inspired orange, gold and warm-white token set (not official brand specs, no Maltina assets). Barlow Condensed and Manrope (OFL) are bundled and loaded at runtime from the profile. There is a new component library and a dev-only component preview. Every participant screen was rebuilt (see `ui-design-guide.md`), and the operator console was restyled with confirmation dialogs for abort and maintenance. A UI sound-cue volume setting was added. 14 contrast pairs are tested.
* **Leaderboard window**, a third sandboxed renderer (`booth-app://leaderboard`) with its own role-limited preload. It ranks only today's completed **live** sessions for the active event; replay, aborted and unjudged sessions are excluded. It can go fullscreen and move to the next display (the choice is remembered), and the operator can do the same. Participants open it from Results ("View leaderboard"). Results show the real board placement when one exists.
* **Session machine.** A typed `PLAY_AGAIN` event starts a NEW session with the same mode, routine and characters, going straight to calibration. Results show a visible auto-reset countdown, and the error screen has "Try again" (`RETRY`).
* **Default tracking delegate changed to CPU.** This is based on a measurement, explained below.

### Commands executed and actual results

| Command | Result |
| --- | --- |
| `node scripts/prepare-music.mjs` | 3 excerpts written in 7.2 s (the first attempt failed because one large buffer gave `MPG123_ERR`; fixed by decoding in 16 KB chunks) |
| `pnpm exec tsx scripts/build-routines.ts` | funky-chunk 44/44, disco-medusae 44/44, funkorama 40/40 judged moves |
| `pnpm exec tsx scripts/generate-dev-content.ts` | dev-groove and funky-chunk synthetic fixtures |
| `pnpm typecheck` | Pass |
| `pnpm lint` | Pass (after autofix and one hook-dependency fix) |
| `pnpm test` | **116 passed / 13 files** (adds contrast, clip-timeline, play-again and leaderboard tests) |
| `pnpm content:validate` | `content OK` (integrity hashes verified) |
| `electron-forge package` | Pass. The first attempt failed because Vite tried to resolve `booth-asset://` font URLs in CSS; fixed by registering the fonts at runtime |
| `playwright test e2e/replay-session.spec.ts` | **5 passed**: isolation probes; full journey to results (100 % on synthetic input) → leaderboard window opens, shows "No scores yet today" for replay, fullscreen on/off → Finish → attract; operator abort mid-song needs confirmation; repeated duo abort cycles; diagnostics export |
| `BOOTH_E2E_SCREENSHOTS=1 … screenshots.spec.ts` | Pass. 9 screenshots in `docs/screenshots/` (reviewed; the attract framing and floor-texture gaps were fixed) |
| `BOOTH_E2E_WEBCAM=1 … webcam-smoke.spec.ts` | CPU: **12 Hz**, 61.6 ms inference, in-flight ≤ 1, pass. GPU: **0–1 Hz** (busy 75, stale 3), in-flight ≤ 1. The GPU run failed the old rate assertion, so the test now asserts the rate for CPU only and reports GPU |

### Verification status

* **Automated:** everything above. Visual review covered 1584×861 and 1920×1080.
* **Manual/hardware:** webcam pipeline only (CPU and GPU rate measured). No person has danced against the new routines yet, so how fair and accurate the clip-extracted moves are for real people is **unverified**.
* **Not performed:** the beat alignment of the music excerpts has not been checked by ear; the leaderboard with real live sessions; multi-display leaderboard moves (only one display attached); the installer.

### Known defects / limitations

* Choreography is limited to the robot's 14 general-purpose clips (Dance, Wave, Yes, ThumbsUp, …). It is placeholder choreography, not commissioned dance. Mixamo dance clips are the next step.
* Some extracted moves repeat near-identical poses. A move-distinctness pass is needed.
* The GPU delegate is unusable on this laptop alongside the studio scene. CPU only reaches 12 Hz, below the target.
* The operator's active-camera dropdown mismatch from session 1 is still open.
* The leaderboard identifies entries as "Dancer #session", because no names are collected (by design).

### Placeholder / provisional

The orange/gold palette is provisional, not official Maltina specs. The "DanceOff" wordmark is neutral; **no Maltina logo was supplied**. The robot character is CC0 and not branded. The choreography is generated from generic clips. The dev-groove track and the synthetic fixtures are dev-only.

### Next highest-priority tasks

1. Get the Mixamo character and dance clips from Daniel and add them through the documented pipeline. Re-run `assets:routines`.
2. Run a live session with people: check move fairness, beat alignment by ear, calibration prompts and duo identity.
3. Phase 3 hardening for two players (live duo test, reacquisition) and Phase 4 profile switching without a reload.
4. Tune CPU tracking (model `lite`, capture resolution, `targetHz`) on the booth PC.

## Session 1 — 2026-11-02 (Phase 0 complete, Phase 1 technical slice working)

### Repository assessment

`D:\Projects\DanceHallBooth` was **empty** (no files, no git repo, no legacy
Python, no lockfile). Tooling: Node 24.18.0, pnpm 12.5.1, Git 2.55, Python
3.14 (unused). A git repository was initialised on `main`. Fresh project ⇒
pnpm workspace per the spec.

### What changed

* **Workspace & tooling:** pnpm workspace (hoisted linker), strict TS 6.0, ESLint 10 + typescript-eslint, Prettier, Vitest 5, Playwright. Pinned versions in [decision 0001](decisions/0001-stack-and-versions.md).
* **Shared packages:** `contracts` (landmark topology, tracking frame, Zod schemas for routines/profiles/characters/settings/fixtures/IPC, error codes + participant messages), `session` (XState machine with all 14 states), `tracking` (provider interface, replay provider, player assignment, bounded frame gate, calibration/framing, tracking-loss monitor), `scoring` (feature extraction, judging, deterministic per-player scorer, synthetic landmark generator), `choreography` (audio-clock song timeline, clock mapper, routine pose sampler, avatar smoothing), `content` (loader/validator, safe asset paths, MIME), `diagnostics` (rolling percentiles, log retention planner).
* **Electron main:** `booth-app://` and `booth-asset://` protocols, CSP, video-only camera permission for the participant origin, navigation/window-open/webview blocking, validated IPC router (role + origin + Zod), settings with atomic writes and corrupt-file fallback, JSONL logger with rotation and retention, anonymous session records with retention, diagnostics export, renderer crash restart limit (3 per 10 min), display-removed recovery, display-sleep blocker, kiosk escape shortcut, Forge fuses.
* **Participant renderer:** `BoothRuntime` effect layer; Web Audio engine; real webcam capture + MediaPipe Pose Landmarker in a module worker (ImageBitmap transfer, GPU→CPU reported fallback, configurable pose count); replay mode; calibration with framing hints; scoring wired to capture-time song time; full journey UI (attract, mode, character/palette, calibration, tutorial, countdown, HUD with feedback, pause, results, error, maintenance); mirrored skeleton overlay; perf overlay; keyboard + gamepad input; reduced motion; R3F stage with procedural demo rigs, beat lighting, quality presets; experimental live-avatar retargeting behind a setting (off by default).
* **Operator console:** session controls, routine/difficulty, player status/confidence, camera selection, delegate/model, tracking metrics, render metrics, quality/overlay/reduced-motion/live-avatar toggles, A/V offset, audio test, replay toggle, profile selection, kiosk toggle, maintenance enter/exit, reload participant, diagnostics export, error history.
* **Content:** original synthesised 120 BPM test track, generated 29-move dev routine, synthetic replay fixture, dev event profile, two placeholder demo characters, placeholder logo. MediaPipe models fetched with SHA-256 lock; WASM copied from the npm package.
* **Docs:** README, architecture, 7 decision records, content pipeline/art contract, operator runbook, hardware qualification, privacy, release checklist, screenshots (`docs/screenshots/`).

### Commands executed and actual results

| Command | Result |
| --- | --- |
| `pnpm install` | OK (pnpm required `allowBuilds` for electron/electron-winstaller/esbuild) |
| `node node_modules/electron/install.js` | Electron 45.2.1 binary downloaded |
| `pnpm assets:wasm`, `pnpm assets:models` | WASM synced (tasks-vision 1.2.0); lite 5.8 MB + full 9.4 MB models saved and hash-locked |
| `pnpm typecheck` | Pass (all 8 workspace projects) |
| `pnpm lint` | Pass (0 problems) |
| `pnpm test` | **95 passed / 11 files** |
| `pnpm content:validate` | `content OK` |
| `electron-forge package` | Pass; packaged app in `apps/desktop/out/DanceOff Booth-win32-x64` |
| Packaged app launch (manual) | Self-check passed: opened the Integrated Webcam, Pose Landmarker initialised from `booth-asset://` (packaged resources), reached ATTRACT |
| `electron-forge start` (dev mode, replay) | Reached ATTRACT; Vite dev servers + dev CSP + cross-origin asset fetch work |
| `pnpm test:e2e` (replay) | **4 passed**, 3 skipped (opt-in hardware/screenshot specs): isolation/bridge/popup/traversal probes; full journey to RESULTS with score 100 % on synthetic input; 3 duo start → skip calibration → abort cycles; diagnostics export |
| `BOOTH_E2E_WEBCAM=1 … webcam-smoke.spec.ts` | **2 passed** (real camera): GPU 15 Hz / 42 ms inference / age≈65 ms; CPU 15 Hz / 54 ms / age≈68 ms; in-flight ≤ 1 |
| `BOOTH_E2E_SCREENSHOTS=1 … screenshots.spec.ts` | Pass; 7 screenshots in `docs/screenshots/` |
| `electron-forge make --platform win32` | Pass: unsigned `DanceOffBoothSetup.exe` (183 MB) + zip. **Installer not run/installed.** |

### Verification status

**Automated tests passed:** unit/integration (session transitions, timeouts, stale-event rejection, abort from every active state, recovery escalation, 200 repeated cycles of the machine; scoring geometry, mirror conventions, body-size invariance, missing joints, degenerate vectors, NaN input, timing, duplicate frames, determinism; fixture-based end-to-end scoring; player assignment incl. order flips, occlusion, low-confidence, implausible jumps; frame gate bounds/staleness/hung work; calibration hints; manifest validation; content loading failures; path traversal; IPC policy; restart policy; log retention; GLB rig validation) and Electron E2E in replay mode.

**Manual/hardware checks performed:** webcam capture + real Pose Landmarker inference on the dev laptop's integrated webcam (no person deliberately posed; this verifies the pipeline and rate, **not** pose accuracy or scoring quality on live people).

**Not yet performed / needs real hardware or people:**

* A full live-camera dance session with a person, live scoring sanity, calibration at booth distance, duo with two people.
* Tracking rate during PLAYING (measured only in ATTRACT); GPU vs CPU under 3D load.
* Camera unplug/replug, camera occupied by another app, audio device loss, display disconnect, offline install, long soak, installer install/rollback (see [hardware-qualification.md](hardware-qualification.md)).
* Fairness across participants (not validated).

### Known defects / limitations

* Tracking rate ≈15 Hz on the dev laptop (target 20–30 Hz) — hardware-dependent; needs booth PC measurement.
* Operator camera dropdown showed "Select…" instead of the active camera during the webcam smoke test: the active `deviceId` from `track.getSettings()` did not match an enumerated device id. Needs investigation; camera selection itself was not exercised.
* Audio output device loss is not explicitly detected (Web Audio gives limited signals); only AudioContext state is reported.
* Tracking-lost pause triggers only when *all* players are missing ≥ 5 s; a single missing duo player is prompted but not paused (by design, but untested with people).
* Procedural character allocates small temporary vectors per frame (minor GC); fine for the demo rig, replace with GLB pipeline.
* Profile switching requires reloading the participant screen.
* Installer is 183 MB because it ships three WASM variants and both models; trim to the module WASM + chosen model once qualified.
* R3F logs a THREE.Clock deprecation warning in dev (upstream).
* `electron-forge start` overwrites `.vite/` with dev URLs; `pnpm test:e2e` rebuilds first for that reason.

### Placeholder assets (not production)

Music track, dev routine choreography, synthetic replay fixture, both demo characters (primitive rigs), logo, fonts (system fonts). See [decision 0006](decisions/0006-placeholder-content.md).

### Next highest-priority tasks

1. Live session with real people on the dev laptop: verify calibration hints, live scoring sanity, A/V offset, tracking-loss behaviour; record a consented **recorded-landmark fixture** for regression tests.
2. Measure tracking and render rates during PLAYING (GPU vs CPU, lite vs full) and tune `targetHz` / quality defaults; then run on the candidate booth PC.
3. Fix active-camera id matching in the operator console; test camera unplug/replug and "camera in use" flows.
4. Phase 2 polish: attract loop content, tutorial with move previews, results celebration, inactivity return during PLAYING when nobody is present.
5. Phase 3: duo calibration/assignment validation with two people; per-player character rendering on stage.
6. Obtain production assets (characters per the GLB contract, licensed music, commissioned choreography, brand kit) and wire the GLB character path.

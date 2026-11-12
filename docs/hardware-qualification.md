# Hardware qualification

No target booth hardware has been qualified yet. Development measurements
(2026-11-02, developer laptop "DEVINTEL", Integrated Webcam 0bda:5673,
1280×720 requested, lite model, app idle in ATTRACT):

| Delegate | Inference (single sample) | Update rate | In flight | Notes |
| --- | --- | --- | --- | --- |
| GPU | 42–64 ms | 13–15 Hz | ≤ 1 | Busy drops expected at 30 Hz pacing |
| CPU | ≈54 ms | ≈15 Hz | ≤ 1 | |

This is **below** the 20–30 Hz engineering target, so the booth PC needs a faster CPU/GPU or `targetHz` tuned to what it sustains.

## Qualification checklist (per candidate PC + camera)

Record results in a copy of this table with the exported diagnostics bundle.

| # | Test | Pass criteria | Result |
| --- | --- | --- | --- |
| H1 | Install from installer on a clean Windows account | App starts, self-check passes offline | |
| H2 | Camera at 720p30 under booth lighting | Tracking ≥ 20 Hz for 1 and 2 players; in-flight ≤ 1; dropped-stale not growing | |
| H3 | GPU vs CPU delegate during PLAYING at each quality preset | Pick the delegate with better tracking rate *and* render p95 < 20 ms | |
| H4 | Render performance during duo PLAYING | p95 frame ≤ 18 ms at chosen quality on the participant display | |
| H5 | Calibration at booth distance (2.5–3.5 m) | Two adults calibrate within 10 s; hints are correct | |
| H6 | Camera unplug during PLAYING, replug | Session moves to error/recovery with a clear message; **Restart tracking** recovers without app restart | |
| H7 | Camera occupied by another app at start | Self-check fails into maintenance with `CAMERA_IN_USE`; recovers after release | |
| H8 | Audio device unplug/replug | Behaviour recorded; audio test recovers (Web Audio device-loss behaviour is not yet handled explicitly) | |
| H9 | Display disconnect/reconnect (participant and operator) | Windows move to a remaining display; controls stay reachable | |
| H10 | Offline start (network disabled) | Identical behaviour to online | |
| H11 | Repeated sessions: 100 solo + 50 duo cycles | No growth in JS heap trend, tracking rate stable, no stuck states | |
| H12 | Soak: full event duration (e.g. 10 h) attract + periodic sessions | No crash; log size within limits; heap stable | |
| H13 | Power loss / hard kill mid-session | Restarts to ATTRACT via watchdog; settings intact | |
| H14 | Latency calibration | A/V offset set with a clap/beat test; documented value | |
| H15 | Fairness spot-check | Scores comparable across testers of different heights, body types, clothing, skin tones under booth light | |

## Camera requirements (initial)

UVC webcam, 1280×720 at 30 fps minimum, fixed focus or reliable autofocus,
≥ 78° diagonal FOV for duo at ~3 m, good low-light performance, USB 3 preferred,
mounted at roughly chest height centred on the play area.

### Azure Kinect DK

The app uses only its colour camera ("Azure Kinect 4K Camera"), as an ordinary
webcam; depth and the Kinect body-tracking SDK are not used.

* Power it from **its own power supply** (barrel/USB-C power brick), with the
  data cable in a **USB 3** port directly on the PC (not a hub). On USB power
  alone the colour camera often fails to start.
* Close **Azure Kinect Viewer**, recorder and body-tracking apps (and any
  TouchDesigner/Unity project using the Kinect): only one program can use the
  camera. The booth then says "camera busy" and names these apps.
* Update the firmware with the Azure Kinect firmware tool if Windows lists the
  device but the camera never sends a picture.
* Windows has two camera paths. Chromium's default (Media Foundation) times out on the
  Kinect's colour camera after 10 s; the booth therefore uses **DirectShow** for it
  (operator console → **Camera driver**: Auto picks it when an Azure Kinect, Orbbec Femto
  or RealSense camera is selected; the app restarts to switch).
* The colour camera only offers 1280×720 and larger (no 640×480) and needs a few
  seconds to start. The booth waits up to 20 s for the first picture and, if the
  first request fails, retries with 1280×720 and then the camera's own default.
  Each attempt is written to the log (`camera attempt …` / `camera started …`),
  so **Export diagnostics** shows exactly what happened.

# 0005 — Web Audio as the single timeline

`SongTimeline` derives song position from `AudioContext.currentTime` and a scheduled start. Instructor pose, beat cues, scoring windows, progress and end-of-song all read it. Pause stores the position and stops the source; resume schedules the buffer from that offset after a 1 s lead-in. The global A/V calibration offset (operator setting) plus the routine's `audio.offsetMs` shift judging/visuals relative to audio.

Camera capture times (performance clock) are mapped to audio time with `getOutputTimestamp()` pairs, so scoring compares the pose the participant *was in* when the frame was captured with the reference at that song time.

Audio is fully decoded up front (small files); self-check preloads every enabled routine so a missing/corrupt song is caught before a participant starts. Participant windows use `autoplayPolicy: no-user-gesture-required` (local trusted content only).

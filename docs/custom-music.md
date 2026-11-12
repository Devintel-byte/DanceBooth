# Adding your own music

Every song in Maltina Dance All is a short, beat-aligned excerpt (about 45 s; the on-screen timer counts it down)
with its own routine. The 3D dancer's choreography and the scoring reference are
generated from the same Mixamo clips, laid out on the song's beat grid, so a new
song needs no hand-authored choreography.

Pipeline: **source file → `pnpm assets:music` → `pnpm assets:routines` → enable in the profile.**

## 1. Clear the rights first

Use only music you are allowed to play at a live, public event:

* music the client owns or has licensed for the event, or
* royalty-free / Creative Commons tracks whose licence allows public performance
  (CC BY needs a visible credit: the app shows "title · artist" while the song plays,
  and the full attribution is kept in the routine file and `docs/asset-licenses.md`), or
* commissioned tracks with a written licence.

Pixabay (pixabay.com/music) is a good free source: its licence allows commercial
use without attribution. Prefer tracks without "Content ID" (otherwise guests' videos
of the booth can get copyright claims on YouTube/Instagram) and not marked
AI-generated. The five Maltina songs were chosen that way.

Some venues and countries also require a public-performance licence whatever the
track licence says (in Nigeria, for example, COSON or MCSN). Confirm this with the client.

## 2. Add the source file

Put the song in `assets/audio/source/` as **MP3** or **16-bit PCM WAV** (export from
any audio editor). This folder is not committed to git and is **never shipped in the
installer**; only the prepared excerpt is.

Pick a song with a steady tempo and a clear beat. Dance-pop, Afrobeats, amapiano,
funk and disco work well. Avoid tempo changes, long intros without drums, and very
slow songs; 95–130 BPM is the sweet spot.

## 3. Describe it in `assets/audio/music.json`

Add one entry to `tracks`:

```json
{
  "id": "maltina-anthem",
  "title": "Maltina Anthem",
  "artist": "Artist Name",
  "file": "Maltina Anthem.mp3",
  "bpm": 110,
  "startNear": 18,
  "beats": 96,
  "license": {
    "source": "Supplied by Nigerian Breweries for the Maltina 50 campaign",
    "license": "Licensed for live event use, 2026",
    "attribution": "\"Maltina Anthem\" by Artist Name.",
    "placeholder": false
  }
}
```

| Field | Meaning |
| --- | --- |
| `id` | Lowercase letters, digits and dashes. Becomes the routine id and the WAV name. Never reuse an id for a different song |
| `title`, `artist` | Shown to players on the song card |
| `file` | File name inside `assets/audio/source/` |
| `bpm` | Tempo. An estimate is enough (a BPM-tapping app works); the script searches ±1.5 BPM around it |
| `startNear` | Seconds into the song where the excerpt should begin, usually where the chorus or the full beat starts. The script snaps to the nearest beat |
| `beats` | Excerpt length in beats. Duration ≈ `beats × 60 / bpm`; 96 beats at 115 BPM ≈ 50 s. Use a multiple of 8 |
| `license` | Where the song comes from and the licence. `attribution` is the credit line; "Cut to an N s excerpt with fades" is added automatically |

## 4. Prepare the audio

```bash
pnpm assets:music
```

For each song the script decodes the source, refines the BPM from the audio,
finds the beat phase, cuts a beat-aligned excerpt with a short fade-in and a 2 s
fade-out, and writes `assets/audio/<id>.wav` plus `assets/audio/tracks.json`.
Check the printed line, for example
`Maltina Anthem: bpm 110.4 (given 110), excerpt from 17.73 s, 53.3 s`.

* `pnpm assets:music -- --only maltina-anthem` processes just that song.
* Songs whose source file is not on this PC keep their existing excerpt, so you do
  not need every old MP3 to add a new one.
* "the song is too short" means `startNear` plus `beats` runs past the end; lower one of them.

Listen to the WAV. If the excerpt starts in an awkward place, change `startNear` and run it again.

## 5. Build the routine

```bash
pnpm assets:routines -- --dry-run
pnpm assets:routines
```

This writes `assets/routines/<id>.json` for every song in `tracks.json`: 16
different random dances per song, made from the clip pool in
`assets/choreography/plan.json` and timed so the clips' steps land on the song's
beats. The booth plays a different one each session. The run prints each clip's
measured beat and, per song, how many moves are judged, for example
`maltina-anthem: 16 dances, 20-20 judged moves each` (every dance of a song judges
the same number, so scores compare fairly).

Optional: set the song's default difficulty in `plan.json` → `difficulty`
(`"maltina-anthem": "easy"`); otherwise it is `normal`.

## 6. Turn it on for the event

Add the id to `enabledRoutines` in the event profile (`assets/profiles/maltina.json`).
The first song in the list is the default and plays behind the attract screen. The
operator can change the song for new sessions in the console (**Song**), and guests
can pick from the list on the character screen.
To retire a song, remove it from `enabledRoutines`; its files can stay.

## 7. Check and test

```bash
pnpm content:validate
pnpm dev
```

Validation checks the routine, that the WAV exists and that its SHA-256 matches the
routine (so a re-exported WAV without re-running `assets:routines` is caught).
In the app, play the song once and watch that the dancer moves on the beat. If the
whole song feels early or late, adjust **A/V offset** in the operator console
(positive = judge later). If only one song is off, its beat grid was found in the
wrong place: change `startNear` slightly and run steps 4 and 5 again. (The beat
position is taken from the kick and bass, which suits Afrobeats and amapiano where
the hi-hats sit on the off-beats.)

## Changing the dances

The moves come from the clips in `plan.json`: `clipFiles` (files to load) and `pool`
(clips the dances are made from; `{"clip": "shimmy", "weight": 2}` makes a clip come up
twice as often). `variations` sets how many dances each song gets (default 16) and
`phraseBeats` how long each clip plays (default 8, 8 or 16 beats). The builder measures
each clip's beat from the dancer's hip bounce; if a clip looks off the beat, check it with
`pnpm exec tsx scripts/analyse-clips.ts` and set it by hand in `beatOverrides`
(`"kick-step": {"beatSec": 0.53, "downbeatSec": 0.03}`). To add a Mixamo dance, download it
from the client's account (FBX Binary, **Without Skin**, 30 fps) into
`assets/animations/mixamo/`, add the file to `clipFiles` and its name (file name without
`.fbx`) to `pool`, then run `pnpm assets:routines` again. See
[content-pipeline.md](content-pipeline.md).

## Files involved

| File | Edited by |
| --- | --- |
| `assets/audio/source/*.mp3` | You (not committed, not shipped) |
| `assets/audio/music.json` | You |
| `assets/audio/<id>.wav`, `assets/audio/tracks.json` | `pnpm assets:music` |
| `assets/choreography/plan.json` | You (optional: difficulty, clip pool) |
| `assets/routines/<id>.json` | `pnpm assets:routines` |
| `assets/profiles/<event>.json` → `enabledRoutines` | You |
| `docs/asset-licenses.md` | You: record every song and its licence |

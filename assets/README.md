# Assets

Everything here is loaded at runtime through the app's `booth-asset://` protocol
(see `docs/architecture.md`). Nothing is fetched from the network at runtime.
Everything in this folder is copied into the installer, except `audio/source/`
and the development routine (see "Development only" below).

| Folder | Contents |
| --- | --- |
| `profiles/` | `maltina.json`: the event profile (name, colours, fonts, logo, songs, characters, session timings) |
| `branding/` | Maltina logo and fonts (licences in `docs/asset-licenses.md`) |
| `characters/` | `catalog.json`, the Mixamo characters (Michelle, Elizabeth, David, Lewis, Remy) and their portraits in `thumbs/` |
| `animations/mixamo/` | Dance clips used by the routines, plus Happy Idle and Cheering |
| `choreography/` | `plan.json`: which clips the dances are made from |
| `audio/` | Song excerpts (`*.wav`), `music.json` (your song list), `tracks.json` (generated). `source/` holds the original MP3s and is never shipped |
| `routines/` | One generated routine per song (16 dances each) |
| `fixtures/` | `demo-synthetic.json`: synthetic dancer for the operator's replay/demo mode (generated geometry, not a recording of a person) |
| `tracking-models/` | MediaPipe Pose Landmarker models + WASM runtime (Apache-2.0, see `tracking-models/LICENSES.md`) |

Mixamo characters and clips must not be redistributed: keep the repository and
the installer private to the client's booths.

`pnpm assets:prune` deletes characters, clips, songs, routines and fixtures that
nothing uses any more (`--dry-run` lists them first).

## Development only

`audio/dev-groove-120bpm.wav`, `routines/dev-groove.json` and
`fixtures/dev-groove-synthetic.json` are placeholder test content used by the
automated tests. The installer build removes them.

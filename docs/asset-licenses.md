# Asset and font licence inventory

| Asset | Path | Source | Licence | Status |
| --- | --- | --- | --- | --- |
| "Funkorama" (44 s excerpt) | `assets/audio/funkorama.wav` | Kevin MacLeod, incompetech.com | CC BY 4.0. Attribution shown in the routine manifest and on the credits line below | Usable, needs attribution |
| Maltina theme song, 45.7 s excerpt from the start | `assets/audio/maltina-theme.wav` (source `audio/source/maltina_theme_song.mp3`) | Supplied by the client, 2026-11-04 | Client-owned brand audio; use in this booth only, do not redistribute. Confirm usage rights in writing with the client before public events | Maltina default song |
| "Unlock Me" (Kontraa Music), "My Bebe", "The Hills" (artbybigvee), "Afro Trap Fusion" (CNA Beats), 45 s excerpts | `assets/audio/{unlock-me,my-bebe,the-hills,afro-trap-fusion}.wav` | Pixabay (track pages linked in `assets/audio/music.json`), downloaded 2026-11-03 | Pixabay Content License: free, including commercial use; no attribution required (credit is shown anyway). Chosen without YouTube Content ID and not AI-generated | Maltina event songs |
| Dev test track | `assets/audio/dev-groove-120bpm.wav` | Synthesised by `scripts/generate-dev-audio.mjs` | Project-owned | Tests only; removed from the installer |
| Michelle character | `assets/characters/Michelle.fbx` | Mixamo (Adobe), downloaded with the client's Adobe account on 2026-11-03 | Mixamo terms of use: royalty-free in commercial projects; raw FBX files must not be redistributed | Production character. Keep the repo and installer private |
| Remy character | `assets/characters/Remy.fbx` | Mixamo (Adobe), downloaded with the client's Adobe account on 2026-11-03 | Mixamo terms of use | Production character (second dancer for duo). Same no-redistribution rule |
| Elizabeth, David and Lewis characters | `assets/characters/Elizabeth.fbx`, `David.fbx`, `Lewis.fbx` | Mixamo (Adobe), downloaded with the client's Adobe account on 2026-11-04 | Mixamo terms of use | Production characters (replace Sophie, Ty and Kaya, removed 2026-11-04). Same no-redistribution rule |
| 14 Mixamo animation clips: 12 simple dance moves (Just Listening, Twist, Silly Twist, Cabbage Patch, Raise the Roof, YMCA, Macarena, Chicken Dance, Arm Wave, Rumba, Shimmy, Step Hip Hop), Happy Idle and Cheering | `assets/animations/mixamo/*.fbx` | Mixamo (Adobe), downloaded with the client's Adobe account on 2026-11-03/04 | Mixamo terms of use | Used by all songs. Same no-redistribution rule. Unused clips are removed with `pnpm assets:prune` |
| Mode and player icons ("person-arms-spread", "user") | inlined in `apps/desktop/src/renderer/components/icons.tsx` | Phosphor Icons 2.1.1 (phosphoricons.com) | MIT | Usable; licence notice kept in the file |
| Character portraits | `assets/characters/thumbs/*.png` | Rendered from the Mixamo characters (happy-idle pose) | Derived from Mixamo assets; same terms as the characters | Keep private with the characters |
| Plus Jakarta Sans (variable, Latin subset) | `assets/branding/fonts/PlusJakartaSans-Variable-latin.woff2` | Tokotype, via Fontsource 5.3.0 | SIL OFL 1.1 (`OFL-PlusJakartaSans.txt`) | Maltina profile font (Maltina guidelines name Plus Jakarta Sans Bold) |
| Maltina logo | `assets/branding/maltina.png` | Supplied by Kome (client brand asset) | Client's trademark; use only for this client's events | Shown unaltered on a plain white card (header, leaderboard); never stretched, watermarked or placed on a busy background |
| DSEG7 Classic Bold (timer digits) | `apps/desktop/src/renderer/styles/fonts/` | keshikan, DSEG 0.46 (npm `dseg`) | SIL OFL 1.1 (`OFL-DSEG.txt`) | Usable |
| Barlow Condensed SemiBold/Bold | `assets/branding/fonts/` | Google Fonts repository | SIL OFL 1.1 (`OFL-BarlowCondensed.txt`) | Proposed app font, not Maltina's |
| Manrope (variable) | `assets/branding/fonts/Manrope-Variable.ttf` | Google Fonts repository | SIL OFL 1.1 (`OFL-Manrope.txt`) | Proposed app font, not Maltina's |
| Pose Landmarker models, WASM | `assets/tracking-models/` | Google MediaPipe | Apache 2.0 (see `assets/tracking-models/LICENSES.md`) | Required runtime |
| Dance All environments (solo and duo) | generated in code (`BrandHall.tsx`) | Project-owned | — | — |
| Wordmark | rendered text (`productName`) | Project-owned | — | "Maltina Dance All" |

Required credit line for the event, shown in the operator credits and the
release notes:

> Music by Kevin MacLeod (incompetech.com), licensed under Creative Commons:
> By Attribution 4.0. "Funkorama" was cut to a short excerpt with fades.

Source MP3s are kept out of git (`assets/audio/source/`) and are not shipped in the
installer. To rebuild the excerpts, download them from incompetech.com and run
`pnpm assets:music`. To add songs, see [custom-music.md](custom-music.md), and add a
row to the table above for every song.

## Still needed before release

* Official Maltina brand guidance to confirm the colour values (the logo is now supplied).
* Commissioned choreography, if wanted. The current routines are laid out from
  Mixamo dance clips by `scripts/build-routines.ts`.
* Music the client has cleared for live event use. CC BY needs visible credit.
  Some events require a performance licence (for example COSON in Nigeria)
  whatever the track licence says. Confirm with the client.
* WOFF2 builds of the fonts are optional; TTF works locally.

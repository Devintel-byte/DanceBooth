# Branding, events and rebranding

Everything players see that is specific to a client or event comes from one
**event profile** (`assets/profiles/<id>.json`) plus files in `assets/`. The
shipped profile is `maltina` (Maltina Dance All). A new client or event is a new
profile; no code changes are needed.

## What a profile controls

| Field | What it does |
| --- | --- |
| `id` | Profile id (lowercase, dashes). Also the **event id**: player numbers (`player-001…`), the leaderboard and the score feed are kept per event id |
| `productName` | App name in the header, operator console title, window titles and leaderboard (max 40 characters) |
| `productNameAccent` | Optional part of `productName` drawn in the brand orange, e.g. `"Maltina"` in `"Maltina Dance All"` |
| `eventName` | Shown in the operator console and used in the logo's alt text |
| `tagline` | Line under "Feel the beat." on the attract screen |
| `logo` | Optional logo file, e.g. `"branding/maltina.png"`. Shown top-right on the participant screens and on the leaderboard |
| `colors` | The 13 theme colours (see below) |
| `fonts.display`, `fonts.body` | Font family and a local font file (`.woff2`/`.ttf`) |
| `stageTheme` | `dance-studio` or `neon-club` |
| `enabledRoutines` | Songs offered at this event (the first plays behind the attract screen) |
| `enabledCharacters` | Characters offered at this event, in display order |
| `defaultDifficulty`, `modes` | `easy`/`normal`/`hard`; `single` and/or `duo` |
| `session` | Timeouts (attract, selection, calibration, tutorial, countdown, results, tracking loss) |
| `results.tiers` | Result titles and messages by score |

## Switching the active event

Operator console → **Maintenance** → **Event profile**, then **Reload participant
screen**. The choice is saved. New installs (and settings left on the old dev
profile) start on `maltina`. Switching profile starts a fresh event: new player
numbering and an empty leaderboard for that event id; the other event's data is kept.

## Making a new brand profile

1. Copy `assets/profiles/maltina.json` to `assets/profiles/<new-id>.json` and change `id`.
2. Set `productName`, `productNameAccent` (or remove it), `eventName`, `tagline`.
3. **Logo:** put the approved file in `assets/branding/` (PNG with a transparent
   background is best; SVG also works) and set `logo`. Never redraw, recolour or
   imitate a client's logo; ask for the official file. The app shows it unaltered,
   on a plain white card, never stretched or used as a watermark. If the logo file has
   a large transparent margin, trim it in an image editor.
4. **Colours:** fill in `colors` (hex `#RRGGBB`):

   | Token | Used for |
   | --- | --- |
   | `brandOrange` | Main brand colour: borders, selected cards, Player 1, the name accent, dancer icons |
   | `brandOrangeDark` | Primary buttons (white text on it). Must be dark enough for white text |
   | `brandGold`, `brandGoldLight` | Second brand colour: Player 2, check marks, highlights |
   | `surfacePage`, `surfaceCard`, `surfaceWarm` | Light panels and cards |
   | `textPrimary`, `textSecondary` | Text on light panels |
   | `borderSubtle` | Card borders |
   | `stageBackground`, `stagePanel` | Dark gameplay background and the name pill |
   | `textOnDark` | Text on dark backgrounds and buttons |

   `pnpm test` checks every profile for readable contrast (WCAG 2.1: 4.5:1 for text,
   3:1 for large numerals). A brand colour that is too light for white text, as
   Maltina's `#FF6600` is, needs a darker shade for `brandOrangeDark`; keep the exact
   brand colour in `brandOrange`.
5. **Fonts:** put the font file in `assets/branding/fonts/` with its licence file, and
   set `fonts`. The app works offline, so the file must be local (Google Fonts are
   available as `.woff2` from the font's repository or the Fontsource npm packages).
   Letters the font lacks fall back to Segoe UI.
6. Choose `enabledRoutines` and `enabledCharacters`.
7. Run `pnpm check`, then `pnpm dev`, switch to the profile and look at every screen
   (attract, mode, character, name entry, calibration, playing, results, leaderboard).
8. Record the logo, font and colours in `docs/asset-licenses.md`.

## Characters

Characters live in `assets/characters/catalog.json`; any Mixamo character works
with the existing dances because they share one skeleton.

1. On mixamo.com (client's account) download the character as **FBX Binary, With
   Skin, T-pose** into `assets/characters/`.
2. Copy an existing catalog entry (e.g. `elizabeth`) and change `id`, `displayName`,
   `file`, `license`. Set `rig.heightM` (e.g. `1.72`): the app scales the model to
   that height by itself, whatever units the file uses. (Older entries use a
   hand-measured `rig.scale` instead; `heightM` wins when both are set.)
   With `"optional": true` the character is simply hidden until its file is present.
3. Render its portrait for the character-select card:

   ```bash
   pnpm assets:portraits -- --only <id>
   ```

   The portrait at `characters/thumbs/<id>.png` is picked up automatically.
4. Add the id to the profile's `enabledCharacters`.

### Maltina line-up (2026-11-04)

Michelle, Elizabeth, David, Lewis and Remy. Kaya, Ty and Sophie were removed from the
project; `pnpm assets:prune` deletes any model or portrait the catalog no
longer uses (and any unused clip, song or routine).
Elizabeth, David and Lewis are Mixamo characters that must be downloaded with the
client's Adobe account. On mixamo.com → Characters, search each name, then
**Download → FBX Binary (.fbx), With Skin, T-pose**, and save as exactly
`assets/characters/Elizabeth.fbx`, `David.fbx`, `Lewis.fbx`. Then run
`pnpm assets:portraits -- --only elizabeth` (and `david`, `lewis`) and restart.
Until a file is there, that character does not appear (no error).

Clips recorded on one Mixamo character play on any other: the app rescales the hip
height per character, so taller or shorter characters keep their feet on the floor.

## Songs

See [custom-music.md](custom-music.md).

## Application name, installer and data folder

The visible name comes from the profile. The installed application itself is named
**Maltina Dance All** in `apps/desktop/package.json` (`productName`) and
`apps/desktop/forge.config.ts` (`name`, `executableName`, Squirrel `name` and
`setupExe`). Change these only when the product itself is renamed, because:

* the data folder (`%APPDATA%\<productName>`: settings, player ids, session records,
  logs) follows `productName`. The app copies data from the previous folder name
  once on first start (`user-data-migration.ts`); update the old name there if you
  rename again;
* the Squirrel `name` identifies the installed app. A new name installs side by side
  with the old one, so uninstall the old one.

`pnpm make:win` then produces `<setupExe>` (see [release-checklist.md](release-checklist.md)).

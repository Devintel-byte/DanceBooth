# UI design guide

A short guide to the participant, operator and leaderboard interfaces.
Screenshots of each screen are in `docs/screenshots/`. They were captured in
replay mode at 1584×861 (the window's default size) and at 1920×1080
(`09-duo-calibration`).

## Direction

The interface should feel warm, energetic and welcoming, like a finished
event experience rather than a dashboard. Each screen has one dominant action.
Onboarding screens use warm-white panels. Gameplay happens on a dark-brown 3D
dance studio, with orange and gold kept as accents.

> **Branding comes from the event profile.** The `maltina` profile uses the Maltina
> colours (orange `#FF6600`, gold `#D4AF37`, malt brown `#4A2306`, white), Plus Jakarta
> Sans, the name "Maltina Dance All" with "Maltina" in orange, and the supplied logo on
> a plain white card. The defaults in `tokens.css` are the neutral dev palette. See
> [rebranding.md](rebranding.md).

## Tokens (`apps/desktop/src/renderer/styles/tokens.css`)

All colour values live in this one file, and event profiles override them at
runtime: `profile.colors.brandOrangeDark` becomes `--brand-orange-dark`.

| Token | Use |
| --- | --- |
| `--surface-page` / `--surface-card` / `--surface-warm` | Onboarding panels, cards, selected tiles |
| `--brand-orange-dark` | Primary buttons (white text passes AA) |
| `--brand-orange` | P1 identity and the wordmark (always with **dark** text) |
| `--brand-gold` | Selected state, celebration, scores on stage, P2 identity |
| `--text-primary` / `--text-secondary` | Text on light surfaces |
| `--stage-background` / `--stage-panel` / `--text-on-dark` | Gameplay, results, leaderboard |
| `--status-*` | Only for real status (camera, tracking, errors) |
| `--focus-ring` | 4 px keyboard focus outline |

Contrast is verified by `src/renderer/shared/contrast.test.ts`, which covers 14
text/background pairs. A further test confirms that white on bright orange
fails AA, so that combination is never used.

The 8 px spacing scale runs from `--space-1` to `--space-8`, and every screen
keeps a `--safe-margin`. The type scale (`--fs-hero` … `--fs-secondary`)
follows the 1920×1080 reference values and scales with viewport height.

## Typography

| Role | Font | Fallback |
| --- | --- | --- |
| Headings, buttons, scores | Barlow Condensed SemiBold/Bold | Bahnschrift, Segoe UI |
| Body, instructions, labels | Manrope (variable 200–800) | Segoe UI |

The fonts are bundled locally (OFL) and registered at runtime from the event
profile by `loadBrandFonts()`. If a font fails to load, the app logs it and uses
the fallback. Scores and countdowns use tabular numerals.

## Components (`src/renderer/components`)

The shared components are `PrimaryButton`, `SecondaryButton`, `IconButton`,
`SelectionTile`, `CharacterOption`, `StatusBadge`, `ProgressIndicator`,
`ConfirmationDialog` and `PlayerBadge`.

* All of them are real `<button>` elements. Each state (focus, pressed, selected,
  disabled, loading) is styled, and hover is never required.
* Loading disables the button to prevent double submission.
* Selection always shows a checkmark and the word "Selected" as well as the
  border colour.
* Players are identified by shape and text as well as colour: Player 1 is a
  circle (●) and Player 2 a diamond (◆).
* Motion uses 120–200 ms transitions with a small press movement. Nothing pulses
  permanently. Reduced motion (an operator setting or the OS preference)
  disables UI animation, which has no effect on gameplay timing.

In development builds, the operator console has a **Component preview** button
that shows every state of every component. It is not reachable in packaged
builds.

## Input

* **Keyboard:** arrow keys, Enter or Space, and Esc or Backspace.
* **Gamepad (standard mapping):** A, B and the D-pad.
* **Pointer:** clicking also works.

On the results and error screens, the arrow keys move focus between buttons and
Enter activates the focused one. Every visible action is wired to a real
session event.

## Screens

| State | Screen |
| --- | --- |
| ATTRACT | "Feel the beat." panel, a single **Start dancing** action, and the instructor dancing on the right |
| MODE_SELECT | "How are you dancing?" with Solo and Two players tiles, plus Back and Continue |
| CHARACTER_SELECT | Character × outfit options per player. The chosen character appears on stage. Duo picks Player 1 first, then Player 2 |
| CALIBRATION | Tracking view with standing zones, per-player plain-language prompts, a readiness checkmark and a progress bar |
| TUTORIAL / COUNTDOWN | One instruction, then large countdown numerals with an optional tick sound |
| PLAYING | Song title and progress, the next move, per-player badges, running points, and after each move the feedback word with "+N · N% match", plus a small tracking view. Solo shows ONE dancer; duo shows TWO (each wears that player's chosen character and performs the routine) |
| PAUSED | A calm message. Tracking loss only pauses after the configured time |
| RESULTS | Large score, tier, details, today's board placement (real live data only), **Play again**, **Finish**, **View leaderboard** and a visible auto-reset countdown |
| RECOVERABLE_ERROR | A plain message, **Try again**, "ask the attendant" and a small error code |
| MAINTENANCE / SELF_CHECK | "Back in a moment" or "Warming up…" |

The leaderboard window shows today's completed **live** sessions for the active
event. Replay/demo, aborted and unjudged sessions never appear. It can go
fullscreen and move to the next display from its own controls or from the
operator console, and it remembers the display it was last shown on.

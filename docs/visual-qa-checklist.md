# Visual QA checklist

Run this on the actual booth display, with the player standing 2–3 m from it
(or at the event's real playing distance). Record the date, display and
resolution for each run.

| # | Check | How to check |
| --- | --- | --- |
| V1 | Attract headline, button and availability line are readable from the play area | Stand at the play distance |
| V2 | Exactly one dominant action per screen | Walk through ATTRACT → RESULTS |
| V3 | Focus ring visible on every button | Use Tab or the arrow keys on each screen |
| V4 | Selected state shows both a checkmark and "Selected" | Mode tiles and character options |
| V5 | Disabled and loading buttons look inactive and ignore repeated presses | Component preview (dev) |
| V6 | No text clipped at 1920×1080, 1600×900 or 1280×720 | Resize the window or use the screenshots spec |
| V7 | Duo layouts separate Player 1 and Player 2 by label and shape | Duo calibration, HUD, results |
| V8 | Calibration prompts match what the person is actually doing | Live camera, move out of frame and back |
| V9 | Feedback text is readable over the 3D stage | Live session |
| V10 | Effects never hide the instructor's body | Live session in solo and duo |
| V11 | Reduced motion removes UI animation, and gameplay timing is unchanged | Turn on Reduced motion and play a song |
| V12 | A missing font or logo falls back gracefully | Rename a font file and restart (dev) |
| V13 | Leaderboard is readable fullscreen on the second display | Operator: Open leaderboard → Fullscreen → choose a display |
| V14 | No development metrics on the participant screen with the perf overlay off | Operator: Perf overlay off |
| V15 | Results auto-reset countdown is visible and correct | Finish a song and wait |

Automated coverage: `e2e/screenshots.spec.ts` captures nine reference
screenshots (1584×861 and 1920×1080) in replay mode. I reviewed them on
2026-11-02 and corrected two problems: the attract framing hid the instructor,
and the floor texture had gaps.

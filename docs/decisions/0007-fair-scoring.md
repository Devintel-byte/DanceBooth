# 0007 — Fair scoring (scoring version danceoff-points-v3)

Date: 2026-11-04. Supersedes the "best sample in the window" rule of
[0004](0004-scoring-conventions.md); its mirroring and frame conventions still apply.

## Problem

Players who barely followed the dancer could beat players who danced well.
Measured on the bundled songs:

* Standing still with arms down earned **44–61 %** of the maximum points,
  because many reference poses (side-to-side, idle grooves) have the arms
  low and the torso upright, and the torso is upright in every pose.
* Each move took the single best frame in a ±0.35 s window, so waving the
  arms about passed through the right pose often enough to score.
* People copy a screen 0.3–0.6 s late; a good dancer at 0.5 s was outside
  the window while a random mover was inside it.
* Only mirror-wise copying was accepted; good dancers who raised the same arm
  as the dancer lost about a quarter of their points.

## Rules (v2)

1. **Relative to standing still.** Each move's match is rescaled so the best
   rest pose (arms hanging, hands on hips) scores 0 and an exact match 1.
   Moves that a resting person already matches at least 75 % are not judged.
2. **Segments that move count most.** Per move, a segment's weight is its base
   weight × (0.2 + 0.8 × how far the reference is from every rest position).
3. **Held pose.** A move scores the average over samples within `sustainSec`
   (v2: normal 0.17 s; v3: 0.15 s on every difficulty) of the chosen moment, not one frame.
4. **Own delay.** The window runs from `timingToleranceSec` early to
   `lateToleranceSec` late (normal 0.25 / 0.7 s). Timing is perfect anywhere
   from the beat up to the player's steady delay (median of recent good
   moves, at most 0.5 s), then falls off over `timingSpreadSec`.
5. **Mirror or same-side.** Each frame is read both ways; per player the
   scorer uses whichever convention they have followed better so far (with a
   margin, so it does not flip move by move).

6. **Points ladder** (client's request, 2026-11-04): each judged move earns
   **10** for a match (held-pose accuracy ≥ `matchAt` 0.7), **5** for a close
   match (≥ `closeAt` 0.4), **2** for at least making a move (an arm segment
   turned ≥ `movedDeg` 35° inside the move's window), else **0**. Feedback:
   "Perfect match!", "Close!", "Keep moving!".

v1 (0–100 per move by accuracy), v2 and v3 scores must not be mixed on one
leaderboard or in one central round.

## v3 (2026-11-04): no points for taking part

Client's request: points only for matching the moves. Changes from v2:

* **10** for a match, **4** for a close match, **0** for everything else. The
  2 points for "at least making a move" are gone, and so is the "Keep moving!"
  feedback. Not moving, moving without copying the moves, and being out of
  frame all score 0.
* Stricter bars, so moving about no longer collects close matches by chance:
  `matchAt` 0.72 (was 0.7), `closeAt` 0.58 (was 0.4).
* The pose must be held over ±0.15 s on every difficulty (`sustainSec`; was
  0.12–0.2 s by difficulty).
* Each move is judged where the 3D dancer is most still inside its 2-beat slot
  (`scripts/build-routines.ts`), i.e. at the pose a player sees and copies, not
  mid-swing.
* Easy is a little stricter: `perfectAngleDeg` 22° / `zeroAngleDeg` 72° (was 24° / 80°).
* The dances use only simple moves (see `assets/choreography/plan.json`).

A longer hold (±0.3 s) shut out even more random movement, but a perfect copy
of the actual 3D dancer (tracked poses with a 0.3 s reaction delay and ±4°
jitter) then scored only 50–75 % on normal, because the Mixamo dances flow
rather than stop on poses. At ±0.15 s with the stillest-moment judging, the
same perfect copy scores 92–100 % (easy), 77–100 % (normal), 69–97 % (hard).

Simulated performers on the bundled songs, share of the maximum points
(`fairness.test.ts`), easy / normal / hard:

| Performer | v3 |
| --- | --- |
| Follows the dancer (mirror, late or loose) | 98–100 % |
| Follows same-side | 95 % |
| Half-hearted small versions of the moves | 9 / 5 / 1 % |
| Generic arm-pumping to the beat | 1.8 / 1.8 / 1.2 % |
| Random fast waving | 6.7 / 4.5 / 1.7 % |
| Standing still, or out of frame | 0 % |
| Dances a different dance to the same song (shares some poses) | 17 / 13 / 8 % |

What is left for random movement is the odd move it lands on by chance; there
is no participation score.

**Eased slightly (2026-11-04, client: "too rigid").** `matchAt` 0.72 → 0.68,
`closeAt` 0.58 → 0.52, easy angles 22°/72° → 24°/76° (normal and hard angles
unchanged). Copying the actual 3D dancer: easy 96 → 97 %, normal 89–91 → 91–94 %
on average, more for loose followers (worst case normal 82 → 86 %). Random
movement on easy: arm-pumping 2 → 3 %, fast waving 7 → 10 %; standing still
stays 0. Same points ladder, so the scoring version stays `danceoff-points-v3`.

## Evidence

Real MediaPipe tracking of the Mixamo dancer rendered performing each
routine (4 songs, normal difficulty), share of maximum points:

| Performance | v1 | v2 |
| --- | --- | --- |
| Dances the routine (mirror, 0.3 s late) | 90–93 % | 81–92 % |
| Dances the routine, same-side | 67–77 % | 73–86 % |
| Dances the routine, 0.6 s late | 68–82 % | 80–92 % |
| Idle sway, not dancing | 46–62 % | 0–3 % |
| Dances a different routine | 47–58 % | 17–25 % |

Simulated performers on all bundled routines (`fairness.test.ts`, run on
every `pnpm test`): standing still < 8 %, generic arm-pumping < 25 %,
random waving < 40 %, half-hearted small moves < 40 %; close, loose, slow
and same-side followers > 75–85 %.

With the ladder, on the same real-tracking runs: the routine danced
correctly earns mostly 10s (79–97 % of the maximum, same-side included);
idle swaying earns 0 on every move; dancing a different routine earns mostly
2s (23–33 %).

## Not yet validated

Real people. The rendered dancer is a perfect performer seen through the real
tracker; real players add body differences, clothing and lighting. Watch the
first event's scores: if good dancers land well below 60 %, lower `MATCH_AT`/`CLOSE_AT` (v3: 0.72 / 0.58) or loosen
`perfectAngleDeg`/`zeroAngleDeg` for normal difficulty in
`packages/scoring/src/judge.ts` (and bump the scoring version).

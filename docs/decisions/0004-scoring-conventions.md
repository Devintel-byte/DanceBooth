# 0004 — Scoring geometry and mirror conventions

**Coordinate spaces.** Tracking landmarks are `image-normalized`: x right, y **down**, unmirrored camera image. World landmarks are kept separately (`worldLandmarks`) and are not used for scoring yet. Nothing mixes the two.

**Reference poses.** A routine move stores, per segment, a 2D direction `[x, y]` in *display space* (x right, y **up**) describing the instructor **as rendered facing the viewer**, keyed by the instructor's anatomical side. The same data drives the procedural instructor, so animation and scoring reference cannot diverge.

**Mirroring.**

* `same-side`: participants use the same anatomical limb. A person facing the camera appears in the raw image the way the instructor appears on screen, so directions are used as captured (y flipped) with names unchanged.
* `mirror` (dev routine default): participants copy like a mirror. x is negated and the participant's left segment is compared with the instructor's right.

Tests in `scoring.test.ts` lock both conventions, including "wrong arm in mirror mode scores low".

**Features.** Directions of upper arms, forearms, thighs, shins and torso (hip-centre → shoulder-centre). Directions are scale-free, so body size, distance and limb proportions do not matter (tested). Body scale (torso length) is used only to reject foreshortened/degenerate segments (< 12 % of torso).

**Missing evidence.** Landmarks with visibility < 0.5 make their segments *absent*. A move is judged only if observed segment weight ≥ `minEvidence` of the required weight; otherwise it is `no-read`, excluded from the percentage, and neither extends nor breaks the streak.

**Timing.** Samples are tagged with the song time of the captured frame (not inference completion). Each move takes the best sample within ±`timingToleranceSec`; timing quality falls linearly after `perfectTimingSec`, and `combined = pose × (floor + (1 − floor) × timing)`.

**Known limitations.** 2D directions cannot see motion toward/away from the camera (no knee lifts, punches toward camera); routines must be authored in the frontal plane. Fairness across body types, clothing, lighting and skin tones has **not** been validated.

**Update 2026-11-03 (points model, after Daniel's feedback that scoring felt ambiguous).**
Points now track how closely each move is matched:

* *Superseded by [0007](0007-fair-scoring.md) (2026-11-04): 10 / 5 / 2 / 0 points per move.* Previously each judged move was worth up to **100 points**: `points = round(100 × pose accuracy × (1 − timingWeight × (1 − timing quality)))`.
* Pose accuracy is the weighted average of the per-segment scores. A segment scores 1 when its angle error is within `perfectAngleDeg`, falls linearly to 0 at `zeroAngleDeg`, and gives partial credit in between.
* Timing can remove at most 10% of a move's points on easy, 15% on normal and 25% on hard, so correctness dominates.
* The score is the total points. The rating is the **average match %** over the moves actually scored. Unreadable moves are still excluded rather than counted as zero.
* After each move, the HUD shows the feedback word plus "+N · N% match".

A test locks this in: a tilt of 0°, 25°, 40°, 55° and 80° from the reference yields strictly decreasing points (100 down to 0) on normal.

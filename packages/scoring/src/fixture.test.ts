import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadContent, loadReplayFixture } from '@booth/content';
import { DIFFICULTY_PRESETS, PlayerScorer, extractPose } from './index';

const assets = path.resolve(__dirname, '../../../assets');

/**
 * End-to-end scoring over the bundled SYNTHETIC replay fixture: routine
 * manifest -> fixture landmarks -> feature extraction -> scorer. Uses the
 * fixture's media time as song time, exactly like replay mode in the app.
 */
function scoreFixture() {
  const content = loadContent(assets);
  const routine = content.routines.find((r) => r.id === 'dev-groove')!;
  const fixture = loadReplayFixture(assets, 'fixtures/dev-groove-synthetic.json');
  const scorer = new PlayerScorer(routine, DIFFICULTY_PRESETS[routine.difficulty]);
  fixture.frames.forEach((f, i) => {
    const body = f.bodies[0]?.map(([x, y, z, visibility]) => ({ x, y, z, visibility }));
    scorer.addSample(i, f.t, body ? extractPose(body, routine.mirroring) : null);
    scorer.advance(f.t);
  });
  scorer.finish();
  return { routine, scorer };
}

describe('replay fixture scoring', () => {
  it('scores the synthetic performance highly and treats the occlusion as missing evidence', () => {
    const { routine, scorer } = scoreFixture();
    void routine;
    const s = scorer.summary();
    // Moves that look like standing still are not judged; every other move is judged or unreadable.
    expect(s.judgedMoves + s.insufficientEvidence).toBe(scorer.judgeableMoves);
    expect(scorer.judgeableMoves).toBeGreaterThan(routine.moves.length / 2);
    expect(s.percent).toBeGreaterThan(80);
    // The left-arm occlusion (12-13.5 s) removes evidence but is never a "miss".
    const occluded = scorer.moveResults.filter((r) => r.moveTimeSec >= 12 && r.moveTimeSec <= 13.5);
    for (const r of occluded) expect(r.feedback).not.toBe('miss');
    expect(s.feedbackCounts.miss).toBe(0);
  });

  it('is reproducible', () => {
    const a = JSON.stringify(scoreFixture().scorer.moveResults);
    const b = JSON.stringify(scoreFixture().scorer.moveResults);
    expect(a).toBe(b);
  });
});

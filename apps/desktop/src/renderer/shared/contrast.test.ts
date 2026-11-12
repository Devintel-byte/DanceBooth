import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from './contrast';

const css = readFileSync(path.resolve(__dirname, '../styles/tokens.css'), 'utf-8');
const token = (name: string) => {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  if (!m) throw new Error(`token ${name} missing`);
  return m[1]!;
};

/** Text/background pairs actually used by the UI, with the WCAG level they must meet. */
const PAIRS: [string, string, number][] = [
  ['text-primary', 'surface-page', 4.5],
  ['text-secondary', 'surface-page', 4.5],
  ['text-primary', 'surface-card', 4.5],
  ['text-primary', 'surface-warm', 4.5],
  ['text-on-dark', 'brand-orange-dark', 4.5], // primary button
  ['text-primary', 'brand-gold', 4.5], // selected / celebration
  ['text-primary', 'brand-orange', 4.5], // P1 badge
  ['text-on-dark', 'stage-background', 4.5],
  ['text-on-dark', 'stage-panel', 4.5],
  ['brand-gold', 'stage-background', 3], // large score numerals
  ['brand-orange', 'stage-background', 3], // large labels on stage
  ['status-error', 'surface-page', 4.5],
  ['status-success', 'surface-page', 4.5],
  ['status-warning', 'surface-page', 4.5],
];

describe('theme contrast', () => {
  it.each(PAIRS)('%s on %s meets %s:1', (fg, bg, min) => {
    expect(contrastRatio(token(fg), token(bg))).toBeGreaterThanOrEqual(min);
  });

  it('documents that white text on bright orange is NOT used (fails AA)', () => {
    expect(contrastRatio('#ffffff', token('brand-orange'))).toBeLessThan(4.5);
  });
});

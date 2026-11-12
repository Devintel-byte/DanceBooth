import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every event profile's colours must keep the UI readable (WCAG 2.1 contrast),
 * for the same text/background pairs the UI uses (see shared/contrast.test.ts).
 */
const dir = path.resolve(__dirname, '../../../assets/profiles');

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};

const PAIRS: [string, string, number][] = [
  ['textPrimary', 'surfacePage', 4.5],
  ['textSecondary', 'surfacePage', 4.5],
  ['textPrimary', 'surfaceCard', 4.5],
  ['textPrimary', 'surfaceWarm', 4.5],
  ['textOnDark', 'brandOrangeDark', 4.5],
  ['textPrimary', 'brandGold', 4.5],
  ['textPrimary', 'brandOrange', 4.5],
  ['textOnDark', 'stageBackground', 4.5],
  ['textOnDark', 'stagePanel', 4.5],
  ['brandGold', 'stageBackground', 3],
  ['brandOrange', 'stageBackground', 3],
];

for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  const colors = (JSON.parse(readFileSync(path.join(dir, file), 'utf-8')) as { colors: Record<string, string> }).colors;
  describe(`profile ${file} contrast`, () => {
    it.each(PAIRS)('%s on %s meets %s:1', (fg, bg, min) => {
      expect(ratio(colors[fg]!, colors[bg]!)).toBeGreaterThanOrEqual(min);
    });
  });
}

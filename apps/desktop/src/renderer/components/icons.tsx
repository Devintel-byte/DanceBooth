/**
 * Dancer icons from Phosphor Icons 2.1 ("person-arms-spread", "user", fill
 * weight), MIT licence, Copyright (c) 2023 Phosphor Icons
 * (https://phosphoricons.com). Paths are inlined so the booth works offline
 * and needs no extra dependency. See docs/asset-licenses.md.
 */

const DANCER =
  'M100,36a28,28,0,1,1,28,28A28,28,0,0,1,100,36ZM227.6,92.57A15.7,15.7,0,0,0,212,80H44a16,16,0,0,0-6.7,30.53l.06,0,53.89,23.73-21.92,83.3a16,16,0,0,0,7.9,20.91A15.83,15.83,0,0,0,84,240a16,16,0,0,0,14.44-9.06L128,180l29.58,51a16,16,0,0,0,29.07-13.35l-21.92-83.3,54-23.76A15.7,15.7,0,0,0,227.6,92.57Z';
const PERSON =
  'M230.93,220a8,8,0,0,1-6.93,4H32a8,8,0,0,1-6.92-12c15.23-26.33,38.7-45.21,66.09-54.16a72,72,0,1,1,73.66,0c27.39,8.95,50.86,27.83,66.09,54.16A8,8,0,0,1,230.93,220Z';

/** One dancer, arms out: the solo mode. */
export function SoloDancerIcon({ size = 112 }: { size?: number }) {
  return (
    <svg className="dancer-icon" width={size} height={size} viewBox="0 0 256 256" aria-hidden="true">
      <ellipse cx="128" cy="246" rx="72" ry="8" className="dancer-floor" />
      <path d={DANCER} className="dancer-p1" />
    </svg>
  );
}

/** Two dancers side by side: the duo mode (player colours, Player 1 in front). */
export function DuoDancersIcon({ size = 112 }: { size?: number }) {
  return (
    <svg className="dancer-icon" width={size * 1.6} height={size} viewBox="0 0 410 256" aria-hidden="true">
      <ellipse cx="205" cy="246" rx="160" ry="8" className="dancer-floor" />
      <g transform="translate(170 14) scale(0.94)">
        <path d={DANCER} className="dancer-p2" />
      </g>
      <g transform="translate(-6 0)">
        <path d={DANCER} className="dancer-p1" stroke="var(--surface-card)" strokeWidth="10" paintOrder="stroke" />
      </g>
    </svg>
  );
}

/** Small person glyph for the player badges. */
export function PlayerIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
      <path d={PERSON} />
    </svg>
  );
}

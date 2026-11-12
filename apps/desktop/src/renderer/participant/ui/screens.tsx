import { useCallback, useEffect, useRef, useState } from 'react';
import { PARTICIPANT_MESSAGES, type CharacterPreset, type EventProfile } from '@booth/contracts';
import type { PlayerSelection } from '@booth/session';
import type { CalibrationIssue } from '@booth/tracking';
import {
  ArrowIcon,
  CharacterOption,
  DuoDancersIcon,
  SoloDancerIcon,
  Wordmark,
  CheckIcon,
  PlayIcon,
  PlayerBadge,
  PrimaryButton,
  ProgressIndicator,
  SecondaryButton,
  SelectionTile,
  StatusBadge,
} from '../../components';
import { booth } from '../../shared/booth';
import type { BoothRuntime, UiSnapshot } from '../runtime/runtime';
import { SkeletonOverlay } from './SkeletonOverlay';

/** Plain-language, slot-aware calibration prompts. */
const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

function issueText(issue: CalibrationIssue, slot: 1 | 2, duo: boolean): string {
  const who = duo ? `Player ${slot}, ` : '';
  switch (issue) {
    case 'not-detected':
      return duo ? `Player ${slot}, step into your space.` : 'Step into the space in front of the screen.';
    case 'step-back':
      return `${who}step back so we can see all of you.`;
    case 'come-closer':
      return `${who}come a little closer.`;
    case 'move-left':
      return `${who}move a little to the left.`;
    case 'move-right':
      return `${who}move a little to the right.`;
    case 'show-arms':
      return `${who}keep both arms in view.`;
    case 'show-legs':
      return `${who}step back so we can see your feet.`;
    case 'low-confidence':
      return `${who}face the screen.`;
    case 'wrong-side':
      return slot === 1 ? 'Player 1, move to the left side.' : 'Player 2, move to the right side.';
    case 'too-close':
      return 'Give each other a little more space.';
  }
}

const FEEDBACK_TEXT: Record<string, string> = {
  perfect: 'Perfect match!',
  great: 'Perfect match!',
  good: 'Close!',
  miss: 'Copy the dancer!',
  'no-read': 'Stay in view',
};

export function BrandHeader({ profile, assetBaseUrl, snap }: { profile: EventProfile; assetBaseUrl: string; snap: UiSnapshot }) {
  const hidden = ['COUNTDOWN', 'PLAYING'].includes(snap.state);
  return (
    <header className={`brand-header ${hidden ? 'is-hidden' : ''}`}>
      <Wordmark name={profile.productName} accent={profile.productNameAccent} />
      {/* Reserved brand-logo slot: shows an approved logo only when the profile supplies one. */}
      <span className="logo-slot" aria-hidden={!profile.logo}>
        {profile.logo && <img src={`${assetBaseUrl}${profile.logo}`} alt={`${profile.eventName} logo`} draggable={false} onError={(e) => (e.currentTarget.style.display = 'none')} />}
      </span>
    </header>
  );
}

export function AttractScreen({ profile, snap, onStart }: { profile: EventProfile; snap: UiSnapshot; onStart: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <section className="attract panel-light">
      <div className="sunray" aria-hidden="true" />
      <h1 className="hero-title">Feel the beat.</h1>
      <p className="lead">{profile.tagline || 'Step in. Pick your dancer. Make your move.'}</p>
      <PrimaryButton ref={ref} icon={<PlayIcon />} onClick={onStart}>
        Start dancing
      </PrimaryButton>
      <p className="availability">
        {profile.modes.includes('duo') ? 'Play solo or with a friend' : 'Solo dancing'} · press Start or the A button
      </p>
      {snap.trackingStatus.kind === 'error' && <StatusBadge tone="warning">Camera check in progress</StatusBadge>}
    </section>
  );
}

const MODE_COPY = {
  single: { title: 'Solo', desc: 'Your moment on the dance floor.', icon: <SoloDancerIcon /> },
  duo: { title: 'Two players', desc: 'Dance together. See who takes the lead.', icon: <DuoDancersIcon /> },
} as const;

export function ModeSelectScreen({
  modes,
  index,
  onSelect,
  onContinue,
  onBack,
}: {
  modes: readonly ('single' | 'duo')[];
  index: number;
  onSelect: (i: number) => void;
  onContinue: () => void;
  onBack: () => void;
}) {
  return (
    <section className="onboarding panel-light">
      <h2 className="screen-title">How are you dancing?</h2>
      <div className="tile-row">
        {modes.map((m, i) => (
          <SelectionTile
            key={m}
            title={MODE_COPY[m].title}
            description={MODE_COPY[m].desc}
            media={<span className="mode-icon">{MODE_COPY[m].icon}</span>}
            selected={i === index}
            onSelect={() => onSelect(i)}
          />
        ))}
      </div>
      <div className="action-row">
        <SecondaryButton onClick={onBack}>Back</SecondaryButton>
        <PrimaryButton icon={<ArrowIcon />} onClick={onContinue}>
          Continue
        </PrimaryButton>
      </div>
    </section>
  );
}

export function CharacterSelectScreen({
  characters,
  assetBaseUrl,
  selection,
  activeSlot,
  onPick,
  onConfirm,
  onBack,
}: {
  characters: readonly CharacterPreset[];
  assetBaseUrl: string;
  selection: PlayerSelection[];
  activeSlot: 1 | 2;
  onPick: (slot: 1 | 2, characterId: string, paletteId: string) => void;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const duo = selection.length === 2;
  return (
    <section className="onboarding char-select panel-light">
      <h2 className="screen-title">{duo ? `Player ${activeSlot}, choose your character` : 'Choose your character'}</h2>
      <div className="char-columns">
        {selection.map((p) => (
          <div key={p.slot} className={`char-panel ${p.slot === activeSlot ? 'is-active' : 'is-waiting'}`}>
            {duo && <PlayerBadge slot={p.slot} />}
            <div className="char-list" role="group" aria-label={`Player ${p.slot} character`}>
              {characters.flatMap((c) =>
                c.palettes.map((pal) => (
                  <CharacterOption
                    key={`${c.id}-${pal.id}`}
                    name={c.palettes.length > 1 ? `${c.displayName} · ${pal.name}` : c.displayName}
                    portrait={c.thumbnail ? `${assetBaseUrl}${c.thumbnail}` : undefined}
                    swatch={`linear-gradient(135deg, ${pal.primary} 50%, ${pal.secondary} 50%)`}
                    selected={p.characterId === c.id && p.paletteId === pal.id}
                    onSelect={() => onPick(p.slot, c.id, pal.id)}
                  />
                )),
              )}
            </div>
            {characters.find((c) => c.id === p.characterId)?.placeholder && <span className="note">Placeholder character for testing</span>}
          </div>
        ))}
      </div>
      <div className="action-row">
        <SecondaryButton onClick={onBack}>Back</SecondaryButton>
        <PrimaryButton icon={<ArrowIcon />} onClick={onConfirm}>
          {duo && activeSlot === 1 ? 'Continue to Player 2' : 'Continue'}
        </PrimaryButton>
      </div>
    </section>
  );
}

function NoteIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 18.5a2.5 2.5 0 1 1-2.5-2.5c.53 0 1.02.16 1.5.44V5l11-2v12.5a2.5 2.5 0 1 1-2.5-2.5c.53 0 1.02.16 1.5.44V7.4l-9 1.64v9.46z" fill="currentColor" />
    </svg>
  );
}

/**
 * Song choice on the character screen (top left). Tap to open the list, or
 * use LB / RB on a controller (Page Up / Page Down on a keyboard).
 */
export function SongPicker({
  songs,
  currentId,
  onSelect,
}: {
  songs: readonly { id: string; title: string }[];
  currentId: string | null;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  if (songs.length < 2) return null;
  const current = songs.find((s) => s.id === currentId) ?? songs[0]!;
  return (
    <aside className={`song-picker ${open ? 'is-open' : ''}`} ref={ref}>
      <span className="song-picker-label">Song</span>
      <button type="button" className="song-picker-current" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <NoteIcon />
        <span className="song-picker-title">{current.title}</span>
        <span className="song-picker-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <ul className="song-picker-list" role="listbox" aria-label="Choose a song">
          {songs.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                role="option"
                aria-selected={s.id === current.id}
                className={s.id === current.id ? 'is-selected' : ''}
                onClick={() => {
                  onSelect(s.id);
                  setOpen(false);
                }}
              >
                {s.title}
              </button>
            </li>
          ))}
        </ul>
      )}
      <span className="song-picker-hint">LB / RB to change</span>
    </aside>
  );
}

export function CalibrationScreen({ snap, runtime, onBack }: { snap: UiSnapshot; runtime: BoothRuntime; onBack: () => void }) {
  const duo = snap.mode === 'duo';
  const slots = snap.calibration.length ? snap.calibration : snap.players.map((p) => ({ slot: p.slot, ready: false, issues: ['not-detected' as const] }));
  const allReady = slots.length > 0 && slots.every((s) => s.ready);
  return (
    <section className="calibration panel-light">
      <h2 className="screen-title">{allReady ? 'You’re ready!' : 'Step into position.'}</h2>
      <div className="calib-body">
        <div className="tracking-view">
          <SkeletonOverlay runtime={runtime} zones={duo ? 2 : 1} />
        </div>
        <ul className="calib-status" aria-live="polite">
          {slots.map((c) => (
            <li key={c.slot} className={c.ready ? 'is-ready' : ''}>
              {duo && <PlayerBadge slot={c.slot} />}
              {c.ready ? (
                <span className="ready-line">
                  <CheckIcon /> {duo ? `Player ${c.slot} is ready` : 'You’re ready!'}
                </span>
              ) : (
                <span>{capitalize(issueText(c.issues[0] ?? 'not-detected', c.slot, duo))}</span>
              )}
            </li>
          ))}
        </ul>
      </div>
      <ProgressIndicator value={snap.calibrationProgress} label="Getting ready" />
      {snap.calibrationLeavingIn !== null ? (
        <p className="calib-help calib-leaving" role="status">
          We can’t see anyone. Going back to the start in {snap.calibrationLeavingIn} s.
        </p>
      ) : snap.calibrationHelp && !allReady ? (
        <p className="calib-help" role="status">
          <span className="calib-help-key">Press START</span> to dance anyway
        </p>
      ) : (
        <p className="footnote">Make sure your whole body fits in the frame{duo ? ' — Player 1 on the left, Player 2 on the right' : ''}.</p>
      )}
      <div className="action-row">
        <SecondaryButton onClick={onBack}>Back</SecondaryButton>
      </div>
    </section>
  );
}

export function TutorialScreen(_props: { snap: UiSnapshot }) {
  return (
    <section className="tutorial panel-dark">
      <p className="eyebrow">How to play</p>
      <h2 className="screen-title">Copy the dancer, like a mirror.</h2>
      <p className="lead">Match a move: 10 points. Close: 4 points. No match: 0. Copy the dancer’s arms and hold each pose for a moment.</p>
      <p className="footnote">Press Start to skip</p>
    </section>
  );
}

export function CountdownScreen({ snap }: { snap: UiSnapshot }) {
  const n = snap.countdown;
  return (
    <section className="countdown" aria-live="assertive">
      <span key={n ?? 'go'} className="count-number tabular">
        {n && n > 0 ? n : 'Go!'}
      </span>
    </section>
  );
}

/**
 * Time left in the song as a digital board (like the stoppage-time board in
 * football): seven-segment digits over faint unlit segments. Turns red and
 * pulses in the last 10 seconds.
 */
export function GameTimer({ remainingSec }: { remainingSec: number }) {
  const s = Math.max(0, Math.ceil(remainingSec));
  const text = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  return (
    <div className={`game-timer ${s <= 10 ? 'is-ending' : ''}`} role="timer" aria-label={`${s} seconds left`}>
      <span className="game-timer-label">TIME</span>
      <span className="game-timer-face" aria-hidden="true">
        <span className="game-timer-ghost">8:88</span>
        <span className="game-timer-digits">{text}</span>
      </span>
    </div>
  );
}

const MINI_VIEW_KEY = 'booth.hud.miniView';

/**
 * The small live skeleton view (top right) with a hide/show button. The
 * choice is remembered on this booth PC. Also toggled with the V key.
 */
function MiniView({ runtime }: { runtime: BoothRuntime }) {
  const [shown, setShown] = useState(() => {
    try {
      return localStorage.getItem(MINI_VIEW_KEY) !== 'hidden';
    } catch {
      return true;
    }
  });
  const toggle = useCallback(() => {
    setShown((v) => {
      try {
        localStorage.setItem(MINI_VIEW_KEY, v ? 'hidden' : 'shown');
      } catch {
        // storage unavailable: the choice lasts for this run only
      }
      return !v;
    });
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'v' || e.key === 'V') toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);
  return (
    <div className={`hud-mini ${shown ? 'is-shown' : 'is-hidden'}`}>
      <button type="button" className="hud-mini-toggle" onClick={toggle} aria-pressed={shown} title="Show or hide the camera view (V)">
        {shown ? 'Hide view' : 'Show view'}
      </button>
      {shown && (
        <div className="hud-mini-view">
          <SkeletonOverlay runtime={runtime} zones={0} compact />
        </div>
      )}
    </div>
  );
}

export function PlayingHud({ snap, runtime }: { snap: UiSnapshot; runtime: BoothRuntime }) {
  const remaining = snap.routine ? snap.routine.durationSec - Math.max(0, snap.songTimeSec ?? 0) : 0;
  return (
    <section className="hud" aria-label="Gameplay">
      <div className="hud-top">
        <GameTimer remainingSec={remaining} />
        <span />
        {snap.nextMoveLabel && <span className="hud-next">Next: {snap.nextMoveLabel}</span>}
      </div>
      <div className={`hud-players n${snap.players.length}`}>
        {snap.players.map((p) => (
          <div key={p.slot} className={`hud-player p${p.slot}`}>
            <PlayerBadge slot={p.slot} />
            {p.name && <span className="hud-name">{p.name}</span>}
            {p.locked && <span className="hud-locked">Locked in</span>}
            <span className="points tabular">{p.points.toLocaleString()}</span>
            <span className="points-caption">points</span>
            {p.lastFeedback && (
              <span key={p.feedbackSeq} className={`feedback fb-${p.lastFeedback}`}>
                {FEEDBACK_TEXT[p.lastFeedback]}
                {p.lastMovePoints !== null && p.lastMovePoints > 0 && <span className="move-points tabular"> +{p.lastMovePoints}</span>}
              </span>
            )}
            {p.prompt && <span className="prompt">{snap.players.length === 2 ? `Player ${p.slot}, step back into view` : 'Step back into view'}</span>}
          </div>
        ))}
      </div>
      <MiniView runtime={runtime} />
    </section>
  );
}

export function PausedScreen({ snap }: { snap: UiSnapshot }) {
  const lost = snap.pauseReason === 'tracking-lost';
  return (
    <section className="paused panel-dark" role="status">
      <h2 className="screen-title">{lost ? 'We can’t see you' : 'Paused'}</h2>
      <p className="lead">{lost ? 'Step back in front of the screen. The attendant will resume the song.' : 'Hang tight — the song will continue shortly.'}</p>
    </section>
  );
}

export function ResultsScreen({
  snap,
  profile,
  onPlayAgain,
  onFinish,
}: {
  snap: UiSnapshot;
  profile: EventProfile;
  onPlayAgain: () => void;
  onFinish: () => void;
}) {
  const again = useRef<HTMLButtonElement>(null);
  useEffect(() => again.current?.focus(), []);
  const tierFor = (pct: number) =>
    [...profile.results.tiers].sort((a, b) => b.minScore - a.minScore).find((t) => pct >= t.minScore) ?? profile.results.tiers[0]!;
  const duo = snap.results.length === 2;
  const leader = duo ? (snap.results[0]!.summary.points === snap.results[1]!.summary.points ? null : snap.results[0]!.summary.points > snap.results[1]!.summary.points ? 1 : 2) : null;
  return (
    <section className="results panel-dark">
      <h2 className="screen-title">
        {duo
          ? leader
            ? `${snap.players.find((p) => p.slot === leader)?.name ?? `Player ${leader}`} takes the lead!`
            : 'A perfect tie!'
          : `What a performance${snap.players[0]?.name ? `, ${snap.players[0].name}` : ''}!`}
      </h2>
      <div className={`result-cards n${snap.results.length}`}>
        {snap.results.map(({ slot, summary }) => {
          const tier = tierFor(summary.percent);
          const placement = snap.placements.find((p) => p.slot === slot);
          const who = snap.players.find((p) => p.slot === slot);
          return (
            <div key={slot} className={`result-card ${leader === slot ? 'is-leader' : ''}`}>
              {duo && <PlayerBadge slot={slot} />}
              {who?.name && (
                <span className="result-name">
                  {who.name} <span className="result-id">{who.playerId}</span>
                </span>
              )}
              <span className="result-score tabular">{summary.points.toLocaleString()}</span>
              <span className="result-score-label">points</span>
              <span className="result-tier">{tier.title}</span>
              <span className="result-msg">{tier.message}</span>
              <span className="result-detail">
                {summary.feedbackCounts.perfect + summary.feedbackCounts.great} matched · {summary.feedbackCounts.good} close · best streak {summary.bestStreak}
                {summary.insufficientEvidence > 0 ? ` · ${summary.insufficientEvidence} moves we couldn’t see` : ''}
              </span>
              {placement && (
                <span className="placement">
                  #{placement.rank} on today’s board
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="action-row">
        <PrimaryButton ref={again} icon={<PlayIcon />} onClick={onPlayAgain}>
          Play again
        </PrimaryButton>
        <SecondaryButton onClick={onFinish}>Finish</SecondaryButton>
        <SecondaryButton onClick={() => void booth().openLeaderboard()}>View leaderboard</SecondaryButton>
      </div>
      {snap.resultsSecondsLeft !== null && (
        <p className="footnote tabular" aria-live="off">
          Starting over in {snap.resultsSecondsLeft}s
        </p>
      )}
    </section>
  );
}

export function ErrorScreen({ snap, onRetry }: { snap: UiSnapshot; onRetry: () => void }) {
  if (snap.state === 'RESETTING') return <section className="resetting" aria-live="polite" />;
  const code = snap.error?.code;
  const cameraProblem = code?.startsWith('CAMERA');
  return (
    <section className="error-screen panel-light" role="alert">
      <h2 className="screen-title">{cameraProblem ? 'We couldn’t connect to the camera.' : 'Something went wrong.'}</h2>
      <p className="lead">{code ? PARTICIPANT_MESSAGES[code] : 'Getting the stage ready again.'}</p>
      <div className="action-row">
        <PrimaryButton onClick={onRetry}>Try again</PrimaryButton>
      </div>
      <p className="footnote">Need help? Please ask the attendant.{code ? ` Code: ${code}` : ''}</p>
    </section>
  );
}

export function MaintenanceScreen({ snap }: { snap: UiSnapshot }) {
  const booting = snap.state === 'BOOT' || snap.state === 'SELF_CHECK';
  return (
    <section className="maintenance panel-light" role="status">
      <h2 className="screen-title">{booting ? 'Warming up the dance floor…' : 'Back in a moment'}</h2>
      <p className="lead">{booting ? 'Checking the camera, music and tracker.' : 'The attendant is getting things ready.'}</p>
      {!booting && snap.error && <p className="footnote">Code: {snap.error.code}</p>}
    </section>
  );
}

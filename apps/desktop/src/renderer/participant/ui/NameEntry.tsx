import { useCallback, useEffect, useRef, useState } from 'react';
import { PLAYER_NUMBER_LENGTH, normalizePlayerNumber, playerNameSchema, playerNumberDigits, type PlayerNumberLookup } from '@booth/contracts';
import { ArrowIcon, CheckIcon, PlayerBadge, PrimaryButton, SecondaryButton } from '../../components';

const ROWS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', '-'],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M', '.', "'", '⌫'],
  ['Space', 'Done'],
];
const MAX = 16;

export interface PlayerEntry {
  name?: string;
  number?: string;
}

export interface NameEntryProps {
  slots: (1 | 2)[];
  /** Registers the players and starts calibration; rejects with a message on failure. */
  onSubmit: (players: PlayerEntry[]) => Promise<void>;
  /** Looks up one player number in the event's player list (main process); '' clears the operator's view. */
  lookup: (slot: 1 | 2, number: string) => Promise<PlayerNumberLookup>;
  onBack: () => void;
  onActivity: () => void;
  onCue: (cue: 'select' | 'confirm') => void;
  /** Names of officially registered participants (central registry), per slot index; pre-filled. */
  initialNames?: (string | null)[];
}

interface SlotState {
  value: string;
  lookup: PlayerNumberLookup | null;
}

/** Distinguishes a 4-digit registry ID from a name (also shared with tests). */
export function nameOrIdState(value: string, lookup: PlayerNumberLookup | null): { kind: 'empty' | 'name' | 'partial-id' | 'checking' | 'known' | 'unknown' | 'no-list'; message: string } {
  const digits = playerNumberDigits(value);
  if (digits === null) return { kind: value.trim() ? 'name' : 'empty', message: '' };
  if (!digits) return { kind: 'empty', message: '' };
  if (digits.length !== PLAYER_NUMBER_LENGTH) return { kind: 'partial-id', message: 'IDs have 4 digits. Enter a name instead.' };
  const number = normalizePlayerNumber(value)!;
  if (!lookup || !('number' in lookup) || lookup.number !== number) return { kind: 'checking', message: 'Looking up ID…' };
  if (lookup.status === 'known') return { kind: 'known', message: `${lookup.name} · registered player` };
  if (lookup.status === 'unknown') return { kind: 'unknown', message: 'ID not found. Check it or enter your name instead.' };
  return { kind: 'no-list', message: 'The player list is not available. Enter your name instead.' };
}

/** One entry per player: a registered 4-digit ID or a new player's name. */
export function NameEntryScreen({ slots, onSubmit, lookup, onBack, onActivity, onCue, initialNames }: NameEntryProps) {
  const [players, setPlayers] = useState<SlotState[]>(slots.map((_, i) => ({ value: (initialNames?.[i] ?? '').slice(0, MAX), lookup: null })));
  const [active, setActive] = useState(0);
  const [cursor, setCursor] = useState<[number, number]>([0, 0]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const playersRef = useRef(players);
  playersRef.current = players;
  const entryInput = useRef<HTMLInputElement>(null);
  const duo = slots.length === 2;

  const update = useCallback((i: number, fn: (s: SlotState) => SlotState) => setPlayers((ps) => ps.map((p, k) => (k === i ? fn(p) : p))), []);

  const check = useCallback(
    async (i: number, number: string): Promise<PlayerNumberLookup | null> => {
      if (!normalizePlayerNumber(number)) {
        void lookup(slots[i]!, '').catch(() => undefined); // clears the operator's view
        return null;
      }
      let res: PlayerNumberLookup;
      try {
        res = await lookup(slots[i]!, number);
      } catch {
        res = { status: 'no-list', number };
      }
      update(i, (s) => (normalizePlayerNumber(s.value) !== number ? s : { ...s, lookup: res }));
      return res;
    },
    [lookup, slots, update],
  );

  const setValue = useCallback(
    (i: number, raw: string) => {
      const value = raw.slice(0, MAX);
      const number = normalizePlayerNumber(value);
      const prev = playersRef.current[i]!;
      if (value === prev.value) return;
      update(i, (s) => ({ ...s, value, lookup: number ? s.lookup : null }));
      void check(i, number ?? '');
    },
    [check, update],
  );

  const type = useCallback(
    (key: string) => {
      onActivity();
      setError(null);
      const p = playersRef.current[active]!;
      const value = p.value;
      if (key === '⌫') setValue(active, value.slice(0, -1));
      else if (key === 'Space') setValue(active, value.length && value.length < MAX && !value.endsWith(' ') ? `${value} ` : value);
      else setValue(active, value.length < MAX ? value + (value.length === 0 ? key : key.toLowerCase()) : value);
    },
    [active, onActivity, setValue],
  );

  const resolveEntry = useCallback(
    async (i: number, player: SlotState): Promise<PlayerEntry | null> => {
      let state = nameOrIdState(player.value, player.lookup);
      if (state.kind === 'checking') {
        const number = normalizePlayerNumber(player.value)!;
        const result = await check(i, number);
        state = nameOrIdState(player.value, result);
      }
      if (state.kind === 'known') return { number: normalizePlayerNumber(player.value)! };
      if (state.kind !== 'name') {
        setActive(i);
        setError(state.message || 'Enter your name or ID');
        return null;
      }
      const parsed = playerNameSchema.safeParse(player.value);
      if (!parsed.success) {
        setActive(i);
        setError(parsed.error.issues[0]?.message ?? 'Enter a name');
        return null;
      }
      return { name: parsed.data };
    },
    [check],
  );

  const submit = useCallback(async () => {
    const entries: PlayerEntry[] = [];
    for (const [i, player] of playersRef.current.entries()) {
      const entry = await resolveEntry(i, player);
      if (!entry) return;
      entries.push(entry);
    }
    busyRef.current = true;
    setBusy(true);
    try {
      await onSubmit(entries);
    } catch (e) {
      setError(String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
      busyRef.current = false;
      setBusy(false);
    }
  }, [onSubmit, resolveEntry]);

  const nextPlayerOrSubmit = useCallback(() => {
    if (active < slots.length - 1) {
      setActive(active + 1);
      setCursor([0, 0]);
      return;
    }
    void submit();
  }, [active, slots.length, submit]);

  const done = useCallback(async () => {
    if (busyRef.current) return;
    const entry = await resolveEntry(active, playersRef.current[active]!);
    if (!entry) return;
    onCue('confirm');
    nextPlayerOrSubmit();
  }, [active, nextPlayerOrSubmit, onCue, resolveEntry]);

  const back = useCallback(() => {
    setError(null);
    if (active > 0) {
      setActive(active - 1);
      return;
    }
    onBack();
  }, [active, onBack]);

  const press = useCallback(
    (key: string) => {
      if (key === 'Done') void done();
      else {
        onCue('select');
        type(key);
      }
    },
    [done, type, onCue],
  );

  const move = useCallback((dr: number, dc: number) => {
    setCursor(([r, c]) => {
      const nr = (r + dr + ROWS.length) % ROWS.length;
      const row = ROWS[nr]!;
      return [nr, dr !== 0 ? Math.min(c, row.length - 1) : (c + dc + row.length) % row.length];
    });
  }, []);

  // Focus the active player's single entry field.
  useEffect(() => {
    entryInput.current?.focus({ preventScroll: true });
  }, [active]);

  // Physical keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (busyRef.current) return;
      const inInput = document.activeElement === entryInput.current;
      if (!inInput && document.activeElement?.tagName === 'BUTTON' && (e.key === 'Enter' || e.key === ' ')) return; // native click
      if (e.key === 'Enter') void done();
      else if (e.key === 'Escape') back();
      else if (inInput) return; // the input handles text editing and cursor keys
      else if (e.key === 'ArrowUp') move(-1, 0);
      else if (e.key === 'ArrowDown') move(1, 0);
      else if (e.key === 'ArrowLeft') move(0, -1);
      else if (e.key === 'ArrowRight') move(0, 1);
      else if (e.key === 'Backspace') type('⌫');
      else if (e.key === ' ') type('Space');
      else if (e.key.length === 1 && /[\p{L}\p{N}.'-]/u.test(e.key)) type(e.key.toUpperCase());
      else return;
      e.preventDefault();
      e.stopPropagation();
      onActivity();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [done, move, type, back, onActivity]);

  // Gamepad (forwarded by App as booth-action events): D-pad moves, A presses the key, B deletes.
  useEffect(() => {
    const onAction = (e: Event) => {
      if (busyRef.current) return;
      const a = (e as CustomEvent<string>).detail;
      if (a === 'up') move(-1, 0);
      if (a === 'down') move(1, 0);
      if (a === 'left') move(0, -1);
      if (a === 'right') move(0, 1);
      if (a === 'confirm') press(ROWS[cursor[0]]![cursor[1]]!);
      if (a === 'back') type('⌫');
      onActivity();
    };
    window.addEventListener('booth-action', onAction);
    return () => window.removeEventListener('booth-action', onAction);
  }, [cursor, move, press, type, onActivity]);

  return (
    <section className="onboarding name-entry panel-light">
      <h2 className="screen-title">{duo ? `Player ${slots[active]}` : 'Your name'}</h2>
      <div className="name-fields">
        {slots.map((slot, i) => {
          const p = players[i]!;
          const state = nameOrIdState(p.value, p.lookup);
          const here = i === active;
          return (
            <div key={slot} className={`name-field ${here ? 'is-active' : 'is-waiting'}`}>
              {duo && <PlayerBadge slot={slot} />}
              <label className="entry-line">
                <span className="entry-label">Enter your name or ID</span>
                <input
                  ref={here ? entryInput : undefined}
                  className={`player-entry-input ${state.kind !== 'name' && state.kind !== 'empty' ? 'is-id' : ''}`}
                  type="text"
                  inputMode="text"
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Enter your name or ID"
                  placeholder="Name or 4-digit ID"
                  value={p.value}
                  disabled={busy}
                  onFocus={() => {
                    setActive(i);
                  }}
                  onChange={(e) => {
                    setError(null);
                    onActivity();
                    setValue(i, e.target.value);
                  }}
                />
              </label>
              {state.kind === 'known' && (
                <p className="number-status is-known" role="status">
                  <span className="number-status-icon" aria-hidden="true">
                    <CheckIcon />
                  </span>
                  {state.message}
                </p>
              )}
              {(state.kind === 'unknown' || state.kind === 'no-list' || state.kind === 'checking' || state.kind === 'partial-id') && (
                <p className="number-status is-unknown" role="status">
                  {state.message}
                </p>
              )}
            </div>
          );
        })}
      </div>
      <p className={`name-hint ${error ? 'is-error' : ''}`} role={error ? 'alert' : undefined}>
        {error ?? ' '}
      </p>
      <div className="osk" role="group" aria-label="On-screen keyboard">
        {ROWS.map((row, r) => (
          <div key={r} className="osk-row">
            {row.map((k, c) => (
              <button
                key={k}
                type="button"
                tabIndex={-1}
                className={`osk-key ${k.length > 1 ? 'wide' : ''} ${k === 'Done' ? 'done' : ''} ${cursor[0] === r && cursor[1] === c ? 'is-cursor' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setCursor([r, c]);
                  press(k);
                }}
                disabled={busy}
                aria-label={k === '⌫' ? 'Delete' : k}
              >
                {k}
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="action-row">
        <SecondaryButton onClick={back} disabled={busy}>
          Back
        </SecondaryButton>
        <PrimaryButton icon={<ArrowIcon />} loading={busy} onClick={() => void done()}>
          {active < slots.length - 1 ? `Next: Player ${slots[active + 1]}` : 'Start'}
        </PrimaryButton>
      </div>
    </section>
  );
}

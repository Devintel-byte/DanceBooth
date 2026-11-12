import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { BootstrapData, CentralPlayersView, CharacterPreset } from '@booth/contracts';
import type { PlayerSelection } from '@booth/session';
import type { BoothRuntime, UiSnapshot } from './runtime/runtime';
import { Stage } from './scene/Stage';
import { StageBoundary } from './scene/StageBoundary';
import { PerfOverlay } from './ui/PerfOverlay';
import { NameEntryScreen } from './ui/NameEntry';
import { booth } from '../shared/booth';
import { uiCue } from './ui/ui-sounds';
import {
  AttractScreen,
  CalibrationScreen,
  CharacterSelectScreen,
  SongPicker,
  CountdownScreen,
  ErrorScreen,
  MaintenanceScreen,
  ModeSelectScreen,
  PausedScreen,
  PlayingHud,
  ResultsScreen,
  TutorialScreen,
  BrandHeader,
} from './ui/screens';

export type Action = 'left' | 'right' | 'up' | 'down' | 'confirm' | 'back' | 'songPrev' | 'songNext';

const KEYMAP: Record<string, Action> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  Enter: 'confirm',
  ' ': 'confirm',
  Escape: 'back',
  Backspace: 'back',
  PageUp: 'songPrev',
  PageDown: 'songNext',
  '[': 'songPrev',
  ']': 'songNext',
};

/** Screens whose actions are ordinary focusable buttons (navigated by arrows / Tab). */
const BUTTON_SCREENS = new Set(['RESULTS', 'RECOVERABLE_ERROR']);

/** Polls standard-mapping gamepads and emits the same actions as the keyboard. */
function useGamepad(onAction: (a: Action) => void) {
  const prev = useRef<Record<string, boolean>>({});
  const handler = useRef(onAction);
  useEffect(() => {
    handler.current = onAction;
  }, [onAction]);
  useEffect(() => {
    let raf = 0;
    const buttons: [number, Action][] = [
      [0, 'confirm'],
      [1, 'back'],
      [4, 'songPrev'],
      [5, 'songNext'],
      [12, 'up'],
      [13, 'down'],
      [14, 'left'],
      [15, 'right'],
    ];
    const loop = () => {
      raf = requestAnimationFrame(loop);
      for (const pad of navigator.getGamepads?.() ?? []) {
        if (!pad) continue;
        for (const [idx, action] of buttons) {
          const key = `${pad.index}:${idx}`;
          const pressed = !!pad.buttons[idx]?.pressed;
          if (pressed && !prev.current[key]) handler.current(action);
          prev.current[key] = pressed;
        }
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
}

function moveFocus(dir: 1 | -1) {
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('.screen-layer button:not(:disabled)')];
  if (buttons.length === 0) return;
  const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
  buttons[(i + dir + buttons.length) % buttons.length]!.focus();
}

export function App({ runtime, boot }: { runtime: BoothRuntime; boot: BootstrapData }) {
  const snap: UiSnapshot = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot);
  const characters = boot.characters.characters;
  const [selection, setSelection] = useState<PlayerSelection[]>([]);
  // Officially registered participants (central registry), confirmed by the operator.
  const [official, setOfficial] = useState<CentralPlayersView>({ official: false, slots: [] });
  useEffect(() => {
    void booth()
      .centralGetPlayers()
      .then(setOfficial)
      .catch(() => undefined);
    return booth().onCentralPlayers(setOfficial);
  }, []);
  const [activeSlot, setActiveSlot] = useState<1 | 2>(1);
  const [modeIndex, setModeIndex] = useState(0);
  const modes = boot.profile.modes;
  const cue = useCallback((k: Parameters<typeof uiCue>[1]) => uiCue(runtime, k), [runtime]);

  // Reset participant-local UI state whenever a new session begins or the mode changes.
  useEffect(() => {
    const slots: (1 | 2)[] = snap.mode === 'duo' ? [1, 2] : [1];
    const first = characters[0]!;
    setSelection(slots.map((slot, i) => ({ slot, characterId: first.id, paletteId: first.palettes[i % first.palettes.length]!.id })));
    setActiveSlot(1);
  }, [snap.sessionId, snap.mode, characters]);
  useEffect(() => {
    if (snap.state === 'ATTRACT') setModeIndex(0);
  }, [snap.state]);

  const cycle = useCallback(
    (slot: 1 | 2, field: 'character' | 'palette', dir: 1 | -1) => {
      setSelection((sel) =>
        sel.map((p) => {
          if (p.slot !== slot) return p;
          const ci = characters.findIndex((c) => c.id === p.characterId);
          if (field === 'character') {
            const c = characters[(ci + dir + characters.length) % characters.length]!;
            return { ...p, characterId: c.id, paletteId: c.palettes[0]!.id };
          }
          const c = characters[ci]!;
          const pi = c.palettes.findIndex((x) => x.id === p.paletteId);
          return { ...p, paletteId: c.palettes[(pi + dir + c.palettes.length) % c.palettes.length]!.id };
        }),
      );
    },
    [characters],
  );

  const pick = useCallback(
    (slot: 1 | 2, characterId: string, paletteId: string) => {
      setSelection((sel) => sel.map((p) => (p.slot === slot ? { ...p, characterId, paletteId } : p)));
      runtime.send({ type: 'ACTIVITY' });
      cue('select');
    },
    [runtime, cue],
  );

  const confirmCharacters = useCallback(() => {
    cue('confirm');
    if (snap.mode === 'duo' && activeSlot === 1) setActiveSlot(2);
    else runtime.send({ type: 'CONFIRM_CHARACTERS', players: selection });
  }, [cue, snap.mode, activeSlot, runtime, selection]);

  const onAction = useCallback(
    (a: Action) => {
      const s = runtime.state;
      if (s === 'NAME_ENTRY') {
        // The name screen owns its keyboard; forward controller actions to it.
        window.dispatchEvent(new CustomEvent('booth-action', { detail: a }));
        return;
      }
      if (s === 'MODE_SELECT' || s === 'CHARACTER_SELECT') runtime.send({ type: 'ACTIVITY' });
      if (BUTTON_SCREENS.has(s)) {
        if (a === 'left' || a === 'up') moveFocus(-1);
        if (a === 'right' || a === 'down') moveFocus(1);
        if (a === 'confirm') (document.activeElement as HTMLElement | null)?.click();
        return;
      }
      switch (s) {
        case 'ATTRACT':
          if (a === 'confirm') {
            cue('confirm');
            runtime.send({ type: 'START' });
          }
          break;
        case 'MODE_SELECT':
          if (a === 'left' || a === 'up') {
            setModeIndex((i) => (i - 1 + modes.length) % modes.length);
            cue('select');
          }
          if (a === 'right' || a === 'down') {
            setModeIndex((i) => (i + 1) % modes.length);
            cue('select');
          }
          if (a === 'confirm') {
            cue('confirm');
            runtime.send({ type: 'SELECT_MODE', mode: modes[modeIndex]! });
          }
          if (a === 'back') runtime.send({ type: 'BACK' });
          break;
        case 'CHARACTER_SELECT':
          if (a === 'songPrev' || a === 'songNext') {
            const songs = boot.routines;
            const i = Math.max(0, songs.findIndex((r) => r.id === runtime.context.routineId));
            const next = songs[(i + (a === 'songNext' ? 1 : -1) + songs.length) % songs.length];
            if (next && songs.length > 1) {
              runtime.selectRoutine(next.id);
              cue('select');
            }
          }
          if (a === 'left') cycle(activeSlot, 'character', -1);
          if (a === 'right') cycle(activeSlot, 'character', 1);
          if (a === 'up') cycle(activeSlot, 'palette', -1);
          if (a === 'down') cycle(activeSlot, 'palette', 1);
          if (a === 'left' || a === 'right' || a === 'up' || a === 'down') cue('select');
          if (a === 'back') {
            if (activeSlot === 2) setActiveSlot(1);
            else runtime.send({ type: 'BACK' });
          }
          if (a === 'confirm') confirmCharacters();
          break;
        case 'TUTORIAL':
          if (a === 'confirm') runtime.send({ type: 'SKIP' });
          break;
        case 'CALIBRATION':
          // Offered after a while: start dancing even though framing is not perfect.
          if (a === 'confirm') {
            cue('confirm');
            runtime.danceAnyway();
          }
          break;
      }
    },
    [runtime, modes, modeIndex, cycle, activeSlot, confirmCharacters, cue, boot.routines],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = KEYMAP[e.key];
      if (!a || e.repeat) return;
      if (runtime.state === 'NAME_ENTRY') return; // handled by the name screen (typing)
      // Let a focused button activate natively (Enter/Space) on button-driven screens.
      const onButton = (document.activeElement as HTMLElement | null)?.tagName === 'BUTTON';
      if (a === 'confirm' && onButton && BUTTON_SCREENS.has(runtime.state)) return;
      e.preventDefault();
      onAction(a);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onAction, runtime]);
  useGamepad(onAction);

  // Countdown ticks (UI sound only; the countdown itself is driven by the audio clock).
  const lastCount = useRef<number | null>(null);
  useEffect(() => {
    if (snap.countdown !== lastCount.current) {
      if (snap.countdown !== null && snap.countdown > 0) cue('tick');
      lastCount.current = snap.countdown;
    }
  }, [snap.countdown, cue]);
  useEffect(() => {
    if (snap.state === 'RESULTS') cue('results');
  }, [snap.state, cue]);

  const presetFor = (id: string): CharacterPreset => characters.find((c) => c.id === id) ?? characters[0]!;
  const ctxPlayers = runtime.context.players.some((p) => p.characterId) ? runtime.context.players : selection;
  const stagePlayers = ctxPlayers.map((p) => ({ slot: p.slot, preset: presetFor(p.characterId), paletteId: p.paletteId }));
  const onStageStates = ['CHARACTER_SELECT', 'CALIBRATION', 'TUTORIAL', 'COUNTDOWN', 'PLAYING', 'PAUSED', 'RESULTS'];
  const showPlayers = onStageStates.includes(snap.state);
  const framing = snap.state === 'ATTRACT' || snap.state === 'MODE_SELECT' ? 'hero' : 'wide';
  const dark = ['TUTORIAL', 'COUNTDOWN', 'PLAYING', 'PAUSED', 'RESULTS'].includes(snap.state);

  return (
    <div className={`app state-${snap.state.toLowerCase()} ${dark ? 'tone-dark' : 'tone-light'} ${snap.reducedMotion ? 'reduced-motion' : ''}`}>
      <StageBoundary>
        <Stage
          runtime={runtime}
          profile={boot.profile}
          assetBaseUrl={boot.app.assetBaseUrl}
          quality={snap.quality}
          maxFps={snap.maxRenderFps}
          reducedMotion={snap.reducedMotion}
          routine={snap.routine ?? boot.routines[0] ?? null}
          characters={characters}
          players={stagePlayers}
          showPlayers={showPlayers}
          celebrate={snap.state === 'RESULTS'}
          framing={framing}
        />
      </StageBoundary>
      <BrandHeader profile={boot.profile} assetBaseUrl={boot.app.assetBaseUrl} snap={snap} />
      <main className="screen-layer" key={snap.state}>
        {snap.state === 'ATTRACT' && <AttractScreen profile={boot.profile} snap={snap} onStart={() => onAction('confirm')} />}
        {snap.state === 'MODE_SELECT' && (
          <ModeSelectScreen
            modes={modes}
            index={modeIndex}
            onSelect={(i) => {
              setModeIndex(i);
              runtime.send({ type: 'ACTIVITY' });
              cue('select');
            }}
            onContinue={() => onAction('confirm')}
            onBack={() => runtime.send({ type: 'BACK' })}
          />
        )}
        {snap.state === 'CHARACTER_SELECT' && (
          <SongPicker
            songs={boot.routines}
            currentId={snap.routine?.id ?? runtime.context.routineId}
            onSelect={(id) => {
              runtime.selectRoutine(id);
              cue('select');
            }}
          />
        )}
        {snap.state === 'CHARACTER_SELECT' && (
          <CharacterSelectScreen
            characters={characters}
            assetBaseUrl={boot.app.assetBaseUrl}
            selection={selection}
            activeSlot={activeSlot}
            onPick={pick}
            onConfirm={confirmCharacters}
            onBack={() => (activeSlot === 2 ? setActiveSlot(1) : runtime.send({ type: 'BACK' }))}
          />
        )}
        {snap.state === 'NAME_ENTRY' && (
          <NameEntryScreen
            key={official.slots.map((s) => `${s.slot}:${s.displayName}`).join('|')}
            slots={snap.mode === 'duo' ? [1, 2] : [1]}
            initialNames={(snap.mode === 'duo' ? [1, 2] : [1]).map((slot) => official.slots.find((s) => s.slot === slot)?.displayName ?? null)}
            onActivity={() => runtime.send({ type: 'ACTIVITY' })}
            onCue={cue}
            onBack={() => runtime.send({ type: 'BACK' })}
            lookup={(slot, number) => booth().lookupPlayerNumber(slot, number)}
            onSubmit={async (entries) => {
              const registered = await booth().registerPlayers(entries);
              const base = runtime.context.players.some((p) => p.characterId) ? runtime.context.players : selection;
              runtime.send({
                type: 'CONFIRM_NAMES',
                players: base.map((p, i) => ({ ...p, name: registered[i]!.name, playerId: registered[i]!.playerId })),
              });
            }}
          />
        )}
        {snap.state === 'CALIBRATION' && <CalibrationScreen snap={snap} runtime={runtime} onBack={() => runtime.send({ type: 'ABORT' })} />}
        {snap.state === 'TUTORIAL' && <TutorialScreen snap={snap} />}
        {snap.state === 'COUNTDOWN' && <CountdownScreen snap={snap} />}
        {snap.state === 'PLAYING' && <PlayingHud snap={snap} runtime={runtime} />}
        {snap.state === 'PAUSED' && <PausedScreen snap={snap} />}
        {snap.state === 'RESULTS' && (
          <ResultsScreen
            snap={snap}
            profile={boot.profile}
            onPlayAgain={() => {
              cue('confirm');
              runtime.send({ type: 'PLAY_AGAIN' });
            }}
            onFinish={() => runtime.send({ type: 'CONTINUE' })}
          />
        )}
        {(snap.state === 'RECOVERABLE_ERROR' || snap.state === 'RESETTING') && <ErrorScreen snap={snap} onRetry={() => runtime.send({ type: 'RETRY' })} />}
        {(snap.state === 'MAINTENANCE' || snap.state === 'BOOT' || snap.state === 'SELF_CHECK') && <MaintenanceScreen snap={snap} />}
      </main>
      {snap.inputSource === 'replay' && (
        <div className="demo-badge" role="status">
          Demo mode · replayed synthetic movement, not a live camera
        </div>
      )}
      {snap.showPerf && <PerfOverlay snap={snap} />}
    </div>
  );
}

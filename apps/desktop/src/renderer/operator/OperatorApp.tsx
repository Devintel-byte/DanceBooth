import { useEffect, useState } from 'react';
import { effectiveCaptureBackend, type PlayerEntryView, type BoothSettings, type BootstrapData, type Difficulty, type DisplayInfo, type FeedStatusInfo, type OperatorCommand, type ParticipantStatus, type SettingsPatch } from '@booth/contracts';
import { ConfirmationDialog } from '../components';
import { booth } from '../shared/booth';
import { CentralPanel } from './CentralPanel';
import { FeedPanel, FeedStatusBar, FeedToasts } from './FeedPanel';
import { ComponentPreview } from './ComponentPreview';

const fmt = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? '—' : v.toFixed(d));

const ACTIVE = ['MODE_SELECT', 'CHARACTER_SELECT', 'CALIBRATION', 'TUTORIAL', 'COUNTDOWN', 'PLAYING', 'PAUSED', 'RESULTS'];

export function OperatorApp({ boot }: { boot: BootstrapData }) {
  const [status, setStatus] = useState<ParticipantStatus | null>(null);
  const [lastSeen, setLastSeen] = useState(0);
  const [settings, setSettings] = useState<BoothSettings>(boot.settings);
  const [routineId, setRoutineId] = useState(boot.routines[0]?.id ?? '');
  const [difficulty, setDifficulty] = useState<Difficulty>(boot.profile.defaultDifficulty);
  const [errors, setErrors] = useState<{ at: string; code: string; message: string }[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [replay, setReplay] = useState(boot.app.startInReplay);
  const [now, setNow] = useState(Date.now());
  const [confirm, setConfirm] = useState<null | { title: string; message: string; label: string; run: () => void }>(null);
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [preview, setPreview] = useState(false);
  const [feed, setFeed] = useState<FeedStatusInfo | null>(null);
  const [entry, setEntry] = useState<Partial<Record<1 | 2, PlayerEntryView>>>({});

  useEffect(() => {
    const offStatus = booth().onStatus((s) => {
      setStatus(s);
      setLastSeen(Date.now());
    });
    const offSettings = booth().onSettingsChanged(setSettings);
    const offEntry = booth().onPlayerEntry((v) => setEntry((e) => ({ ...e, [v.slot]: v })));
    const timer = setInterval(() => {
      setNow(Date.now());
      void booth().getErrorHistory().then(setErrors).catch(() => undefined);
      void booth().listDisplays().then(setDisplays).catch(() => undefined);
      void booth().getFeedStatus().then(setFeed).catch(() => undefined);
    }, 2000);
    return () => {
      offStatus();
      offSettings();
      offEntry();
      clearInterval(timer);
    };
  }, []);

  const send = (c: OperatorCommand) => booth().sendCommand(c);
  const patch = async (p: SettingsPatch) => {
    try {
      setSettings(await booth().updateSettings(p));
    } catch (e) {
      setNotice(`Settings rejected: ${String(e)}`);
    }
  };

  const state = status?.state ?? 'NO SIGNAL';
  useEffect(() => {
    if (state !== 'NAME_ENTRY') setEntry({});
  }, [state]);
  const stale = !status || now - lastSeen > 3000;
  const active = ACTIVE.includes(state);
  const midSong = ['COUNTDOWN', 'PLAYING', 'PAUSED'].includes(state);
  const guarded = (needsConfirm: boolean, title: string, message: string, label: string, run: () => void) =>
    needsConfirm ? setConfirm({ title, message, label, run }) : run();

  if (preview) return <ComponentPreview onClose={() => setPreview(false)} />;

  return (
    <div className="op">
      <header className="op-head">
        <div>
          <h1>{boot.profile.productName} · Operator</h1>
          <span className="sub">
            {boot.profile.eventName} · v{boot.app.version} {boot.app.isPackaged ? '' : '(dev build)'}
          </span>
        </div>
        <div className={`state-pill ${stale ? 'bad' : active ? 'live' : ''}`}>{stale ? 'PARTICIPANT SCREEN NOT RESPONDING' : state}</div>
      </header>
      <FeedStatusBar feed={feed} now={now} />
      {state === 'NAME_ENTRY' &&
        ([1, 2] as const).map((slot) => {
          const v = entry[slot];
          if (!v || v.status === 'none') return null;
          return (
            <div key={slot} className={`entry-check ${v.status}`} role="status">
              <span className="entry-check-num">
                Player {slot} · number <b>{v.number}</b>
              </span>
              {v.status === 'known' ? (
                <span>
                  is <b className="entry-check-name">{v.name}</b>. Check the name with the player before starting.
                </span>
              ) : v.status === 'unknown' ? (
                <span>is not in the player list. Check the number, or the player plays as a guest.</span>
              ) : (
                <span>No player list yet: the main leaderboard will check the number.</span>
              )}
            </div>
          );
        })}
      <FeedToasts />

      {boot.contentIssues.length > 0 && (
        <div className="banner warn">
          Content problems: {boot.contentIssues.map((i) => `${i.file}: ${i.message}`).join(' · ')}
        </div>
      )}
      {status?.inputSource === 'replay' && <div className="banner info">Input: REPLAY / DEMO (synthetic landmarks). Scores are not from a live participant.</div>}
      {status?.lastError && (
        <div className="banner bad">
          {status.lastError.code}: {status.lastError.message}
        </div>
      )}
      {notice && (
        <div className="banner info" onClick={() => setNotice(null)}>
          {notice}
        </div>
      )}

      <div className="op-grid">
        <section className="panel">
          <h2>Session</h2>
          <dl>
            <dt>Session</dt>
            <dd>#{status?.sessionId ?? '—'} {status?.mode ?? ''}</dd>
            <dt>Routine</dt>
            <dd>{status?.routineId ?? '—'}</dd>
            <dt>Song</dt>
            <dd>
              {fmt(status?.songTimeSec, 1)} / {fmt(status?.durationSec, 0)} s
            </dd>
          </dl>
          <div className="row">
            <label title="The song new sessions start with. Players can still change it on the character screen.">
              Song
              <select
                value={routineId}
                onChange={(e) => {
                  setRoutineId(e.target.value);
                  send({ type: 'select-routine', routineId: e.target.value });
                }}
              >
                {boot.routines.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Difficulty
              <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>
                <option value="easy">Easy</option>
                <option value="normal">Normal</option>
                <option value="hard">Hard</option>
              </select>
            </label>
          </div>
          <div className="buttons">
            <button className="primary" disabled={state !== 'ATTRACT'} onClick={() => send({ type: 'start', mode: 'single', routineId, difficulty })}>
              Start solo
            </button>
            <button className="primary" disabled={state !== 'ATTRACT'} onClick={() => send({ type: 'start', mode: 'duo', routineId, difficulty })}>
              Start duo
            </button>
            <button disabled={state !== 'PLAYING'} onClick={() => send({ type: 'pause' })}>
              Pause
            </button>
            <button disabled={state !== 'PAUSED'} onClick={() => send({ type: 'resume' })}>
              Resume
            </button>
            <button disabled={state !== 'CALIBRATION'} onClick={() => send({ type: 'skip-calibration' })}>
              Skip calibration
            </button>
            <button className="danger" disabled={!active && state !== 'RECOVERABLE_ERROR'} onClick={() =>
                guarded(midSong, 'Abort this song?', 'The current dancers will lose this performance and the booth resets.', 'Abort & reset', () => send({ type: 'abort' }))
              }
            >
              Abort &amp; reset
            </button>
          </div>
        </section>

        <section className="panel">
          <h2>Players</h2>
          {(status?.players.length ? status.players : [{ slot: 1, status: 'empty', confidence: 0, score: 0, points: 0 }]).map((p) => (
            <div key={p.slot} className="player-row">
              <span className={`tag p${p.slot}`}>P{p.slot}</span>
              <span className={`status-text ${p.status}`}>{p.status === 'tracked' ? '✓ tracked' : p.status === 'lost' ? '! lost' : '– not seen'}</span>
              <div className="bar">
                <div style={{ width: `${Math.round(p.confidence * 100)}%` }} />
              </div>
              <span>{p.points.toLocaleString()} pts</span>
            </div>
          ))}
        </section>

        <section className="panel">
          <h2>Camera &amp; tracking</h2>
          <dl>
            <dt>Status</dt>
            <dd>{status?.tracking.status ?? '—'}</dd>
            <dt>Delegate</dt>
            <dd>{status?.tracking.delegate ?? '—'} (configured {settings.tracking.delegate})</dd>
            <dt>Update rate</dt>
            <dd>{fmt(status?.tracking.updateRateHz, 0)} Hz</dd>
            <dt>Inference</dt>
            <dd>{fmt(status?.tracking.lastInferenceMs)} ms</dd>
            <dt>Result age (est.)</dt>
            <dd>{fmt(status?.tracking.latestResultAgeMs, 0)} ms</dd>
            <dt>In flight / dropped</dt>
            <dd>
              {status?.tracking.inFlight ?? 0} / busy {status?.tracking.framesDroppedBusy ?? 0} · stale {status?.tracking.framesDroppedStale ?? 0}
            </dd>
          </dl>
          <div className="row">
            <label>
              Camera
              <select
                value={status?.activeCameraId ?? settings.camera.deviceId ?? ''}
                onChange={(e) => {
                  const cam = status?.cameras.find((c) => c.deviceId === e.target.value);
                  const next = { ...settings.camera, deviceId: e.target.value, label: cam?.label ?? null };
                  const apply = () => {
                    void patch({ camera: { deviceId: e.target.value, label: cam?.label ?? null } });
                    send({ type: 'select-camera', deviceId: e.target.value });
                  };
                  // A depth camera (Azure Kinect…) needs the DirectShow driver, which needs a restart.
                  guarded(
                    effectiveCaptureBackend(next) !== boot.app.captureBackend && navigator.userAgent.includes('Windows'),
                    'Restart for this camera?',
                    `${cam?.label ?? 'This camera'} needs the ${effectiveCaptureBackend(next) === 'directshow' ? 'DirectShow (compatibility)' : 'Media Foundation'} camera driver. The app restarts now (about 5 seconds).`,
                    'Restart with this camera',
                    apply,
                  );
                }}
              >
                <option value="" disabled>
                  {status?.cameras.length ? 'Select…' : 'No cameras listed'}
                </option>
                {status?.cameras.map((c) => (
                  <option key={c.deviceId} value={c.deviceId}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Camera driver
              <select
                value={settings.camera.captureBackend}
                onChange={(e) => {
                  const v = e.target.value as 'auto' | 'media-foundation' | 'directshow';
                  const restart = effectiveCaptureBackend({ ...settings.camera, captureBackend: v }) !== boot.app.captureBackend;
                  guarded(restart, 'Restart to change the camera driver?', 'The camera driver can only change when the app starts. It restarts now (about 5 seconds).', 'Restart', () => void patch({ camera: { captureBackend: v } }));
                }}
              >
                <option value="auto">Auto (DirectShow for Azure Kinect)</option>
                <option value="media-foundation">Media Foundation</option>
                <option value="directshow">DirectShow (compatibility)</option>
              </select>
              <span className="small">Active: {boot.app.captureBackend === 'directshow' ? 'DirectShow' : 'Media Foundation'}</span>
            </label>
            <label>
              Delegate
              <select value={settings.tracking.delegate} onChange={(e) => void patch({ tracking: { delegate: e.target.value as 'GPU' | 'CPU' } })}>
                <option value="GPU">GPU</option>
                <option value="CPU">CPU</option>
              </select>
            </label>
            <label>
              Model
              <select value={settings.tracking.model} onChange={(e) => void patch({ tracking: { model: e.target.value as 'lite' | 'full' } })}>
                <option value="lite">Lite</option>
                <option value="full">Full</option>
              </select>
            </label>
            <label className="check" title="Each duo player is tracked in their own half of the camera image (more robust when they stand close; uses about twice the CPU in duo)">
              <input type="checkbox" checked={settings.tracking.duoSplit} onChange={(e) => void patch({ tracking: { duoSplit: e.target.checked } })} />
              Duo: track each half separately
            </label>
          </div>
          <div className="buttons">
            <button onClick={() => send({ type: 'restart-tracking' })}>Restart tracking</button>
            <button
              onClick={() => {
                setReplay(!replay);
                send({ type: 'set-replay', enabled: !replay });
              }}
            >
              {replay ? 'Use live camera' : 'Use replay (demo)'}
            </button>
          </div>
        </section>

        <section className="panel">
          <h2>Performance</h2>
          <dl>
            <dt>3D render FPS</dt>
            <dd>{fmt(status?.render.fps, 0)}</dd>
            <dt>Frame p50/p95/p99</dt>
            <dd>
              {fmt(status?.render.frameMsP50)} / {fmt(status?.render.frameMsP95)} / {fmt(status?.render.frameMsP99)} ms
            </dd>
            <dt>JS heap (approx.)</dt>
            <dd>{fmt(status?.memory.jsHeapUsedMB, 0)} MB</dd>
          </dl>
          <div className="row">
            <label>
              Quality
              <select value={settings.quality} onChange={(e) => void patch({ quality: e.target.value as BoothSettings['quality'] })}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
            <label>
              3D frame cap
              <select value={settings.maxRenderFps} onChange={(e) => void patch({ maxRenderFps: Number(e.target.value) })}>
                <option value={24}>24 fps</option>
                <option value={30}>30 fps</option>
                <option value={45}>45 fps</option>
                <option value={60}>60 fps</option>
                <option value={0}>Uncapped</option>
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={settings.showPerfOverlay} onChange={(e) => void patch({ showPerfOverlay: e.target.checked })} />
              Perf overlay
            </label>
            <label className="check">
              <input type="checkbox" checked={settings.reducedMotion} onChange={(e) => void patch({ reducedMotion: e.target.checked })} />
              Reduced motion
            </label>
            
          </div>
        </section>

        <section className="panel">
          <h2>Audio &amp; calibration</h2>
          <div className="row">
            <label>
              A/V offset (ms)
              <input
                type="number"
                min={-500}
                max={500}
                step={10}
                value={settings.calibrationOffsetMs}
                onChange={(e) => void patch({ calibrationOffsetMs: Number(e.target.value) })}
              />
            </label>
          </div>
          <div className="buttons">
            <button onClick={() => send({ type: 'audio-test' })}>Play audio test</button>
          </div>
          <div className="row">
            <label>
              UI sound volume ({Math.round(settings.uiSoundVolume * 100)}%)
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={settings.uiSoundVolume}
                onChange={(e) => void patch({ uiSoundVolume: Number(e.target.value) })}
              />
            </label>
          </div>
        </section>

        <section className="panel">
          <h2>Maintenance</h2>
          <div className="row">
            <label>
              Event profile
              <select value={settings.activeProfileId} onChange={(e) => void patch({ activeProfileId: e.target.value })}>
                {boot.profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.eventName}
                  </option>
                ))}
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={settings.kiosk} onChange={(e) => void patch({ kiosk: e.target.checked })} />
              Kiosk (participant)
            </label>
          </div>
          <div className="buttons">
            <button
              onClick={() =>
                guarded(active, 'Enter maintenance?', 'The current session ends and the participant screen shows “Back in a moment”.', 'Enter maintenance', () =>
                  send({ type: 'enter-maintenance' }),
                )
              }
            >
              Enter maintenance
            </button>
            <button onClick={() => send({ type: 'exit-maintenance' })}>Exit maintenance (re-run self-check)</button>
            <button onClick={() => void booth().reloadParticipant()}>Reload participant screen</button>
            <button
              onClick={() =>
                void booth()
                  .exportDiagnostics()
                  .then((r) => setNotice(r.ok ? `Diagnostics saved: ${r.path}` : `Export failed: ${r.error}`))
              }
            >
              Export diagnostics
            </button>
          </div>
          <p className="small">Profile changes apply after "Reload participant screen". Kiosk escape: Ctrl+Shift+Alt+M on the participant screen.</p>
          {!boot.app.isPackaged && (
            <div className="buttons">
              <button onClick={() => setPreview(true)}>Component preview (dev)</button>
            </div>
          )}
        </section>

        <section className="panel">
          <h2>Leaderboard</h2>
          <p className="small">Live, completed sessions from today only. Replay/demo sessions never appear.</p>
          <div className="buttons">
            <button className="primary" onClick={() => void booth().openLeaderboard()}>
              Open leaderboard window
            </button>
            <button onClick={() => void booth().leaderboardWindow({ type: 'fullscreen', enabled: true })}>Fullscreen</button>
            <button onClick={() => void booth().leaderboardWindow({ type: 'fullscreen', enabled: false })}>Windowed</button>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <label>
              Show on display
              <select
                value={displays.find((d) => d.hostsLeaderboard)?.id ?? ''}
                onChange={(e) => void booth().leaderboardWindow({ type: 'move-to-display', displayId: Number(e.target.value) })}
              >
                <option value="" disabled>
                  {displays.some((d) => d.hostsLeaderboard) ? 'Select…' : 'Window not open'}
                </option>
                {displays.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label} ({d.width}×{d.height}){d.primary ? ' · primary' : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <FeedPanel
          settings={settings}
          feed={feed}
          patch={patch}
          confirm={(title, message, label, run) => guarded(true, title, message, label, run)}
          refresh={() => void booth().getFeedStatus().then(setFeed).catch(() => undefined)}
        />

        <CentralPanel />

        <section className="panel wide">
          <h2>Error history</h2>
          <ol className="errors">
            {errors.length === 0 && <li className="small">No errors recorded.</li>}
            {[...errors].reverse().slice(0, 30).map((e, i) => (
              <li key={i}>
                <time>{e.at.slice(11, 19)}</time> <b>{e.code}</b> {e.message}
              </li>
            ))}
          </ol>
        </section>
      </div>
      <ConfirmationDialog
        open={!!confirm}
        title={confirm?.title ?? ''}
        message={confirm?.message ?? ''}
        confirmLabel={confirm?.label ?? ''}
        destructive
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          confirm?.run();
          setConfirm(null);
        }}
      />
    </div>
  );
}

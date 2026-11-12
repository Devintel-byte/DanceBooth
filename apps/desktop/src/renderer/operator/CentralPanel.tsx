import { useEffect, useState } from 'react';
import type { CentralConfigPatch, CentralResultRow, CentralStatus } from '@booth/contracts';
import { booth } from '../shared/booth';

/**
 * Operator panel for the main application's participant registry and
 * result ingestion (contract event-results/1). The credential is
 * write-only: it goes to the main process and is never read back.
 * Player numbers are typed by hand; nothing here can create a participant.
 */

const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : '—');

const CONNECTION_LABEL: Record<CentralStatus['connection'], string> = {
  disabled: 'Off',
  'not-configured': 'Not configured',
  unknown: 'Not checked yet',
  online: 'Online',
  offline: 'Offline (results are queued)',
  'auth-failed': 'Credential rejected: sending stopped',
};

function SlotControl({ slot, status, onMessage }: { slot: 1 | 2; status: CentralStatus; onMessage: (m: string) => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const confirmed = status.slots.find((s) => s.slot === slot);
  const candidate = status.candidates.find((c) => c.slot === slot);

  const lookup = async () => {
    if (!code.trim()) return;
    setBusy(true);
    const r = await booth().centralResolve(slot, code.trim());
    setBusy(false);
    if (r.ok) setCode('');
    else onMessage(`Player ${slot}: ${r.error}`);
  };

  return (
    <div className="central-slot">
      <h3>Player {slot}</h3>
      {confirmed ? (
        <>
          <p>
            <b>{confirmed.displayName}</b> <code>{confirmed.participantId}</code>
            {confirmed.offline && <span className="central-warn"> · verified from offline cache</span>}
          </p>
          <button onClick={() => void booth().centralClearSlot(slot)}>Next player (clear)</button>
        </>
      ) : candidate ? (
        <>
          <p>
            Is this the player? <b>{candidate.participant.displayName}</b> <code>{candidate.participant.participantId}</code>
            {candidate.offline && <span className="central-warn"> · offline: from the cache retrieved {when(candidate.retrievedAt)}</span>}
          </p>
          <div className="buttons">
            <button
              className="primary"
              onClick={() =>
                void booth()
                  .centralConfirm(slot)
                  .then((r) => !r.ok && onMessage(`Player ${slot}: ${r.error}`))
              }
            >
              Confirm
            </button>
            <button onClick={() => void booth().centralClearSlot(slot)}>Not them</button>
          </div>
        </>
      ) : (
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void lookup();
          }}
        >
          <label>
            Player number
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Player number" inputMode="numeric" autoComplete="off" spellCheck={false} />
          </label>
          <button type="submit" disabled={busy || !code.trim()}>
            {busy ? 'Looking up…' : 'Look up'}
          </button>
        </form>
      )}
    </div>
  );
}

function ResultRow({ r, onMessage }: { r: CentralResultRow; onMessage: (m: string) => void }) {
  const [mode, setMode] = useState<null | 'correct' | 'resolve'>(null);
  const [value, setValue] = useState('');
  const submit = async () => {
    if (mode === 'correct') {
      const points = Number(value);
      if (!Number.isInteger(points) || points < 0) return onMessage('Points must be a whole number, 0 or more.');
      const res = await booth().centralEditResult({ kind: 'correct', resultId: r.resultId, points });
      if (!res.ok) onMessage(res.error);
    } else if (mode === 'resolve') {
      const res = await booth().centralResolveUnresolved(r.resultId, value.trim());
      onMessage(res.ok ? `Result assigned to ${res.displayName}.` : res.error);
    }
    setMode(null);
    setValue('');
  };
  return (
    <tr className={`central-${r.state}`}>
      <td>{new Date(r.completedAt).toLocaleTimeString()}</td>
      <td>{r.displayName ?? <i>unresolved</i>}</td>
      <td>{r.status === 'void' ? <s>{r.points}</s> : r.points} pts</td>
      <td>
        r{r.revision} · {r.state}
        {r.lastError && <div className="small">{r.lastError}</div>}
      </td>
      <td>
        {mode ? (
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder={mode === 'correct' ? 'Corrected points' : 'Player number'} />
            <button type="submit">Save</button>
            <button type="button" onClick={() => setMode(null)}>
              Cancel
            </button>
          </form>
        ) : (
          <div className="buttons">
            {r.state === 'unresolved' ? (
              <button onClick={() => setMode('resolve')}>Assign player…</button>
            ) : (
              <>
                {r.status === 'valid' && <button onClick={() => setMode('correct')}>Correct…</button>}
                {r.status === 'valid' && (
                  <button className="danger" onClick={() => void booth().centralEditResult({ kind: 'void', resultId: r.resultId }).then((x) => !x.ok && onMessage(x.error))}>
                    Void
                  </button>
                )}
                {r.state === 'blocked' && <button onClick={() => void booth().centralRetry(r.resultId)}>Retry</button>}
              </>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

export function CentralPanel() {
  const [status, setStatus] = useState<CentralStatus | null>(null);
  const [credential, setCredential] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ serverUrl: string; sourceId: string; gameId: string } | null>(null);

  useEffect(() => {
    void booth().centralGetStatus().then(setStatus).catch(() => undefined);
    return booth().onCentralStatus(setStatus);
  }, []);

  if (!status) return null;
  const cfg = status.config;
  const d = draft ?? { serverUrl: cfg.serverUrl, sourceId: cfg.sourceId, gameId: cfg.gameId };
  const patch = async (p: CentralConfigPatch) => {
    try {
      setStatus(await booth().centralUpdateConfig(p));
    } catch (e) {
      setMessage(`Rejected: ${String(e)}`);
    }
  };
  const rounds = status.manifest?.rounds ?? [];
  const game = status.manifest?.games.find((g) => g.gameId === cfg.gameId);
  const versions = game?.scoringVersions.length ? game.scoringVersions : [cfg.scoringVersion];

  return (
    <section className="panel wide">
      <h2>Central registry (main application)</h2>
      <p className="small">
        Official players are verified by player number and every finished attempt is sent to the main application as raw points.
        See docs/central-integration.md.
      </p>
      {message && (
        <p className="central-notice" role="status">
          {message}{' '}
          <button type="button" onClick={() => setMessage(null)}>
            OK
          </button>
        </p>
      )}

      <div className="row">
        <label className="check">
          <input type="checkbox" checked={cfg.enabled} onChange={(e) => void patch({ enabled: e.target.checked })} />
          Enable
        </label>
        <label>
          Server URL
          <input value={d.serverUrl} placeholder="https://results.example.com" onChange={(e) => setDraft({ ...d, serverUrl: e.target.value })} />
        </label>
        <label>
          Source id
          <input value={d.sourceId} onChange={(e) => setDraft({ ...d, sourceId: e.target.value })} />
        </label>
        <label>
          Game id
          <input value={d.gameId} onChange={(e) => setDraft({ ...d, gameId: e.target.value })} />
        </label>
        <button
          disabled={!draft}
          onClick={() =>
            void patch({ serverUrl: d.serverUrl.trim(), sourceId: d.sourceId.trim(), gameId: d.gameId.trim() }).then(() => setDraft(null))
          }
        >
          Save
        </button>
      </div>
      <div className="row">
        <label className="check">
          <input type="checkbox" checked={cfg.allowPlainHttp} onChange={(e) => void patch({ allowPlainHttp: e.target.checked })} />
          Trusted LAN (allow http://)
        </label>
        <label>
          Source credential {status.credentialConfigured ? '(saved)' : '(not set)'}
          <input type="password" value={credential} autoComplete="new-password" placeholder={status.credentialConfigured ? '•••••••• (replace)' : 'Paste credential'} onChange={(e) => setCredential(e.target.value)} />
        </label>
        <button
          disabled={credential.length < 8}
          onClick={() =>
            void booth()
              .centralSetCredential(credential)
              .then((s) => {
                setStatus(s);
                setCredential('');
              })
              .catch((e) => setMessage(String(e)))
          }
        >
          Save credential
        </button>
        <button onClick={() => void booth().centralTestConnection().then((r) => setMessage(r.message))}>Test connection</button>
      </div>
      <div className="row">
        <label>
          Competition
          <input value={cfg.competitionId} onChange={(e) => void patch({ competitionId: e.target.value.trim() })} />
        </label>
        <label>
          Round
          <select value={cfg.roundId} onChange={(e) => void patch({ roundId: e.target.value })}>
            <option value="">— choose —</option>
            {cfg.roundId && !rounds.some((r) => r.roundId === cfg.roundId) && <option value={cfg.roundId}>{cfg.roundId}</option>}
            {rounds.map((r) => (
              <option key={r.roundId} value={r.roundId}>
                {r.name ?? r.roundId}
                {r.active ? ' · active' : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          Scoring version
          <select value={cfg.scoringVersion} onChange={(e) => void patch({ scoringVersion: e.target.value })}>
            {[...new Set([cfg.scoringVersion, ...versions])].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          When offline
          <select value={cfg.offlinePolicy} onChange={(e) => void patch({ offlinePolicy: e.target.value as 'allow-cached' | 'deny' })}>
            <option value="allow-cached">Accept players verified earlier</option>
            <option value="deny">Online verification only</option>
          </select>
        </label>
      </div>

      <dl>
        <dt>Connection</dt>
        <dd>
          {CONNECTION_LABEL[status.connection]}
          {status.lastError && <div className="small">{status.lastError}</div>}
        </dd>
        <dt>Queue</dt>
        <dd>
          {status.counts.pending} waiting · {status.counts.delivered} delivered · {status.counts.blocked} blocked · {status.counts.unresolved} unresolved
        </dd>
        <dt>Last acknowledgement</dt>
        <dd>{when(status.lastAckAt)}</dd>
        <dt>Last reconciliation</dt>
        <dd>
          {when(status.lastReconcileAt)}
          {status.lastReconcileSummary && <div className="small">{status.lastReconcileSummary}</div>}
        </dd>
        <dt>Manifest</dt>
        <dd>{status.manifest ? `${status.manifest.competitionId} · retrieved ${when(status.manifestRetrievedAt)}` : '—'}</dd>
      </dl>
      {status.warnings.length > 0 && (
        <ul className="central-warn-list">
          {status.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {status.conflicts.length > 0 && (
        <>
          <h3>Conflicts (central holds a different version)</h3>
          <ul className="central-warn-list">
            {status.conflicts.map((c) => (
              <li key={c.resultId}>
                <code>{c.resultId}</code> {c.detail}
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="buttons">
        <button onClick={() => void booth().centralRetry()}>Retry blocked</button>
        <button onClick={() => void booth().centralReconcile().then((r) => setMessage(r.message))}>Reconcile now</button>
      </div>

      {cfg.enabled && (
        <>
          <h3>Players for the next game</h3>
          <p className="small">Look up, then confirm with the player in front of you. "Play again" keeps the confirmed players; "Next player" clears them.</p>
          <div className="central-slots">
            <SlotControl slot={1} status={status} onMessage={setMessage} />
            <SlotControl slot={2} status={status} onMessage={setMessage} />
          </div>
        </>
      )}

      {status.recent.length > 0 && (
        <>
          <h3>Recent results</h3>
          <table className="central-results">
            <thead>
              <tr>
                <th>Time</th>
                <th>Player</th>
                <th>Points</th>
                <th>State</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {status.recent.map((r) => (
                <ResultRow key={r.resultId} r={r} onMessage={setMessage} />
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

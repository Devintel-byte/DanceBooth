import { useCallback, useEffect, useRef, useState } from 'react';
import type { BoothSettings, FeedLogEntry, FeedStatusInfo, FeedToast, SettingsPatch } from '@booth/contracts';
import { booth } from '../shared/booth';

/** "just now", "2 min ago", "1 h ago". */
export function ago(iso: string | null, now: number): string {
  if (!iso) return '';
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ago`;
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** One-line connection state shown at the top of the operator console at all times. */
export function FeedStatusBar({ feed, now }: { feed: FeedStatusInfo | null; now: number }) {
  if (!feed) return null;
  const last = feed.lastSessionSentAt ? ` · Last session sent ${ago(feed.lastSessionSentAt, now)}` : '';
  const [tone, text] =
    feed.state === 'off'
      ? (['off', 'Main leaderboard feed: Off'] as const)
      : feed.state === 'problem'
        ? (['bad', `Main leaderboard feed: Problem: ${feed.problem ?? 'unknown'}`] as const)
        : feed.state === 'connected'
          ? (['good', `Connected to the main leaderboard (${feed.mainLeaderboard!.ip})`] as const)
          : (['warn', 'Waiting for the main leaderboard'] as const);
  return (
    <div className={`feed-bar ${tone}`} role="status">
      <span className="feed-dot" aria-hidden="true" />
      <span>
        {text}
        {feed.state !== 'off' && feed.scoreboards.length > 0 ? ` · ${feed.scoreboards.length} scoreboard${feed.scoreboards.length > 1 ? 's' : ''}` : ''}
        {last}
      </span>
    </div>
  );
}

/** Short notices (auto-dismiss) about the main leaderboard connection. */
export function FeedToasts() {
  const [toasts, setToasts] = useState<(FeedToast & { id: number })[]>([]);
  const next = useRef(1);
  useEffect(
    () =>
      booth().onFeedToast((t) => {
        const id = next.current++;
        setToasts((ts) => [...ts.slice(-3), { ...t, id }]);
        window.setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 6000);
      }),
    [],
  );
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.level}`} onClick={() => setToasts((ts) => ts.filter((x) => x.id !== t.id))}>
          {t.message}
        </div>
      ))}
    </div>
  );
}

export function FeedPanel({
  settings,
  feed,
  patch,
  confirm,
  refresh,
}: {
  settings: BoothSettings;
  feed: FeedStatusInfo | null;
  patch: (p: SettingsPatch) => Promise<void>;
  confirm: (title: string, message: string, label: string, run: () => void) => void;
  refresh: () => void;
}) {
  const [key, setKey] = useState<string | null>(null);
  const [log, setLog] = useState<FeedLogEntry[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [port, setPort] = useState(String(settings.scoreFeed.port));
  const [boothId, setBoothId] = useState(settings.scoreFeed.boothId);

  useEffect(() => setPort(String(settings.scoreFeed.port)), [settings.scoreFeed.port]);
  useEffect(() => setBoothId(settings.scoreFeed.boothId), [settings.scoreFeed.boothId]);
  useEffect(() => {
    const load = () => void booth().getFeedLog().then(setLog).catch(() => undefined);
    load();
    const t = window.setInterval(load, 2000);
    return () => window.clearInterval(t);
  }, []);
  // Hide the key again after a while, and whenever it changes.
  useEffect(() => {
    if (!key) return;
    const t = window.setTimeout(() => setKey(null), 60_000);
    return () => window.clearTimeout(t);
  }, [key]);

  const flash = useCallback((what: string) => {
    setCopied(what);
    window.setTimeout(() => setCopied((c) => (c === what ? null : c)), 1500);
  }, []);
  const copy = (what: string, text: string) => void booth().copyText(text).then(() => flash(what));

  const savePort = () => {
    const n = Number(port);
    if (Number.isInteger(n) && n >= 1024 && n <= 65535 && n !== settings.scoreFeed.port) void patch({ scoreFeed: { port: n } }).then(refresh);
    else setPort(String(settings.scoreFeed.port));
  };
  const saveBoothId = () => {
    const v = boothId.trim().toLowerCase();
    if (/^[a-z0-9][a-z0-9-]{0,31}$/.test(v) && v !== settings.scoreFeed.boothId) void patch({ scoreFeed: { boothId: v } }).then(refresh);
    else setBoothId(settings.scoreFeed.boothId);
  };

  return (
    <section className="panel wide feed-panel">
      <h2>Main leaderboard connection</h2>
      <p className="small">
        Sends every finished session to the event's main leaderboard over this network. The main leaderboard connects to this booth: type the address and the
        shared key below into its <b>Admin → Booths → Add a booth</b> form.
      </p>
      <div className="row">
        <label className="check">
          <input type="checkbox" checked={settings.scoreFeed.enabled} onChange={(e) => void patch({ scoreFeed: { enabled: e.target.checked } }).then(refresh)} />
          Enable feed
        </label>
        <label>
          Port
          <input type="number" min={1024} max={65535} value={port} onChange={(e) => setPort(e.target.value)} onBlur={savePort} onKeyDown={(e) => e.key === 'Enter' && savePort()} />
        </label>
        <label>
          Booth id
          <input value={boothId} onChange={(e) => setBoothId(e.target.value)} onBlur={saveBoothId} onKeyDown={(e) => e.key === 'Enter' && saveBoothId()} />
        </label>
      </div>

      <div className="feed-enter">
        <h3>Enter this on the main leaderboard</h3>
        <dl>
          <dt>Address</dt>
          <dd>
            {feed?.addresses.length ? (
              feed.addresses.map((a) => (
                <div key={a} className="copy-row">
                  <code className="big">{a}</code>
                  <button type="button" onClick={() => copy(a, a)}>
                    {copied === a ? 'Copied' : 'Copy'}
                  </button>
                </div>
              ))
            ) : (
              <span className="small">No network address. Connect this PC to the event network (cable or Wi-Fi).</span>
            )}
          </dd>
          <dt>Shared key</dt>
          <dd>
            <div className="copy-row">
              <code className="big">{key ?? (feed?.hasKey ? '••••••••••••••••' : '—')}</code>
              <button type="button" onClick={() => (key ? setKey(null) : void booth().revealFeedKey().then(setKey))}>
                {key ? 'Hide' : 'Show'}
              </button>
              <button type="button" onClick={() => void booth().copyFeedKey().then((ok) => ok && flash('key'))}>
                {copied === 'key' ? 'Copied' : 'Copy'}
              </button>
              <button
                type="button"
                onClick={() =>
                  confirm('Create a new key?', 'The main leaderboard must be updated with the new key. Until then it cannot receive sessions from this booth.', 'Create new key', () => {
                    setKey(null);
                    void booth().regenerateFeedKey().then(refresh);
                  })
                }
              >
                New key
              </button>
            </div>
          </dd>
          <dt>Player list</dt>
          <dd>
            {feed?.playerList
              ? `${feed.playerList.count} registered player${feed.playerList.count === 1 ? '' : 's'}${feed.playerList.title ? ` (${feed.playerList.title})` : ''}, updated ${clock(feed.playerList.receivedAt)}`
              : 'No player list yet; player numbers will be checked by the main leaderboard.'}
          </dd>
        </dl>
      </div>

      <details className="feed-firewall">
        <summary>Main leaderboard cannot connect? Allow the port through Windows Firewall</summary>
        <p className="small">
          Run this once in an <b>Administrator PowerShell</b> (Start → type PowerShell → right-click → Run as administrator). The Wi-Fi or cable network must be set
          to <b>Private</b> in Windows (Settings → Network &amp; internet → your network → Private network).
        </p>
        <div className="copy-row">
          <code className="cmd">{feed?.firewallCommand ?? ''}</code>
          <button type="button" onClick={() => feed && copy('fw', feed.firewallCommand)}>
            {copied === 'fw' ? 'Copied' : 'Copy'}
          </button>
        </div>
      </details>

      <div className="feed-log-head">
        <h3>Connection log</h3>
        <button
          type="button"
          onClick={() =>
            copy(
              'log',
              log.map((l) => `${l.at} ${l.level.toUpperCase()} ${l.message}`).join('\n'),
            )
          }
          disabled={log.length === 0}
        >
          {copied === 'log' ? 'Copied' : 'Copy log'}
        </button>
      </div>
      <ol className="feed-log">
        {log.length === 0 && <li className="small">Nothing yet.</li>}
        {log.map((l, i) => (
          <li key={`${l.at}-${i}`} className={l.level}>
            <time>{new Date(l.at).toLocaleTimeString()}</time> <b>{l.level}</b> {l.message}
          </li>
        ))}
      </ol>
      <div className="buttons">
        <button
          className="danger"
          onClick={() =>
            confirm(
              "Clear today's leaderboard?",
              'All player names for this event are removed from this booth. Sessions already sent to the main leaderboard are not deleted there.',
              'Clear leaderboard',
              () => void booth().clearLeaderboard(),
            )
          }
        >
          Clear leaderboard names
        </button>
      </div>
    </section>
  );
}

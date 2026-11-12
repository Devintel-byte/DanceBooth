import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { DisplayInfo, EventProfile, Leaderboard } from '@booth/contracts';
import { applyBranding, booth, loadBrandFonts, log } from '../shared/booth';
import { SecondaryButton, Wordmark } from '../components';
import '../styles/tokens.css';
import './leaderboard.css';

function LeaderboardApp({ profile, assetBaseUrl }: { profile: EventProfile; assetBaseUrl: string }) {
  const [board, setBoard] = useState<Leaderboard | null>(null);
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [fullscreen, setFullscreen] = useState(false);

  const refreshDisplays = useCallback(() => {
    void booth().listDisplays().then(setDisplays).catch(() => setDisplays([]));
  }, []);

  useEffect(() => {
    void booth().getLeaderboard().then(setBoard);
    const off = booth().onLeaderboardUpdated(setBoard);
    refreshDisplays();
    const onResize = () => setFullscreen(window.innerHeight === screen.height && window.innerWidth === screen.width);
    window.addEventListener('resize', onResize);
    return () => {
      off();
      window.removeEventListener('resize', onResize);
    };
  }, [refreshDisplays]);

  const toggleFullscreen = () => {
    void booth().leaderboardWindow({ type: 'fullscreen', enabled: !fullscreen });
    setFullscreen(!fullscreen);
  };
  const nextDisplay = () => {
    if (displays.length < 2) return;
    const i = Math.max(0, displays.findIndex((d) => d.hostsLeaderboard));
    const target = displays[(i + 1) % displays.length]!;
    void booth()
      .leaderboardWindow({ type: 'move-to-display', displayId: target.id })
      .then(refreshDisplays);
  };

  return (
    <div className="lb">
      <header className="lb-head">
        <div className="lb-brand">
          {profile.logo && <img className="lb-logo" src={`${assetBaseUrl}${profile.logo}`} alt={`${profile.eventName} logo`} draggable={false} onError={(e) => (e.currentTarget.style.display = 'none')} />}
          <div>
            <Wordmark name={profile.productName} accent={profile.productNameAccent} className="lb-wordmark" />
            <h1>Today’s top dancers</h1>
          </div>
        </div>
        <nav className="lb-controls" aria-label="Window controls">
          <SecondaryButton size="compact" onClick={toggleFullscreen}>
            {fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          </SecondaryButton>
          <SecondaryButton size="compact" onClick={nextDisplay} disabled={displays.length < 2} title={displays.length < 2 ? 'Only one display connected' : undefined}>
            Move to next display
          </SecondaryButton>
        </nav>
      </header>
      {!board ? (
        <p className="lb-empty">Loading…</p>
      ) : board.entries.length === 0 ? (
        <div className="lb-empty">
          <h2>No scores yet today</h2>
          <p>Dance a full song to be the first on the board.</p>
        </div>
      ) : (
        <ol className="lb-list">
          {board.entries.map((e) => (
            <li key={e.playerId} className={`lb-row rank-${e.rank <= 3 ? e.rank : 'n'}`}>
              <span className="lb-rank tabular" aria-label={`Rank ${e.rank}`}>
                {e.rank}
              </span>
              <span className="lb-who">
                <strong>{e.name}</strong>
                <span className="lb-id">{e.playerId}</span>
                {e.guest && <span className="lb-guest">Guest</span>}
              </span>
              <span className="lb-time tabular">{new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              <span className="lb-score tabular">{e.points.toLocaleString()} pts</span>
            </li>
          ))}
        </ol>
      )}
      <footer className="lb-foot">
        Best score per player today · live booth sessions only · {board?.sessionsCounted ?? 0} sessions
      </footer>
    </div>
  );
}

async function main() {
  const root = createRoot(document.getElementById('root')!);
  try {
    const data = await booth().getBootstrap();
    applyBranding(data.profile);
    void loadBrandFonts(data.profile, data.app.assetBaseUrl);
    document.title = `${data.profile.productName} Leaderboard`;
    root.render(
      <StrictMode>
        <LeaderboardApp profile={data.profile} assetBaseUrl={data.app.assetBaseUrl} />
      </StrictMode>,
    );
  } catch (e) {
    log('error', `leaderboard bootstrap failed: ${String(e)}`);
    root.render(<p className="lb-empty">Leaderboard unavailable.</p>);
  }
}

void main();

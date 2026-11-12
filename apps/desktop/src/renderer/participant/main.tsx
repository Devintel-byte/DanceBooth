import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { booth, applyBranding, loadBrandFonts, log } from '../shared/booth';
import { BoothRuntime } from './runtime/runtime';
import { App } from './App';
import '../styles/tokens.css';
import './participant.css';

window.addEventListener('error', (e) => log('error', `uncaught: ${e.message}`, 'UNKNOWN'));
window.addEventListener('unhandledrejection', (e) => log('error', `unhandled rejection: ${String(e.reason)}`, 'UNKNOWN'));

async function main() {
  const root = createRoot(document.getElementById('root')!);
  try {
    const data = await booth().getBootstrap();
    applyBranding(data.profile);
    void loadBrandFonts(data.profile, data.app.assetBaseUrl);
    const runtime = new BoothRuntime(data, data.settings);
    booth().onCommand((c) => runtime.handleCommand(c));
    booth().onSettingsChanged((s) => runtime.updateSettings(s));
    booth().onLeaderboardUpdated((b) => runtime.setLeaderboard(b));
    runtime.start();
    window.addEventListener('beforeunload', () => void runtime.dispose());
    root.render(
      <StrictMode>
        <App runtime={runtime} boot={data} />
      </StrictMode>,
    );
  } catch (e) {
    log('error', `participant bootstrap failed: ${String(e)}`, 'CONTENT_INVALID');
    root.render(
      <div className="fatal">
        <h1>Booth unavailable</h1>
        <p>Please ask a team member for help.</p>
      </div>,
    );
  }
}

void main();

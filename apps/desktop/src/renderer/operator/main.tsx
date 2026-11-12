import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { applyBranding, booth, loadBrandFonts, log } from '../shared/booth';
import { OperatorApp } from './OperatorApp';
import '../styles/tokens.css';
import './operator.css';

window.addEventListener('error', (e) => log('error', `operator uncaught: ${e.message}`));

async function main() {
  const root = createRoot(document.getElementById('root')!);
  try {
    const data = await booth().getBootstrap();
    applyBranding(data.profile);
    void loadBrandFonts(data.profile, data.app.assetBaseUrl);
    root.render(
      <StrictMode>
        <OperatorApp boot={data} />
      </StrictMode>,
    );
  } catch (e) {
    root.render(<pre className="fatal">Operator console failed to start: {String(e)}</pre>);
  }
}

void main();

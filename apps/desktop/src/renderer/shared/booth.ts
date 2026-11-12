import type { BoothBridge, EventProfile } from '@booth/contracts';

declare global {
  interface Window {
    booth: BoothBridge;
  }
}

export const booth = (): BoothBridge => window.booth;

/** Structured log to the main-process logger (never includes images). */
export function log(level: 'debug' | 'info' | 'warn' | 'error', message: string, code?: string): void {
  try {
    window.booth.log(code ? { level, message: message.slice(0, 2000), code } : { level, message: message.slice(0, 2000) });
  } catch {
    // Bridge unavailable (e.g. during teardown); nothing else to do.
  }
}

/** Applies event-profile branding as CSS custom properties (design tokens). */
export function applyBranding(profile: EventProfile, root: HTMLElement = document.documentElement): void {
  const set = (k: string, v: string) => root.style.setProperty(k, v);
  // camelCase token -> --kebab-case custom property (brandOrangeDark -> --brand-orange-dark).
  for (const [key, value] of Object.entries(profile.colors)) {
    set(`--${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`, value);
  }
  set('--font-display', `"${profile.fonts.display.family}", "Bahnschrift", "Segoe UI", sans-serif`);
  set('--font-body', `"${profile.fonts.body.family}", "Segoe UI", sans-serif`);
  document.title = profile.productName;
}

/**
 * Registers the profile's locally bundled fonts. A missing or broken font
 * file is logged and the CSS fallback stack is used; it never breaks the UI.
 */
export async function loadBrandFonts(profile: EventProfile, assetBaseUrl: string): Promise<void> {
  const faces = [
    { family: profile.fonts.display.family, file: profile.fonts.display.file, weight: '600 700' },
    { family: profile.fonts.body.family, file: profile.fonts.body.file, weight: '200 800' },
  ];
  await Promise.all(
    faces
      .filter((f) => f.file)
      .map(async (f) => {
        try {
          const face = new FontFace(f.family, `url("${assetBaseUrl}${f.file}")`, { weight: f.weight, display: 'swap' });
          document.fonts.add(await face.load());
        } catch (e) {
          log('warn', `font ${f.family} unavailable, using fallback: ${String(e)}`, 'CONTENT_MISSING');
        }
      }),
  );
}

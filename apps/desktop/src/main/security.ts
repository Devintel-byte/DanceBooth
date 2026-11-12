import { app, session, type WebContents } from 'electron';

export type Role = 'participant' | 'operator' | 'leaderboard';

/**
 * Content Security Policy for app windows. Production is strict: no inline
 * or remote script, WASM allowed via 'wasm-unsafe-eval' (needed by MediaPipe),
 * assets only from the booth-asset scheme. Dev additionally allows the Vite
 * dev server, its HMR websocket, and the inline React refresh preamble.
 */
export function contentSecurityPolicy(dev: boolean, devOrigins: readonly string[] = []): string {
  const devSrc = dev ? ` ${devOrigins.join(' ')} 'unsafe-inline'` : '';
  const devConnect = dev ? ` ${devOrigins.join(' ')} ${devOrigins.map((o) => o.replace(/^http/, 'ws')).join(' ')}` : '';
  return [
    "default-src 'none'",
    `script-src 'self' 'wasm-unsafe-eval' booth-asset:${devSrc}`,
    `worker-src 'self'${dev ? ' ' + devOrigins.join(' ') : ''}`,
    `connect-src 'self' booth-asset:${devConnect}`,
    "img-src 'self' data: blob: booth-asset:",
    "media-src 'self' blob: booth-asset: mediastream:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' booth-asset:",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join('; ');
}

export interface SecurityOptions {
  isDev: boolean;
  devOrigins: () => readonly string[];
  roleOf: (wc: WebContents) => Role | null;
  expectedOrigin: (role: Role) => string;
  onBlocked: (what: string, detail: string) => void;
}

function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.origin === 'null' ? `${u.protocol}//${u.host}` : u.origin;
  } catch {
    return null;
  }
}

export function installSecurity(opts: SecurityOptions): void {
  const ses = session.defaultSession;

  // Only the participant window may use a camera, only video, only from its own origin.
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const role = opts.roleOf(wc);
    const origin = originOf(details.requestingUrl ?? '');
    const mediaTypes = (details as { mediaTypes?: string[] }).mediaTypes ?? [];
    const ok =
      permission === 'media' &&
      role === 'participant' &&
      origin === opts.expectedOrigin('participant') &&
      mediaTypes.length > 0 &&
      mediaTypes.every((t) => t === 'video');
    if (!ok) opts.onBlocked('permission-request', `${permission} from ${origin ?? 'unknown'} (${role ?? 'unknown role'})`);
    callback(ok);
  });

  ses.setPermissionCheckHandler((wc, permission, requestingOrigin) => {
    if (!wc) return false;
    const role = opts.roleOf(wc);
    // enumerateDevices() needs a positive 'media' check to expose camera labels.
    if (permission === 'media' && role === 'participant') {
      return originOf(requestingOrigin) === opts.expectedOrigin('participant');
    }
    return false;
  });

  ses.setDevicePermissionHandler(() => false);

  // Dev only: CSP header for responses from the Vite dev server.
  if (opts.isDev) {
    ses.webRequest.onHeadersReceived((details, callback) => {
      const origin = originOf(details.url);
      if (origin && opts.devOrigins().includes(origin)) {
        const headers = { ...details.responseHeaders };
        headers['Content-Security-Policy'] = [contentSecurityPolicy(true, opts.devOrigins())];
        callback({ responseHeaders: headers });
      } else {
        callback({});
      }
    });
  }

  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      opts.onBlocked('window-open', url);
      return { action: 'deny' };
    });
    contents.on('will-navigate', (event, url) => {
      const role = opts.roleOf(contents);
      if (!role || originOf(url) !== opts.expectedOrigin(role)) {
        event.preventDefault();
        opts.onBlocked('navigation', url);
      }
    });
    contents.on('will-redirect', (event, url) => {
      const role = opts.roleOf(contents);
      if (!role || originOf(url) !== opts.expectedOrigin(role)) {
        event.preventDefault();
        opts.onBlocked('redirect', url);
      }
    });
    contents.on('will-attach-webview', (event) => {
      event.preventDefault();
      opts.onBlocked('webview', 'attach attempt');
    });
  });
}

/** Verifies an IPC message came from the main frame of the expected role's window. */
export function senderRole(
  sender: WebContents,
  senderFrame: Electron.WebFrameMain | null,
  opts: Pick<SecurityOptions, 'roleOf' | 'expectedOrigin'>,
): Role | null {
  const role = opts.roleOf(sender);
  if (!role || !senderFrame || senderFrame !== sender.mainFrame) return null;
  return originOf(senderFrame.url) === opts.expectedOrigin(role) ? role : null;
}

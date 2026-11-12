import { createReadStream, promises as fs } from 'node:fs';
import { Readable } from 'node:stream';
import { protocol } from 'electron';
import { mimeTypeFor, resolveAssetPath } from '@booth/content';
import { contentSecurityPolicy } from './security';

/**
 * Two privileged custom schemes replace file:// so that:
 * - the app has stable, distinct origins per window (`booth-app://participant`,
 *   `booth-app://operator`), which permission and IPC checks rely on;
 * - content (audio, GLB, models, WASM) is served from one allow-listed root
 *   with correct MIME types and CORS, without disabling web security.
 */
export const APP_SCHEME = 'booth-app';
export const ASSET_SCHEME = 'booth-asset';
export const ASSET_BASE_URL = `${ASSET_SCHEME}://content/`;

/** Must run before `app.ready`. */
export function registerSchemesAsPrivileged(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true },
    },
    {
      scheme: ASSET_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
    },
  ]);
}

function notFound(): Response {
  return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
}

async function serveFile(
  abs: string,
  request: Request,
  extraHeaders: Record<string, string>,
): Promise<Response> {
  const mime = mimeTypeFor(abs);
  if (!mime) return new Response('Unsupported type', { status: 415 });
  let size: number;
  try {
    const st = await fs.stat(abs);
    if (!st.isFile()) return notFound();
    size = st.size;
  } catch {
    return notFound();
  }
  const headers: Record<string, string> = {
    'content-type': mime,
    'accept-ranges': 'bytes',
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-cache',
    ...extraHeaders,
  };
  // Range support so media elements can seek.
  const range = request.headers.get('range');
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : size - Number(m[2]);
    let end = m[1] && m[2] ? Number(m[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(size - 1, end);
    if (start > end) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
    const stream = Readable.toWeb(createReadStream(abs, { start, end })) as ReadableStream;
    return new Response(stream, {
      status: 206,
      headers: { ...headers, 'content-length': String(end - start + 1), 'content-range': `bytes ${start}-${end}/${size}` },
    });
  }
  const stream = Readable.toWeb(createReadStream(abs)) as ReadableStream;
  return new Response(stream, { status: 200, headers: { ...headers, 'content-length': String(size) } });
}

export interface ProtocolOptions {
  assetsRoot: string;
  rendererRoot: string;
  /** Origins allowed to read assets cross-origin (app windows, dev servers). */
  allowedOrigins: () => readonly string[];
  isDev: boolean;
}

export function handleProtocols(opts: ProtocolOptions): void {
  protocol.handle(ASSET_SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== 'content' || (request.method !== 'GET' && request.method !== 'HEAD')) return notFound();
    const abs = resolveAssetPath(opts.assetsRoot, url.pathname.replace(/^\//, ''));
    if (!abs) return notFound();
    const origin = request.headers.get('origin');
    const cors: Record<string, string> =
      origin && opts.allowedOrigins().includes(origin)
        ? { 'access-control-allow-origin': origin, vary: 'origin' }
        : {};
    return serveFile(abs, request, cors);
  });

  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    if (!['participant', 'operator', 'leaderboard'].includes(url.host)) return notFound();
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\//, '');
    const abs = resolveAssetPath(`${opts.rendererRoot}/${url.host}`, rel);
    if (!abs) return notFound();
    return serveFile(abs, request, {
      'content-security-policy': contentSecurityPolicy(false),
      'cross-origin-opener-policy': 'same-origin',
    });
  });
}

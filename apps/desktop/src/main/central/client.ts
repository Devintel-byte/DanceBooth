/**
 * HTTP client for the main application (contract event-results/1).
 * Runs in the Electron main process only; the credential never reaches a
 * renderer. Every response is classified so the sender knows whether to
 * retry, stop (credentials), or block the message for an operator.
 */

export type FailureKind =
  /** Network error, timeout, 408, 429, 5xx: retry with backoff. */
  | 'transient'
  /** 401 / 403: stop sending until credentials change (no retry storm). */
  | 'auth'
  /** 400, 404, 409, 422 and other 4xx: permanent for this message; operator-visible. */
  | 'permanent';

export class CentralError extends Error {
  constructor(
    message: string,
    readonly kind: FailureKind,
    readonly status: number | null,
    /** Seconds from Retry-After, when supplied. */
    readonly retryAfterSec: number | null = null,
    readonly body: unknown = null,
  ) {
    super(message);
  }
}

export interface ClientOptions {
  serverUrl: string;
  allowPlainHttp: boolean;
  credential: string | null;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export function validateServerUrl(url: string, allowPlainHttp: boolean): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return 'Server URL is not a valid URL';
  }
  if (u.protocol === 'https:') return null;
  if (u.protocol === 'http:') return allowPlainHttp ? null : 'Plain http:// is only allowed with "trusted LAN (http)" switched on; use https://';
  return 'Server URL must start with https:// (or http:// in trusted-LAN mode)';
}

function retryAfter(h: string | null): number | null {
  if (!h) return null;
  const n = Number(h);
  if (Number.isFinite(n)) return Math.max(0, n);
  const t = Date.parse(h);
  return Number.isFinite(t) ? Math.max(0, (t - Date.now()) / 1000) : null;
}

export class CentralClient {
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: ClientOptions) {
    const problem = validateServerUrl(opts.serverUrl, opts.allowPlainHttp);
    if (problem) throw new CentralError(problem, 'permanent', null);
    this.base = opts.serverUrl.replace(/\/+$/, '');
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /**
   * Sends one request. `body` is sent verbatim when it is a string (so
   * retries are byte-identical). Throws CentralError on any failure.
   */
  async request<T>(method: 'GET' | 'POST', pathname: string, body?: string | object, auth = true): Promise<T> {
    if (auth && !this.opts.credential) throw new CentralError('No source credential configured', 'auth', null);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 15_000);
    let res: Response;
    try {
      res = await this.fetchImpl(this.base + pathname, {
        method,
        headers: {
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(auth && this.opts.credential ? { Authorization: `Bearer ${this.opts.credential}` } : {}),
        },
        body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e) {
      throw new CentralError(`Network error: ${(e as Error).name === 'AbortError' ? 'timed out' : (e as Error).message}`, 'transient', null);
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text().catch(() => '');
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (res.ok) {
      if (json === null) throw new CentralError(`Invalid JSON in ${res.status} response`, 'transient', res.status);
      return json as T;
    }
    const detail = (json && typeof json === 'object' && ('error' in json || 'message' in json) ? String((json as { error?: unknown; message?: unknown }).error ?? (json as { message?: unknown }).message) : text.slice(0, 200)) || res.statusText;
    const s = res.status;
    if (s === 401 || s === 403) throw new CentralError(`Credentials rejected (${s}): ${detail}`, 'auth', s, null, json);
    if (s === 408 || s === 425 || s === 429 || s >= 500) throw new CentralError(`Server busy or unavailable (${s}): ${detail}`, 'transient', s, retryAfter(res.headers.get('retry-after')), json);
    throw new CentralError(`Rejected (${s}): ${detail}`, 'permanent', s, null, json);
  }
}

/**
 * Reads the Tasks tab with the Google Sheets API (spreadsheets.values.get).
 * Read-only: nothing here can change the sheet.
 */

/** The only permission the app asks for: read-only access to spreadsheets. */
export const SHEETS_READONLY_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';

/** Only the Tasks tab is read. Other tabs (such as "Dashboard prompt" or "Read me") never are. */
export const TASKS_RANGE = 'Tasks!A1:F1000';

export type SheetsErrorKind =
  | 'auth-expired'
  | 'no-access'
  | 'scope-missing'
  | 'api-disabled'
  | 'not-found'
  | 'tab-missing'
  | 'rate-limited'
  | 'server'
  | 'offline'
  | 'network'
  | 'bad-response'
  | 'unknown';

export class SheetsApiError extends Error {
  readonly kind: SheetsErrorKind;
  /** HTTP status, or null when no response arrived. */
  readonly status: number | null;
  /** Google's own error text, for the "technical details" line. Never contains sheet data. */
  readonly detail: string;

  constructor(kind: SheetsErrorKind, status: number | null, detail: string) {
    super(`${kind}${status ? ` (HTTP ${status})` : ''}${detail ? `: ${detail}` : ''}`);
    this.name = 'SheetsApiError';
    this.kind = kind;
    this.status = status;
    this.detail = detail;
  }
}

export function buildValuesUrl(spreadsheetId: string, range: string = TASKS_RANGE): string {
  return (
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}` +
    `/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE`
  );
}

interface GoogleErrorBody {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: { reason?: string }[];
  };
}

/** Maps a failed response to a kind the UI can explain. Exported for tests. */
export function classifyError(httpStatus: number, body: GoogleErrorBody | null): SheetsApiError {
  const message = body?.error?.message ?? '';
  const reasons = (body?.error?.details ?? []).map((d) => d?.reason ?? '');
  const detail = [body?.error?.status, message].filter(Boolean).join(': ');
  const has = (reason: string) => reasons.includes(reason);

  if (httpStatus === 401) return new SheetsApiError('auth-expired', httpStatus, detail);
  if (httpStatus === 403) {
    if (has('SERVICE_DISABLED') || /has not been used in project|is disabled/i.test(message)) {
      return new SheetsApiError('api-disabled', httpStatus, detail);
    }
    if (has('ACCESS_TOKEN_SCOPE_INSUFFICIENT') || /insufficient authentication scopes/i.test(message)) {
      return new SheetsApiError('scope-missing', httpStatus, detail);
    }
    if (has('RATE_LIMIT_EXCEEDED') || has('RESOURCE_EXHAUSTED')) {
      return new SheetsApiError('rate-limited', httpStatus, detail);
    }
    return new SheetsApiError('no-access', httpStatus, detail);
  }
  if (httpStatus === 404) return new SheetsApiError('not-found', httpStatus, detail);
  if (httpStatus === 400 && /unable to parse range/i.test(message)) {
    return new SheetsApiError('tab-missing', httpStatus, detail);
  }
  if (httpStatus === 429) return new SheetsApiError('rate-limited', httpStatus, detail);
  if (httpStatus >= 500) return new SheetsApiError('server', httpStatus, detail);
  return new SheetsApiError('unknown', httpStatus, detail);
}

function isRetryable(httpStatus: number): boolean {
  return httpStatus === 429 || httpStatus === 500 || httpStatus === 502 || httpStatus === 503 || httpStatus === 504;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Seconds from a Retry-After header, if Google sends one and the browser lets us read it. */
function retryAfterMs(response: Response): number | null {
  const header = response.headers.get('Retry-After');
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds, 60) * 1000;
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.min(Math.max(date - Date.now(), 0), 60_000);
}

export interface FetchValuesOptions {
  spreadsheetId: string;
  accessToken: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  /** Extra attempts after the first for rate limits, server errors and network drops. */
  maxRetries?: number;
  baseDelayMs?: number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
  isOnline?: () => boolean;
}

/**
 * Fetches the raw `values` rows of the Tasks tab.
 *
 * Rate limits (429) and temporary server errors are retried with truncated
 * exponential backoff plus jitter, as Google's Sheets API docs recommend.
 * Sign-in, permission and setup errors are not retried.
 */
export async function fetchSheetValues(options: FetchValuesOptions): Promise<unknown[]> {
  const {
    spreadsheetId,
    accessToken,
    signal,
    fetchImpl = globalThis.fetch.bind(globalThis),
    maxRetries = 3,
    baseDelayMs = 1000,
    sleep = abortableSleep,
    random = Math.random,
    isOnline = () => globalThis.navigator?.onLine !== false,
  } = options;
  const url = buildValuesUrl(spreadsheetId);
  const backoff = (attempt: number) => Math.min(baseDelayMs * 2 ** attempt, 30_000) + random() * baseDelayMs;

  for (let attempt = 0; ; attempt += 1) {
    if (!isOnline()) throw new SheetsApiError('offline', null, '');

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        // Personal data: never keep a copy in the browser's HTTP cache, never send cookies.
        cache: 'no-store',
        credentials: 'omit',
        signal,
      });
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) throw error;
      if (attempt < maxRetries) {
        await sleep(backoff(attempt), signal);
        continue;
      }
      throw new SheetsApiError(isOnline() ? 'network' : 'offline', null, error instanceof Error ? error.message : '');
    }

    if (response.ok) {
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new SheetsApiError('bad-response', response.status, 'The response was not JSON.');
      }
      if (typeof body !== 'object' || body === null) {
        throw new SheetsApiError('bad-response', response.status, 'The response was empty.');
      }
      const values = (body as { values?: unknown }).values;
      // An empty range comes back without a values field at all.
      if (values === undefined) return [];
      if (!Array.isArray(values)) {
        throw new SheetsApiError('bad-response', response.status, 'The values field was not a list.');
      }
      return values as unknown[];
    }

    if (isRetryable(response.status) && attempt < maxRetries) {
      await sleep(retryAfterMs(response) ?? backoff(attempt), signal);
      continue;
    }
    let errorBody: GoogleErrorBody | null = null;
    try {
      errorBody = (await response.json()) as GoogleErrorBody;
    } catch {
      errorBody = null;
    }
    throw classifyError(response.status, errorBody);
  }
}

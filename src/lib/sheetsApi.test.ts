import { describe, expect, it, vi } from 'vitest';
import { buildValuesUrl, classifyError, fetchSheetValues, SheetsApiError, type FetchValuesOptions } from './sheetsApi.ts';

const SHEET_ID = 'sheet-id-for-tests-0000000000';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function googleError(status: number, apiStatus: string, message: string, reason?: string): Response {
  return json(status, {
    error: { code: status, message, status: apiStatus, details: reason ? [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason }] : [] },
  });
}

function setup(responses: (Response | Error)[], overrides: Partial<FetchValuesOptions> = {}) {
  const fetchImpl = vi.fn<typeof fetch>();
  for (const response of responses) {
    if (response instanceof Error) fetchImpl.mockRejectedValueOnce(response);
    else fetchImpl.mockResolvedValueOnce(response);
  }
  const sleep = vi.fn((_ms: number, _signal?: AbortSignal) => Promise.resolve());
  const run = () =>
    fetchSheetValues({
      spreadsheetId: SHEET_ID,
      accessToken: 'test-token',
      fetchImpl,
      sleep,
      random: () => 0,
      isOnline: () => true,
      ...overrides,
    });
  return { fetchImpl, sleep, run };
}

async function failure(promise: Promise<unknown>): Promise<SheetsApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof SheetsApiError) return error;
    throw error;
  }
  throw new Error('expected the request to fail');
}

describe('buildValuesUrl', () => {
  it('asks for only the Tasks tab, as formatted values', () => {
    expect(buildValuesUrl(SHEET_ID)).toBe(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Tasks!A1%3AF1000?valueRenderOption=FORMATTED_VALUE`,
    );
  });
});

describe('fetchSheetValues', () => {
  it('sends the token as a Bearer header without cookies or caching', async () => {
    const { fetchImpl, run } = setup([json(200, { range: 'Tasks!A1:F1000', majorDimension: 'ROWS', values: [['a']] })]);
    await expect(run()).resolves.toEqual([['a']]);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe(buildValuesUrl(SHEET_ID));
    expect(init).toMatchObject({
      method: 'GET',
      headers: { Authorization: 'Bearer test-token' },
      cache: 'no-store',
      credentials: 'omit',
    });
  });

  it('returns no rows when the range is empty', async () => {
    const { run } = setup([json(200, { range: 'Tasks!A1:F1000', majorDimension: 'ROWS' })]);
    await expect(run()).resolves.toEqual([]);
  });

  it('rejects responses it cannot read', async () => {
    const { run } = setup([new Response('<html>', { status: 200 })]);
    expect((await failure(run())).kind).toBe('bad-response');
  });

  it.each([
    [googleError(401, 'UNAUTHENTICATED', 'Request had invalid authentication credentials.'), 'auth-expired'],
    [googleError(403, 'PERMISSION_DENIED', 'The caller does not have permission'), 'no-access'],
    [
      googleError(403, 'PERMISSION_DENIED', 'Google Sheets API has not been used in project 123 before or it is disabled.', 'SERVICE_DISABLED'),
      'api-disabled',
    ],
    [
      googleError(403, 'PERMISSION_DENIED', 'Request had insufficient authentication scopes.', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT'),
      'scope-missing',
    ],
    [googleError(404, 'NOT_FOUND', 'Requested entity was not found.'), 'not-found'],
    [googleError(400, 'INVALID_ARGUMENT', 'Unable to parse range: Tasks!A1:F1000'), 'tab-missing'],
    [googleError(400, 'INVALID_ARGUMENT', 'Something else'), 'unknown'],
  ])('does not retry %#: %s', async (response, kind) => {
    const { fetchImpl, run } = setup([response]);
    const error = await failure(run());
    expect(error.kind).toBe(kind);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('keeps Google’s error text for the technical details', async () => {
    const { run } = setup([googleError(403, 'PERMISSION_DENIED', 'The caller does not have permission')]);
    const error = await failure(run());
    expect(error.status).toBe(403);
    expect(error.detail).toBe('PERMISSION_DENIED: The caller does not have permission');
  });

  it('retries rate limits with exponential backoff, then succeeds', async () => {
    const { fetchImpl, sleep, run } = setup([
      googleError(429, 'RESOURCE_EXHAUSTED', 'Quota exceeded'),
      googleError(429, 'RESOURCE_EXHAUSTED', 'Quota exceeded'),
      json(200, { values: [['ok']] }),
    ]);
    await expect(run()).resolves.toEqual([['ok']]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000]);
  });

  it('gives up after three retries', async () => {
    const { fetchImpl, sleep, run } = setup(Array.from({ length: 4 }, () => googleError(429, 'RESOURCE_EXHAUSTED', 'Quota exceeded')));
    expect((await failure(run())).kind).toBe('rate-limited');
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000, 4000]);
  });

  it('adds random jitter to each wait', async () => {
    const { sleep, run } = setup([googleError(503, 'UNAVAILABLE', 'Try later'), json(200, { values: [] })], {
      random: () => 0.5,
    });
    await run();
    expect(sleep.mock.calls[0]?.[0]).toBe(1500);
  });

  it('retries temporary server errors', async () => {
    const { run } = setup(Array.from({ length: 4 }, () => googleError(503, 'UNAVAILABLE', 'The service is currently unavailable.')));
    expect((await failure(run())).kind).toBe('server');
  });

  it('retries dropped connections, then reports a network problem', async () => {
    const { fetchImpl, run } = setup(Array.from({ length: 4 }, () => new TypeError('Failed to fetch')));
    expect((await failure(run())).kind).toBe('network');
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('does not try while the device is offline', async () => {
    const { fetchImpl, run } = setup([], { isOnline: () => false });
    expect((await failure(run())).kind).toBe('offline');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('stops immediately when cancelled', async () => {
    const controller = new AbortController();
    const { fetchImpl, run } = setup([], { signal: controller.signal });
    fetchImpl.mockImplementation((_url, init) => {
      controller.abort();
      return Promise.reject(init?.signal?.reason as Error);
    });
    await expect(run()).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('classifyError', () => {
  it('copes with an empty error body', () => {
    expect(classifyError(500, null).kind).toBe('server');
    expect(classifyError(403, null).kind).toBe('no-access');
    expect(classifyError(418, null).kind).toBe('unknown');
  });
});

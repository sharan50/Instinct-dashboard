import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GIS_SCRIPT_URL,
  interpretGisError,
  interpretTokenResponse,
  loadGoogleIdentity,
  type GoogleIdentity,
} from './googleAuth.ts';
import { SHEETS_READONLY_SCOPE } from './sheetsApi.ts';

const google: GoogleIdentity = {
  accounts: {
    oauth2: {
      initTokenClient: () => ({ requestAccessToken: () => undefined }),
      hasGrantedAllScopes: (response, ...scopes) => scopes.every((s) => (response.scope ?? '').split(' ').includes(s)),
      revoke: () => undefined,
    },
  },
};

describe('interpretTokenResponse', () => {
  const now = Date.parse('2026-10-21T09:00:00Z');

  it('accepts a token with the read-only Sheets permission and keeps its lifetime from Google', () => {
    const outcome = interpretTokenResponse(
      google,
      { access_token: 'abc', expires_in: 3599, scope: SHEETS_READONLY_SCOPE, token_type: 'Bearer' },
      now,
    );
    expect(outcome).toEqual({ ok: true, token: { value: 'abc', expiresAt: now + 3_599_000 } });
  });

  it('treats a refused consent screen as denied', () => {
    expect(interpretTokenResponse(google, { error: 'access_denied' }, now)).toMatchObject({ ok: false, problem: 'denied' });
  });

  it('notices when the Sheets permission was unticked', () => {
    const outcome = interpretTokenResponse(google, { access_token: 'abc', expires_in: 3599, scope: 'email' }, now);
    expect(outcome).toMatchObject({ ok: false, problem: 'scope-missing' });
  });

  it('reports other OAuth errors and empty responses', () => {
    expect(interpretTokenResponse(google, { error: 'invalid_client', error_description: 'no' }, now)).toEqual({
      ok: false,
      problem: 'unknown',
      detail: 'invalid_client: no',
    });
    expect(interpretTokenResponse(google, {}, now)).toMatchObject({ ok: false, problem: 'unknown' });
  });

  it('falls back to a one-hour lifetime only if Google omits expires_in', () => {
    const outcome = interpretTokenResponse(google, { access_token: 'abc', scope: SHEETS_READONLY_SCOPE }, now);
    expect(outcome).toMatchObject({ ok: true, token: { expiresAt: now + 3_600_000 } });
  });
});

describe('interpretGisError', () => {
  it('maps pop-up problems', () => {
    expect(interpretGisError({ type: 'popup_failed_to_open' }).problem).toBe('popup-blocked');
    expect(interpretGisError({ type: 'popup_closed' }).problem).toBe('popup-closed');
    expect(interpretGisError({ type: 'unknown', message: 'odd' })).toEqual({ problem: 'unknown', detail: 'unknown: odd' });
  });
});

describe('loadGoogleIdentity', () => {
  afterEach(() => {
    delete window.google;
    document.head.querySelectorAll('script').forEach((script) => script.remove());
    vi.useRealTimers();
  });

  const script = () => document.head.querySelector<HTMLScriptElement>(`script[src="${GIS_SCRIPT_URL}"]`);

  it('adds Google’s script once and resolves when it has loaded', async () => {
    const first = loadGoogleIdentity();
    const second = loadGoogleIdentity();
    expect(document.head.querySelectorAll('script')).toHaveLength(1);
    window.google = google;
    script()?.dispatchEvent(new Event('load'));
    await expect(first).resolves.toBe(google);
    await expect(second).resolves.toBe(google);
  });

  it('rejects when the script cannot load, and can try again later', async () => {
    const attempt = loadGoogleIdentity();
    script()?.dispatchEvent(new Event('error'));
    await expect(attempt).rejects.toThrow('could not be loaded');
    expect(script()).toBeNull();
    const retry = loadGoogleIdentity();
    expect(script()).not.toBeNull();
    script()?.dispatchEvent(new Event('error'));
    await expect(retry).rejects.toThrow('could not be loaded');
  });

  it('gives up if loading takes too long', async () => {
    vi.useFakeTimers();
    const attempt = loadGoogleIdentity(5000);
    vi.advanceTimersByTime(5000);
    await expect(attempt).rejects.toThrow('too long');
  });
});

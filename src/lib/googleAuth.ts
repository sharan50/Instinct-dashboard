import { SHEETS_READONLY_SCOPE } from './sheetsApi.ts';

/**
 * Google Identity Services (GIS), token model.
 *
 * The browser asks Google for a short-lived access token in a pop-up after the
 * user clicks Connect. There is no client secret and no refresh token, and the
 * token is only ever held in memory.
 */

export const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client';

/** The parts of the GIS library this app uses. */
export interface TokenResponse {
  access_token?: string;
  expires_in?: number | string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
  error_uri?: string;
}

export interface GisError {
  type?: string;
  message?: string;
}

export interface TokenClientConfig {
  client_id: string;
  scope: string;
  callback: (response: TokenResponse) => void;
  error_callback?: (error: GisError) => void;
  login_hint?: string;
  prompt?: string;
  include_granted_scopes?: boolean;
}

export interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string; login_hint?: string }): void;
}

export interface RevocationResponse {
  successful?: boolean;
  error?: string;
  error_description?: string;
}

export interface GoogleOAuth2 {
  initTokenClient(config: TokenClientConfig): TokenClient;
  hasGrantedAllScopes(response: TokenResponse, scope: string, ...more: string[]): boolean;
  revoke(accessToken: string, done?: (response: RevocationResponse) => void): void;
}

export interface GoogleIdentity {
  accounts: { oauth2: GoogleOAuth2 };
}

declare global {
  interface Window {
    google?: GoogleIdentity;
  }
}

let loading: Promise<GoogleIdentity> | null = null;

/** Adds Google's sign-in script to the page once and resolves when it is ready. */
export function loadGoogleIdentity(timeoutMs = 20_000): Promise<GoogleIdentity> {
  if (window.google?.accounts?.oauth2) return Promise.resolve(window.google);
  if (loading) return loading;

  loading = new Promise<GoogleIdentity>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GIS_SCRIPT_URL;
    script.async = true;

    const fail = (message: string) => {
      window.clearTimeout(timer);
      script.remove();
      loading = null;
      reject(new Error(message));
    };
    const timer = window.setTimeout(() => fail('Google sign-in took too long to load.'), timeoutMs);

    script.onload = () => {
      window.clearTimeout(timer);
      if (window.google?.accounts?.oauth2) {
        loading = null;
        resolve(window.google);
      } else {
        fail('Google sign-in loaded but is not usable.');
      }
    };
    script.onerror = () => fail('Google sign-in could not be loaded.');
    document.head.appendChild(script);
  });
  return loading;
}

export interface AccessToken {
  value: string;
  /** Epoch milliseconds, from the expires_in that Google returns. */
  expiresAt: number;
}

export type AuthProblem = 'denied' | 'scope-missing' | 'popup-blocked' | 'popup-closed' | 'unknown';

export type TokenOutcome =
  | { ok: true; token: AccessToken }
  | { ok: false; problem: AuthProblem; detail: string };

/** Fallback if Google ever omits expires_in. The real lifetime always comes from Google. */
const FALLBACK_LIFETIME_SECONDS = 3600;

export function interpretTokenResponse(google: GoogleIdentity, response: TokenResponse, now: number): TokenOutcome {
  if (response.error) {
    const detail = [response.error, response.error_description].filter(Boolean).join(': ');
    return { ok: false, problem: response.error === 'access_denied' ? 'denied' : 'unknown', detail };
  }
  if (!response.access_token) return { ok: false, problem: 'unknown', detail: 'Google returned no access token.' };
  // With granular consent the user can untick the permission and still continue.
  if (!google.accounts.oauth2.hasGrantedAllScopes(response, SHEETS_READONLY_SCOPE)) {
    return { ok: false, problem: 'scope-missing', detail: '' };
  }
  const seconds = Number(response.expires_in);
  const lifetime = Number.isFinite(seconds) && seconds > 0 ? seconds : FALLBACK_LIFETIME_SECONDS;
  return { ok: true, token: { value: response.access_token, expiresAt: now + lifetime * 1000 } };
}

export function interpretGisError(error: GisError): { problem: AuthProblem; detail: string } {
  switch (error.type) {
    case 'popup_failed_to_open':
      return { problem: 'popup-blocked', detail: '' };
    case 'popup_closed':
      return { problem: 'popup-closed', detail: '' };
    default:
      return { problem: 'unknown', detail: [error.type, error.message].filter(Boolean).join(': ') };
  }
}

import { vi } from 'vitest';
import type { GoogleIdentity, TokenClientConfig, TokenResponse } from '../lib/googleAuth.ts';
import { SHEETS_READONLY_SCOPE } from '../lib/sheetsApi.ts';

export type PopupOutcome = 'grant' | 'deny' | 'close' | 'blocked' | 'no-scope' | 'wait';

/**
 * A stand-in for Google's sign-in library. Tests decide how the next Google
 * pop-up ends; nothing ever reaches Google.
 */
export function createFakeGoogle() {
  let config: TokenClientConfig | null = null;
  let outcome: PopupOutcome = 'grant';
  let expiresIn = 3599;
  let tokenCount = 0;
  const requests: { prompt?: string; login_hint?: string }[] = [];
  const revoked: string[] = [];

  const respond = (response: TokenResponse) => config?.callback(response);

  const google: GoogleIdentity = {
    accounts: {
      oauth2: {
        initTokenClient(clientConfig) {
          config = clientConfig;
          return {
            requestAccessToken(overrides = {}) {
              requests.push(overrides);
              const current = outcome;
              // Google always answers asynchronously, after the pop-up.
              setTimeout(() => {
                if (current === 'grant') {
                  tokenCount += 1;
                  respond({
                    access_token: `token-${tokenCount}`,
                    expires_in: expiresIn,
                    scope: SHEETS_READONLY_SCOPE,
                    token_type: 'Bearer',
                  });
                } else if (current === 'deny') {
                  respond({ error: 'access_denied' });
                } else if (current === 'no-scope') {
                  respond({ access_token: 'token-x', expires_in: expiresIn, scope: 'email', token_type: 'Bearer' });
                } else if (current === 'close') {
                  config?.error_callback?.({ type: 'popup_closed', message: 'Popup window closed' });
                } else if (current === 'blocked') {
                  config?.error_callback?.({ type: 'popup_failed_to_open', message: 'Failed to open popup window' });
                }
              }, 0);
            },
          };
        },
        hasGrantedAllScopes: (response, ...scopes) =>
          scopes.every((scope) => (response.scope ?? '').split(' ').includes(scope)),
        revoke: (token, done) => {
          revoked.push(token);
          setTimeout(() => done?.({ successful: true }), 0);
        },
      },
    },
  };

  const loaded = Promise.resolve(google);
  return {
    google,
    load: vi.fn(() => loaded),
    requests,
    revoked,
    clientConfig: () => config,
    /** How the next pop-up ends. */
    nextPopup(next: PopupOutcome, options: { expiresIn?: number } = {}) {
      outcome = next;
      expiresIn = options.expiresIn ?? 3599;
    },
  };
}

export type FakeGoogle = ReturnType<typeof createFakeGoogle>;

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export function valuesResponse(values: unknown[]): Response {
  return new Response(JSON.stringify({ range: 'Tasks!A1:Z1000', majorDimension: 'ROWS', values }), {
    status: 200,
    headers: JSON_HEADERS,
  });
}

export function errorResponse(status: number, apiStatus: string, message: string, reason?: string): Response {
  return new Response(
    JSON.stringify({ error: { code: status, message, status: apiStatus, details: reason ? [{ reason }] : [] } }),
    { status, headers: JSON_HEADERS },
  );
}

type Reply = Response | Error | (() => Promise<Response>);

/** A fetch stand-in that answers with each reply in turn, then keeps repeating the last one. */
export function scriptedFetch(...replies: Reply[]) {
  const queue = [...replies];
  return vi.fn<typeof fetch>((_input, init) => {
    const reply = queue.length > 1 ? queue.shift() : queue[0];
    if (init?.signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
    if (!reply) return Promise.reject(new Error('no reply scripted'));
    if (reply instanceof Error) return Promise.reject(reply);
    if (typeof reply === 'function') return reply();
    return Promise.resolve(reply.clone());
  });
}

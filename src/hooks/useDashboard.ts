import { useCallback, useEffect, useLayoutEffect, useReducer, useRef } from 'react';
import type { AppConfig } from '../config.ts';
import {
  interpretGisError,
  interpretTokenResponse,
  type AccessToken,
  type AuthProblem,
  type GisError,
  type GoogleIdentity,
  type TokenClient,
  type TokenResponse,
} from '../lib/googleAuth.ts';
import { fetchSheetValues, SHEETS_READONLY_SCOPE, SheetsApiError, type SheetsErrorKind } from '../lib/sheetsApi.ts';
import { parseTaskSheet, SheetFormatError, type DataIssue, type ParsedSheet, type Task } from '../lib/tasks.ts';
import { usePageVisible } from './usePageVisible.ts';

/** Automatic refreshes happen at most this often, and only while the page is visible. */
export const AUTO_REFRESH_MS = 5 * 60_000;
/** Data older than this is labelled as possibly out of date. */
export const STALE_AFTER_MS = 10 * 60_000;
/** Treat the token as expired slightly early so a request never starts with a dying token. */
export const EXPIRY_MARGIN_MS = 60_000;

export type Phase =
  /** Google's sign-in library is loading. */
  | 'loading'
  /** Google's sign-in library could not load. */
  | 'library-error'
  | 'signed-out'
  /** The Google pop-up is open. */
  | 'authorizing'
  | 'connected'
  /** The access token ran out; data stays visible but marked as out of date. */
  | 'expired';

export interface FetchProblem {
  kind: SheetsErrorKind | 'format' | 'unexpected';
  detail: string;
  /** For header problems: the specific issues found. */
  details: string[];
  at: number;
}

export interface DashboardData {
  tasks: Task[];
  issues: DataIssue[];
  fetchedAt: number;
}

export type Notice = 'signed-out' | 'revoking' | 'revoked' | 'revoke-failed';

export interface DashboardState {
  phase: Phase;
  /** Where to return if the Google pop-up fails or is cancelled. */
  resumePhase: Phase;
  libraryError: string | null;
  authProblem: { problem: AuthProblem; detail: string } | null;
  /** Kept in memory only, never stored. */
  token: AccessToken | null;
  /** Increases with every new token and every sign-out, so late responses are ignored. */
  session: number;
  data: DashboardData | null;
  fetching: boolean;
  lastAttemptAt: number | null;
  fetchError: FetchProblem | null;
  expiredAt: number | null;
  notice: Notice | null;
}

type Action =
  | { type: 'library-ready' }
  | { type: 'library-failed'; message: string }
  | { type: 'auth-start' }
  | { type: 'auth-cancelled' }
  | { type: 'auth-failed'; problem: AuthProblem; detail: string }
  | { type: 'auth-succeeded'; token: AccessToken }
  | { type: 'fetch-start'; at: number }
  | { type: 'fetch-succeeded'; session: number; parsed: ParsedSheet; at: number }
  | { type: 'fetch-failed'; session: number; problem: FetchProblem }
  | { type: 'token-expired'; at: number }
  | { type: 'signed-out'; notice: Notice }
  | { type: 'notice'; notice: Notice };

export const initialState: DashboardState = {
  phase: 'loading',
  resumePhase: 'signed-out',
  libraryError: null,
  authProblem: null,
  token: null,
  session: 0,
  data: null,
  fetching: false,
  lastAttemptAt: null,
  fetchError: null,
  expiredAt: null,
  notice: null,
};

export function reducer(state: DashboardState, action: Action): DashboardState {
  switch (action.type) {
    case 'library-ready':
      return state.phase === 'loading' ? { ...state, phase: 'signed-out' } : state;
    case 'library-failed':
      return { ...state, phase: 'library-error', libraryError: action.message };
    case 'auth-start':
      if (state.phase === 'loading' || state.phase === 'library-error' || state.phase === 'authorizing') return state;
      return { ...state, phase: 'authorizing', resumePhase: state.phase, authProblem: null, notice: null };
    case 'auth-cancelled':
      return state.phase === 'authorizing' ? { ...state, phase: state.resumePhase } : state;
    case 'auth-failed':
      if (state.phase !== 'authorizing') return state;
      return { ...state, phase: state.resumePhase, authProblem: { problem: action.problem, detail: action.detail } };
    case 'auth-succeeded':
      if (state.phase !== 'authorizing') return state;
      return {
        ...state,
        phase: 'connected',
        token: action.token,
        session: state.session + 1,
        authProblem: null,
        fetchError: null,
        expiredAt: null,
        fetching: false,
      };
    case 'fetch-start':
      return { ...state, fetching: true, lastAttemptAt: action.at };
    case 'fetch-succeeded':
      if (action.session !== state.session) return state;
      return {
        ...state,
        fetching: false,
        fetchError: null,
        data: { tasks: action.parsed.tasks, issues: action.parsed.issues, fetchedAt: action.at },
      };
    case 'fetch-failed':
      if (action.session !== state.session) return state;
      return { ...state, fetching: false, fetchError: action.problem };
    case 'token-expired':
      if (state.phase !== 'connected') return state;
      return { ...state, phase: 'expired', token: null, fetching: false, expiredAt: action.at };
    case 'signed-out':
      // The token and everything read from the sheet are dropped from memory.
      return { ...initialState, phase: 'signed-out', session: state.session + 1, notice: action.notice };
    case 'notice':
      return { ...state, notice: action.notice };
  }
}

function toProblem(error: unknown, at: number): FetchProblem {
  if (error instanceof SheetsApiError) return { kind: error.kind, detail: error.detail, details: [], at };
  if (error instanceof SheetFormatError) return { kind: 'format', detail: error.message, details: error.details, at };
  return { kind: 'unexpected', detail: error instanceof Error ? error.message : '', details: [], at };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

export interface DashboardDeps {
  config: AppConfig;
  loadGoogle: () => Promise<GoogleIdentity>;
  fetchImpl?: typeof fetch;
}

export interface DashboardController {
  state: DashboardState;
  /** Opens Google's pop-up. Must be called straight from a click so browsers allow the pop-up. */
  connect: (options?: { chooseAccount?: boolean }) => void;
  cancelConnect: () => void;
  refresh: () => void;
  signOut: () => void;
  /** Signs out and asks Google to remove this app's access to the account. */
  revokeAccess: () => void;
}

/**
 * The dashboard's sign-in and sync logic.
 *
 * - Tokens are requested only from a click, kept in memory, and dropped on sign-out.
 * - Data is fetched right after connecting, on the Refresh button, and
 *   automatically at most every 5 minutes while the page is visible.
 * - When the token expires, data stays on screen marked as out of date and
 *   the user is asked to reconnect; nothing is refreshed silently.
 */
export function useDashboard({ config, loadGoogle, fetchImpl }: DashboardDeps): DashboardController {
  const [state, dispatch] = useReducer(reducer, initialState);
  const visible = usePageVisible();
  const googleRef = useRef<GoogleIdentity | null>(null);
  const clientRef = useRef<TokenClient | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  /** True between a Connect click and Google's answer; stray answers are ignored. */
  const awaitingTokenRef = useRef(false);
  const openedSessionRef = useRef(0);
  const stateRef = useRef(state);
  useLayoutEffect(() => {
    stateRef.current = state;
  });

  const abortRequest = useCallback(() => {
    requestRef.current?.abort();
    requestRef.current = null;
  }, []);

  const onTokenResponse = useCallback((response: TokenResponse) => {
    const google = googleRef.current;
    if (!google || !awaitingTokenRef.current) return;
    awaitingTokenRef.current = false;
    const outcome = interpretTokenResponse(google, response, Date.now());
    if (!outcome.ok) {
      dispatch({ type: 'auth-failed', problem: outcome.problem, detail: outcome.detail });
      return;
    }
    // A request still running with an older token must not overwrite the new one.
    abortRequest();
    dispatch({ type: 'auth-succeeded', token: outcome.token });
  }, [abortRequest]);

  const onTokenError = useCallback((error: GisError) => {
    if (!awaitingTokenRef.current) return;
    awaitingTokenRef.current = false;
    const { problem, detail } = interpretGisError(error);
    dispatch({ type: 'auth-failed', problem, detail });
  }, []);

  // Google's library keeps the callbacks it was created with, so route them to the current handlers.
  const handlersRef = useRef({ onTokenResponse, onTokenError });
  useLayoutEffect(() => {
    handlersRef.current = { onTokenResponse, onTokenError };
  });

  useEffect(() => {
    let cancelled = false;
    loadGoogle().then(
      (google) => {
        if (cancelled) return;
        try {
          clientRef.current = google.accounts.oauth2.initTokenClient({
            client_id: config.clientId,
            scope: SHEETS_READONLY_SCOPE,
            include_granted_scopes: false,
            ...(config.accountHint ? { login_hint: config.accountHint } : {}),
            callback: (response) => handlersRef.current.onTokenResponse(response),
            error_callback: (error) => handlersRef.current.onTokenError(error),
          });
          googleRef.current = google;
          dispatch({ type: 'library-ready' });
        } catch (error) {
          dispatch({ type: 'library-failed', message: errorMessage(error) });
        }
      },
      (error: unknown) => {
        if (!cancelled) dispatch({ type: 'library-failed', message: errorMessage(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [config.clientId, config.accountHint, loadGoogle]);

  const refresh = useCallback(() => {
    const { phase, token, session } = stateRef.current;
    if (phase !== 'connected' || !token || requestRef.current) return;
    if (Date.now() >= token.expiresAt - EXPIRY_MARGIN_MS) {
      dispatch({ type: 'token-expired', at: Date.now() });
      return;
    }
    const controller = new AbortController();
    requestRef.current = controller;
    dispatch({ type: 'fetch-start', at: Date.now() });

    fetchSheetValues({
      spreadsheetId: config.spreadsheetId,
      accessToken: token.value,
      signal: controller.signal,
      fetchImpl,
    })
      .then((values) => {
        if (controller.signal.aborted) return;
        dispatch({ type: 'fetch-succeeded', session, parsed: parseTaskSheet(values), at: Date.now() });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof SheetsApiError && error.kind === 'auth-expired') {
          dispatch({ type: 'token-expired', at: Date.now() });
        } else {
          dispatch({ type: 'fetch-failed', session, problem: toProblem(error, Date.now()) });
        }
      })
      .finally(() => {
        if (requestRef.current === controller) requestRef.current = null;
      });
  }, [config.spreadsheetId, fetchImpl]);

  // Fetch as soon as a new token arrives ("refresh on opening"), once per token.
  useEffect(() => {
    if (state.phase === 'connected' && openedSessionRef.current !== state.session) {
      openedSessionRef.current = state.session;
      refresh();
    }
  }, [state.phase, state.session, refresh]);

  // Automatic refresh: at most every 5 minutes, paused while the page is hidden.
  useEffect(() => {
    if (state.phase !== 'connected' || !visible || state.fetching || state.lastAttemptAt === null) return;
    const delay = Math.max(0, state.lastAttemptAt + AUTO_REFRESH_MS - Date.now());
    const timer = window.setTimeout(refresh, delay);
    return () => window.clearTimeout(timer);
  }, [state.phase, state.fetching, state.lastAttemptAt, visible, refresh]);

  // Stop using the token just before the expiry time Google gave.
  useEffect(() => {
    if (state.phase !== 'connected' || !state.token) return;
    const delay = Math.max(0, state.token.expiresAt - EXPIRY_MARGIN_MS - Date.now());
    const timer = window.setTimeout(() => dispatch({ type: 'token-expired', at: Date.now() }), delay);
    return () => window.clearTimeout(timer);
  }, [state.phase, state.token]);

  // Back online after a failed refresh: try again straight away.
  useEffect(() => {
    const onOnline = () => {
      const { phase, fetchError } = stateRef.current;
      if (phase === 'connected' && (fetchError?.kind === 'offline' || fetchError?.kind === 'network')) refresh();
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [refresh]);

  useEffect(() => abortRequest, [abortRequest]);

  const connect = useCallback(
    (options: { chooseAccount?: boolean } = {}) => {
      const client = clientRef.current;
      if (!client) return;
      awaitingTokenRef.current = true;
      dispatch({ type: 'auth-start' });
      // With a known account Google can skip the chooser; otherwise always let the user pick.
      const prompt = options.chooseAccount || !config.accountHint ? 'select_account' : '';
      try {
        client.requestAccessToken({ prompt });
      } catch (error) {
        awaitingTokenRef.current = false;
        dispatch({ type: 'auth-failed', problem: 'unknown', detail: errorMessage(error) });
      }
    },
    [config.accountHint],
  );

  const cancelConnect = useCallback(() => {
    awaitingTokenRef.current = false;
    dispatch({ type: 'auth-cancelled' });
  }, []);

  const signOut = useCallback(() => {
    awaitingTokenRef.current = false;
    abortRequest();
    dispatch({ type: 'signed-out', notice: 'signed-out' });
  }, [abortRequest]);

  const revokeAccess = useCallback(() => {
    const token = stateRef.current.token;
    const google = googleRef.current;
    awaitingTokenRef.current = false;
    abortRequest();
    dispatch({ type: 'signed-out', notice: 'revoking' });
    if (!token || !google) {
      dispatch({ type: 'notice', notice: 'revoke-failed' });
      return;
    }
    try {
      google.accounts.oauth2.revoke(token.value, (response) => {
        dispatch({ type: 'notice', notice: response?.successful === false ? 'revoke-failed' : 'revoked' });
      });
    } catch {
      dispatch({ type: 'notice', notice: 'revoke-failed' });
    }
  }, [abortRequest]);

  return { state, connect, cancelConnect, refresh, signOut, revokeAccess };
}

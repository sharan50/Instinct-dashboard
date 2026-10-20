import type { FetchProblem, Notice } from './hooks/useDashboard.ts';
import type { AuthProblem } from './lib/googleAuth.ts';
import { COLUMNS } from './lib/tasks.ts';

/** What the user can do about a problem, shown as the main button. */
export type ProblemAction = 'retry' | 'choose-account' | 'reconnect';

export interface ProblemText {
  title: string;
  body: string;
  action: ProblemAction;
}

export function fetchProblemText(problem: FetchProblem, accountHint: string | null): ProblemText {
  const account = accountHint ?? 'the Google account that owns the tracker sheet';
  switch (problem.kind) {
    case 'no-access':
      return {
        title: 'This Google account can’t open the tracker',
        body: `Sign in with ${account}. The sheet stays private, so only accounts it is shared with can read it.`,
        action: 'choose-account',
      };
    case 'not-found':
      return {
        title: 'Spreadsheet not found',
        body: 'Google couldn’t find a spreadsheet with the ID in the VITE_SPREADSHEET_ID setting. Check that setting against the sheet’s address.',
        action: 'retry',
      };
    case 'tab-missing':
      return {
        title: 'No tab called “Tasks”',
        body: 'The dashboard only reads the tab named “Tasks”. If it was renamed, rename it back to Tasks in the sheet, then try again.',
        action: 'retry',
      };
    case 'api-disabled':
      return {
        title: 'The Google Sheets API is turned off',
        body: 'In Google Cloud, open APIs & Services, then Library, search for “Google Sheets API” and choose Enable. Wait a minute, then try again.',
        action: 'retry',
      };
    case 'scope-missing':
      return {
        title: 'Read access to your spreadsheets wasn’t granted',
        body: 'Connect again, and on Google’s screen leave the permission to see your Google Sheets spreadsheets ticked.',
        action: 'reconnect',
      };
    case 'auth-expired':
      return {
        title: 'Google sign-in expired',
        body: 'Reconnect to load the latest tasks.',
        action: 'reconnect',
      };
    case 'rate-limited':
      return {
        title: 'Google asked the dashboard to slow down',
        body: 'There were too many requests in a short time. Waiting a minute usually fixes this; the dashboard also tries again by itself every 5 minutes.',
        action: 'retry',
      };
    case 'server':
      return {
        title: 'Google Sheets is having a temporary problem',
        body: 'This usually clears up on its own. Try again in a minute.',
        action: 'retry',
      };
    case 'offline':
      return {
        title: 'You’re offline',
        body: 'Connect to the internet; the dashboard tries again as soon as you’re back online.',
        action: 'retry',
      };
    case 'network':
      return {
        title: 'Couldn’t reach Google Sheets',
        body: 'Check your internet connection. If you use an ad or content blocker, allow sheets.googleapis.com on this site.',
        action: 'retry',
      };
    case 'format':
      return {
        title: 'The Tasks tab’s header row doesn’t match',
        body: `Row 1 must hold these headers: ${Object.values(COLUMNS).join(', ')}. Fix row 1 in the sheet, then try again.`,
        action: 'retry',
      };
    case 'bad-response':
    case 'unknown':
    case 'unexpected':
      return {
        title: 'Something went wrong reading the sheet',
        body: 'Try again. If it keeps happening, the technical details below help with troubleshooting.',
        action: 'retry',
      };
  }
}

export function authProblemText(problem: AuthProblem): { title: string; body: string } {
  switch (problem) {
    case 'denied':
      return {
        title: 'Google access wasn’t granted',
        body: 'Without it the dashboard can’t read your tracker. Choose Connect again and allow access on Google’s screen.',
      };
    case 'scope-missing':
      return {
        title: 'Read access to your spreadsheets wasn’t ticked',
        body: 'On Google’s screen, keep the permission to see your Google Sheets spreadsheets ticked, then continue.',
      };
    case 'popup-blocked':
      return {
        title: 'The Google sign-in window was blocked',
        body: 'Allow pop-ups for this site in your browser settings, then choose Connect again.',
      };
    case 'popup-closed':
      return {
        title: 'The Google sign-in window was closed',
        body: 'Sign-in didn’t finish. Choose Connect to try again.',
      };
    case 'unknown':
      return {
        title: 'Google sign-in didn’t finish',
        body: 'Try again in a moment.',
      };
  }
}

export function noticeText(notice: Notice): string {
  switch (notice) {
    case 'signed-out':
      return 'You’re signed out. Your tasks were cleared from this page.';
    case 'revoking':
      return 'Removing the dashboard’s access from your Google account…';
    case 'revoked':
      return 'The dashboard no longer has access to your Google account. To use it again, choose Connect and allow access.';
    case 'revoke-failed':
      return 'You’re signed out, but Google didn’t confirm that access was removed. You can remove it yourself in your Google Account, under Security, then “Your connections to third-party apps & services”.';
  }
}

/**
 * Settings come from environment variables at build time (Vite inlines every
 * VITE_ variable into the public site code). None of them are secrets, and
 * none must ever be: anything starting with VITE_ is readable by anyone who
 * opens the site.
 */

export interface AppConfig {
  clientId: string;
  spreadsheetId: string;
  /** Optional account email, used to pre-select the Google account. */
  accountHint: string | null;
}

export type ConfigField = 'clientId' | 'spreadsheetId' | 'secret';

export interface ConfigProblem {
  field: ConfigField;
  /** The environment variable to fix. */
  name: string;
  message: string;
  /** "danger" means a secret may have been exposed and should be rotated. */
  severity: 'missing' | 'invalid' | 'danger';
}

export type ConfigResult =
  | { ok: true; config: AppConfig; problems: [] }
  | { ok: false; config: null; problems: ConfigProblem[] };

/** The README with the step-by-step setup guide. */
export const SETUP_GUIDE_URL = 'https://github.com/sharan50/Instinct-dashboard#readme';

export const ENV = {
  clientId: 'VITE_GOOGLE_CLIENT_ID',
  spreadsheetId: 'VITE_SPREADSHEET_ID',
  accountHint: 'VITE_GOOGLE_ACCOUNT_HINT',
} as const;

const CLIENT_ID = /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/;
const SPREADSHEET_ID = /^[A-Za-z0-9_-]{20,}$/;
const SPREADSHEET_URL = /\/spreadsheets\/d\/([A-Za-z0-9_-]+)/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PLACEHOLDERS = new Set(['your-client-id.apps.googleusercontent.com', 'your-spreadsheet-id']);
const SECRET_NAME = /SECRET|PRIVATE|PASSWORD|API_KEY|SERVICE_ACCOUNT|CREDENTIAL/i;
const SECRET_VALUE = /^GOCSPX-|-----BEGIN [A-Z ]*PRIVATE KEY-----|"private_key"|^AIza[0-9A-Za-z_-]{20,}/;

function value(env: Record<string, unknown>, name: string): string {
  const raw = env[name];
  return typeof raw === 'string' ? raw.trim() : '';
}

/** Accepts either the bare ID or a full spreadsheet address. */
export function extractSpreadsheetId(input: string): string {
  return SPREADSHEET_URL.exec(input)?.[1] ?? input;
}

export function readConfig(env: Record<string, unknown>): ConfigResult {
  const problems: ConfigProblem[] = [];

  // Secrets must never be in a VITE_ variable: the build would publish them.
  for (const [name, raw] of Object.entries(env)) {
    if (!name.startsWith('VITE_') || typeof raw !== 'string' || raw.trim() === '') continue;
    if (SECRET_VALUE.test(raw.trim()) || (SECRET_NAME.test(name) && name !== ENV.accountHint)) {
      problems.push({
        field: 'secret',
        name,
        severity: 'danger',
        message:
          'This setting looks like a secret (a client secret, private key or API key). Anything starting with VITE_ is published in the site code. Remove it and replace the secret in Google Cloud.',
      });
    }
  }

  const clientId = value(env, ENV.clientId);
  if (!clientId || PLACEHOLDERS.has(clientId)) {
    problems.push({ field: 'clientId', name: ENV.clientId, severity: 'missing', message: 'Not set yet.' });
  } else if (!CLIENT_ID.test(clientId) && !SECRET_VALUE.test(clientId)) {
    problems.push({
      field: 'clientId',
      name: ENV.clientId,
      severity: 'invalid',
      message: 'This does not look like an OAuth client ID. It should end in .apps.googleusercontent.com.',
    });
  }

  const spreadsheetInput = value(env, ENV.spreadsheetId);
  const spreadsheetId = extractSpreadsheetId(spreadsheetInput);
  if (!spreadsheetId || PLACEHOLDERS.has(spreadsheetId)) {
    problems.push({ field: 'spreadsheetId', name: ENV.spreadsheetId, severity: 'missing', message: 'Not set yet.' });
  } else if (!SPREADSHEET_ID.test(spreadsheetId)) {
    problems.push({
      field: 'spreadsheetId',
      name: ENV.spreadsheetId,
      severity: 'invalid',
      message: 'This does not look like a spreadsheet ID. Copy the long code between /d/ and /edit in the sheet address.',
    });
  }

  if (problems.length > 0) return { ok: false, config: null, problems };

  const hint = value(env, ENV.accountHint);
  return {
    ok: true,
    config: { clientId, spreadsheetId, accountHint: EMAIL.test(hint) ? hint : null },
    problems: [],
  };
}

export function sheetUrl(config: AppConfig): string {
  const base = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(config.spreadsheetId)}/edit`;
  return config.accountHint ? `${base}?authuser=${encodeURIComponent(config.accountHint)}` : base;
}

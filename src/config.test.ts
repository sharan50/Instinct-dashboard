import { describe, expect, it } from 'vitest';
import { extractSpreadsheetId, readConfig, sheetUrl } from './config.ts';

const CLIENT_ID = '123456789012-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com';
const SHEET_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-xyz';

describe('readConfig', () => {
  it('accepts a client ID and spreadsheet ID', () => {
    expect(readConfig({ VITE_GOOGLE_CLIENT_ID: CLIENT_ID, VITE_SPREADSHEET_ID: SHEET_ID })).toEqual({
      ok: true,
      config: { clientId: CLIENT_ID, spreadsheetId: SHEET_ID, accountHint: null },
      problems: [],
    });
  });

  it('reports missing settings, including untouched placeholders', () => {
    const result = readConfig({
      VITE_GOOGLE_CLIENT_ID: 'your-client-id.apps.googleusercontent.com',
      VITE_SPREADSHEET_ID: '   ',
    });
    expect(result.ok).toBe(false);
    expect(result.problems.map((p) => [p.name, p.severity])).toEqual([
      ['VITE_GOOGLE_CLIENT_ID', 'missing'],
      ['VITE_SPREADSHEET_ID', 'missing'],
    ]);
    expect(readConfig({}).problems).toHaveLength(2);
  });

  it('reports values that do not look right', () => {
    const result = readConfig({ VITE_GOOGLE_CLIENT_ID: 'hello', VITE_SPREADSHEET_ID: 'short' });
    expect(result.problems.map((p) => p.severity)).toEqual(['invalid', 'invalid']);
  });

  it('warns loudly when a client secret is used instead of the client ID', () => {
    const result = readConfig({ VITE_GOOGLE_CLIENT_ID: 'GOCSPX-abcdefghijklmnop', VITE_SPREADSHEET_ID: SHEET_ID });
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([expect.objectContaining({ name: 'VITE_GOOGLE_CLIENT_ID', severity: 'danger' })]);
  });

  it('warns about any other VITE_ setting that looks like a secret, without echoing it', () => {
    const result = readConfig({
      VITE_GOOGLE_CLIENT_ID: CLIENT_ID,
      VITE_SPREADSHEET_ID: SHEET_ID,
      VITE_GOOGLE_CLIENT_SECRET: 'x',
      VITE_SA: '-----BEGIN PRIVATE KEY-----\nabc',
      OTHER_SECRET: 'not built into the site',
    });
    expect(result.problems.map((p) => [p.name, p.severity])).toEqual([
      ['VITE_GOOGLE_CLIENT_SECRET', 'danger'],
      ['VITE_SA', 'danger'],
    ]);
    expect(JSON.stringify(result)).not.toContain('BEGIN PRIVATE KEY');
  });

  it('accepts a full spreadsheet address', () => {
    const result = readConfig({
      VITE_GOOGLE_CLIENT_ID: CLIENT_ID,
      VITE_SPREADSHEET_ID: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit?gid=0#gid=0`,
    });
    expect(result.config?.spreadsheetId).toBe(SHEET_ID);
    expect(extractSpreadsheetId(SHEET_ID)).toBe(SHEET_ID);
  });

  it('uses the account hint only when it is an email address', () => {
    const base = { VITE_GOOGLE_CLIENT_ID: CLIENT_ID, VITE_SPREADSHEET_ID: SHEET_ID };
    expect(readConfig({ ...base, VITE_GOOGLE_ACCOUNT_HINT: 'person@example.com' }).config?.accountHint).toBe('person@example.com');
    expect(readConfig({ ...base, VITE_GOOGLE_ACCOUNT_HINT: 'not an email' }).config?.accountHint).toBeNull();
  });
});

describe('sheetUrl', () => {
  it('links to the sheet, in the hinted account when there is one', () => {
    expect(sheetUrl({ clientId: CLIENT_ID, spreadsheetId: SHEET_ID, accountHint: null })).toBe(
      `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`,
    );
    expect(sheetUrl({ clientId: CLIENT_ID, spreadsheetId: SHEET_ID, accountHint: 'a+b@example.com' })).toBe(
      `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit?authuser=a%2Bb%40example.com`,
    );
  });
});

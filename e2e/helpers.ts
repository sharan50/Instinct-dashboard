import { readFileSync } from 'node:fs';
import type { Page, Route } from '@playwright/test';

/** Invented rows for browser tests. Never copy real tracker rows here. */
export const TIME_ZONE = 'Asia/Kolkata';

const fakeGis = readFileSync(new URL('./fake-gis.js', import.meta.url), 'utf8');

/** YYYY-MM-DD for today plus `days`, in the browser's timezone. */
export function isoDate(days: number): string {
  const date = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function sampleValues(): string[][] {
  const stamp = new Date(Date.now() - 2 * 3_600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return [
    ['Task ID', 'Task', 'Status', 'Deadline', 'Last update', 'Notes', 'Links'],
    ['T001', 'Renew library card', 'open', isoDate(8), stamp, 'Bring proof of address. Opening hours: https://example.org/library/hours.', 'Checklist: https://example.org/library/checklist'],
    ['T002', 'Book dentist check-up', 'waiting on you', '', stamp, 'Choose a morning slot from the three offered.'],
    ['T003', 'Plumber quote for the kitchen tap', 'waiting on someone else', isoDate(-3), stamp, 'Asked for a written quote; no reply yet.'],
    ['T004', 'Return borrowed camera', 'done', isoDate(-10), stamp, 'Returned in person.'],
    ['T005', 'Water the balcony plants', 'open', '', stamp, 'Ongoing: every Sunday morning.'],
    ['T006', 'Order new passport photos', 'waiting on you', isoDate(2), stamp],
    ['T007', 'Compare broadband offers before the contract ends', 'open', isoDate(40), stamp, 'Shortlist: three providers. A very-long-unbroken-reference-code-ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789-should-wrap.', 'Comparison: https://example.org/broadband/comparison-with-a-very-long-address-that-must-wrap-on-phones ; Earlier draft (superseded): https://example.org/broadband/old'],
    ['T008', 'Check the <b>markup</b> stays text', 'waiting on you', '', stamp, '<img src=x onerror="window.__xss=1"> stays as text.'],
  ];
}

type SheetsReply = { status: number; body: unknown };

/** Fakes Google: the sign-in library and the Sheets API. Blocks every other outside request. */
export async function mockGoogle(
  page: Page,
  options: { gis?: Record<string, unknown>; sheets?: SheetsReply[] } = {},
): Promise<{ sheetRequests: string[] }> {
  const sheetRequests: string[] = [];
  const replies = [...(options.sheets ?? [])];
  if (options.gis) await page.addInitScript((settings) => ((window as unknown as Record<string, unknown>).__FAKE_GIS__ = settings), options.gis);

  await page.route(/^https:\/\/(?!localhost)/, (route: Route) => route.abort('blockedbyclient'));
  await page.route('https://accounts.google.com/gsi/client', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: fakeGis }),
  );
  await page.route('https://sheets.googleapis.com/**', (route: Route) => {
    const request = route.request();
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization, accept',
      'access-control-allow-methods': 'GET, OPTIONS',
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    sheetRequests.push(`${request.url()} ${request.headers()['authorization'] ?? ''}`);
    const reply = replies.length > 1 ? replies.shift() : replies[0];
    return route.fulfill({
      status: reply?.status ?? 200,
      contentType: 'application/json',
      headers: cors,
      body: JSON.stringify(reply?.body ?? { range: 'Tasks!A1:Z1000', majorDimension: 'ROWS', values: sampleValues() }),
    });
  });
  return { sheetRequests };
}

export async function connect(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Connect Google account' }).click();
  await page.getByText('Synced with your sheet').waitFor();
}

/** True when the page is wider than the screen (sideways scrolling). */
export function hasHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
}

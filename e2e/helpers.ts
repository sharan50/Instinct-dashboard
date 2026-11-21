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

/** A long entry: it must fold behind "Show full text" and wrap on a phone. */
const LONG_PROGRESS =
  'Compared three providers on monthly price, contract length and the fee for leaving early. Two of them answered the ' +
  'question about the router; the third has not replied yet, so the comparison is not final. Table so far: ' +
  'https://example.org/broadband/table-with-a-very-long-address-that-must-wrap-on-phones and a note to ask again on Friday.';

const HEADER = [
  'Task ID', 'Task', 'Status', 'Deadline', 'Last update', 'Notes', 'Links',
  'Origin', 'Money at stake', 'Progress', 'Hands-on effort', 'Delay-cost basis', 'Expected finish incl. waits', 'Date verified',
  'Area', 'Start', 'Next step',
];

/** An ISO timestamp `hours` hours before now. */
function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function sampleValues(): string[][] {
  const stamp = hoursAgo(2);
  return [
    HEADER,
    ['T001', 'Renew library card', 'open', isoDate(8), stamp, 'Bring proof of address. Opening hours: https://example.org/library/hours.', 'Checklist: https://example.org/library/checklist', 'you requested', 'Small charge after the renewal date', 'Form filled in; proof of address still to print.', '15 minutes', 'avoidable charge', 'Next week', '', 'Admin', '', 'Print the proof of address'],
    ['T002', 'Book dentist check-up', 'waiting on you', '', stamp, 'Choose a morning slot from the three offered.', '', 'Inbound', '', 'Three slots offered by the practice.', '5 minutes', '', '', '', 'Health', '', 'Pick one of the three slots'],
    ['T003', 'Plumber quote for the kitchen tap', 'waiting on someone else', isoDate(-3), stamp, 'Asked for a written quote; no reply yet.', '', 'you requested', 'Unknown until the quote arrives', 'Chased once by phone.', 'None until the quote is in', 'opportunity', 'About a week after the quote arrives', 'verified', 'Home', '', 'Ring the plumber again'],
    ['T004', 'Return borrowed camera', 'done', isoDate(-10), stamp, 'Returned in person.', '', 'you requested', '', 'Returned.', '', 'sunk or reference', '', '', 'Home'],
    // A short row: the Sheets API leaves out trailing empty cells, so every optional cell is blank.
    ['T005', 'Water the balcony plants', 'open', '', stamp, 'Ongoing: every Sunday morning.'],
    ['T006', 'Order new passport photos', 'waiting on you', isoDate(2), stamp, '', '', 'inbound', 'The cheaper booth offer runs until the appointment', '', '30 minutes', 'opportunity', 'In two days', 'verified', 'Admin', '', 'Book the photo booth'],
    ['T007', 'Compare broadband offers before the contract ends', 'open', isoDate(40), stamp, 'Shortlist: three providers. A very-long-unbroken-reference-code-ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789-should-wrap.', 'Comparison: https://example.org/broadband/comparison-with-a-very-long-address-that-must-wrap-on-phones ; Earlier draft (superseded): https://example.org/broadband/old', 'you requested', 'Possible saving: reference-ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ-should-wrap', LONG_PROGRESS, 'About 2 hours, spread over a few evenings', 'opportunity', 'Around the end of next month, depending on the provider', 'planning', 'Home', isoDate(-5), 'Ask the third provider again: reference-ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789-should-wrap'],
    ['T008', 'Check the <b>markup</b> stays text', 'waiting on you', '', stamp, '<img src=x onerror="window.__xss=1"> stays as text.', '', 'somewhere <i>else</i>', '<b>12</b> maybe', '<img src=x onerror="window.__xss=2"> stays as text too.', '', 'a guess', '', 'maybe', 'Tests <b>bold</b>', '', '<img src=x onerror="window.__xss=3"> stays as text as well.'],
  ];
}

/** A long next step: it must fold and wrap on a phone. */
const LONG_NEXT_STEP =
  'Ask again on Friday, and if there is still no answer write to the managing agent with the photos of the latch, ' +
  'then borrow a screwdriver and fit a temporary catch.';

/**
 * Invented rows for the Today and Review views, with dates relative to now.
 * Today: Your move L02, L01. Next 7 days L04, L03, L10. Chase L05, L06.
 * L07 is in none of them, L08 has not started, L09 is done.
 * Review: L05 (quiet for 45 days, waiting with no date), L10 (no update), L04 (no next step), L07 (no area).
 */
export function lifeValues(): string[][] {
  const recent = hoursAgo(2);
  const row = (
    id: string,
    title: string,
    status: string,
    deadline: string,
    lastUpdate: string,
    extra: { notes?: string; basis?: string; verified?: string; area?: string; start?: string; next?: string } = {},
  ) => [
    id, title, status, deadline, lastUpdate, extra.notes ?? '', '',
    '', '', '', '', extra.basis ?? '', '', extra.verified ?? '',
    extra.area ?? '', extra.start ?? '', extra.next ?? '',
  ];
  return [
    HEADER,
    row('L01', 'Book the boiler service', 'waiting on you', '', recent, { notes: 'The engineer prefers mornings.', area: 'Home', next: 'Ring the engineer for a slot' }),
    row('L02', 'Reply to the school trip form', 'waiting on you', isoDate(2), recent, { basis: 'deadline', verified: 'verified', area: 'Family', next: 'Sign it and hand it in' }),
    row('L03', 'Collect the dry cleaning', 'open', isoDate(1), recent, { verified: 'planning', area: 'Home', next: 'Pick it up after work' }),
    row('L04', 'Renew the railcard', 'open', isoDate(6), recent, { verified: 'verified', area: 'Travel' }),
    row('L05', 'Landlord to fix the gate latch', 'waiting on someone else', '', hoursAgo(45 * 24), { area: 'Home', next: LONG_NEXT_STEP }),
    row('L06', 'Garage to send the invoice', 'waiting on someone else', isoDate(25), hoursAgo(7 * 24), { area: 'car', next: 'Wait for the email' }),
    row('L07', 'Sort the photo albums', 'open', '', recent, { next: 'Pick a weekend' }),
    row('L08', 'Plan the spring allotment beds', 'open', '', recent, { area: 'Garden', start: isoDate(20), next: 'Order the seed catalogue' }),
    row('L09', 'Return the library books', 'done', isoDate(-11), recent, { area: 'Home' }),
    row('L10', 'Swap the winter tyres', 'open', isoDate(4), '', { area: 'Car', start: isoDate(-6), next: 'Book the garage' }),
  ];
}

/** A Sheets reply holding the given rows, for mockGoogle's `sheets` option. */
export function sheetReply(values: string[][]): { status: number; body: unknown } {
  return { status: 200, body: { range: 'Tasks!A1:Z1000', majorDimension: 'ROWS', values } };
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

/** Clicks one of the views by its label (the radio itself is visually hidden behind its label). */
export async function openView(page: Page, name: string): Promise<void> {
  await page.locator('.view-switch--views').getByText(name, { exact: true }).click();
}

/**
 * Connects and opens a view. The dashboard itself opens on Today; most tests
 * are about the full list, so that is the default here.
 */
export async function connect(page: Page, view = 'All tasks'): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Connect Google account' }).click();
  await page.getByText('Synced with your sheet').waitFor();
  if (view !== 'Today') await openView(page, view);
}

/** True when the page is wider than the screen (sideways scrolling). */
export function hasHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
}

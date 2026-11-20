import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.tsx';
import { readConfig } from './config.ts';
import type { FormatOptions } from './lib/dates.ts';
import { createFakeGoogle, errorResponse, scriptedFetch, valuesResponse, type FakeGoogle } from './test/fakeGoogle.ts';
import { FULL_HEADER, HEADER, LIFE_HEADER, lifeValues, planningValues, sampleValues } from './test/fixtures.ts';
import { setWideScreen } from './test/viewport.ts';

const CLIENT_ID = '123456789012-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com';
const SHEET_ID = 'sheet-id-for-tests-0000000000';
const NOW = new Date('2026-10-21T04:00:00Z'); // 09:30 in India on 21 Oct 2026
const INDIA: FormatOptions = { locale: 'en-GB', timeZone: 'Asia/Kolkata' };

let google: FakeGoogle;

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  google = createFakeGoogle();
});

afterEach(() => {
  vi.useRealTimers();
  setPageHidden(false);
});

/** Lets pending timers, Google's answer and fetches run, then re-renders. */
async function settle(ms = 50) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function setup({
  fetchImpl = scriptedFetch(valuesResponse(sampleValues())),
  env = {},
  format = INDIA,
}: { fetchImpl?: typeof fetch; env?: Record<string, string>; format?: FormatOptions } = {}) {
  const configResult = readConfig({ VITE_GOOGLE_CLIENT_ID: CLIENT_ID, VITE_SPREADSHEET_ID: SHEET_ID, ...env });
  const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
  const view = render(<App configResult={configResult} loadGoogle={google.load} fetchImpl={fetchImpl} format={format} />);
  return { user, fetchImpl, ...view };
}

/** Connects and stays on the view the dashboard opens with (Today). */
async function connectOnly(user: ReturnType<typeof userEvent.setup>) {
  await settle();
  await user.click(screen.getByRole('button', { name: 'Connect Google account' }));
  await settle();
}

/** Connects, then switches to All tasks when the dashboard is up: most tests are about the list. */
async function connect(user: ReturnType<typeof userEvent.setup>) {
  await connectOnly(user);
  const allTasks = screen.queryByRole('radio', { name: 'All tasks' });
  if (allTasks) await user.click(allTasks);
}

/** Presses Refresh and lets the next scripted answer arrive. */
async function refresh(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Refresh' }));
  await settle();
}

function setPageHidden(hidden: boolean) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

/** Presses Tab until `element` has focus. */
async function tabTo(user: ReturnType<typeof userEvent.setup>, element: HTMLElement) {
  for (let presses = 0; document.activeElement !== element; presses += 1) {
    if (presses > 60) throw new Error('element never received focus');
    await user.tab();
  }
}

const syncHeadline = () => document.querySelector('.sync-bar__headline')?.textContent ?? '';
const cardTitles = () => screen.queryAllByRole('heading', { level: 3 }).map((h) => h.textContent);
const card = (title: string) => screen.getByRole('article', { name: title });
/** One labelled line of a task ("Progress", "Money at stake" and so on). */
const line = (task: HTMLElement, label: string) => within(task).getByText(label, { selector: 'dt' }).parentElement as HTMLElement;
/** The "why this order" line of a task, without its label. */
const why = (task: HTMLElement) => (task.querySelector('.why-order')?.textContent ?? '').replace('Why this order: ', '');

/** The invented rows that use every optional column (see planningValues). */
function setupPlanning() {
  return setup({ fetchImpl: scriptedFetch(valuesResponse(planningValues())) });
}

/** The invented rows that also use Area, Start and Next step (see lifeValues). */
function setupLife(values: string[][] = lifeValues()) {
  return setup({ fetchImpl: scriptedFetch(valuesResponse(values)) });
}

const LIFE = {
  L01: 'Book the boiler service',
  L02: 'Reply to the school trip form',
  L03: 'Collect the dry cleaning',
  L04: 'Renew the railcard',
  L05: 'Landlord to fix the gate latch',
  L06: 'Garage to send the invoice',
  L07: 'Sort the photo albums',
  L08: 'Plan the spring allotment beds',
  L09: 'Return the library books',
  L10: 'Swap the winter tyres',
  L11: 'Chase the deposit refund',
};

const PLANNING = {
  P01: 'Return the rented ladder',
  P02: 'Cancel the unused gym trial',
  P03: 'Send the club membership form',
  P04: 'Compare bike insurance quotes',
  P05: 'File the appliance warranty card',
  P06: 'Archive last year’s receipts',
  P07: 'Renew the parking permit',
  P08: 'Return the borrowed drill',
};

describe('setup', () => {
  it('shows a setup screen, not fake data, when settings are missing', () => {
    render(<App configResult={readConfig({})} loadGoogle={google.load} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Finish setting up your dashboard' })).toBeInTheDocument();
    expect(screen.getByText('VITE_GOOGLE_CLIENT_ID').closest('li')).toHaveTextContent('Not set yet.');
    expect(screen.queryByRole('button', { name: /connect/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/library card/i)).not.toBeInTheDocument();
    expect(google.load).not.toHaveBeenCalled();
  });

  it('warns when a client secret was put in the settings', () => {
    render(<App configResult={readConfig({ VITE_GOOGLE_CLIENT_ID: 'GOCSPX-abc123', VITE_SPREADSHEET_ID: SHEET_ID })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('A secret may have been published');
  });
});

describe('connecting', () => {
  it('waits for Google’s library, then offers to connect with the hinted account', async () => {
    setup({ env: { VITE_GOOGLE_ACCOUNT_HINT: 'person@example.com' } });
    expect(screen.getByRole('button', { name: 'Loading Google sign-in…' })).toBeDisabled();
    await settle();
    expect(screen.getByRole('button', { name: 'Connect Google account' })).toBeEnabled();
    expect(screen.getByText('person@example.com')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open sheet/i })).toHaveAttribute(
      'href',
      `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit?authuser=person%40example.com`,
    );
  });

  it('asks only for read-only Sheets access, from the click', async () => {
    const { user, fetchImpl } = setup();
    await settle();
    expect(google.requests).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Connect Google account' }));
    expect(google.clientConfig()).toMatchObject({
      client_id: CLIENT_ID,
      scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
      include_granted_scopes: false,
    });
    expect(google.requests).toEqual([{ prompt: 'select_account' }]);
    await settle();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0] ?? [];
    expect(url).toBe(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Tasks!A1%3AZ1000?valueRenderOption=FORMATTED_VALUE`,
    );
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer token-1' });
  });

  it('lets Google skip the account chooser when an account hint is set', async () => {
    const { user } = setup({ env: { VITE_GOOGLE_ACCOUNT_HINT: 'person@example.com' } });
    await connect(user);
    expect(google.clientConfig()?.login_hint).toBe('person@example.com');
    expect(google.requests).toEqual([{ prompt: '' }]);
  });

  it('explains a refused consent screen and does not read the sheet', async () => {
    google.nextPopup('deny');
    const { user, fetchImpl } = setup();
    await connect(user);
    expect(screen.getByRole('alert')).toHaveTextContent('Google access wasn’t granted');
    expect(screen.getByRole('button', { name: 'Connect Google account' })).toBeEnabled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('explains when the Sheets permission was unticked', async () => {
    google.nextPopup('no-scope');
    const { user, fetchImpl } = setup();
    await connect(user);
    expect(screen.getByRole('alert')).toHaveTextContent('Read access to your spreadsheets wasn’t ticked');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ['close', 'The Google sign-in window was closed'],
    ['blocked', 'The Google sign-in window was blocked'],
  ] as const)('explains a pop-up that was %s', async (outcome, message) => {
    google.nextPopup(outcome);
    const { user } = setup();
    await connect(user);
    expect(screen.getByRole('alert')).toHaveTextContent(message);
  });

  it('can cancel a sign-in that never finishes', async () => {
    google.nextPopup('wait');
    const { user } = setup();
    await connect(user);
    expect(screen.getByText('Finish signing in in the Google window…')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Connect Google account' })).toBeEnabled();
  });

  it('explains when Google’s library cannot load', async () => {
    google.load.mockReturnValueOnce(Promise.reject(new Error('Google sign-in could not be loaded.')));
    setup();
    await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('Google sign-in couldn’t load');
    expect(screen.getByRole('button', { name: 'Reload the page' })).toBeInTheDocument();
  });
});

describe('loading and errors on the first fetch', () => {
  it('shows a loading screen until the sheet arrives', async () => {
    let finish: (response: Response) => void = () => undefined;
    const pending = new Promise<Response>((resolve) => (finish = resolve));
    const { user } = setup({ fetchImpl: scriptedFetch(() => pending) });
    await connect(user);
    expect(screen.getByRole('heading', { level: 1, name: 'Loading your tasks…' })).toBeInTheDocument();
    finish(valuesResponse(sampleValues()));
    await settle();
    expect(screen.getByRole('heading', { level: 1, name: 'Your tasks' })).toBeInTheDocument();
  });

  it('shows an empty state for a sheet with only the header row', async () => {
    const { user } = setup({ fetchImpl: scriptedFetch(valuesResponse([HEADER])) });
    await connect(user);
    expect(screen.getByRole('heading', { name: 'No tasks yet' })).toBeInTheDocument();
    expect(screen.getByText('Showing 0 of 0 tasks')).toBeInTheDocument();
  });

  it('handles a wrong Google account and lets the user pick another one', async () => {
    const fetchImpl = scriptedFetch(
      errorResponse(403, 'PERMISSION_DENIED', 'The caller does not have permission'),
      valuesResponse(sampleValues()),
    );
    const { user } = setup({ fetchImpl });
    await connect(user);
    expect(screen.getByRole('heading', { level: 1, name: 'Couldn’t load your tasks' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('This Google account can’t open the tracker');

    await user.click(screen.getByRole('button', { name: 'Use a different Google account' }));
    expect(google.requests.at(-1)).toEqual({ prompt: 'select_account' });
    await settle();
    expect(screen.getByRole('heading', { level: 1, name: 'Your tasks' })).toBeInTheDocument();
    expect(vi.mocked(fetchImpl).mock.calls[1]?.[1]?.headers).toMatchObject({ Authorization: 'Bearer token-2' });
  });

  it('explains a changed header row, with the specific problem', async () => {
    const { user } = setup({
      fetchImpl: scriptedFetch(valuesResponse([['Task ID', 'Task', 'Status', 'Due', 'Last update', 'Notes']])),
    });
    await connect(user);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('The Tasks tab’s header row doesn’t match');
    expect(alert).toHaveTextContent('Missing column: “Deadline”.');
  });

  it('explains a disabled Sheets API', async () => {
    const { user } = setup({
      fetchImpl: scriptedFetch(
        errorResponse(403, 'PERMISSION_DENIED', 'Google Sheets API has not been used in project 1 before or it is disabled.', 'SERVICE_DISABLED'),
      ),
    });
    await connect(user);
    expect(screen.getByRole('alert')).toHaveTextContent('The Google Sheets API is turned off');
  });
});

describe('showing tasks', () => {
  it('shows active tasks, earliest deadline first, with counts by status', async () => {
    const { user } = setup();
    await connect(user);
    expect(cardTitles()).toEqual([
      'Plumber quote for kitchen tap',
      'Renew library card',
      'Order new passport photos',
      'Book dentist check-up',
      'Water the balcony plants',
    ]);
    expect(screen.getByText('Showing 5 of 6 tasks')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Open, 2 tasks' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Waiting on you, 2 tasks' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Waiting on someone else, 1 task' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Done, 1 task' })).not.toBeChecked();
    expect(screen.getByText('1 task has a recorded date in the past')).toBeInTheDocument();
    expect(screen.getByText('(none verified)')).toBeInTheDocument();
  });

  it('shows when the sheet was fetched and each row’s own last update, in the viewer’s timezone', async () => {
    const { user } = setup();
    await connect(user);
    expect(syncHeadline()).toBe('Synced with your sheet');
    expect(screen.getByText(/Last fetched 09:30 GMT\+5:30 \(just now\)/)).toBeInTheDocument();
    const card = screen.getByRole('article', { name: 'Renew library card' });
    expect(within(card).getByText('21 Oct 2026, 09:15 GMT+5:30')).toBeInTheDocument();
    expect(within(card).getByText('Thu, 29 Oct 2026')).toBeInTheDocument();
    expect(screen.getByText(/Times are shown in your timezone, Asia\/Kolkata \(GMT\+5:30\)/)).toBeInTheDocument();
  });

  it('keeps deadlines on the same calendar day in another timezone', async () => {
    const { user } = setup({ format: { locale: 'en-GB', timeZone: 'America/Los_Angeles' } });
    await connect(user);
    const card = screen.getByRole('article', { name: 'Renew library card' });
    expect(within(card).getByText('Thu, 29 Oct 2026')).toBeInTheDocument();
    expect(within(card).getByText('20 Oct 2026, 20:45 GMT-7')).toBeInTheDocument();
  });

  it('labels ongoing work and never shows done tasks as overdue', async () => {
    const { user } = setup();
    await connect(user);
    const ongoing = screen.getByRole('article', { name: 'Water the balcony plants' });
    expect(within(ongoing).getByText('Ongoing')).toBeInTheDocument();
    expect(within(ongoing).getByText('Ongoing, no fixed date')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /^Done/ }));
    const done = screen.getByRole('article', { name: 'Return borrowed camera' });
    expect(within(done).getByText('Thu, 15 Oct 2026')).toBeInTheDocument();
    // Its date is 6 days back, but a done task's date no longer counts as past.
    expect(within(done).queryByText('6 days ago')).not.toBeInTheDocument();
    expect(within(done).queryByText(/overdue/i)).not.toBeInTheDocument();
    const waiting = screen.getByRole('article', { name: 'Plumber quote for kitchen tap' });
    expect(within(waiting).getByText('3 days ago')).toBeInTheDocument();
  });

  it('renders notes as text and makes only https links clickable', async () => {
    const values = [
      HEADER,
      ['T1', 'Tricky notes', 'open', '', '', '<img src=x onerror="alert(1)"> <b>bold</b> see https://example.org/x.'],
    ];
    const { user, container } = setup({ fetchImpl: scriptedFetch(valuesResponse(values)) });
    await connect(user);
    await user.click(screen.getByRole('button', { name: /Show notes for Tricky notes/ }));
    expect(screen.getByText(/<img src=x onerror="alert\(1\)"> <b>bold<\/b> see/)).toBeInTheDocument();
    expect(container.querySelector('img, b')).toBeNull();
    expect(screen.getByRole('link', { name: 'https://example.org/x' })).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('shows each task’s links from the Links column, and finds them by search', async () => {
    const values = [
      [...HEADER, 'Links'],
      ['T1', 'Holiday comparison', 'done', '', '', 'Delivered.', 'Comparison: https://example.org/c ; Earlier draft: https://example.org/d'],
      ['T2', 'No links here', 'open'],
    ];
    const { user } = setup({ fetchImpl: scriptedFetch(valuesResponse(values)) });
    await connect(user);
    expect(within(screen.getByRole('article', { name: 'No links here' })).queryByRole('list', { name: /Links/ })).toBeNull();

    await user.type(screen.getByRole('searchbox'), 'earlier draft');
    await user.click(screen.getByRole('checkbox', { name: /^Done/ }));
    const card = screen.getByRole('article', { name: 'Holiday comparison' });
    const links = within(card).getByRole('list', { name: 'Links for Holiday comparison' });
    expect(within(links).getByRole('link', { name: 'Comparison' })).toHaveAttribute('href', 'https://example.org/c');
    expect(within(links).getByRole('link', { name: 'Earlier draft' })).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('lists problems in the sheet without hiding the rows', async () => {
    const values = [...sampleValues(), ['T7', 'Odd status', 'paused', 'next week']];
    const { user } = setup({ fetchImpl: scriptedFetch(valuesResponse(values)) });
    await connect(user);
    expect(screen.getByRole('article', { name: 'Odd status' })).toHaveTextContent('Unknown status: paused');
    expect(screen.getByText('2 problems found in the sheet')).toBeInTheDocument();
    expect(screen.getByText(/status “paused” is not one of/)).toBeInTheDocument();
  });

  it('uses cards on a phone and a table on a wide screen', async () => {
    const { user, unmount } = setup();
    await connect(user);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(5);
    unmount();

    setWideScreen(true);
    const wide = setup();
    await connect(wide.user);
    const table = screen.getByRole('table', { name: 'Tasks by financial priority' });
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual([
      'ID',
      'Task',
      'Status',
      'Recorded date',
      'Last update',
      'Notes',
    ]);
    expect(within(table).getAllByRole('row')).toHaveLength(6);
  });
});

describe('filters', () => {
  it('toggles statuses, including Done', async () => {
    const { user } = setup();
    await connect(user);
    await user.click(screen.getByRole('checkbox', { name: /^Done/ }));
    expect(cardTitles()).toContain('Return borrowed camera');
    expect(screen.getByText('Showing 6 of 6 tasks')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /^Waiting on you/ }));
    expect(cardTitles()).not.toContain('Book dentist check-up');
    expect(screen.getByText('Showing 4 of 6 tasks')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reset filters' }));
    expect(screen.getByText('Showing 5 of 6 tasks')).toBeInTheDocument();
  });

  it('searches task names and notes', async () => {
    const { user } = setup();
    await connect(user);
    await user.type(screen.getByRole('searchbox', { name: 'Search tasks and notes' }), 'morning');
    expect(cardTitles()).toEqual(['Book dentist check-up', 'Water the balcony plants']);
    expect(screen.getAllByText('matches your search')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Show notes for Book dentist check-up (matches your search)' })).toBeInTheDocument();

    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), 'camera');
    expect(screen.getByRole('heading', { name: 'No tasks match' })).toBeInTheDocument();
    expect(screen.getByText(/1 task matches with a status that is hidden right now/)).toBeInTheDocument();
  });

  it('groups tasks by recorded date', async () => {
    const { user } = setup();
    await connect(user);
    await user.click(screen.getByRole('radio', { name: 'By date' }));
    const group = (name: RegExp) =>
      within(screen.getByRole('region', { name })).queryAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(group(/^Recorded date passed/)).toEqual(['Plumber quote for kitchen tap']);
    expect(group(/^Next 7 days/)).toEqual([]);
    expect(screen.getByText('No recorded dates in the next 7 days.')).toBeInTheDocument();
    expect(group(/^Later/)).toEqual(['Renew library card', 'Order new passport photos']);
    expect(group(/^Ongoing/)).toEqual(['Water the balcony plants']);
    expect(group(/^No recorded date/)).toEqual(['Book dentist check-up']);
    expect(screen.queryByRole('region', { name: /^Done/ })).not.toBeInTheDocument();
    // The sort order belongs to the list views: this view is always grouped by date.
    expect(screen.queryByRole('radio', { name: 'Financial priority' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Why this order/)).not.toBeInTheDocument();
  });
});

describe('origin views', () => {
  it('offers You requested and Inbound next to All tasks and By date', async () => {
    const { user } = setupPlanning();
    await connect(user);
    const views = within(screen.getByRole('group', { name: 'View' })).getAllByRole('radio');
    expect(views.map((radio) => radio.closest('label')?.textContent)).toEqual([
      'Today',
      'All tasks',
      'By date',
      'You requested',
      'Inbound',
      'Review',
    ]);
    expect(screen.getByRole('radio', { name: 'All tasks' })).toBeChecked();
  });

  it('shows one origin at a time and keeps counting the tasks that have none', async () => {
    const { user } = setupPlanning();
    await connect(user);
    expect(screen.getByText('Showing 7 of 8 tasks')).toBeInTheDocument();
    expect(screen.getByText('Origin missing: 2 tasks.')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'You requested' }));
    expect(cardTitles()).toEqual([PLANNING.P03, PLANNING.P01]);
    expect(screen.getByText('Showing 2 of 8 tasks')).toBeInTheDocument();
    expect(screen.getByText('Origin missing: 2 tasks.').closest('p')).toHaveTextContent(
      'Origin missing: 2 tasks. Tasks without a valid Origin are in All tasks and By date, not in this view.',
    );

    await user.click(screen.getByRole('radio', { name: 'Inbound' }));
    expect(cardTitles()).toEqual([PLANNING.P07, PLANNING.P02, PLANNING.P06]);
    expect(screen.getByText('Showing 3 of 8 tasks')).toBeInTheDocument();
    expect(screen.getByText('Origin missing: 2 tasks.')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'All tasks' }));
    expect(cardTitles()).toHaveLength(7);
  });

  it('keeps rows with a blank or wrong Origin in All tasks, marked, and lists the wrong one as a problem', async () => {
    const { user } = setupPlanning();
    await connect(user);
    expect(within(card(PLANNING.P04)).getByText('Origin missing')).toBeInTheDocument();
    expect(within(card(PLANNING.P05)).getByText('Origin not recognised: vendor')).toBeInTheDocument();
    expect(within(card(PLANNING.P01)).getByText('You requested')).toBeInTheDocument();
    expect(within(card(PLANNING.P02)).getByText('Inbound')).toBeInTheDocument();
    expect(screen.getByText('1 problem found in the sheet')).toBeInTheDocument();
    expect(screen.getByText('Row 6 (P05): origin “vendor” is not one of: you requested, inbound.')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'By date' }));
    expect(cardTitles()).toContain(PLANNING.P04);
    expect(cardTitles()).toContain(PLANNING.P05);
  });

  it('keeps the status filters and the search working inside an origin view', async () => {
    const { user } = setupPlanning();
    await connect(user);
    await user.click(screen.getByRole('radio', { name: 'Inbound' }));
    await user.click(screen.getByRole('checkbox', { name: /^Waiting on you/ }));
    expect(cardTitles()).toEqual([PLANNING.P07, PLANNING.P06]);
    await user.click(screen.getByRole('button', { name: 'Reset filters' }));
    expect(screen.getByRole('radio', { name: 'Inbound' })).toBeChecked();
    expect(cardTitles()).toEqual([PLANNING.P07, PLANNING.P02, PLANNING.P06]);

    await user.type(screen.getByRole('searchbox'), 'permit');
    expect(cardTitles()).toEqual([PLANNING.P07]);
    await user.click(screen.getByRole('radio', { name: 'You requested' }));
    expect(screen.getByRole('heading', { name: 'No tasks match' })).toBeInTheDocument();
    expect(screen.getByText('Try a different word, or show more statuses.')).toBeInTheDocument();

    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), 'drill');
    expect(screen.getByText(/1 task matches with a status that is hidden right now/)).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /^Done/ }));
    expect(cardTitles()).toEqual([PLANNING.P08]);
  });

  it('counts statuses for the view on screen', async () => {
    const { user } = setupPlanning();
    await connect(user);
    const chips = () => screen.getAllByRole('checkbox').map((chip) => chip.getAttribute('aria-label'));
    expect(chips()).toEqual(['Open, 5 tasks', 'Waiting on you, 1 task', 'Waiting on someone else, 1 task', 'Done, 1 task']);

    await user.click(screen.getByRole('radio', { name: 'Inbound' }));
    expect(chips()).toEqual(['Open, 2 tasks', 'Waiting on you, 1 task', 'Waiting on someone else, 0 tasks', 'Done, 0 tasks']);

    await user.click(screen.getByRole('radio', { name: 'You requested' }));
    expect(chips()).toEqual(['Open, 1 task', 'Waiting on you, 0 tasks', 'Waiting on someone else, 1 task', 'Done, 1 task']);

    await user.click(screen.getByRole('radio', { name: 'By date' }));
    expect(chips()).toEqual(['Open, 5 tasks', 'Waiting on you, 1 task', 'Waiting on someone else, 1 task', 'Done, 1 task']);
  });

  it('offers Reset filters only when a filter is set', async () => {
    const values = [
      [...HEADER, 'Origin'],
      ['T1', 'Open and requested', 'open', '', '', '', 'you requested'],
      ['T2', 'Done and inbound', 'done', '', '', '', 'inbound'],
    ];
    const { user } = setup({ fetchImpl: scriptedFetch(valuesResponse(values)) });
    await connect(user);
    await user.click(screen.getByRole('radio', { name: 'Inbound' }));
    // The only inbound task is done, and the filters are as they started: nothing to reset.
    expect(screen.getByRole('heading', { name: 'No tasks match' })).toBeInTheDocument();
    expect(screen.getByText(/1 task matches with a status that is hidden right now/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reset filters' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /^Done/ }));
    expect(cardTitles()).toEqual(['Done and inbound']);
    await user.type(screen.getByRole('searchbox'), 'nothing like this');
    expect(screen.getByRole('heading', { name: 'No tasks match' })).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Reset filters' })[0] as HTMLElement);
    expect(screen.getByRole('radio', { name: 'Inbound' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /^Done/ })).not.toBeChecked();
  });

  it('counts the missing origins among the tasks that pass the filters', async () => {
    const { user } = setupPlanning();
    await connect(user);
    await user.type(screen.getByRole('searchbox'), 'insurance');
    expect(screen.getByText('Origin missing: 1 task.')).toBeInTheDocument();
    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), 'ladder');
    expect(screen.queryByText(/Origin missing:/)).not.toBeInTheDocument();
  });

  it('explains an origin view the sheet never uses, instead of showing an empty list', async () => {
    const { user } = setup();
    await connect(user);
    expect(screen.getByText('Origin missing: 5 tasks.')).toBeInTheDocument();
    expect(screen.getByText(/The Tasks tab has no Origin column yet, so You requested and Inbound stay empty/)).toBeInTheDocument();
    // Without the column, cards carry no origin badge.
    expect(screen.queryByText('Origin missing')).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Inbound' }));
    expect(screen.getByRole('heading', { name: 'No tasks marked “Inbound”' })).toBeInTheDocument();
    expect(screen.getByText(/Add one with “you requested” or “inbound” on each row/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show all tasks' }));
    expect(cardTitles()).toHaveLength(5);
  });
});

describe('priority order', () => {
  it('sorts by financial priority by default and says why on every card', async () => {
    const { user } = setupPlanning();
    await connect(user);
    expect(screen.getByRole('radio', { name: 'Financial priority' })).toBeChecked();
    expect(cardTitles()).toEqual([
      PLANNING.P07,
      PLANNING.P03,
      PLANNING.P01,
      PLANNING.P02,
      PLANNING.P04,
      PLANNING.P05,
      PLANNING.P06,
    ]);
    expect(why(card(PLANNING.P07))).toBe('Deadline basis, recorded date in 30 days (verified)');
    expect(why(card(PLANNING.P03))).toBe(
      'Opportunity, recorded date in 2 days (verified). Moved up by the fixed 7-day rule: its verified date is within 7 days.',
    );
    expect(why(card(PLANNING.P01))).toBe('Avoidable charge, recorded date in 3 days (not verified)');
    expect(why(card(PLANNING.P02))).toBe('Avoidable charge, no date recorded');
    expect(why(card(PLANNING.P04))).toBe('Opportunity, recorded date tomorrow (planning, not verified)');
    expect(why(card(PLANNING.P05))).toBe('Basis unknown, recorded date 2 days ago (not verified)');
    expect(why(card(PLANNING.P06))).toBe('Sunk or reference, no date recorded');
  });

  it('switches to the recorded-date order and back', async () => {
    const { user } = setupPlanning();
    await connect(user);
    await user.click(screen.getByRole('radio', { name: 'Recorded date' }));
    expect(cardTitles()).toEqual([
      PLANNING.P05,
      PLANNING.P04,
      PLANNING.P03,
      PLANNING.P01,
      PLANNING.P07,
      PLANNING.P02,
      PLANNING.P06,
    ]);
    expect(screen.queryByText(/Why this order/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Financial priority' }));
    expect(cardTitles()[0]).toBe(PLANNING.P07);
    expect(screen.getAllByText('Why this order:')).toHaveLength(7);
  });

  it('keeps the sort order when the view changes, and keeps done tasks last', async () => {
    const { user } = setupPlanning();
    await connect(user);
    await user.click(screen.getByRole('radio', { name: 'Recorded date' }));
    await user.click(screen.getByRole('radio', { name: 'Inbound' }));
    expect(cardTitles()).toEqual([PLANNING.P07, PLANNING.P02, PLANNING.P06]);
    expect(screen.getByRole('radio', { name: 'Recorded date' })).toBeChecked();

    await user.click(screen.getByRole('radio', { name: 'Financial priority' }));
    await user.click(screen.getByRole('radio', { name: 'You requested' }));
    await user.click(screen.getByRole('checkbox', { name: /^Done/ }));
    expect(cardTitles()).toEqual([PLANNING.P03, PLANNING.P01, PLANNING.P08]);
    expect(why(card(PLANNING.P08))).toBe('Done, not ranked');
  });

  it('is the same as the recorded-date order while the sheet has none of the new columns', async () => {
    const { user } = setup();
    await connect(user);
    const byPriority = cardTitles();
    expect(why(card('Renew library card'))).toBe('Basis unknown, recorded date in 8 days (not verified)');
    expect(why(card('Book dentist check-up'))).toBe('Basis unknown, no date recorded');
    await user.click(screen.getByRole('radio', { name: 'Recorded date' }));
    expect(cardTitles()).toEqual(byPriority);
  });

  it('explains its rules and says which columns the sheet does not have yet', async () => {
    const { user, unmount } = setup();
    await connect(user);
    await user.click(screen.getByText('How Financial priority works'));
    const help = screen.getByText('How Financial priority works').closest('details') as HTMLElement;
    expect(help).toHaveTextContent('It never reads amounts or dates out of Money at stake, Progress or other text');
    expect(help).toHaveTextContent(
      'One that is not verified only puts its task ahead of tasks with no date in the same basis group: it never outranks a verified date and never moves a task to another group.',
    );
    expect(help).toHaveTextContent('Neither a date nor a Money at stake entry proves a loss.');
    // What the order cannot tell you: the 7-day move is a fixed rule, not a comparison of what is at stake.
    expect(help).toHaveTextContent(
      'This is a fixed rule, not a judgement of how much is at stake. The dashboard cannot compare amounts, currencies or the real cost of an opportunity, so the order reflects only the basis label, the recorded date and whether that date is verified. The 7-day window is an arbitrary fixed threshold.',
    );
    expect(help).toHaveTextContent(
      'an opportunity task whose verified date is today or within the next 7 days goes above avoidable-charge and deadline tasks that have no verified date',
    );
    expect(help).toHaveTextContent('A verified date that has passed does not move a task up');
    expect(help).toHaveTextContent('Tasks with any other basis, a blank one included, are never moved, whatever their date.');
    expect(help).toHaveTextContent('When a verified date has passed, the dashboard does not know whether a consequence applies now.');
    expect(help).toHaveTextContent('The Tasks tab has no “Delay-cost basis” column yet, so every task counts as basis unknown.');
    expect(help).toHaveTextContent('The Tasks tab has no “Date verified” column yet, so no date counts as verified.');
    unmount();

    const full = setupPlanning();
    await connect(full.user);
    expect(screen.queryByText(/column yet/)).not.toBeInTheDocument();
  });

  it('calls the date a recorded date, with its verification, and never due, overdue or enforced', async () => {
    const { user } = setupPlanning();
    await connect(user);
    expect(within(line(card(PLANNING.P07), 'Recorded date')).getByText('Verified')).toBeInTheDocument();
    expect(within(line(card(PLANNING.P04), 'Recorded date')).getByText('Planning date')).toBeInTheDocument();
    expect(line(card(PLANNING.P04), 'Recorded date')).toHaveTextContent('Thu, 22 Oct 2026 Tomorrow Planning date');
    expect(line(card(PLANNING.P01), 'Recorded date')).toHaveTextContent('Sat, 24 Oct 2026 In 3 days Not verified');
    expect(line(card(PLANNING.P05), 'Recorded date')).toHaveTextContent('Mon, 19 Oct 2026 2 days ago Not verified');
    expect(line(card(PLANNING.P02), 'Recorded date')).toHaveTextContent(/^Recorded dateNo recorded date$/);

    const everything = () => document.body.textContent ?? '';
    expect(everything()).not.toMatch(/overdue|\bdue\b|enforced/i);
    await user.click(screen.getByRole('radio', { name: 'Recorded date' }));
    expect(everything()).not.toMatch(/overdue|\bdue\b|enforced/i);
    await user.click(screen.getByRole('radio', { name: 'By date' }));
    expect(everything()).not.toMatch(/overdue|\bdue\b|enforced/i);
    expect(screen.getByRole('region', { name: /^Recorded date passed/ })).toHaveTextContent(PLANNING.P05);
  });

  it('counts recorded dates in the past and says how many of them are verified', async () => {
    const { user, unmount } = setupPlanning();
    await connect(user);
    expect(screen.getByText('1 task has a recorded date in the past')).toBeInTheDocument();
    expect(screen.getByText('(none verified)').closest('p')?.className).toBe('date-note');
    await user.click(screen.getByRole('button', { name: 'See by date' }));
    expect(screen.getByRole('radio', { name: 'By date' })).toBeChecked();
    unmount();

    const values = [
      [...HEADER, 'Date verified'],
      ['T1', 'Past and verified', 'open', '2026-10-19', '', '', 'verified'],
      ['T2', 'Past, planning only', 'open', '2026-10-20', '', '', 'planning'],
      ['T3', 'Past but finished', 'done', '2026-10-01', '', '', 'verified'],
    ];
    const second = setup({ fetchImpl: scriptedFetch(valuesResponse(values)) });
    await connect(second.user);
    expect(screen.getByText('2 tasks have a recorded date in the past')).toBeInTheDocument();
    // A verified date that has passed is counted, not raised as an alarm: same note, same colour.
    expect(screen.getByText('(1 verified)').closest('p')?.className).toBe('date-note');
    expect(within(card('Past and verified')).getByText('2 days ago').className).toBe('badge badge--warning');
    expect(within(card('Past, planning only')).getByText('Yesterday').className).toBe('badge badge--warning');
  });

  it('moves a task up only for a verified date from today to 7 days ahead, and says a passed one has passed', async () => {
    const values = [
      [...HEADER, 'Delay-cost basis', 'Date verified', 'Money at stake'],
      ['T1', 'Charge with no date', 'open', '', '', '', 'avoidable charge', '', 'A large amount'],
      ['T2', 'Opportunity, verified, 8 days ahead', 'open', '2026-10-29', '', '', 'opportunity', 'verified', 'A large amount'],
      ['T3', 'Opportunity, verified, 7 days ahead', 'open', '2026-10-28', '', '', 'opportunity', 'verified', 'A small amount'],
      ['T4', 'Opportunity, verified, 3 days back', 'open', '2026-10-18', '', '', 'opportunity', 'verified', 'A large amount'],
      ['T5', 'Opportunity, verified, today', 'open', '2026-10-21', '', '', 'opportunity', 'verified', ''],
      ['T6', 'Charge, verified, 3 days back', 'open', '2026-10-18', '', '', 'avoidable charge', 'verified', ''],
    ];
    const { user } = setup({ fetchImpl: scriptedFetch(valuesResponse(values)) });
    await connect(user);
    expect(cardTitles()).toEqual([
      'Charge, verified, 3 days back',
      'Opportunity, verified, today',
      'Opportunity, verified, 7 days ahead',
      'Charge with no date',
      'Opportunity, verified, 3 days back',
      'Opportunity, verified, 8 days ahead',
    ]);
    const moved = 'Moved up by the fixed 7-day rule: its verified date is within 7 days.';
    const passed = 'The date has passed; the dashboard does not know whether a consequence applies now.';
    expect(why(card('Opportunity, verified, today'))).toBe(`Opportunity, recorded date today (verified). ${moved}`);
    expect(why(card('Opportunity, verified, 7 days ahead'))).toBe(`Opportunity, recorded date in 7 days (verified). ${moved}`);
    expect(why(card('Opportunity, verified, 8 days ahead'))).toBe('Opportunity, recorded date in 8 days (verified)');
    expect(why(card('Opportunity, verified, 3 days back'))).toBe(`Opportunity, recorded date 3 days ago (verified). ${passed}`);
    expect(why(card('Charge, verified, 3 days back'))).toBe(`Avoidable charge, recorded date 3 days ago (verified). ${passed}`);
    expect(why(card('Charge with no date'))).toBe('Avoidable charge, no date recorded');
    // Nothing on the page words a passed date as a missed one.
    expect(document.body.textContent ?? '').not.toMatch(/overdue|\bdue\b|enforced|missed|too late/i);
  });
});

describe('a verified date that has passed', () => {
  const PASSED = 'The date has passed; the dashboard does not know whether a consequence applies now.';
  const MOVED = 'Moved up by the fixed 7-day rule: its verified date is within 7 days.';
  const values = [
    [...HEADER, 'Delay-cost basis', 'Date verified'],
    ['T1', 'Verified and passed', 'open', '2026-10-18', '', '', 'opportunity', 'verified'],
    ['T2', 'Planning and passed', 'open', '2026-10-19', '', '', 'opportunity', 'planning'],
    ['T3', 'Verified and ahead', 'open', '2026-10-30', '', '', 'opportunity', 'verified'],
  ];

  it('says so once on the task in every view, including those without the "why this order" line', async () => {
    const { user } = setup({ fetchImpl: scriptedFetch(valuesResponse(values)) });
    await connect(user);
    const passedOn = (title: string) => within(card(title)).queryAllByText(PASSED, { exact: false }).length;

    // Financial priority: the why line says it, so the date line does not repeat it.
    expect(why(card('Verified and passed'))).toBe(`Opportunity, recorded date 3 days ago (verified). ${PASSED}`);
    expect(line(card('Verified and passed'), 'Recorded date')).toHaveTextContent(/^Recorded dateSun, 18 Oct 2026 3 days ago Verified$/);
    expect(['Verified and passed', 'Planning and passed', 'Verified and ahead'].map(passedOn)).toEqual([1, 0, 0]);

    // Recorded date order has no why line: the date line carries the sentence.
    await user.click(screen.getByRole('radio', { name: 'Recorded date' }));
    expect(screen.queryByText(/Why this order/)).not.toBeInTheDocument();
    expect(line(card('Verified and passed'), 'Recorded date')).toHaveTextContent(
      `Recorded dateSun, 18 Oct 2026 3 days ago Verified${PASSED}`,
    );
    expect(['Verified and passed', 'Planning and passed', 'Verified and ahead'].map(passedOn)).toEqual([1, 0, 0]);

    // So does the By date view, where "See by date" leads.
    await user.click(screen.getByRole('button', { name: 'See by date' }));
    const group = screen.getByRole('region', { name: /^Recorded date passed/ });
    expect(within(group).getByRole('article', { name: 'Verified and passed' })).toHaveTextContent(PASSED);
    expect(['Verified and passed', 'Planning and passed', 'Verified and ahead'].map(passedOn)).toEqual([1, 0, 0]);
  });

  it('says so once on short cards too, closed and open, in Today and in Review', async () => {
    const short = [
      [...HEADER, 'Delay-cost basis', 'Date verified'],
      ['T1', 'Mine, verified and passed', 'waiting on you', '2026-10-18', '', '', 'opportunity', 'verified'],
      ['T2', 'Theirs, verified and passed', 'waiting on someone else', '2026-10-18', '', '', '', 'verified'],
      ['T3', 'Theirs, planning and passed', 'waiting on someone else', '2026-10-19', '', '', '', 'planning'],
    ];
    const { user } = setup({ fetchImpl: scriptedFetch(valuesResponse(short)) });
    await connectOnly(user);
    const titles = ['Mine, verified and passed', 'Theirs, verified and passed', 'Theirs, planning and passed'];
    const times = () => titles.map((title) => (card(title).textContent ?? '').split(PASSED).length - 1);
    const openAll = async () => {
      for (const button of screen.getAllByRole('button', { name: /^Show details for/ })) await user.click(button);
    };
    const closeAll = async () => {
      for (const button of screen.getAllByRole('button', { name: /^Hide details for/ })) await user.click(button);
    };

    // Today: Your move (which shows the why line once open) and Chase (which never does).
    expect(times()).toEqual([1, 1, 0]);
    await openAll();
    expect(why(card('Mine, verified and passed'))).toContain(PASSED);
    expect(times()).toEqual([1, 1, 0]);
    await closeAll();

    // Review: all three are flagged (no update recorded), none shows the why line.
    await user.click(screen.getByRole('radio', { name: 'Review' }));
    expect(cardTitles().sort()).toEqual([...titles].sort());
    expect(times()).toEqual([1, 1, 0]);
    await openAll();
    expect(times()).toEqual([1, 1, 0]);
  });

  it('says so once per row in the wide table, in both sort orders', async () => {
    setWideScreen(true);
    const { user } = setup({ fetchImpl: scriptedFetch(valuesResponse(values)) });
    await connect(user);
    const times = () =>
      ['Verified and passed', 'Planning and passed', 'Verified and ahead'].map((title) => {
        const row = screen.getByRole('rowheader', { name: new RegExp(`^${title}`) }).closest('tr') as HTMLElement;
        return (row.textContent ?? '').split(PASSED).length - 1;
      });
    expect(times()).toEqual([1, 0, 0]);
    await user.click(screen.getByRole('radio', { name: 'Recorded date' }));
    expect(screen.queryByText(/Why this order/)).not.toBeInTheDocument();
    expect(times()).toEqual([1, 0, 0]);
  });

  it('follows the calendar: after midnight a date that was today has passed, and its move has ended', async () => {
    const today = [
      [...HEADER, 'Delay-cost basis', 'Date verified'],
      ['T1', 'Charge with no date', 'open', '', '', '', 'avoidable charge', ''],
      ['T2', 'Opportunity dated today', 'open', '2026-10-21', '', '', 'opportunity', 'verified'],
    ];
    const { user } = setup({ fetchImpl: scriptedFetch(valuesResponse(today)) });
    await connect(user);
    expect(cardTitles()).toEqual(['Opportunity dated today', 'Charge with no date']);
    expect(why(card('Opportunity dated today'))).toBe(`Opportunity, recorded date today (verified). ${MOVED}`);

    // It is 09:30 in India. Fifteen hours on, with the page left open, it is 00:30 the next day.
    await settle(15 * 3_600_000);
    expect(cardTitles()).toEqual(['Charge with no date', 'Opportunity dated today']);
    expect(why(card('Opportunity dated today'))).toBe(`Opportunity, recorded date yesterday (verified). ${PASSED}`);
    expect(screen.getByText('1 task has a recorded date in the past')).toBeInTheDocument();
  });
});

describe('progress on each task', () => {
  it('shows Progress, Money at stake, Hands-on effort and Expected finish as separate labelled lines', async () => {
    const { user } = setupPlanning();
    await connect(user);
    const ladder = card(PLANNING.P01);
    expect(line(ladder, 'Progress')).toHaveTextContent(/^ProgressReturn slot booked\.$/);
    expect(line(ladder, 'Money at stake')).toHaveTextContent(/^Money at stakeLate-return fee for each extra day Basis: avoidable charge$/);
    expect(line(ladder, 'Hands-on effort')).toHaveTextContent(/^Hands-on effort20 minutes$/);
    expect(line(ladder, 'Expected finish')).toHaveTextContent(
      /^Expected finishThis SaturdayIncludes any waiting on others, not just hands-on time\.$/,
    );
    expect(within(card(PLANNING.P07)).getByText('Basis: deadline')).toBeInTheDocument();
    expect(within(card(PLANNING.P06)).getByText('Basis: sunk or reference')).toBeInTheDocument();
    expect(within(card(PLANNING.P05)).getByText('Basis unknown')).toBeInTheDocument();
  });

  it('says when a cell is blank, and when the finish includes waiting on someone else', async () => {
    const { user } = setupPlanning();
    await connect(user);
    const club = card(PLANNING.P03);
    expect(line(club, 'Money at stake')).toHaveTextContent(/^Money at stakeNot recorded Basis: opportunity$/);
    expect(line(club, 'Hands-on effort')).toHaveTextContent(/^Hands-on effortNot recorded$/);
    expect(line(club, 'Expected finish')).toHaveTextContent(/^Expected finishEnd of next week Includes waiting on someone else$/);
    // No finish recorded: nothing is guessed, and there is no waiting note.
    expect(line(card(PLANNING.P02), 'Expected finish')).toHaveTextContent(/^Expected finishNot recorded$/);
    expect(line(card(PLANNING.P02), 'Progress')).toHaveTextContent(/^ProgressNot recorded$/);
  });

  it('folds long text behind a toggle like the notes one', async () => {
    const { user } = setupPlanning();
    await connect(user);
    const club = card(PLANNING.P03);
    expect(screen.getAllByRole('button', { name: /^Show full text for/ })).toHaveLength(1);
    const toggle = within(club).getByRole('button', { name: `Show full text for ${PLANNING.P03}` });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(line(club, 'Progress')).toHaveTextContent(/before it can be posted,…$/);
    expect(within(club).queryByRole('link', { name: 'https://example.org/club/checklist' })).not.toBeInTheDocument();

    await user.click(toggle);
    expect(within(club).getByRole('button', { name: `Show less text for ${PLANNING.P03}` })).toHaveAttribute('aria-expanded', 'true');
    expect(line(club, 'Progress')).toHaveTextContent(/and bring a pencil\.$/);
    expect(within(club).getByRole('link', { name: 'https://example.org/club/checklist' })).toHaveAttribute(
      'rel',
      'noopener noreferrer',
    );

    await user.click(within(club).getByRole('button', { name: `Show less text for ${PLANNING.P03}` }));
    expect(line(club, 'Progress')).toHaveTextContent(/before it can be posted,…$/);
  });

  it('finds tasks by these lines and flags a match that is folded away', async () => {
    const { user } = setupPlanning();
    await connect(user);
    await user.type(screen.getByRole('searchbox'), 'scanned');
    expect(cardTitles()).toEqual([PLANNING.P06]);
    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), 'pencil');
    expect(cardTitles()).toEqual([PLANNING.P03]);
    await user.click(screen.getByRole('button', { name: `Show full text for ${PLANNING.P03} (matches your search)` }));
    // Once the text is open the match is on screen, so the hint goes.
    expect(screen.getByRole('button', { name: `Show less text for ${PLANNING.P03}` })).toBeInTheDocument();
    expect(screen.queryByText('matches your search')).not.toBeInTheDocument();
  });

  it('shows the text as written: no HTML, no reading of amounts, only https links', async () => {
    const values = [
      [...HEADER, 'Progress', 'Money at stake', 'Delay-cost basis'],
      ['T1', 'Tricky text', 'open', '', '', '', '<img src=x onerror="alert(1)"> see https://example.org/p or http://example.org/q', '1,250.00 by 2026-10-22?', 'unknown'],
    ];
    const { user, container } = setup({ fetchImpl: scriptedFetch(valuesResponse(values)) });
    await connect(user);
    const tricky = card('Tricky text');
    expect(line(tricky, 'Progress')).toHaveTextContent('<img src=x onerror="alert(1)"> see https://example.org/p or http://example.org/q');
    expect(container.querySelector('img')).toBeNull();
    expect(within(tricky).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['https://example.org/p']);
    expect(line(tricky, 'Money at stake')).toHaveTextContent(/^Money at stake1,250\.00 by 2026-10-22\? Basis unknown$/);
    // The date written in the text is not the task's date.
    expect(why(tricky)).toBe('Basis unknown, no date recorded');
    expect(line(tricky, 'Recorded date')).toHaveTextContent('No recorded date');
  });

  it('adds no lines for columns the sheet does not have, and lists which optional columns it found', async () => {
    const { user, unmount } = setup();
    await connect(user);
    const library = card('Renew library card');
    for (const label of ['Progress', 'Money at stake', 'Hands-on effort', 'Expected finish']) {
      expect(within(library).queryByText(label)).not.toBeInTheDocument();
    }
    expect(screen.queryByText(/^Basis/, { selector: '.badge' })).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'Optional columns found in the Tasks tab: none. Not found, so not shown: Links, Origin, Money at stake, Progress, Hands-on effort, Delay-cost basis, Expected finish incl. waits, Date verified, Area, Start, Next step.',
      ),
    ).toBeInTheDocument();
    unmount();

    const planning = setupPlanning();
    await connect(planning.user);
    expect(
      screen.getByText(
        `Optional columns found in the Tasks tab: ${FULL_HEADER.slice(HEADER.length).join(', ')}. Not found, so not shown: Area, Start, Next step.`,
      ),
    ).toBeInTheDocument();
    planning.unmount();

    const life = setupLife();
    await connect(life.user);
    expect(screen.getByText(`Optional columns found in the Tasks tab: ${LIFE_HEADER.slice(HEADER.length).join(', ')}.`)).toBeInTheDocument();
  });

  it('adds a line only for a column the sheet has, even when it has just one of them', async () => {
    const one = async (header: string, value: string) => {
      const view = setup({ fetchImpl: scriptedFetch(valuesResponse([[...HEADER, header], ['T1', 'One column', 'open', '', '', '', value]])) });
      await connect(view.user);
      return view;
    };
    const labels = ['Progress', 'Money at stake', 'Delay-cost basis', 'Hands-on effort', 'Expected finish'];
    const shown = () => labels.filter((label) => within(card('One column')).queryByText(label, { selector: 'dt' }) !== null);

    // A basis without a Money at stake column gets its own line: no "Money at stake" line for a column that is not there.
    let view = await one('Delay-cost basis', 'opportunity');
    expect(shown()).toEqual(['Delay-cost basis']);
    expect(line(card('One column'), 'Delay-cost basis')).toHaveTextContent(/^Delay-cost basisBasis: opportunity$/);
    expect(screen.getByText(/^Optional columns found in the Tasks tab: Delay-cost basis\. Not found, so not shown: Links, Origin, Money at stake,/)).toBeInTheDocument();
    view.unmount();

    view = await one('Money at stake', 'A refundable fee');
    expect(shown()).toEqual(['Money at stake']);
    expect(line(card('One column'), 'Money at stake')).toHaveTextContent(/^Money at stakeA refundable fee$/);
    expect(screen.queryByText(/^Basis/, { selector: '.badge' })).not.toBeInTheDocument();
    view.unmount();

    view = await one('Hands-on effort', '10 minutes');
    expect(shown()).toEqual(['Hands-on effort']);
    view.unmount();

    view = await one('Expected finish incl. waits', 'Friday');
    expect(shown()).toEqual(['Expected finish']);
    view.unmount();

    view = await one('Progress', 'Started.');
    expect(shown()).toEqual(['Progress']);
  });

  it('says the finish includes waiting on someone else only when that is the task’s status', async () => {
    const values = [
      [...HEADER, 'Expected finish incl. waits'],
      ['T1', 'Waiting on me', 'waiting on you', '', '', '', 'Friday'],
      ['T2', 'Waiting on them', 'waiting on someone else', '', '', '', 'Next month'],
      ['T3', 'Finished', 'done', '', '', '', 'Last week'],
    ];
    const { user } = setup({ fetchImpl: scriptedFetch(valuesResponse(values)) });
    await connect(user);
    await user.click(screen.getByRole('checkbox', { name: /^Done/ }));
    const general = 'Includes any waiting on others, not just hands-on time.';
    expect(line(card('Waiting on me'), 'Expected finish')).toHaveTextContent(`Expected finishFriday${general}`);
    expect(line(card('Finished'), 'Expected finish')).toHaveTextContent(`Expected finishLast week${general}`);
    expect(line(card('Waiting on them'), 'Expected finish')).toHaveTextContent(/^Expected finishNext month Includes waiting on someone else$/);
    expect(screen.getAllByText('Includes waiting on someone else')).toHaveLength(1);
  });

  it('shows a Date verified value it does not recognise on the task, not as a blank one', async () => {
    const values = [
      [...HEADER, 'Date verified'],
      ['T1', 'Checkbox column', 'open', '2026-10-24', '', '', 'TRUE'],
      ['T2', 'Odd value, no date', 'open', '', '', '', 'maybe'],
      ['T3', 'Blank cell', 'open', '2026-10-24'],
    ];
    const { user } = setup({ fetchImpl: scriptedFetch(valuesResponse(values)) });
    await connect(user);
    expect(line(card('Checkbox column'), 'Recorded date')).toHaveTextContent(
      /^Recorded dateSat, 24 Oct 2026 In 3 days Date verified not recognised: TRUE$/,
    );
    expect(line(card('Odd value, no date'), 'Recorded date')).toHaveTextContent(
      /^Recorded dateNo recorded date Date verified not recognised: maybe$/,
    );
    expect(line(card('Blank cell'), 'Recorded date')).toHaveTextContent(/^Recorded dateSat, 24 Oct 2026 In 3 days Not verified$/);
    // Either way the date is ranked as not verified.
    expect(why(card('Checkbox column'))).toBe('Basis unknown, recorded date in 3 days (not verified)');
    expect(screen.getByText('2 problems found in the sheet')).toBeInTheDocument();
  });

  it('puts the lines in one table column on a wide screen', async () => {
    setWideScreen(true);
    const { user } = setupPlanning();
    await connect(user);
    const table = screen.getByRole('table', { name: 'Tasks by financial priority' });
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual([
      'ID',
      'Task',
      'Status',
      'Recorded date',
      'Last update',
      'Progress and notes',
    ]);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((row) => within(row).getByRole('rowheader').querySelector('span')?.textContent)).toEqual([
      PLANNING.P07,
      PLANNING.P03,
      PLANNING.P01,
      PLANNING.P02,
      PLANNING.P04,
      PLANNING.P05,
      PLANNING.P06,
    ]);
    const ladder = rows[2] as HTMLElement;
    // The row header is read out for every cell of the row, so it holds only the name and badges.
    expect(within(ladder).getByRole('rowheader')).toHaveTextContent(/^Return the rented ladder You requested$/);
    expect(ladder.querySelector('td:last-child')).toHaveTextContent(
      /^Why this order: Avoidable charge, recorded date in 3 days \(not verified\)Progress/,
    );
    expect(line(ladder, 'Progress')).toHaveTextContent('Return slot booked.');
    expect(within(ladder).getByText('Basis: avoidable charge')).toBeInTheDocument();
    expect(within(ladder).getByText('Not verified')).toBeInTheDocument();
    expect(within(ladder).getByRole('button', { name: `Show notes for ${PLANNING.P01}` })).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Recorded date' }));
    expect(screen.getByRole('table', { name: 'Tasks, earliest recorded date first' })).toBeInTheDocument();
    expect(screen.queryByText(/Why this order/)).not.toBeInTheDocument();
  });
});

/** The task names in one group of the Today view, in order. */
const group = (name: RegExp) =>
  within(screen.getByRole('region', { name })).queryAllByRole('heading', { level: 3 }).map((h) => h.textContent);

describe('today view', () => {
  it('opens on Today: your move, the next 7 days and who to chase, each task once', async () => {
    const { user } = setupLife();
    await connectOnly(user);
    expect(screen.getByRole('radio', { name: 'Today' })).toBeChecked();
    expect(group(/^Your move/)).toEqual([LIFE.L02, LIFE.L01]);
    // Verified dates first, then the rest by date. L11 is waiting on someone else, but its date is this week.
    expect(group(/^Next 7 days/)).toEqual([LIFE.L04, LIFE.L03, LIFE.L11, LIFE.L10]);
    // The longest without an update first.
    expect(group(/^Chase/)).toEqual([LIFE.L05, LIFE.L06]);
    expect(new Set(cardTitles()).size).toBe(8);
    expect(cardTitles()).toHaveLength(8);
    expect(screen.getByRole('heading', { level: 2, name: 'Your move 2' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Next 7 days 4' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Chase 2' })).toBeInTheDocument();
    expect(screen.getByText('Showing 8 of 11 tasks')).toBeInTheDocument();
  });

  it('has no status chips or sort order, and says how many tasks it leaves out', async () => {
    const { user } = setupLife();
    await connectOnly(user);
    expect(screen.queryByRole('checkbox', { name: /^Done/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Financial priority' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Why this order/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Origin missing/)).not.toBeInTheDocument();
    // Done (L09) and not started (L08) are left out; L07 is not waiting on anyone and has no date.
    expect(cardTitles()).not.toContain(LIFE.L07);
    expect(
      screen.getByText(
        /^1 more task that is not done is not on this screen: not waiting on anyone, and no recorded date in the next 7 days\.$/,
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'See all tasks' }));
    expect(screen.getByRole('radio', { name: 'All tasks' })).toBeChecked();
    expect(cardTitles()).toContain(LIFE.L07);
    expect(screen.getByRole('checkbox', { name: /^Done/ })).toBeInTheDocument();
  });

  it('keeps each card short: next step, area and date up front, the rest behind Show details', async () => {
    const { user } = setupLife();
    await connectOnly(user);
    const boiler = card(LIFE.L01);
    expect(boiler).toHaveTextContent('Next step: Ring the engineer for a slot');
    expect(within(boiler).getByText('Home').className).toContain('badge--area');
    expect(within(boiler).getByText('Waiting on you')).toBeInTheDocument();
    // No date is recorded, so the short card has no date line; notes and the rest are behind the toggle.
    expect(within(boiler).queryByText('Recorded date')).not.toBeInTheDocument();
    expect(within(boiler).queryByText('Last update')).not.toBeInTheDocument();
    expect(within(boiler).queryByRole('button', { name: /notes/i })).not.toBeInTheDocument();
    expect(within(boiler).queryByText('Origin missing')).not.toBeInTheDocument();

    const toggle = within(boiler).getByRole('button', { name: `Show details for ${LIFE.L01}` });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById(toggle.getAttribute('aria-controls') ?? '')).not.toBeVisible();
    await user.click(toggle);
    const hide = within(boiler).getByRole('button', { name: `Hide details for ${LIFE.L01}` });
    expect(hide).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(hide.getAttribute('aria-controls') ?? '')).toBeVisible();
    expect(line(boiler, 'Recorded date')).toHaveTextContent('No recorded date');
    expect(line(boiler, 'Last update')).toHaveTextContent('20 Oct 2026, 09:00 GMT+5:30');
    expect(line(boiler, 'Money at stake')).toHaveTextContent('Not recorded');
    expect(within(boiler).getByText('Origin missing')).toBeInTheDocument();
    await user.click(within(boiler).getByRole('button', { name: `Show notes for ${LIFE.L01}` }));
    expect(within(boiler).getByText('The engineer prefers mornings.')).toBeVisible();

    await user.click(hide);
    expect(within(boiler).queryByText('Last update')).not.toBeInTheDocument();
    // Opening one card leaves the others closed.
    expect(screen.getAllByRole('button', { name: /^Show details for/ })).toHaveLength(8);
  });

  it('shows a recorded date on the short card, and the last update where a task is waiting on someone', async () => {
    const { user } = setupLife();
    await connectOnly(user);
    const form = card(LIFE.L02);
    expect(line(form, 'Recorded date')).toHaveTextContent('Fri, 23 Oct 2026 In 2 days Verified');
    expect(within(form).queryByText('Last update')).not.toBeInTheDocument();
    const cleaning = card(LIFE.L03);
    expect(line(cleaning, 'Recorded date')).toHaveTextContent('Thu, 22 Oct 2026 Tomorrow Planning date');
    // Chase cards say how long it has been.
    const latch = card(LIFE.L05);
    expect(line(latch, 'Last update')).toHaveTextContent('(41 days ago)');
    expect(within(latch).queryByText('Recorded date')).not.toBeInTheDocument();
    expect(line(card(LIFE.L06), 'Recorded date')).toHaveTextContent('Sun, 15 Nov 2026 Not verified');
  });

  it('narrows to the search and flags a match that is behind Show details', async () => {
    const { user } = setupLife();
    await connectOnly(user);
    await user.type(screen.getByRole('searchbox'), 'mornings');
    expect(cardTitles()).toEqual([LIFE.L01]);
    expect(screen.getByText('Showing 1 of 11 tasks')).toBeInTheDocument();
    // The other two groups are empty because of the search, and say so.
    expect(screen.getAllByText('No task here matches the search or area.')).toHaveLength(2);
    expect(screen.queryByText(/more task/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: `Show details for ${LIFE.L01} (matches your search)` }));
    // Open, the hint moves to where the word is: the notes.
    expect(screen.getByRole('button', { name: `Hide details for ${LIFE.L01}` })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `Show notes for ${LIFE.L01} (matches your search)` })).toBeInTheDocument();

    // A word that is on the short card needs no hint.
    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), 'railcard');
    expect(cardTitles()).toEqual([LIFE.L04]);
    expect(screen.queryByText('matches your search')).not.toBeInTheDocument();
  });

  it('says so when nothing matches, and when the only match has not started yet', async () => {
    const { user } = setupLife();
    await connectOnly(user);
    await user.type(screen.getByRole('searchbox'), 'zebra');
    expect(screen.getByRole('heading', { name: 'No tasks match' })).toBeInTheDocument();
    expect(screen.getByText('Try a different word or another area.')).toBeInTheDocument();
    expect(screen.getByText('Showing 0 of 11 tasks')).toBeInTheDocument();

    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), 'allotment');
    expect(screen.getByRole('heading', { name: 'No tasks match' })).toBeInTheDocument();
    expect(screen.getByText('1 matching task has not started yet: tick “Not started yet” to see it.')).toBeInTheDocument();

    await user.click(within(screen.getByRole('main')).getAllByRole('button', { name: 'Reset filters' })[0] as HTMLElement);
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(cardTitles()).toHaveLength(8);
    expect(screen.queryByRole('button', { name: 'Reset filters' })).not.toBeInTheDocument();
  });

  it('works on a sheet with none of the optional columns', async () => {
    const { user } = setup();
    await connectOnly(user);
    expect(group(/^Your move/)).toEqual(['Order new passport photos', 'Book dentist check-up']);
    expect(group(/^Next 7 days/)).toEqual([]);
    expect(screen.getByText('No other recorded dates in the next 7 days.')).toBeInTheDocument();
    expect(group(/^Chase/)).toEqual(['Plumber quote for kitchen tap']);
    expect(screen.getByText('Showing 3 of 6 tasks')).toBeInTheDocument();
    expect(screen.getByText(/^2 more tasks that are not done are not on this screen/)).toBeInTheDocument();
    // No lines, badges or controls for columns the sheet does not have.
    expect(document.querySelector('.next-step')).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Area' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /not started/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /calendar/i })).not.toBeInTheDocument();
  });

  it('says when a group is empty, and keeps the count of past dates in view', async () => {
    const values = [
      [...HEADER, 'Date verified'],
      ['T1', 'Past and verified', 'open', '2026-10-19', '', '', 'verified'],
      ['T2', 'No date at all', 'open', '', '', '', ''],
    ];
    const { user } = setup({ fetchImpl: scriptedFetch(valuesResponse(values)) });
    await connectOnly(user);
    expect(screen.getByText('Nothing is waiting on you.')).toBeInTheDocument();
    expect(screen.getByText('No other recorded dates in the next 7 days.')).toBeInTheDocument();
    expect(screen.getByText('Nothing else is waiting on someone else.')).toBeInTheDocument();
    expect(cardTitles()).toEqual([]);
    // A date that has passed is not in "Next 7 days", but it is still counted, in amber, with a way to see it.
    expect(screen.getByText('1 task has a recorded date in the past')).toBeInTheDocument();
    expect(screen.getByText(/^2 more tasks that are not done are not on this screen/)).toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toMatch(/overdue|\bdue\b|enforced|missed|too late/i);
    await user.click(screen.getByRole('button', { name: 'See by date' }));
    expect(screen.getByRole('region', { name: /^Recorded date passed/ })).toHaveTextContent('Past and verified');
  });

  it('orders Your move by financial priority, and an open card says why', async () => {
    const values = [
      [...HEADER, 'Delay-cost basis', 'Date verified'],
      ['T1', 'No basis', 'waiting on you', '', '', '', '', ''],
      ['T2', 'Opportunity, verified, in 2 days', 'waiting on you', '2026-10-23', '', '', 'opportunity', 'verified'],
      ['T3', 'Charge, verified, 2 days back', 'waiting on you', '2026-10-19', '', '', 'avoidable charge', 'verified'],
      ['T4', 'Someone else, no date', 'waiting on someone else', '', '', '', 'avoidable charge', ''],
    ];
    const { user } = setup({ fetchImpl: scriptedFetch(valuesResponse(values)) });
    await connectOnly(user);
    expect(screen.getByText('Waiting on you, in Financial priority order.')).toBeInTheDocument();
    expect(group(/^Your move/)).toEqual(['Charge, verified, 2 days back', 'Opportunity, verified, in 2 days', 'No basis']);

    // Closed, a card has no "why" line; a verified date that has passed says so on the date itself.
    const passed = 'The date has passed; the dashboard does not know whether a consequence applies now.';
    const charge = card('Charge, verified, 2 days back');
    expect(screen.queryByText(/Why this order/)).not.toBeInTheDocument();
    expect(line(charge, 'Recorded date')).toHaveTextContent(passed);

    // Open, the "why" line says it instead: once on the card, not twice.
    await user.click(within(charge).getByRole('button', { name: /^Show details for/ }));
    expect(why(charge)).toBe(`Avoidable charge, recorded date 2 days ago (verified). ${passed}`);
    expect((charge.textContent ?? '').split(passed)).toHaveLength(2);
    const moved = card('Opportunity, verified, in 2 days');
    await user.click(within(moved).getByRole('button', { name: /^Show details for/ }));
    expect(why(moved)).toBe(
      'Opportunity, recorded date in 2 days (verified). Moved up by the fixed 7-day rule: its verified date is within 7 days.',
    );

    // The other groups are not in Financial priority order, so their cards never carry the line.
    const chase = card('Someone else, no date');
    await user.click(within(chase).getByRole('button', { name: /^Show details for/ }));
    expect(chase.querySelector('.why-order')).toBeNull();
    expect(document.body.textContent ?? '').not.toMatch(/overdue|\bdue\b|enforced|missed|too late/i);
  });

  it('gives tasks it cannot place a group of their own, and never describes them as not waiting on anyone', async () => {
    const values = [
      HEADER,
      ['T1', 'Open with no date', 'open', '', '', ''],
      ['T2', 'Status is not one of the four', 'waiting on me', '', '', ''],
      ['T3', 'Status is blank', '', '', '', ''],
      ['T4', 'Date is not readable', 'open', '25/10/2026', '', ''],
    ];
    const { user } = setup({ fetchImpl: scriptedFetch(valuesResponse(values)) });
    await connectOnly(user);
    expect(screen.getByRole('heading', { level: 2, name: 'Can’t be placed 3' })).toBeInTheDocument();
    expect(group(/^Can’t be placed/)).toEqual(['Status is not one of the four', 'Status is blank', 'Date is not readable']);
    expect(screen.getByText(/^The Status or the Deadline cell of these tasks cannot be read/)).toBeInTheDocument();
    // Each card shows what is wrong with it.
    expect(within(card('Status is not one of the four')).getByText('Unknown status: waiting on me')).toBeInTheDocument();
    expect(within(card('Status is blank')).getByText('No status')).toBeInTheDocument();
    expect(line(card('Date is not readable'), 'Recorded date')).toHaveTextContent('“25/10/2026” Not a YYYY-MM-DD date');
    // Only the task that can be read is counted as "not waiting on anyone, no recorded date in the next 7 days".
    expect(screen.getByText(/^1 more task that is not done is not on this screen: not waiting on anyone/)).toBeInTheDocument();
    expect(screen.getByText('Showing 3 of 4 tasks')).toBeInTheDocument();

    // Review flags the same cells.
    await user.click(screen.getByRole('radio', { name: 'Review' }));
    const flagged = (title: string) => within(card(title)).getByRole('list', { name: 'Flagged for' });
    expect(flagged('Status is not one of the four')).toHaveTextContent('No valid status');
    expect(flagged('Date is not readable')).toHaveTextContent('Date not readable');
    const checks = Array.from(document.querySelectorAll('.review-checks li')).map((li) => li.textContent);
    expect(checks.slice(0, 2)).toEqual(['No valid status: 2', 'Date not readable: 1']);
  });

  it('has no group for unreadable tasks while every task can be read', async () => {
    const { user } = setupLife();
    await connectOnly(user);
    expect(screen.queryByRole('heading', { name: /^Can’t be placed/ })).not.toBeInTheDocument();
  });

  it('counts the done tasks it leaves out, so the numbers add up', async () => {
    const { user } = setupLife();
    await connectOnly(user);
    // 11 tasks: 8 on screen, 1 not waiting on anyone, 1 done, and 1 not started (counted on its chip).
    expect(screen.getByText('Showing 8 of 11 tasks')).toBeInTheDocument();
    expect(screen.getByText(/^1 more task that is not done is not on this screen/)).toBeInTheDocument();
    expect(screen.getByText('1 done task is left out.')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Show tasks that have not started yet, 1 task' })).not.toBeChecked();
  });

  it('says a match is done instead of "no match", in Today and in Review', async () => {
    const values = lifeValues();
    values.push(['L12', 'Shred the old statements', 'done', '', '2026-10-20T09:00:00+05:30', '', '', '', '', '', '', '', '', '', 'Archive', '', '']);
    const { user } = setupLife(values);
    await connectOnly(user);
    const done = '1 matching task is done, and this view lists only tasks that are not done. All tasks shows it when Done is ticked.';
    await user.type(screen.getByRole('searchbox'), 'library books');
    expect(screen.getByRole('heading', { name: 'No tasks match' })).toBeInTheDocument();
    expect(screen.getByText(done)).toBeInTheDocument();
    expect(screen.queryByText(/Try a different word/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Review' }));
    expect(screen.getByText(done)).toBeInTheDocument();

    // An area whose tasks are all done: no word was typed, so none is asked for.
    await user.clear(screen.getByRole('searchbox'));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Area' }), 'Archive (0 not done)');
    expect(screen.getByRole('heading', { name: 'No tasks match' })).toBeInTheDocument();
    expect(screen.getByText(done)).toBeInTheDocument();
    expect(screen.queryByText(/Try a different word/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'All tasks' }));
    await user.click(screen.getByRole('checkbox', { name: /^Done/ }));
    expect(cardTitles()).toEqual(['Shred the old statements']);
  });

  it('opens the full list with its usual statuses from "See all tasks"', async () => {
    const { user } = setupLife();
    await connect(user);
    await user.click(screen.getByRole('checkbox', { name: /^Open/ }));
    expect(cardTitles()).not.toContain(LIFE.L07);
    await user.click(screen.getByRole('radio', { name: 'Today' }));
    await user.click(screen.getByRole('button', { name: 'See all tasks' }));
    // The note promised the task that is "not on this screen": the list has to show it.
    expect(screen.getByRole('checkbox', { name: /^Open/ })).toBeChecked();
    expect(cardTitles()).toContain(LIFE.L07);
  });

  it('keeps everything "Show details" reveals inside the part the toggle controls', async () => {
    const { user } = setupLife();
    await connectOnly(user);
    const form = card(LIFE.L02);
    const toggle = within(form).getByRole('button', { name: `Show details for ${LIFE.L02}` });
    const body = document.getElementById(toggle.getAttribute('aria-controls') ?? '') as HTMLElement;
    const upFront = form.textContent;
    await user.click(toggle);
    // What opening added: the calendar link, the origin, the last update, the lines, the notes.
    expect(within(body).getByRole('link', { name: /^Add to calendar: / })).toBeInTheDocument();
    expect(within(body).getByText('Origin missing')).toBeInTheDocument();
    expect(within(body).getByText('Last update')).toBeInTheDocument();
    // Nothing outside that part changed, apart from the toggle's own arrow and label.
    body.remove();
    expect(form.textContent).toBe((upFront ?? '').replace('▸Show details', '▾Hide details'));
  });

  it('does not flag a match that is already on the card because its full text was opened', async () => {
    const { user } = setupLife();
    await connectOnly(user);
    const latch = card(LIFE.L05);
    await user.click(within(latch).getByRole('button', { name: `Show details for ${LIFE.L05}` }));
    await user.click(within(latch).getByRole('button', { name: `Show full text for ${LIFE.L05}` }));
    await user.click(within(latch).getByRole('button', { name: `Hide details for ${LIFE.L05}` }));
    expect(latch.querySelector('.next-step')).toHaveTextContent(/fit a temporary catch\.$/);
    await user.type(screen.getByRole('searchbox'), 'screwdriver');
    expect(cardTitles()).toEqual([LIFE.L05]);
    expect(screen.queryByText('matches your search')).not.toBeInTheDocument();
  });

  it('lays the three groups out as cards on a wide screen too', async () => {
    setWideScreen(true);
    const { user } = setupLife();
    await connectOnly(user);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(group(/^Your move/)).toEqual([LIFE.L02, LIFE.L01]);
    await user.click(screen.getByRole('radio', { name: 'All tasks' }));
    expect(screen.getByRole('table', { name: 'Tasks by financial priority' })).toBeInTheDocument();
  });
});

describe('next step', () => {
  it('is the first line under the task name in every list view', async () => {
    const { user } = setupLife();
    await connect(user);
    const boiler = card(LIFE.L01);
    const nextStep = boiler.querySelector('.next-step');
    expect(nextStep).toHaveTextContent(/^Next step: Ring the engineer for a slot$/);
    expect(within(boiler).getByRole('heading', { level: 3 }).nextElementSibling).toBe(nextStep);
    // A blank cell is said, not hidden.
    expect(card(LIFE.L04).querySelector('.next-step')).toHaveTextContent(/^Next step: Not recorded$/);

    await user.click(screen.getByRole('radio', { name: 'By date' }));
    expect(card(LIFE.L01).querySelector('.next-step')).toHaveTextContent('Ring the engineer for a slot');
  });

  it('folds a long one behind Show full text, with the other long text of the task', async () => {
    const { user } = setupLife();
    await connect(user);
    const latch = card(LIFE.L05);
    expect(latch.querySelector('.next-step')).toHaveTextContent(/with the photos of the latch,…$/);
    const toggle = within(latch).getByRole('button', { name: `Show full text for ${LIFE.L05}` });
    // The toggle names the parts it opens: the next step and the labelled lines.
    const controlled = (toggle.getAttribute('aria-controls') ?? '').split(' ').map((id) => document.getElementById(id));
    expect(controlled).toHaveLength(2);
    expect(controlled[0]).toBe(latch.querySelector('.next-step'));
    expect(controlled[1]).toBe(latch.querySelector('.task-details .task-meta'));
    await user.click(toggle);
    expect(latch.querySelector('.next-step')).toHaveTextContent(/fit a temporary catch\.$/);
    expect(screen.queryAllByRole('button', { name: /^Show full text for/ })).toHaveLength(0);
    expect(within(latch).getByRole('button', { name: `Show less text for ${LIFE.L05}` })).toHaveAttribute('aria-expanded', 'true');
  });

  it('is found by search, and a match in the folded part is flagged', async () => {
    const { user } = setupLife();
    await connect(user);
    await user.type(screen.getByRole('searchbox'), 'engineer');
    expect(cardTitles()).toEqual([LIFE.L01]);
    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), 'screwdriver');
    expect(cardTitles()).toEqual([LIFE.L05]);
    expect(screen.getByRole('button', { name: `Show full text for ${LIFE.L05} (matches your search)` })).toBeInTheDocument();

    // On a short card the folded part is behind Show details.
    await user.click(screen.getByRole('radio', { name: 'Today' }));
    expect(screen.getByRole('button', { name: `Show details for ${LIFE.L05} (matches your search)` })).toBeInTheDocument();
  });

  it('is shown as written: no HTML, and only https links', async () => {
    const values = [
      [...HEADER, 'Next step'],
      ['T1', 'Odd text', 'open', '', '', '', '<img src=x onerror=alert(1)> see https://example.org/step or javascript:alert(1)'],
    ];
    const { user } = setup({ fetchImpl: scriptedFetch(valuesResponse(values)) });
    await connect(user);
    const odd = card('Odd text');
    expect(odd.querySelector('img')).toBeNull();
    expect(odd.querySelector('.next-step')).toHaveTextContent('<img src=x onerror=alert(1)> see https://example.org/step or javascript:alert(1)');
    expect(within(odd).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['https://example.org/step']);
  });

  it('sits at the top of the last table column on a wide screen, not in the row header', async () => {
    setWideScreen(true);
    const { user } = setupLife();
    await connect(user);
    const table = screen.getByRole('table', { name: 'Tasks by financial priority' });
    expect(within(table).getAllByRole('columnheader').at(-1)).toHaveTextContent('Progress and notes');
    const row = within(table).getByRole('rowheader', { name: /Book the boiler service/ }).closest('tr') as HTMLElement;
    expect(within(row).getByRole('rowheader')).toHaveTextContent(/^Book the boiler service Home Origin missing$/);
    expect(row.querySelector('td:last-child')).toHaveTextContent(/^Next step: Ring the engineer for a slotWhy this order:/);

    // The long next step folds in the table too, and its toggle names the two parts it opens.
    const latch = within(table).getByRole('rowheader', { name: /Landlord to fix the gate latch/ }).closest('tr') as HTMLElement;
    const toggle = within(latch).getByRole('button', { name: `Show full text for ${LIFE.L05}` });
    const controlled = (toggle.getAttribute('aria-controls') ?? '').split(' ').map((id) => document.getElementById(id));
    expect(controlled).toEqual([latch.querySelector('.next-step'), latch.querySelector('.task-details .task-meta')]);
    expect(latch.querySelector('.next-step')).toHaveTextContent(/with the photos of the latch,…$/);
    await user.click(toggle);
    expect(latch.querySelector('.next-step')).toHaveTextContent(/fit a temporary catch\.$/);
    // A Start date sits under the recorded date in the table.
    const tyres = within(table).getByRole('rowheader', { name: /Swap the winter tyres/ }).closest('tr') as HTMLElement;
    expect(tyres.querySelector('.start-line')).toHaveTextContent(/^Start Thu, 15 Oct 2026$/);
  });

  it('adds the table column for a sheet that has Next step and none of the other new columns', async () => {
    setWideScreen(true);
    const values = [[...HEADER, 'Next step'], ['T1', 'One column', 'open', '', '', '', 'Ring them']];
    const { user } = setup({ fetchImpl: scriptedFetch(valuesResponse(values)) });
    await connect(user);
    expect(screen.getAllByRole('columnheader').at(-1)).toHaveTextContent('Progress and notes');
    expect(screen.getByRole('table')).toHaveTextContent('Next step: Ring them');
  });
});

describe('areas', () => {
  const picker = () => screen.getByRole('combobox', { name: 'Area' });

  it('offers each area once with how many of its tasks are not done', async () => {
    const { user } = setupLife();
    await connectOnly(user);
    expect(within(picker()).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'All areas',
      // "car" and "Car" are one area.
      'car (2 not done)',
      'Family (1 not done)',
      'Garden (1 not done)',
      'Home (4 not done)',
      'Travel (1 not done)',
      'No area (1 not done)',
    ]);
    expect(picker()).toHaveValue('ALL');
  });

  it('narrows every view to one area, and the chip counts with it', async () => {
    const { user } = setupLife();
    await connectOnly(user);
    await user.selectOptions(picker(), 'Home (4 not done)');
    expect(group(/^Your move/)).toEqual([LIFE.L01]);
    expect(group(/^Next 7 days/)).toEqual([LIFE.L03, LIFE.L11]);
    expect(group(/^Chase/)).toEqual([LIFE.L05]);
    expect(screen.getByText('Showing 4 of 11 tasks')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'All tasks' }));
    expect(cardTitles().sort()).toEqual([LIFE.L01, LIFE.L03, LIFE.L05, LIFE.L11].sort());
    expect(screen.getByRole('checkbox', { name: 'Open, 1 task' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Waiting on you, 1 task' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Waiting on someone else, 2 tasks' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Done, 1 task' })).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'By date' }));
    expect(cardTitles().sort()).toEqual([LIFE.L01, LIFE.L03, LIFE.L05, LIFE.L11].sort());
    await user.click(screen.getByRole('radio', { name: 'Review' }));
    expect(cardTitles()).toEqual([LIFE.L05]);

    await user.click(screen.getByRole('button', { name: 'Reset filters' }));
    expect(picker()).toHaveValue('ALL');
    expect(cardTitles()).toEqual([LIFE.L05, LIFE.L10, LIFE.L04, LIFE.L07]);
  });

  it('treats the same area in another letter case as one, and can show the tasks with no area', async () => {
    const { user } = setupLife();
    await connect(user);
    await user.selectOptions(picker(), 'car (2 not done)');
    expect(cardTitles().sort()).toEqual([LIFE.L06, LIFE.L10].sort());
    // Each task keeps its own spelling on its badge.
    expect(within(card(LIFE.L06)).getByText('car').className).toContain('badge--area');
    expect(within(card(LIFE.L10)).getByText('Car').className).toContain('badge--area');

    await user.selectOptions(picker(), 'No area (1 not done)');
    expect(cardTitles()).toEqual([LIFE.L07]);
    expect(card(LIFE.L07).querySelector('.badge--area')).toBeNull();
  });

  it('combines with the search, and counts the past dates of the chosen area only', async () => {
    const values = lifeValues();
    values.push(['L12', 'Post the warranty slip', 'open', '2026-10-19', '', '', '', '', '', '', '', '', '', '', 'Travel', '', 'Find a stamp']);
    const { user } = setupLife(values);
    await connect(user);
    expect(screen.getByText('1 task has a recorded date in the past')).toBeInTheDocument();
    await user.selectOptions(picker(), 'Home (4 not done)');
    expect(screen.queryByText(/recorded date in the past/)).not.toBeInTheDocument();
    await user.type(screen.getByRole('searchbox'), 'deposit');
    expect(cardTitles()).toEqual([LIFE.L11]);
    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), 'railcard');
    expect(screen.getByRole('heading', { name: 'No tasks match' })).toBeInTheDocument();
  });

  it('drops an area for good when the sheet no longer has it', async () => {
    const renamed = lifeValues().map((row) => row.map((cell, index) => (index === 14 && cell === 'Travel' ? 'Trips' : cell)));
    const { user } = setup({
      fetchImpl: scriptedFetch(valuesResponse(lifeValues()), valuesResponse(renamed), valuesResponse(lifeValues())),
    });
    await connect(user);
    await user.selectOptions(picker(), 'Travel (1 not done)');
    expect(cardTitles()).toEqual([LIFE.L04]);

    // The area was renamed in the sheet: the filter is off, and nothing is left to reset.
    await refresh(user);
    expect(picker()).toHaveValue('ALL');
    expect(screen.getByText('Showing 9 of 11 tasks')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reset filters' })).not.toBeInTheDocument();

    // When the old name comes back, the view does not narrow by itself.
    await refresh(user);
    expect(picker()).toHaveValue('ALL');
    expect(screen.getByText('Showing 9 of 11 tasks')).toBeInTheDocument();
  });

  it('drops "No area" when the sheet loses its Area column', async () => {
    const withoutArea = lifeValues().map((row) => row.filter((_, index) => index !== 14));
    const { user } = setup({ fetchImpl: scriptedFetch(valuesResponse(lifeValues()), valuesResponse(withoutArea)) });
    await connectOnly(user);
    await user.selectOptions(picker(), 'No area (1 not done)');
    expect(screen.getByRole('button', { name: 'Reset filters' })).toBeInTheDocument();

    await refresh(user);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reset filters' })).not.toBeInTheDocument();
    expect(screen.queryByText('No task here matches the search or area.')).not.toBeInTheDocument();
    expect(cardTitles()).toHaveLength(8);
  });

  it('has no picker and no badge while the sheet has no Area column', async () => {
    const { user } = setupPlanning();
    await connect(user);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(document.querySelector('.badge--area')).toBeNull();
  });
});

describe('start dates', () => {
  const toggle = () => screen.getByRole('checkbox', { name: 'Show tasks that have not started yet, 1 task' });

  it('leaves out a task that cannot start yet, with a visible count, until asked', async () => {
    const { user } = setupLife();
    await connect(user);
    expect(cardTitles()).not.toContain(LIFE.L08);
    expect(toggle()).not.toBeChecked();
    expect(screen.getByText('Showing 9 of 11 tasks')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Open, 4 tasks' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reset filters' })).not.toBeInTheDocument();

    await user.click(toggle());
    expect(cardTitles()).toContain(LIFE.L08);
    expect(screen.getByText('Showing 10 of 11 tasks')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Open, 5 tasks' })).toBeInTheDocument();
    const beds = card(LIFE.L08);
    expect(line(beds, 'Start')).toHaveTextContent('Tue, 10 Nov 2026 Not started yet');

    await user.click(screen.getByRole('button', { name: 'Reset filters' }));
    expect(toggle()).not.toBeChecked();
    expect(cardTitles()).not.toContain(LIFE.L08);
  });

  it('shows a Start that has passed as a plain date, and no Start line for a blank cell', async () => {
    const { user } = setupLife();
    await connect(user);
    const tyres = card(LIFE.L10);
    expect(line(tyres, 'Start')).toHaveTextContent(/^StartThu, 15 Oct 2026$/);
    expect(within(card(LIFE.L01)).queryByText('Start', { selector: 'dt' })).not.toBeInTheDocument();
  });

  it('applies to Today, By date and Review as well', async () => {
    const { user } = setupLife();
    await connectOnly(user);
    expect(cardTitles()).not.toContain(LIFE.L08);
    await user.click(toggle());
    // It is open with no date, so on Today it joins the tasks left to the other views.
    expect(screen.getByText(/^2 more tasks that are not done are not on this screen/)).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'By date' }));
    expect(cardTitles()).toContain(LIFE.L08);
    await user.click(toggle());
    expect(cardTitles()).not.toContain(LIFE.L08);
  });

  it('says when a search only matches a task that has not started yet', async () => {
    const { user } = setupLife();
    await connect(user);
    await user.type(screen.getByRole('searchbox'), 'allotment');
    expect(screen.getByRole('heading', { name: 'No tasks match' })).toBeInTheDocument();
    expect(screen.getByText('1 matching task has not started yet: tick “Not started yet” to see it.')).toBeInTheDocument();
    await user.click(toggle());
    expect(cardTitles()).toEqual([LIFE.L08]);
  });

  it('says so when a match is hidden by both an unticked status and its Start date', async () => {
    const { user } = setupLife();
    await connect(user);
    await user.click(screen.getByRole('checkbox', { name: /^Open/ }));
    await user.type(screen.getByRole('searchbox'), 'allotment');
    expect(screen.getByRole('heading', { name: 'No tasks match' })).toBeInTheDocument();
    // First the status: ticking "Not started yet" alone would not bring it back.
    expect(screen.getByText(/^1 task matches with a status that is hidden right now/)).toBeInTheDocument();
    expect(screen.queryByText(/not started yet: tick/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Try a different word/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /^Open/ }));
    expect(screen.getByText('1 matching task has not started yet: tick “Not started yet” to see it.')).toBeInTheDocument();
  });

  it('marks a task that has not started on its short card, and lists it in Review only when asked', async () => {
    const values = lifeValues();
    // Waiting on you, cannot start yet, and has no next step (a Review flag).
    values.push(['L12', 'Renew the allotment lease', 'waiting on you', '', '2026-10-20T09:00:00+05:30', '', '', '', '', '', '', '', '', '', 'Garden', '2026-12-01', '']);
    const { user } = setupLife(values);
    await connectOnly(user);
    const toggle = () => screen.getByRole('checkbox', { name: 'Show tasks that have not started yet, 2 tasks' });
    expect(cardTitles()).not.toContain('Renew the allotment lease');
    await user.click(screen.getByRole('radio', { name: 'Review' }));
    expect(cardTitles()).not.toContain('Renew the allotment lease');

    await user.click(toggle());
    expect(cardTitles()).toContain('Renew the allotment lease');
    await user.click(screen.getByRole('radio', { name: 'Today' }));
    expect(group(/^Your move/)).toContain('Renew the allotment lease');
    // Closed, the card already says the task cannot be started yet.
    const lease = card('Renew the allotment lease');
    expect(within(lease).getByRole('button', { name: /^Show details for/ })).toHaveAttribute('aria-expanded', 'false');
    expect(line(lease, 'Start')).toHaveTextContent('Tue, 1 Dec 2026 Not started yet');
    // A task that has started keeps its Start line behind Show details.
    const tyres = card(LIFE.L10);
    expect(within(tyres).queryByText('Start', { selector: 'dt' })).not.toBeInTheDocument();
    await user.click(within(tyres).getByRole('button', { name: /^Show details for/ }));
    expect(line(tyres, 'Start')).toHaveTextContent(/^StartThu, 15 Oct 2026$/);
  });

  it('switches the toggle off for good once no task is waiting to start', async () => {
    const started = lifeValues().map((row) => (row[0] === 'L08' ? row.map((cell, index) => (index === 15 ? '2026-10-01' : cell)) : row));
    const { user } = setup({
      fetchImpl: scriptedFetch(valuesResponse(lifeValues()), valuesResponse(started), valuesResponse(lifeValues())),
    });
    await connect(user);
    await user.click(screen.getByRole('checkbox', { name: 'Show tasks that have not started yet, 1 task' }));
    expect(screen.getByRole('button', { name: 'Reset filters' })).toBeInTheDocument();

    // After a refresh the task has started: the chip goes, and so does a Reset that would have nothing to reset.
    await refresh(user);
    expect(screen.queryByRole('checkbox', { name: /not started/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reset filters' })).not.toBeInTheDocument();
    expect(cardTitles()).toContain(LIFE.L08);

    // If a task is waiting to start again later, the toggle is back unticked, not silently on.
    await refresh(user);
    expect(screen.getByRole('checkbox', { name: 'Show tasks that have not started yet, 1 task' })).not.toBeChecked();
    expect(cardTitles()).not.toContain(LIFE.L08);
  });

  it('never hides a done task, and treats a Start that is not a date as started, with the problem listed', async () => {
    const values = [
      [...HEADER, 'Start'],
      ['T1', 'Finished early', 'done', '', '', '', '2027-01-01'],
      ['T2', 'Start is not a date', 'open', '', '', '', 'next spring'],
      ['T3', 'Starts today', 'open', '', '', '', '2026-10-21'],
    ];
    const { user } = setup({ fetchImpl: scriptedFetch(valuesResponse(values)) });
    await connect(user);
    expect(screen.queryByRole('checkbox', { name: /not started/i })).not.toBeInTheDocument();
    expect(cardTitles()).toEqual(['Start is not a date', 'Starts today']);
    expect(line(card('Start is not a date'), 'Start')).toHaveTextContent('“next spring” Not a YYYY-MM-DD date');
    expect(line(card('Starts today'), 'Start')).toHaveTextContent(/^StartWed, 21 Oct 2026$/);
    await user.click(screen.getByText('1 problem found in the sheet'));
    expect(
      screen.getByText('Row 3 (T2): start “next spring” is not a date written as YYYY-MM-DD. The task is treated as started.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /^Done/ }));
    expect(cardTitles()).toContain('Finished early');
    expect(within(card('Finished early')).queryByText('Not started yet')).not.toBeInTheDocument();
  });

  it('starts a task on its Start date: after midnight it is back without a refresh', async () => {
    const values = [[...HEADER, 'Start'], ['T1', 'Starts tomorrow', 'open', '', '', '', '2026-10-22']];
    const { user } = setup({ fetchImpl: scriptedFetch(valuesResponse(values)) });
    await connect(user);
    expect(cardTitles()).toEqual([]);
    expect(screen.getByRole('checkbox', { name: 'Show tasks that have not started yet, 1 task' })).toBeInTheDocument();
    // 09:30 in India now; 15 hours later it is 22 Oct there.
    await settle(15 * 60 * 60 * 1000);
    expect(cardTitles()).toEqual(['Starts tomorrow']);
    expect(screen.queryByRole('checkbox', { name: /not started/i })).not.toBeInTheDocument();
  });
});

describe('review view', () => {
  const openReview = async (user: ReturnType<typeof userEvent.setup>) => {
    await connectOnly(user);
    await user.click(screen.getByRole('radio', { name: 'Review' }));
  };
  const flags = (title: string) =>
    within(within(card(title)).getByRole('list', { name: 'Flagged for' }))
      .getAllByRole('listitem')
      .map((item) => item.textContent);

  it('lists the tasks that have gone quiet or are missing something, and says why', async () => {
    const { user } = setupLife();
    await openReview(user);
    expect(screen.getByRole('heading', { level: 2, name: 'Needs a look 4' })).toBeInTheDocument();
    expect(cardTitles()).toEqual([LIFE.L05, LIFE.L10, LIFE.L04, LIFE.L07]);
    expect(flags(LIFE.L05)).toEqual(['No update for 41 days', 'Waiting on someone else, no date']);
    expect(flags(LIFE.L10)).toEqual(['No last update recorded']);
    expect(flags(LIFE.L04)).toEqual(['No next step']);
    expect(flags(LIFE.L07)).toEqual(['No area']);
    expect(screen.getByText('Showing 4 of 11 tasks')).toBeInTheDocument();
  });

  it('counts what each check found', async () => {
    const { user } = setupLife();
    await openReview(user);
    const checks = Array.from(document.querySelectorAll('.review-checks li')).map((li) => li.textContent);
    expect(checks).toEqual([
      'No update for 30 days or more: 1',
      'No last update recorded: 1',
      'Waiting on someone else with no recorded date: 1',
      'No next step: 1',
      'No area: 1',
    ]);
  });

  it('has no status chips or sort order, and uses short cards', async () => {
    const { user } = setupLife();
    await openReview(user);
    expect(screen.queryByRole('checkbox', { name: /^Done/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Financial priority' })).not.toBeInTheDocument();
    const latch = card(LIFE.L05);
    expect(line(latch, 'Last update')).toHaveTextContent('(41 days ago)');
    await user.click(within(latch).getByRole('button', { name: `Show details for ${LIFE.L05}` }));
    expect(line(latch, 'Recorded date')).toHaveTextContent('No recorded date');
  });

  it('never lists a done task, and follows the search', async () => {
    const values = lifeValues();
    // Done, with no area, no next step and no update: every flag would apply if done tasks were checked.
    values.push(['L12', 'Shred the old statements', 'done', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);
    const { user } = setupLife(values);
    await openReview(user);
    expect(cardTitles()).toEqual([LIFE.L05, LIFE.L10, LIFE.L04, LIFE.L07]);
    await user.type(screen.getByRole('searchbox'), 'tyres');
    expect(cardTitles()).toEqual([LIFE.L10]);
    expect(screen.getByText('Showing 1 of 12 tasks')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Needs a look 1' })).toBeInTheDocument();
  });

  it('leaves the count of past dates to the other views', async () => {
    const values = [
      [...HEADER, 'Date verified'],
      ['T1', 'Past and quiet', 'open', '2026-10-01', '', '', 'verified'],
    ];
    const { user } = setup({ fetchImpl: scriptedFetch(valuesResponse(values)) });
    await connectOnly(user);
    expect(screen.getByText('1 task has a recorded date in the past')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Review' }));
    expect(screen.queryByText(/recorded date in the past/)).not.toBeInTheDocument();
    // The task itself still says its verified date has passed.
    expect(card('Past and quiet')).toHaveTextContent('The date has passed; the dashboard does not know whether a consequence applies now.');
  });

  it('skips the checks for columns the sheet does not have, and says so', async () => {
    const { user } = setup();
    await openReview(user);
    expect(Array.from(document.querySelectorAll('.review-checks li')).map((li) => li.textContent)).toEqual([
      'No update for 30 days or more: 0',
      'No last update recorded: 0',
      'Waiting on someone else with no recorded date: 0',
    ]);
    expect(screen.getByText('The Tasks tab has no “Next step” column yet, so next steps are not checked.')).toBeInTheDocument();
    expect(screen.getByText('The Tasks tab has no “Area” column yet, so areas are not checked.')).toBeInTheDocument();
    expect(screen.getByText('Nothing needs a look.')).toBeInTheDocument();
    expect(screen.getByText('Showing 0 of 6 tasks')).toBeInTheDocument();
  });

  it('counts the days without an update on the viewer’s calendar', async () => {
    const values = [
      HEADER,
      // 20:00 UTC on 20 Sep is 21 Sep in India: 30 days before 21 Oct there.
      ['T1', 'Quiet for a month', 'open', '', '2026-09-20T20:00:00Z', ''],
      ['T2', 'Quiet for 29 days', 'open', '', '2026-09-21T20:00:00Z', ''],
    ];
    const { user } = setup({ fetchImpl: scriptedFetch(valuesResponse(values)) });
    await openReview(user);
    expect(cardTitles()).toEqual(['Quiet for a month']);
    expect(flags('Quiet for a month')).toEqual(['No update for 30 days']);
  });

  it('words nothing as due, overdue or missed', async () => {
    const { user } = setupLife();
    await openReview(user);
    expect(document.body.textContent ?? '').not.toMatch(/overdue|\bdue\b|enforced|missed|too late/i);
    await user.click(screen.getByRole('radio', { name: 'Today' }));
    expect(document.body.textContent ?? '').not.toMatch(/overdue|\bdue\b|enforced|missed|too late/i);
  });
});

describe('add to calendar', () => {
  it('offers a Google Calendar link only for a verified date that is today or later', async () => {
    const { user } = setupLife();
    await connect(user);
    const links = screen.getAllByRole('link', { name: /^Add to calendar: / });
    expect(links.map((a) => a.getAttribute('aria-label'))).toEqual([
      `Add to calendar: ${LIFE.L02} (opens Google Calendar in a new tab)`,
      `Add to calendar: ${LIFE.L04} (opens Google Calendar in a new tab)`,
    ]);
    const link = within(card(LIFE.L02)).getByRole('link', { name: /^Add to calendar: / });
    expect(link).toHaveTextContent('Add to calendar');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    const url = new URL(link.getAttribute('href') ?? '');
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      action: 'TEMPLATE',
      text: LIFE.L02,
      dates: '20261023/20261024',
      details: 'Task L02 in the task tracker.',
    });
  });

  it('does not offer it for a planning date, a passed date or a done task', async () => {
    const values = [
      [...HEADER, 'Date verified'],
      ['T1', 'Planning date ahead', 'open', '2026-10-25', '', '', 'planning'],
      ['T2', 'Verified but passed', 'open', '2026-10-19', '', '', 'verified'],
      ['T3', 'Verified but done', 'done', '2026-10-25', '', '', 'verified'],
      ['T4', 'Verified and today', 'open', '2026-10-21', '', '', 'verified'],
    ];
    const { user } = setup({ fetchImpl: scriptedFetch(valuesResponse(values)) });
    await connect(user);
    await user.click(screen.getByRole('checkbox', { name: /^Done/ }));
    expect(screen.getAllByRole('link', { name: /^Add to calendar: / }).map((a) => a.getAttribute('aria-label'))).toEqual([
      'Add to calendar: Verified and today (opens Google Calendar in a new tab)',
    ]);
  });

  it('keeps the link behind Show details on a short card, and shows it in the table', async () => {
    const { user, unmount } = setupLife();
    await connectOnly(user);
    expect(screen.queryByRole('link', { name: /^Add to calendar: / })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: `Show details for ${LIFE.L02}` }));
    expect(within(card(LIFE.L02)).getByRole('link', { name: /^Add to calendar: / })).toBeInTheDocument();
    unmount();

    setWideScreen(true);
    const wide = setupLife();
    await connect(wide.user);
    expect(within(screen.getByRole('table')).getAllByRole('link', { name: /^Add to calendar: / })).toHaveLength(2);
  });

  it('never calls Google Calendar itself: the only request is the read of the sheet', async () => {
    const { user, fetchImpl } = setupLife();
    await connect(user);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchImpl).mock.calls[0]?.[0]).toEqual(expect.stringContaining('https://sheets.googleapis.com/'));
  });
});

describe('freshness', () => {
  it('refreshes automatically at most every 5 minutes', async () => {
    const { user, fetchImpl } = setup();
    await connect(user);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await settle(4 * 60_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await settle(60_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('pauses while the page is in the background and catches up when it is back', async () => {
    const { user, fetchImpl } = setup();
    await connect(user);
    setPageHidden(true);
    await settle(11 * 60_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(syncHeadline()).toBe('Tasks may be out of date');

    setPageHidden(false);
    await settle();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(syncHeadline()).toBe('Synced with your sheet');
  });

  it('keeps showing old data after a failed refresh, clearly marked', async () => {
    const fetchImpl = scriptedFetch(valuesResponse(sampleValues()), errorResponse(503, 'UNAVAILABLE', 'Try later'));
    const { user } = setup({ fetchImpl });
    await connect(user);
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await settle(30_000); // the client retries with backoff before giving up
    expect(syncHeadline()).toBe('Refresh failed: tasks may be out of date');
    expect(screen.getByRole('alert')).toHaveTextContent('Google Sheets is having a temporary problem');
    expect(screen.getByRole('alert')).toHaveTextContent('from the last successful fetch and may be out of date');
    expect(screen.getByText(/Last fetched 09:30 GMT\+5:30/)).toBeInTheDocument();
    expect(cardTitles()).toContain('Renew library card');
  });

  it('marks data as out of date when the sign-in expires, and reconnects on request', async () => {
    google.nextPopup('grant', { expiresIn: 600 });
    const { user, fetchImpl } = setup();
    await connect(user);
    await settle(9 * 60_000); // Google said 10 minutes; the dashboard stops a minute early
    expect(syncHeadline()).toBe('Google sign-in expired: tasks may be out of date');
    expect(screen.getByRole('alert')).toHaveTextContent('Your Google sign-in expired');
    expect(cardTitles()).toContain('Renew library card');
    await settle(10 * 60_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    google.nextPopup('grant');
    await user.click(screen.getAllByRole('button', { name: 'Reconnect' })[0] as HTMLElement);
    await settle();
    expect(syncHeadline()).toBe('Synced with your sheet');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('treats a rejected token as an expired sign-in', async () => {
    const fetchImpl = scriptedFetch(
      valuesResponse(sampleValues()),
      errorResponse(401, 'UNAUTHENTICATED', 'Request had invalid authentication credentials.'),
    );
    const { user } = setup({ fetchImpl });
    await connect(user);
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await settle();
    expect(syncHeadline()).toBe('Google sign-in expired: tasks may be out of date');
  });
});

describe('signing out', () => {
  it('clears every task from the page', async () => {
    const { user } = setup();
    await connect(user);
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(screen.queryByText(/library card/i)).not.toBeInTheDocument();
    expect(screen.getByText('You’re signed out. Your tasks were cleared from this page.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect Google account' })).toBeEnabled();
  });

  it('ignores a response that arrives after signing out', async () => {
    let finish: (response: Response) => void = () => undefined;
    const slow = new Promise<Response>((resolve) => (finish = resolve));
    const { user } = setup({ fetchImpl: scriptedFetch(() => slow) });
    await connect(user);
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    finish(valuesResponse(sampleValues()));
    await settle();
    expect(screen.queryByText(/library card/i)).not.toBeInTheDocument();
  });

  it('can remove the dashboard’s access from the Google account', async () => {
    const { user } = setup();
    await connect(user);
    await user.click(screen.getByRole('button', { name: /Remove this dashboard’s access/ }));
    await user.click(screen.getByRole('button', { name: 'Remove access' }));
    await settle();
    expect(google.revoked).toEqual(['token-1']);
    expect(screen.getByRole('heading', { name: 'Access removed' })).toBeInTheDocument();
    expect(screen.queryByText(/library card/i)).not.toBeInTheDocument();
  });
});

describe('keyboard use', () => {
  it('works without a mouse: connect, filter and open notes', async () => {
    const { user } = setup();
    await settle();
    await tabTo(user, screen.getByRole('button', { name: 'Connect Google account' }));
    await user.keyboard('{Enter}');
    await settle();

    // The dashboard opens on Today; the views are the first control, and the arrow keys move between them.
    await tabTo(user, screen.getByRole('radio', { name: 'Today' }));
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'All tasks' })).toBeChecked();

    const done = screen.getByRole('checkbox', { name: /^Done/ });
    await tabTo(user, done);
    await user.keyboard(' ');
    expect(done).toBeChecked();

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('searchbox'));
    await user.keyboard('library');

    const notes = screen.getByRole('button', { name: /Show notes for Renew library card/ });
    await tabTo(user, notes);
    await user.keyboard('{Enter}');
    expect(notes).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/Bring proof of address/)).toBeVisible();
  });

  it('reaches the views, the sort order and the full-text toggle from the keyboard', async () => {
    const { user } = setupPlanning();
    await connectOnly(user);
    await tabTo(user, screen.getByRole('radio', { name: 'Today' }));
    await user.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'You requested' })).toBeChecked();
    expect(cardTitles()).toEqual([PLANNING.P03, PLANNING.P01]);

    await tabTo(user, screen.getByRole('searchbox'));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Financial priority' }));
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Recorded date' })).toBeChecked();

    const fullText = screen.getByRole('button', { name: `Show full text for ${PLANNING.P03}` });
    await tabTo(user, fullText);
    await user.keyboard('{Enter}');
    expect(screen.getByText(/and bring a pencil/)).toBeVisible();
  });
});

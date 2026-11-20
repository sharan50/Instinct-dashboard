import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.tsx';
import { readConfig } from './config.ts';
import type { FormatOptions } from './lib/dates.ts';
import { createFakeGoogle, errorResponse, scriptedFetch, valuesResponse, type FakeGoogle } from './test/fakeGoogle.ts';
import { FULL_HEADER, HEADER, planningValues, sampleValues } from './test/fixtures.ts';
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

async function connect(user: ReturnType<typeof userEvent.setup>) {
  await settle();
  await user.click(screen.getByRole('button', { name: 'Connect Google account' }));
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
    expect(views.map((radio) => radio.closest('label')?.textContent)).toEqual(['All tasks', 'By date', 'You requested', 'Inbound']);
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
        'Optional columns found in the Tasks tab: none. Not found, so not shown: Links, Origin, Money at stake, Progress, Hands-on effort, Delay-cost basis, Expected finish incl. waits, Date verified.',
      ),
    ).toBeInTheDocument();
    unmount();

    const full = setupPlanning();
    await connect(full.user);
    expect(screen.getByText(`Optional columns found in the Tasks tab: ${FULL_HEADER.slice(HEADER.length).join(', ')}.`)).toBeInTheDocument();
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
    await connect(user);
    await tabTo(user, screen.getByRole('searchbox'));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'All tasks' }));
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'You requested' })).toBeChecked();
    expect(cardTitles()).toEqual([PLANNING.P03, PLANNING.P01]);

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

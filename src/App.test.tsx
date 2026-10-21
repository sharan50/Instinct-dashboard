import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.tsx';
import { readConfig } from './config.ts';
import type { FormatOptions } from './lib/dates.ts';
import { createFakeGoogle, errorResponse, scriptedFetch, valuesResponse, type FakeGoogle } from './test/fakeGoogle.ts';
import { HEADER, sampleValues } from './test/fixtures.ts';
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
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Tasks!A1%3AF1000?valueRenderOption=FORMATTED_VALUE`,
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
    expect(screen.getByText('1 overdue task')).toBeInTheDocument();
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
    expect(within(done).queryByText(/Overdue/)).not.toBeInTheDocument();
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
    const table = screen.getByRole('table', { name: 'Tasks, earliest deadline first' });
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual([
      'ID',
      'Task',
      'Status',
      'Deadline',
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

  it('groups tasks by deadline', async () => {
    const { user } = setup();
    await connect(user);
    await user.click(screen.getByRole('radio', { name: 'Deadlines' }));
    const group = (name: RegExp) =>
      within(screen.getByRole('region', { name })).queryAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(group(/^Overdue/)).toEqual(['Plumber quote for kitchen tap']);
    expect(group(/^Next 7 days/)).toEqual([]);
    expect(screen.getByText('Nothing due in the next 7 days.')).toBeInTheDocument();
    expect(group(/^Later/)).toEqual(['Renew library card', 'Order new passport photos']);
    expect(group(/^Ongoing/)).toEqual(['Water the balcony plants']);
    expect(group(/^No deadline/)).toEqual(['Book dentist check-up']);
    expect(screen.queryByRole('region', { name: /^Done/ })).not.toBeInTheDocument();
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
});

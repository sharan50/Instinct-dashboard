import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { connect, hasHorizontalScroll, mockGoogle } from './helpers.ts';

/** Presses Tab until `target` has focus. */
async function tabTo(page: Page, target: Locator) {
  for (let presses = 0; presses < 80; presses += 1) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error('the element never received focus');
}

/** Opens every folded part of every task: the notes and any long text behind "Show full text". */
async function expandAllNotes(page: Page) {
  for (const name of [/^Show notes for/, /^Show full text for/]) {
    const show = page.getByRole('button', { name });
    while ((await show.count()) > 0) await show.first().click();
  }
}

/** Task names in the order shown: card headings on a phone, the first table column on a wide screen. */
function taskNames(page: Page): Promise<string[]> {
  return page.locator('.task-card .task-title, .task-title-cell > span:first-child').allTextContents();
}

const NAMES = {
  library: 'Renew library card',
  dentist: 'Book dentist check-up',
  plumber: 'Plumber quote for the kitchen tap',
  plants: 'Water the balcony plants',
  photos: 'Order new passport photos',
  broadband: 'Compare broadband offers before the contract ends',
  markup: 'Check the <b>markup</b> stays text',
};

async function expectNoAccessibilityViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const store = window as unknown as { __cspViolations: string[] };
    store.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) =>
      store.__cspViolations.push(`${event.violatedDirective} ${event.blockedURI}`),
    );
  });
});

test('connects, shows tasks and never needs sideways scrolling', async ({ page }) => {
  const { sheetRequests } = await mockGoogle(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Connect to your task tracker' })).toBeVisible();
  await expect(page.getByText('person@example.com')).toBeVisible();
  expect(await hasHorizontalScroll(page)).toBe(false);

  await page.getByRole('button', { name: 'Connect Google account' }).click();
  await expect(page.getByText('Synced with your sheet')).toBeVisible();
  await expect(page.getByText('Showing 7 of 8 tasks')).toBeVisible();
  expect(sheetRequests).toEqual([
    'https://sheets.googleapis.com/v4/spreadsheets/test-spreadsheet-id-not-real-000000/values/Tasks!A1%3AZ1000?valueRenderOption=FORMATTED_VALUE Bearer fake-token',
  ]);
  const requests = await page.evaluate(() => (window as unknown as { __FAKE_GIS_REQUESTS__: unknown[] }).__FAKE_GIS_REQUESTS__);
  expect(requests).toEqual([
    {
      prompt: '',
      login_hint: 'person@example.com',
      scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
      include_granted_scopes: false,
    },
  ]);

  await expandAllNotes(page);
  expect(await hasHorizontalScroll(page)).toBe(false);
  await page.getByText('By date', { exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name: /^Recorded date passed/ })).toBeVisible();
  await expandAllNotes(page);
  expect(await hasHorizontalScroll(page)).toBe(false);
  expect(await page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations)).toEqual([]);
});

test('uses cards on phones and a table only where it fits', async ({ page }, testInfo) => {
  await mockGoogle(page);
  await connect(page);
  if (testInfo.project.name === 'phone') {
    await expect(page.getByRole('table')).toHaveCount(0);
    await expect(page.getByRole('article')).toHaveCount(7);
  } else {
    await expect(page.getByRole('table', { name: 'Tasks by financial priority' })).toBeVisible();
    for (const width of [960, 1280, 1600]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await hasHorizontalScroll(page), `at ${width}px`).toBe(false);
    }
    await page.setViewportSize({ width: 959, height: 900 });
    await expect(page.getByRole('table')).toHaveCount(0);
  }
});

test('works with the keyboard alone, with a visible focus ring', async ({ page }) => {
  await mockGoogle(page);
  await page.goto('/');
  const connectButton = page.getByRole('button', { name: 'Connect Google account' });
  await tabTo(page, connectButton);
  await page.keyboard.press('Enter');
  await expect(page.getByText('Synced with your sheet')).toBeVisible();

  const done = page.getByRole('checkbox', { name: /^Done/ });
  await tabTo(page, done);
  const ring = await done.evaluate((input) => getComputedStyle(input.nextElementSibling as Element).outlineStyle);
  expect(ring).toBe('solid');
  await page.keyboard.press('Space');
  await expect(done).toBeChecked();
  await expect(page.getByText('Showing 8 of 8 tasks')).toBeVisible();

  await page.keyboard.press('Tab');
  await expect(page.getByRole('searchbox', { name: 'Search tasks and notes' })).toBeFocused();
  await page.keyboard.type('library');
  await expect(page.getByText('Showing 1 of 8 tasks')).toBeVisible();

  const notes = page.getByRole('button', { name: /^Show notes for Renew library card/ });
  await tabTo(page, notes);
  await page.keyboard.press('Enter');
  await expect(page.getByText(/Bring proof of address/)).toBeVisible();
});

test('passes automated accessibility checks', async ({ page }) => {
  await mockGoogle(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Connect Google account' })).toBeEnabled();
  await expectNoAccessibilityViolations(page);

  await page.getByRole('button', { name: 'Connect Google account' }).click();
  await expect(page.getByText('Synced with your sheet')).toBeVisible();
  await expandAllNotes(page);
  await page.getByText('How Financial priority works').click();
  await expectNoAccessibilityViolations(page);

  await page.getByText('Inbound', { exact: true }).first().click();
  await expect(page.getByText('Showing 2 of 8 tasks')).toBeVisible();
  await expectNoAccessibilityViolations(page);

  await page.getByText('By date', { exact: true }).click();
  await expectNoAccessibilityViolations(page);
});

test('shows notes and names as plain text', async ({ page }) => {
  await mockGoogle(page);
  await connect(page);
  await expect(page.getByText('Check the <b>markup</b> stays text', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Show notes for Check the/ }).click();
  await expect(page.getByText('<img src=x onerror="window.__xss=1"> stays as text.')).toBeVisible();
  await expandAllNotes(page);
  // The same goes for the optional columns: Origin, Money at stake and Progress hold markup in the sample.
  await expect(page.getByText('<img src=x onerror="window.__xss=2"> stays as text too.')).toBeVisible();
  await expect(page.getByText('<b>12</b> maybe')).toBeVisible();
  await expect(page.getByText('Origin not recognised: somewhere <i>else</i>')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  await expect(page.locator('main img, main b, main i')).toHaveCount(0);
});

test('orders by financial priority, says why, and switches back to the recorded-date order', async ({ page }) => {
  await mockGoogle(page);
  await connect(page);
  await expect(page.getByRole('radio', { name: 'Financial priority' })).toBeChecked();
  // Verified top-tier date; the opportunity whose verified date has passed; top tier without a verified date; the rest.
  expect(await taskNames(page)).toEqual([
    NAMES.photos,
    NAMES.plumber,
    NAMES.library,
    NAMES.broadband,
    NAMES.dentist,
    NAMES.plants,
    NAMES.markup,
  ]);
  await expect(page.getByText('Deadline basis, recorded date in 2 days (verified)')).toBeVisible();
  await expect(
    page.getByText('Opportunity, recorded date 3 days ago (verified). Moved up because its verified date has passed.'),
  ).toBeVisible();
  await expect(page.getByText('Avoidable charge, recorded date in 8 days (not verified)')).toBeVisible();
  await expect(page.getByText('Opportunity, recorded date in 40 days (planning, not verified)')).toBeVisible();
  await expect(page.getByText('1 task has a recorded date in the past')).toBeVisible();
  expect(await hasHorizontalScroll(page)).toBe(false);

  await page.getByText('Recorded date', { exact: true }).first().click();
  await expect(page.getByRole('radio', { name: 'Recorded date' })).toBeChecked();
  expect(await taskNames(page)).toEqual([
    NAMES.plumber,
    NAMES.photos,
    NAMES.library,
    NAMES.broadband,
    NAMES.dentist,
    NAMES.plants,
    NAMES.markup,
  ]);
  await expect(page.getByText('Why this order:')).toHaveCount(0);

  await page.getByText('Financial priority', { exact: true }).click();
  expect((await taskNames(page))[0]).toBe(NAMES.photos);
});

test('shows one origin per view and keeps counting tasks without one', async ({ page }) => {
  await mockGoogle(page);
  await connect(page);
  await expect(page.getByText('Origin missing: 2 tasks.')).toBeVisible();
  await expect(page.getByText('Origin missing', { exact: true })).toBeVisible();

  await page.getByText('You requested', { exact: true }).first().click();
  await expect(page.getByText('Showing 3 of 8 tasks')).toBeVisible();
  expect(await taskNames(page)).toEqual([NAMES.plumber, NAMES.library, NAMES.broadband]);
  await expect(page.getByText('Tasks without a valid Origin are in All tasks and By date, not in this view.')).toBeVisible();

  await page.getByText('Inbound', { exact: true }).first().click();
  await expect(page.getByText('Showing 2 of 8 tasks')).toBeVisible();
  expect(await taskNames(page)).toEqual([NAMES.photos, NAMES.dentist]);

  // Status filters and search still apply inside the view.
  await page.getByRole('searchbox', { name: 'Search tasks and notes' }).fill('deposit');
  await expect(page.getByText('Showing 1 of 8 tasks')).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search tasks and notes' }).fill('');
  await page.getByText('Waiting on you', { exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'No tasks match' })).toBeVisible();
  await page.getByRole('button', { name: 'Reset filters' }).first().click();
  await expect(page.getByText('Showing 2 of 8 tasks')).toBeVisible();
  expect(await hasHorizontalScroll(page)).toBe(false);
});

test('shows progress, money at stake, effort and expected finish as labelled lines, folding long text', async ({ page }) => {
  await mockGoogle(page);
  await connect(page);
  await expect(page.getByText('Form filled in; proof of address still to print.')).toBeVisible();
  await expect(page.getByText('Basis: avoidable charge')).toBeVisible();
  await expect(page.getByText('Includes waiting on someone else')).toBeVisible();
  await expect(page.getByText('Planning date', { exact: true })).toBeVisible();

  const link = page.getByRole('link', { name: /broadband\/table-with-a-very-long-address/ });
  await expect(link).toHaveCount(0);
  const toggle = page.getByRole('button', { name: `Show full text for ${NAMES.broadband}` });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(page.getByRole('button', { name: `Show less text for ${NAMES.broadband}` })).toHaveAttribute('aria-expanded', 'true');
  expect(await hasHorizontalScroll(page)).toBe(false);
});

test('stays readable on a 390px-wide phone', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'phone layout only');
  await page.setViewportSize({ width: 390, height: 844 });
  await mockGoogle(page);
  await connect(page);
  await expect(page.getByRole('table')).toHaveCount(0);
  for (const view of ['All tasks', 'You requested', 'Inbound', 'By date']) {
    await page.getByText(view, { exact: true }).first().click();
    await expandAllNotes(page);
    expect(await hasHorizontalScroll(page), view).toBe(false);
  }
  // Nothing sticks out of its card either, with every long text and note open.
  await page.getByText('All tasks', { exact: true }).click();
  const overflowing = await page.evaluate(() =>
    [...document.querySelectorAll('.task-card')].filter((card) =>
      [...card.querySelectorAll('*')].some((part) => part.getBoundingClientRect().right > card.getBoundingClientRect().right + 0.5),
    ).length,
  );
  expect(overflowing).toBe(0);
});

test('never words a recorded date as due, overdue or enforced', async ({ page }) => {
  await mockGoogle(page);
  await connect(page);
  await page.getByRole('checkbox', { name: /^Done/ }).check({ force: true });
  await expandAllNotes(page);
  await page.getByText('How Financial priority works').click();
  for (const view of ['All tasks', 'You requested', 'Inbound', 'By date']) {
    await page.getByText(view, { exact: true }).first().click();
    expect(await page.locator('main').innerText(), view).not.toMatch(/overdue|\bdue\b|enforced/i);
  }
  await expect(page.getByText('Recorded date', { exact: true }).first()).toBeVisible();
});

test('shows links from the Links column as buttons that open in a new tab', async ({ page }) => {
  await mockGoogle(page);
  await connect(page);
  const link = page.getByRole('link', { name: 'Earlier draft (superseded)' });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('href', 'https://example.org/broadband/old');
  expect(await hasHorizontalScroll(page)).toBe(false);
});

test('explains a refused Google consent screen', async ({ page }) => {
  const { sheetRequests } = await mockGoogle(page, { gis: { mode: 'deny' } });
  await page.goto('/');
  await page.getByRole('button', { name: 'Connect Google account' }).click();
  await expect(page.getByRole('alert')).toContainText('Google access wasn’t granted');
  expect(sheetRequests).toEqual([]);
});

test('offers another account when this one cannot open the sheet', async ({ page }) => {
  await mockGoogle(page, {
    sheets: [
      { status: 403, body: { error: { code: 403, message: 'The caller does not have permission', status: 'PERMISSION_DENIED' } } },
      { status: 200, body: undefined },
    ],
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Connect Google account' }).click();
  await expect(page.getByRole('alert')).toContainText('This Google account can’t open the tracker');
  await page.getByRole('button', { name: 'Use a different Google account' }).click();
  await expect(page.getByText('Synced with your sheet')).toBeVisible();
  const prompts = await page.evaluate(() =>
    (window as unknown as { __FAKE_GIS_REQUESTS__: { prompt: string }[] }).__FAKE_GIS_REQUESTS__.map((r) => r.prompt),
  );
  expect(prompts).toEqual(['', 'select_account']);
});

test('marks tasks as out of date when the sign-in expires, then reconnects', async ({ page }) => {
  await mockGoogle(page, { gis: { mode: 'grant', expiresIn: 62 } });
  await connect(page);
  await expect(page.getByText('Google sign-in expired: tasks may be out of date')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Renew library card', { exact: true })).toBeVisible();

  await page.evaluate(() => ((window as unknown as { __FAKE_GIS__: unknown }).__FAKE_GIS__ = { mode: 'grant' }));
  await page.getByRole('button', { name: 'Reconnect' }).first().click();
  await expect(page.getByText('Synced with your sheet')).toBeVisible();
});

test('signing out removes every task from the page', async ({ page }) => {
  await mockGoogle(page);
  await connect(page);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByText('You’re signed out. Your tasks were cleared from this page.')).toBeVisible();
  expect(await page.content()).not.toContain('Renew library card');
});

test('stores nothing in the browser and talks only to Google', async ({ page }) => {
  const hosts = new Set<string>();
  page.on('request', (request) => hosts.add(new URL(request.url()).host));
  await mockGoogle(page);
  await connect(page);
  const storage = await page.evaluate(async () => ({
    local: localStorage.length,
    session: sessionStorage.length,
    databases: (await indexedDB.databases()).length,
    caches: (await caches.keys()).length,
    serviceWorkers: (await navigator.serviceWorker.getRegistrations()).length,
    cookies: document.cookie,
  }));
  expect(storage).toEqual({ local: 0, session: 0, databases: 0, caches: 0, serviceWorkers: 0, cookies: '' });
  expect([...hosts].sort()).toEqual(['accounts.google.com', 'localhost:4173', 'sheets.googleapis.com']);
});

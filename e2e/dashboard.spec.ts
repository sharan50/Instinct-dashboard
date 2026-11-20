import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { connect, hasHorizontalScroll, isoDate, lifeValues, mockGoogle, openView, sheetReply } from './helpers.ts';

/** Presses Tab until `target` has focus. */
async function tabTo(page: Page, target: Locator) {
  for (let presses = 0; presses < 80; presses += 1) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error('the element never received focus');
}

/** Opens every folded part of every task: short cards, the notes and any long text behind "Show full text". */
async function expandAllNotes(page: Page) {
  for (const name of [/^Show details for/, /^Show notes for/, /^Show full text for/]) {
    const show = page.getByRole('button', { name });
    while ((await show.count()) > 0) await show.first().click();
  }
}

/** Task names in the order shown: card headings on a phone, the first table column on a wide screen. */
function taskNames(page: Page): Promise<string[]> {
  return page.locator('.task-card .task-title, .task-title-cell > span:first-child').allTextContents();
}

/** Task names inside one group of the Today view. */
function groupNames(page: Page, group: RegExp): Promise<string[]> {
  return page.getByRole('region', { name: group }).locator('.task-title').allTextContents();
}

const LIFE = {
  boiler: 'Book the boiler service',
  form: 'Reply to the school trip form',
  cleaning: 'Collect the dry cleaning',
  railcard: 'Renew the railcard',
  latch: 'Landlord to fix the gate latch',
  invoice: 'Garage to send the invoice',
  albums: 'Sort the photo albums',
  beds: 'Plan the spring allotment beds',
  books: 'Return the library books',
  tyres: 'Swap the winter tyres',
};

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
  // The dashboard opens on Today.
  await expect(page.getByRole('radio', { name: 'Today' })).toBeChecked();
  await expect(page.getByText('Showing 4 of 8 tasks')).toBeVisible();
  expect(await hasHorizontalScroll(page)).toBe(false);
  await openView(page, 'All tasks');
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
    // The row header (read out for every cell of its row) holds the name, not the "why" sentence.
    await expect(page.locator('.task-table tbody th').first()).not.toContainText('Why this order');
    await expect(page.locator('.task-table tbody td:last-child').first()).toContainText('Why this order:');
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

  // The views come first; the arrow keys move between them.
  const today = page.getByRole('radio', { name: 'Today' });
  await tabTo(page, today);
  expect(await today.evaluate((input) => getComputedStyle(input.nextElementSibling as Element).outlineStyle)).toBe('solid');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'All tasks' })).toBeChecked();

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
  // Today, first with its short cards closed, then with everything open.
  await expectNoAccessibilityViolations(page);
  await expandAllNotes(page);
  await expectNoAccessibilityViolations(page);

  await openView(page, 'All tasks');
  await expandAllNotes(page);
  await page.getByText('How Financial priority works').click();
  await expectNoAccessibilityViolations(page);

  await openView(page, 'Inbound');
  await expect(page.getByText('Showing 2 of 8 tasks')).toBeVisible();
  await expectNoAccessibilityViolations(page);

  await openView(page, 'By date');
  await expectNoAccessibilityViolations(page);

  await openView(page, 'Review');
  await expandAllNotes(page);
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
  await expect(page.getByText('Date verified not recognised: maybe')).toBeVisible();
  // And for Area and Next step.
  await expect(page.getByText('Tests <b>bold</b>', { exact: true })).toBeVisible();
  await expect(page.getByText('<img src=x onerror="window.__xss=3"> stays as text as well.')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  await expect(page.locator('main img, main b, main i')).toHaveCount(0);
});

test('orders by financial priority, says why, and switches back to the recorded-date order', async ({ page }) => {
  await mockGoogle(page);
  await connect(page);
  await expect(page.getByRole('radio', { name: 'Financial priority' })).toBeChecked();
  // The opportunity whose verified date is 2 days ahead is moved up by the fixed rule; then the top tier;
  // then the other opportunities, where the verified date that has passed leads its tier but is not moved up.
  expect(await taskNames(page)).toEqual([
    NAMES.photos,
    NAMES.library,
    NAMES.plumber,
    NAMES.broadband,
    NAMES.dentist,
    NAMES.plants,
    NAMES.markup,
  ]);
  await expect(
    page.getByText(
      'Opportunity, recorded date in 2 days (verified). Moved up by the fixed 7-day rule: its verified date is within 7 days.',
    ),
  ).toBeVisible();
  await expect(page.getByText('Avoidable charge, recorded date in 8 days (not verified)')).toBeVisible();
  await expect(
    page.getByText(
      'Opportunity, recorded date 3 days ago (verified). The date has passed; the dashboard does not know whether a consequence applies now.',
    ),
  ).toBeVisible();
  await expect(page.getByText('Opportunity, recorded date in 40 days (planning, not verified)')).toBeVisible();
  await expect(page.getByText('1 task has a recorded date in the past')).toBeVisible();
  expect(await hasHorizontalScroll(page)).toBe(false);

  // The panel says plainly what the order cannot tell you.
  await page.getByText('How Financial priority works').click();
  await expect(page.getByText('The dashboard cannot compare amounts, currencies or the real cost of an opportunity')).toBeVisible();
  await expect(page.getByText('The 7-day window is an arbitrary fixed threshold.')).toBeVisible();
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

  // The date-grouped view has no "why" line, so there the date line says a verified date has passed.
  await page.getByText('By date', { exact: true }).click();
  await expect(page.getByText('Why this order:')).toHaveCount(0);
  await expect(
    page.getByText('The date has passed; the dashboard does not know whether a consequence applies now.'),
  ).toHaveCount(1);
  expect(await hasHorizontalScroll(page)).toBe(false);
});

test('shows one origin per view and keeps counting tasks without one', async ({ page }) => {
  await mockGoogle(page);
  await connect(page);
  await expect(page.getByText('Origin missing: 2 tasks.')).toBeVisible();
  await expect(page.getByText('Origin missing', { exact: true })).toBeVisible();

  await page.getByText('You requested', { exact: true }).first().click();
  await expect(page.getByText('Showing 3 of 8 tasks')).toBeVisible();
  expect(await taskNames(page)).toEqual([NAMES.library, NAMES.plumber, NAMES.broadband]);
  await expect(page.getByText('Tasks without a valid Origin are in All tasks and By date, not in this view.')).toBeVisible();

  await page.getByText('Inbound', { exact: true }).first().click();
  await expect(page.getByText('Showing 2 of 8 tasks')).toBeVisible();
  expect(await taskNames(page)).toEqual([NAMES.photos, NAMES.dentist]);

  // Status filters and search still apply inside the view.
  await page.getByRole('searchbox', { name: 'Search tasks and notes' }).fill('booth');
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
  const overflowingCards = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.task-card')].filter((card) =>
        [...card.querySelectorAll('*')].some((part) => part.getBoundingClientRect().right > card.getBoundingClientRect().right + 0.5),
      ).length,
    );
  // Every view, with every short card, long text and note open: no sideways scrolling, nothing sticking out of its card.
  for (const view of ['Today', 'All tasks', 'You requested', 'Inbound', 'By date', 'Review']) {
    await openView(page, view);
    await expandAllNotes(page);
    expect(await hasHorizontalScroll(page), view).toBe(false);
    expect(await overflowingCards(), view).toBe(0);
  }
  // The six views sit in a three-by-two grid that fits the screen.
  const switchBox = await page.locator('.view-switch--views').boundingBox();
  expect(switchBox?.width ?? 0).toBeLessThanOrEqual(390 - 32);
  const tops = await page.locator('.view-switch--views .view-switch__option').evaluateAll((options) => [
    ...new Set(options.map((option) => Math.round(option.getBoundingClientRect().top))),
  ]);
  expect(tops).toHaveLength(2);
});

test('never words a recorded date as due, overdue or enforced', async ({ page }) => {
  await mockGoogle(page);
  await connect(page);
  await page.getByRole('checkbox', { name: /^Done/ }).check({ force: true });
  await expandAllNotes(page);
  await page.getByText('How Financial priority works').click();
  for (const view of ['All tasks', 'You requested', 'Inbound', 'By date', 'Today', 'Review']) {
    await openView(page, view);
    await expandAllNotes(page);
    expect(await page.locator('main').innerText(), view).not.toMatch(/overdue|\bdue\b|enforced|missed|too late/i);
  }
  await openView(page, 'All tasks');
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

test('opens on Today: your move, the next 7 days and who to chase, as short cards', async ({ page }, testInfo) => {
  await mockGoogle(page, { sheets: [sheetReply(lifeValues())] });
  await connect(page, 'Today');
  await expect(page.getByRole('radio', { name: 'Today' })).toBeChecked();
  expect(await groupNames(page, /^Your move/)).toEqual([LIFE.form, LIFE.boiler]);
  // Verified dates first, then by date.
  expect(await groupNames(page, /^Next 7 days/)).toEqual([LIFE.railcard, LIFE.cleaning, LIFE.tyres]);
  // The longest without an update first.
  expect(await groupNames(page, /^Chase/)).toEqual([LIFE.latch, LIFE.invoice]);
  await expect(page.getByText('Showing 7 of 10 tasks')).toBeVisible();
  await expect(page.getByText(/^1 more task that is not done is not on this screen/)).toBeVisible();
  // No status chips, no sort order, and never a table: Today is cards on every screen.
  await expect(page.getByRole('checkbox', { name: /^Done/ })).toHaveCount(0);
  await expect(page.getByRole('radio', { name: 'Financial priority' })).toHaveCount(0);
  await expect(page.getByRole('table')).toHaveCount(0);

  // A short card: the next step is on it, the notes are behind "Show details".
  const boiler = page.getByRole('article', { name: LIFE.boiler });
  await expect(boiler).toContainText('Next step: Ring the engineer for a slot');
  await expect(boiler.getByText('Home', { exact: true })).toBeVisible();
  await expect(boiler.getByRole('button', { name: /notes/i })).toHaveCount(0);
  const details = boiler.getByRole('button', { name: `Show details for ${LIFE.boiler}` });
  await expect(details).toHaveAttribute('aria-expanded', 'false');
  await details.click();
  await expect(boiler.getByRole('button', { name: `Hide details for ${LIFE.boiler}` })).toHaveAttribute('aria-expanded', 'true');
  await boiler.getByRole('button', { name: `Show notes for ${LIFE.boiler}` }).click();
  await expect(boiler.getByText('The engineer prefers mornings.')).toBeVisible();
  expect(await hasHorizontalScroll(page)).toBe(false);

  // What "Show details" reveals comes after the toggle, inside the part it controls: the next Tab reaches it.
  const form = page.getByRole('article', { name: LIFE.form });
  await expect(form.getByRole('link', { name: /^Add to calendar: / })).toHaveCount(0);
  const formDetails = form.getByRole('button', { name: `Show details for ${LIFE.form}` });
  const controlled = await formDetails.getAttribute('aria-controls');
  await formDetails.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(form.getByRole('link', { name: /^Add to calendar: / })).toBeFocused();
  await expect(page.locator(`[id="${controlled}"]`).getByRole('link', { name: /^Add to calendar: / })).toBeVisible();

  // On a wide screen the three groups sit side by side; on a phone they are stacked.
  const lefts = await page.locator('.today__group').evaluateAll((groups) => groups.map((group) => Math.round(group.getBoundingClientRect().left)));
  expect(new Set(lefts).size).toBe(testInfo.project.name === 'phone' ? 1 : 3);

  await page.getByRole('button', { name: 'See all tasks' }).click();
  await expect(page.getByRole('radio', { name: 'All tasks' })).toBeChecked();
  expect(await taskNames(page)).toContain(LIFE.albums);
});

test('never passes off an unreadable status or date as "not waiting on anyone"', async ({ page }) => {
  const values = lifeValues();
  values.push(['L11', 'Status typed wrongly', 'waiting on me', '', '', '']);
  values.push(['L12', 'Date typed wrongly', 'open', '25/12/2026', '', '']);
  await mockGoogle(page, { sheets: [sheetReply(values)] });
  await connect(page, 'Today');
  expect(await groupNames(page, /^Can’t be placed/)).toEqual(['Status typed wrongly', 'Date typed wrongly']);
  await expect(page.getByText('Unknown status: waiting on me')).toBeVisible();
  await expect(page.getByText('Not a YYYY-MM-DD date')).toBeVisible();
  // The count of readable leftovers is unchanged, and the done task is counted too.
  await expect(page.getByText(/^1 more task that is not done is not on this screen/)).toBeVisible();
  await expect(page.getByText('1 done task is left out.')).toBeVisible();
  await expect(page.getByText('Showing 9 of 12 tasks')).toBeVisible();
  expect(await hasHorizontalScroll(page)).toBe(false);

  // A search that only matches a done task says so, instead of "no match".
  await page.getByRole('searchbox', { name: 'Search tasks and notes' }).fill('library books');
  await expect(page.getByText(/^1 matching task is done, and this view lists only tasks that are not done\./)).toBeVisible();
});

test('filters by area and keeps tasks that have not started behind a count', async ({ page }) => {
  await mockGoogle(page, { sheets: [sheetReply(lifeValues())] });
  await connect(page);
  await expect(page.getByText('Showing 8 of 10 tasks')).toBeVisible();
  expect(await taskNames(page)).not.toContain(LIFE.beds);

  const notStarted = page.getByRole('checkbox', { name: 'Show tasks that have not started yet, 1 task' });
  await expect(notStarted).not.toBeChecked();
  await notStarted.check({ force: true });
  await expect(page.getByText('Showing 9 of 10 tasks')).toBeVisible();
  expect(await taskNames(page)).toContain(LIFE.beds);
  // The badge on the task itself, not the chip's own label.
  await expect(page.locator('.task-card .badge, .task-table .badge').filter({ hasText: 'Not started yet' })).toHaveCount(1);
  await notStarted.uncheck({ force: true });

  const area = page.getByRole('combobox', { name: 'Area' });
  await expect(area.locator('option')).toHaveText([
    'All areas',
    'car (2 not done)',
    'Family (1 not done)',
    'Garden (1 not done)',
    'Home (3 not done)',
    'Travel (1 not done)',
    'No area (1 not done)',
  ]);
  await area.selectOption({ label: 'car (2 not done)' });
  await expect(page.getByText('Showing 2 of 10 tasks')).toBeVisible();
  expect((await taskNames(page)).sort()).toEqual([LIFE.invoice, LIFE.tyres].sort());
  // The area narrows the other views too.
  await openView(page, 'Today');
  expect(await groupNames(page, /^Your move/)).toEqual([]);
  expect(await groupNames(page, /^Next 7 days/)).toEqual([LIFE.tyres]);
  expect(await groupNames(page, /^Chase/)).toEqual([LIFE.invoice]);
  await page.getByRole('button', { name: 'Reset filters' }).click();
  await expect(area).toHaveValue('ALL');
  await expect(page.getByText('Showing 7 of 10 tasks')).toBeVisible();
  expect(await hasHorizontalScroll(page)).toBe(false);
});

test('lists what has gone quiet or is missing something under Review', async ({ page }) => {
  await mockGoogle(page, { sheets: [sheetReply(lifeValues())] });
  await connect(page, 'Review');
  await expect(page.getByRole('heading', { level: 2, name: /^Needs a look/ })).toBeVisible();
  expect(await taskNames(page)).toEqual([LIFE.latch, LIFE.tyres, LIFE.railcard, LIFE.albums]);
  const flags = (name: string) => page.getByRole('article', { name }).getByRole('list', { name: 'Flagged for' }).getByRole('listitem');
  await expect(flags(LIFE.latch)).toHaveText(['No update for 45 days', 'Waiting on someone else, no date']);
  await expect(flags(LIFE.tyres)).toHaveText(['No last update recorded']);
  await expect(flags(LIFE.railcard)).toHaveText(['No next step']);
  await expect(flags(LIFE.albums)).toHaveText(['No area']);
  await expect(page.locator('.review-checks li')).toHaveText([
    'No update for 30 days or more: 1',
    'No last update recorded: 1',
    'Waiting on someone else with no recorded date: 1',
    'No next step: 1',
    'No area: 1',
  ]);
  await expect(page.getByText('Showing 4 of 10 tasks')).toBeVisible();
  await expandAllNotes(page);
  expect(await hasHorizontalScroll(page)).toBe(false);
});

test('offers "Add to calendar" for verified upcoming dates, as a plain link to Google Calendar', async ({ page }) => {
  const hosts = new Set<string>();
  page.on('request', (request) => hosts.add(new URL(request.url()).host));
  await mockGoogle(page, { sheets: [sheetReply(lifeValues())] });
  await connect(page);
  const links = page.getByRole('link', { name: /^Add to calendar: / });
  // Only the two verified dates ahead: not the planning date, not the dates nobody verified.
  await expect(links).toHaveCount(2);
  const link = page.getByRole('link', { name: `Add to calendar: ${LIFE.form} (opens Google Calendar in a new tab)` });
  await expect(link).toHaveText('Add to calendar');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  const url = new URL((await link.getAttribute('href')) ?? '');
  expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
  const day = (offset: number) => isoDate(offset).replaceAll('-', '');
  expect(Object.fromEntries(url.searchParams)).toEqual({
    action: 'TEMPLATE',
    text: LIFE.form,
    dates: `${day(2)}/${day(3)}`,
    details: 'Task L02 in the task tracker.',
  });
  // Showing the link contacts nobody: the calendar is only reached if the link is followed.
  expect([...hosts]).not.toContain('calendar.google.com');
});

test('serves a web manifest and icons for a home-screen shortcut, and asks for a browser tab', async ({ page, request }) => {
  await mockGoogle(page);
  await page.goto('/');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/icons/apple-touch-icon.png');

  const reply = await request.get('/manifest.webmanifest');
  expect(reply.status()).toBe(200);
  const manifest = (await reply.json()) as { display: string; start_url: string; icons: { src: string; sizes: string }[] };
  // What the site asks for; some phones open a home-screen icon as a web app regardless.
  expect(manifest.display).toBe('browser');
  for (const path of [...manifest.icons.map((icon) => `/${icon.src}`), '/icons/apple-touch-icon.png']) {
    const icon = await request.get(path);
    expect(icon.status(), path).toBe(200);
    expect(icon.headers()['content-type'], path).toBe('image/png');
    // The first bytes of every PNG file.
    expect((await icon.body()).subarray(1, 4).toString(), path).toBe('PNG');
  }
  // Still no service worker and nothing stored: the icon is only a shortcut.
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
  expect(await page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations)).toEqual([]);
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

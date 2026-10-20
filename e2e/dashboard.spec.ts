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

async function expandAllNotes(page: Page) {
  const show = page.getByRole('button', { name: /^Show notes for/ });
  while ((await show.count()) > 0) await show.first().click();
}

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
    'https://sheets.googleapis.com/v4/spreadsheets/test-spreadsheet-id-not-real-000000/values/Tasks!A1%3AF1000?valueRenderOption=FORMATTED_VALUE Bearer fake-token',
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
  await page.getByText('Deadlines', { exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name: /^Overdue/ })).toBeVisible();
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
    await expect(page.getByRole('table', { name: 'Tasks, earliest deadline first' })).toBeVisible();
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
  await expectNoAccessibilityViolations(page);

  await page.getByText('Deadlines', { exact: true }).click();
  await expectNoAccessibilityViolations(page);
});

test('shows notes and names as plain text', async ({ page }) => {
  await mockGoogle(page);
  await connect(page);
  await expect(page.getByText('Check the <b>markup</b> stays text', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Show notes for Check the/ }).click();
  await expect(page.getByText('<img src=x onerror="window.__xss=1"> stays as text.')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  await expect(page.locator('main img, main b')).toHaveCount(0);
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

import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

/**
 * Browser tests run against a production build with made-up settings. Google
 * is faked (see e2e/helpers.ts): no real account, sheet or network is used.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'en-GB',
    timezoneId: 'Asia/Kolkata',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'], viewport: { width: 360, height: 740 } } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
  ],
  webServer: {
    command: `npx vite build --outDir dist-e2e && npx vite preview --outDir dist-e2e --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      VITE_GOOGLE_CLIENT_ID: '123456789012-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com',
      VITE_SPREADSHEET_ID: 'test-spreadsheet-id-not-real-000000',
      VITE_GOOGLE_ACCOUNT_HINT: 'person@example.com',
    },
  },
});

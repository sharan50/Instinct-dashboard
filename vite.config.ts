import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { META_CSP } from './security-headers.ts';

/** Placeholder in index.html, right after the charset, where the policy goes. */
const CSP_MARKER = '<!-- content-security-policy -->';

/**
 * The site is served from the domain root on Netlify. A GitHub Pages
 * "project site" lives under /<repo-name>/, so its build sets BASE_PATH.
 */
function basePath(): string {
  const raw = process.env.BASE_PATH?.trim();
  if (!raw) return '/';
  const withLeadingSlash = raw.startsWith('/') ? raw : `/${raw}`;
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`;
}

export default defineConfig({
  base: basePath(),
  plugins: [
    react(),
    {
      name: 'content-security-policy-meta',
      // Only for production builds: the dev server needs inline scripts.
      apply: 'build',
      transformIndexHtml(html) {
        const tag = `<meta http-equiv="Content-Security-Policy" content="${META_CSP}" />`;
        if (!html.includes(CSP_MARKER)) throw new Error(`index.html is missing ${CSP_MARKER}`);
        return html.replace(CSP_MARKER, tag);
      },
    },
  ],
  server: {
    // Google only accepts sign-in from the exact origins listed on the OAuth
    // client, so the dev server must always use http://localhost:5173.
    host: 'localhost',
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: 'localhost',
    port: 4173,
    strictPort: true,
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    // Run in a timezone that is not UTC or India by default, so bugs that
    // shift date-only deadlines by a day show up. Override with TZ=... .
    env: { TZ: process.env.TZ ?? 'America/New_York' },
    restoreMocks: true,
    unstubGlobals: true,
  },
});

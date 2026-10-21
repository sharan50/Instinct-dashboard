import { describe, expect, it } from 'vitest';
import netlifyToml from '../netlify.toml?raw';
import { HEADER_CSP, META_CSP } from '../security-headers.ts';

describe('security headers', () => {
  it('netlify.toml sends the same Content-Security-Policy as the page', () => {
    expect(netlifyToml).toContain(`Content-Security-Policy = "${HEADER_CSP}"`);
    expect(HEADER_CSP).toBe(`${META_CSP}; frame-ancestors 'none'`);
  });

  it('only allows Google sign-in and the Google APIs the dashboard uses', () => {
    expect(META_CSP).toContain("script-src 'self' https://accounts.google.com/gsi/client;");
    expect(META_CSP).toContain(
      "connect-src 'self' https://sheets.googleapis.com https://oauth2.googleapis.com https://accounts.google.com/gsi/;",
    );
    expect(META_CSP).toContain("worker-src 'none'");
    expect(META_CSP).not.toContain('unsafe-inline');
    expect(META_CSP).not.toContain('unsafe-eval');
  });

  it('lets Google’s sign-in pop-up work and keeps the site out of search engines', () => {
    expect(netlifyToml).toContain('Cross-Origin-Opener-Policy = "same-origin-allow-popups"');
    expect(netlifyToml).toContain('X-Robots-Tag = "noindex, nofollow"');
  });
});

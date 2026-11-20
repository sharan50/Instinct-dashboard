import { describe, expect, it } from 'vitest';
import indexHtml from '../index.html?raw';
import manifestText from '../public/manifest.webmanifest?raw';
import { META_CSP } from '../security-headers.ts';

interface Manifest {
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  icons: { src: string; sizes: string; type: string; purpose?: string }[];
}

const manifest = JSON.parse(manifestText) as Manifest;

describe('home-screen icon', () => {
  it('is offered through a web manifest and an Apple touch icon', () => {
    expect(indexHtml).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(indexHtml).toContain('<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />');
    expect(manifest.name).toBe('Task dashboard');
    expect(manifest.short_name).toBe('Tasks');
    expect(manifest.icons.map((icon) => `${icon.sizes} ${icon.purpose ?? 'any'}`)).toEqual([
      '192x192 any',
      '512x512 any',
      '512x512 maskable',
    ]);
    for (const icon of manifest.icons) expect(icon.type).toBe('image/png');
  });

  it('opens the site in the normal browser, where Google’s sign-in window works', () => {
    // "standalone" would open the site without the browser around it; sign-in pop-ups are unreliable there.
    expect(manifest.display).toBe('browser');
    expect(indexHtml).not.toContain('apple-mobile-web-app-capable');
    expect(indexHtml).not.toContain('mobile-web-app-capable');
  });

  it('uses relative addresses, so it also works when the site is served from a sub-folder', () => {
    expect(manifest.start_url).toBe('.');
    expect(manifest.scope).toBe('.');
    for (const icon of manifest.icons) expect(icon.src).toMatch(/^icons\/[a-z0-9-]+\.png$/);
  });

  it('names nothing private and needs no change to the security policy', () => {
    // The manifest is a public file: it holds the site's generic name and icons only.
    expect(Object.keys(manifest).sort()).toEqual(
      ['background_color', 'description', 'display', 'icons', 'name', 'scope', 'short_name', 'start_url', 'theme_color'].sort(),
    );
    expect(META_CSP).toContain("manifest-src 'self'");
    expect(META_CSP).toContain("img-src 'self' data:");
    // Still no service worker: nothing is stored for offline use.
    expect(META_CSP).toContain("worker-src 'none'");
    expect(indexHtml).not.toMatch(/serviceWorker/);
  });
});

/**
 * Content Security Policy for the built site.
 *
 * It is applied twice and the two copies must stay in sync (a unit test checks
 * this): as a <meta> tag injected into index.html at build time, which is the
 * only option on GitHub Pages, and as an HTTP header in netlify.toml, which can
 * also forbid framing.
 *
 * Only Google's sign-in library and the two Google APIs the app calls are
 * allowed. Google's library also tries to add an inline <style> for its
 * sign-in button; this app does not use that button, so the style is blocked
 * on purpose (it only causes a harmless console warning).
 */
const directives: Record<string, string[]> = {
  'default-src': ["'self'"],
  'script-src': ["'self'", 'https://accounts.google.com/gsi/client'],
  'style-src': ["'self'", 'https://accounts.google.com/gsi/style'],
  'connect-src': [
    "'self'",
    'https://sheets.googleapis.com',
    'https://oauth2.googleapis.com',
    'https://accounts.google.com/gsi/',
  ],
  'frame-src': ['https://accounts.google.com/gsi/'],
  'img-src': ["'self'", 'data:'],
  'font-src': ["'self'"],
  'manifest-src': ["'self'"],
  'object-src': ["'none'"],
  'worker-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'none'"],
};

function serialize(policy: Record<string, string[]>): string {
  return Object.entries(policy)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ');
}

/** For the <meta> tag. Browsers ignore frame-ancestors there, so it is omitted. */
export const META_CSP = serialize(directives);

/** For the HTTP header (netlify.toml). */
export const HEADER_CSP = serialize({ ...directives, 'frame-ancestors': ["'none'"] });

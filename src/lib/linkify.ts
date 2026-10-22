/**
 * Splits plain note text into text and link pieces so web addresses can be
 * clicked. The pieces are rendered by React as text nodes and <a> elements:
 * notes are never interpreted as HTML. Only https:// links become links.
 */

export type NotePart = { type: 'text'; text: string } | { type: 'link'; text: string; href: string };

const URL_PATTERN = /https:\/\/[^\s<>"']+/g;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}]+$/;

export function splitLinks(text: string): NotePart[] {
  const parts: NotePart[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index;
    let url = match[0];
    // "see https://example.com/doc." should not swallow the full stop.
    const trailing = TRAILING_PUNCTUATION.exec(url)?.[0] ?? '';
    // Keep a closing bracket that belongs to the URL, e.g. ".../Thing_(x)".
    const keep = trailing.startsWith(')') && url.includes('(') ? 1 : 0;
    url = url.slice(0, url.length - trailing.length + keep);

    let href: string | null = null;
    try {
      const parsed = new URL(url);
      href = parsed.protocol === 'https:' ? parsed.href : null;
    } catch {
      href = null;
    }
    if (!href) continue;

    if (start > last) parts.push({ type: 'text', text: text.slice(last, start) });
    parts.push({ type: 'link', text: url, href });
    last = start + url.length;
  }
  if (last < text.length) parts.push({ type: 'text', text: text.slice(last) });
  return parts;
}

/** One entry of the "Links" column: a label and, when the entry has a usable https address, the link. */
export interface TaskLink {
  label: string;
  href: string | null;
}

/**
 * Reads the "Links" column. Entries are separated by ";" or new lines and are
 * usually written as "Label: https://…" (for example
 * "Shortlist: https://… ; earlier page (superseded): https://…"). An entry
 * without a label is named after the site it points to; an entry without an
 * https address is kept as plain text.
 */
export function parseLinks(text: string): TaskLink[] {
  const links: TaskLink[] = [];
  for (const entry of text.split(/;|\n/)) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const parts = splitLinks(trimmed);
    const urls = parts.filter((part) => part.type === 'link');
    if (urls.length === 0) {
      links.push({ label: trimmed, href: null });
      continue;
    }
    const firstUrl = parts.findIndex((part) => part.type === 'link');
    const label = parts
      .slice(0, firstUrl)
      .map((part) => part.text)
      .join('')
      .replace(/[\s:–—-]+$/, '')
      .trim();
    urls.forEach((url, index) => {
      const site = new URL(url.href).hostname.replace(/^www\./, '');
      const name = label || site;
      links.push({ label: urls.length > 1 ? `${name} (${index + 1})` : name, href: url.href });
    });
  }
  return links;
}

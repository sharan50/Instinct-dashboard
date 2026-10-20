import { describe, expect, it } from 'vitest';
import { splitLinks } from './linkify.ts';

describe('splitLinks', () => {
  it('turns https addresses into links and leaves the rest as text', () => {
    expect(splitLinks('Latest version: https://example.org/doc/1/edit and more')).toEqual([
      { type: 'text', text: 'Latest version: ' },
      { type: 'link', text: 'https://example.org/doc/1/edit', href: 'https://example.org/doc/1/edit' },
      { type: 'text', text: ' and more' },
    ]);
  });

  it('leaves trailing punctuation outside the link', () => {
    expect(splitLinks('See https://example.org/a. Then (https://example.org/b).')).toEqual([
      { type: 'text', text: 'See ' },
      { type: 'link', text: 'https://example.org/a', href: 'https://example.org/a' },
      { type: 'text', text: '. Then (' },
      { type: 'link', text: 'https://example.org/b', href: 'https://example.org/b' },
      { type: 'text', text: ').' },
    ]);
  });

  it('only links https addresses', () => {
    expect(splitLinks('http://example.org javascript:alert(1)')).toEqual([
      { type: 'text', text: 'http://example.org javascript:alert(1)' },
    ]);
  });

  it('keeps HTML-looking text as plain text', () => {
    expect(splitLinks('<img src=x onerror=alert(1)> <b>bold</b>')).toEqual([
      { type: 'text', text: '<img src=x onerror=alert(1)> <b>bold</b>' },
    ]);
  });

  it('handles empty notes', () => {
    expect(splitLinks('')).toEqual([]);
  });
});

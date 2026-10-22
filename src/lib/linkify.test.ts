import { describe, expect, it } from 'vitest';
import { parseLinks, splitLinks } from './linkify.ts';

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

describe('parseLinks', () => {
  it('reads labelled links separated by semicolons', () => {
    expect(parseLinks('Shortlist: https://example.org/a ; earlier page (superseded): https://example.org/b')).toEqual([
      { label: 'Shortlist', href: 'https://example.org/a' },
      { label: 'earlier page (superseded)', href: 'https://example.org/b' },
    ]);
  });

  it('names unlabelled links after their site and keeps text without a link', () => {
    expect(parseLinks('https://www.example.org/doc\nsee the email thread')).toEqual([
      { label: 'example.org', href: 'https://www.example.org/doc' },
      { label: 'see the email thread', href: null },
    ]);
  });

  it('never links anything but https', () => {
    expect(parseLinks('Bad: javascript:alert(1); Old: http://example.org')).toEqual([
      { label: 'Bad: javascript:alert(1)', href: null },
      { label: 'Old: http://example.org', href: null },
    ]);
  });

  it('handles an empty cell and several links in one entry', () => {
    expect(parseLinks('')).toEqual([]);
    expect(parseLinks('Docs: https://example.org/1 https://example.org/2')).toEqual([
      { label: 'Docs (1)', href: 'https://example.org/1' },
      { label: 'Docs (2)', href: 'https://example.org/2' },
    ]);
  });
});

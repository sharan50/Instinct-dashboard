import { describe, expect, it } from 'vitest';
import { LONG_PROGRESS } from '../test/fixtures.ts';
import { clipText, LONG_TEXT_CHARS, PREVIEW_CHARS } from './preview.ts';

describe('clipText', () => {
  it('leaves short text alone', () => {
    expect(clipText('')).toEqual({ text: '', clipped: false });
    expect(clipText('Two quotes in.')).toEqual({ text: 'Two quotes in.', clipped: false });
    const justUnder = 'word '.repeat(LONG_TEXT_CHARS / 5).trim();
    expect(justUnder.length).toBeLessThanOrEqual(LONG_TEXT_CHARS);
    expect(clipText(justUnder)).toEqual({ text: justUnder, clipped: false });
  });

  it('shows the beginning of long text, cut between words', () => {
    const preview = clipText(LONG_PROGRESS);
    expect(preview.clipped).toBe(true);
    expect(preview.text).toBe(
      'Form downloaded and filled in. Waiting for the committee secretary to countersign it before it can be posted,',
    );
    expect(preview.text.length).toBeLessThanOrEqual(PREVIEW_CHARS);
    expect(LONG_PROGRESS.startsWith(preview.text)).toBe(true);
  });

  it('never cuts through a web address', () => {
    const before = 'See the terms and the fee table that the provider published on its help pages last year, here:';
    const url = 'https://example.org/a/very/long/path/that/would/otherwise/be/cut/in/the/middle/of/the/address?with=a&query=1';
    const preview = clipText(`${before} ${url} and then some more words after the address to make it long.`);
    expect(preview).toEqual({ text: before, clipped: true });
  });

  it('keeps a first word that is longer than the preview whole', () => {
    const url = `https://example.org/${'x'.repeat(200)}`;
    expect(clipText(`${url} is the page`)).toEqual({ text: url, clipped: true });
    // Nothing would be hidden, so nothing is folded.
    expect(clipText(url)).toEqual({ text: url, clipped: false });
  });

  it('folds text with many lines, keeping the first three', () => {
    expect(clipText('one\ntwo\nthree')).toEqual({ text: 'one\ntwo\nthree', clipped: false });
    expect(clipText('one\ntwo\nthree\nfour\nfive')).toEqual({ text: 'one\ntwo\nthree', clipped: true });
  });
});

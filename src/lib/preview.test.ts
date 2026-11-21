import { describe, expect, it } from 'vitest';
import { LONG_PROGRESS } from '../test/fixtures.ts';
import { clipText, LONG_TEXT_CHARS, LONG_TEXT_LINES, PREVIEW_CHARS, PREVIEW_LINES } from './preview.ts';

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

  it('folds at exactly one character over the limit, not at the limit', () => {
    expect([LONG_TEXT_CHARS, PREVIEW_CHARS]).toEqual([160, 110]);
    const atLimit = `${'word '.repeat(31)}words`;
    expect(atLimit).toHaveLength(160);
    expect(clipText(atLimit)).toEqual({ text: atLimit, clipped: false });

    const overLimit = `${atLimit}x`;
    expect(overLimit).toHaveLength(161);
    const preview = clipText(overLimit);
    expect(preview.clipped).toBe(true);
    // The last gap between words at or before character 110 is at 109.
    expect(preview.text).toBe(`${'word '.repeat(21)}word`);
    expect(preview.text).toHaveLength(109);
  });

  it('uses a gap that falls exactly on the preview limit', () => {
    // Gaps at 11, 22, ... 110: the preview may be exactly 110 characters long.
    const start = `${'a'.repeat(11)} ${`${'a'.repeat(10)} `.repeat(9)}`;
    expect(start.lastIndexOf(' ')).toBe(110);
    const preview = clipText(`${start}${'b'.repeat(60)}`);
    expect(preview).toEqual({ text: start.trimEnd(), clipped: true });
    expect(preview.text).toHaveLength(110);
  });

  it('shows a few short lines in full and folds only a longer list, keeping the first three lines', () => {
    expect([LONG_TEXT_LINES, PREVIEW_LINES]).toEqual([5, 3]);
    expect(clipText('one\ntwo\nthree')).toEqual({ text: 'one\ntwo\nthree', clipped: false });
    // Folding four or five short lines would hide a line or two behind a toggle that is taller than they are.
    expect(clipText('Sand\nPrime\nPaint\nDry')).toEqual({ text: 'Sand\nPrime\nPaint\nDry', clipped: false });
    expect(clipText('one\ntwo\nthree\nfour\nfive')).toEqual({ text: 'one\ntwo\nthree\nfour\nfive', clipped: false });
    expect(clipText('one\ntwo\nthree\nfour\nfive\nsix')).toEqual({ text: 'one\ntwo\nthree', clipped: true });
  });
});

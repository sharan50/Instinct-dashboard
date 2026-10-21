import { describe, expect, it } from 'vitest';
import {
  daysBetween,
  describeTimeZone,
  formatCalendarDate,
  formatRelative,
  formatTimeOrTimestamp,
  formatTimestamp,
  parseCalendarDate,
  parseTimestamp,
  todayIn,
} from './dates.ts';

const date = (iso: string) => {
  const parsed = parseCalendarDate(iso);
  if (!parsed) throw new Error(`bad test date ${iso}`);
  return parsed;
};

describe('parseCalendarDate', () => {
  it('reads YYYY-MM-DD as a calendar date', () => {
    expect(parseCalendarDate('2026-10-29')).toEqual({ year: 2026, month: 10, day: 29, iso: '2026-10-29' });
    expect(parseCalendarDate(' 2026-10-29 ')?.iso).toBe('2026-10-29');
    expect(parseCalendarDate('2028-02-29')?.iso).toBe('2028-02-29');
  });

  it('rejects other formats and impossible dates', () => {
    for (const value of ['', '29/10/2026', '2026-10-29T00:00', '2026-1-5', '2026-02-30', '2027-02-29', '2026-13-01', '2026-00-10', 'soon']) {
      expect(parseCalendarDate(value), value).toBeNull();
    }
  });
});

describe('date-only deadlines stay calendar dates in every timezone', () => {
  it('formats the same day regardless of the process timezone', () => {
    // The test runner uses America/New_York by default, where new Date("2026-10-29") is still the 28th.
    expect(formatCalendarDate(date('2026-10-29'), { locale: 'en-GB' })).toBe('Thu, 29 Oct 2026');
    expect(formatCalendarDate(date('2026-01-01'), { locale: 'en-GB' })).toBe('Thu, 1 Jan 2026');
  });

  it('works out "today" in the viewer timezone', () => {
    const instant = new Date('2026-10-20T20:00:00Z');
    expect(todayIn(instant, 'Asia/Kolkata').iso).toBe('2026-10-21');
    expect(todayIn(instant, 'Europe/London').iso).toBe('2026-10-20');
    expect(todayIn(instant, 'America/Los_Angeles').iso).toBe('2026-10-20');
    expect(todayIn(instant, 'Pacific/Kiritimati').iso).toBe('2026-10-21');
    expect(todayIn(instant, 'Pacific/Pago_Pago').iso).toBe('2026-10-20');
  });

  it('counts whole days, unaffected by daylight-saving changes', () => {
    expect(daysBetween(date('2026-10-21'), date('2026-10-29'))).toBe(8);
    expect(daysBetween(date('2026-10-29'), date('2026-10-21'))).toBe(-8);
    expect(daysBetween(date('2026-03-28'), date('2026-03-30'))).toBe(2);
    expect(daysBetween(date('2026-10-24'), date('2026-10-26'))).toBe(2);
    expect(daysBetween(date('2026-12-31'), date('2027-01-01'))).toBe(1);
  });
});

describe('parseTimestamp', () => {
  it('reads ISO 8601 timestamps with an offset', () => {
    expect(parseTimestamp('2026-10-21T02:50:00+05:30')?.toISOString()).toBe('2026-10-20T21:20:00.000Z');
    expect(parseTimestamp('2026-10-21T02:50:00Z')?.toISOString()).toBe('2026-10-21T02:50:00.000Z');
    expect(parseTimestamp('2026-10-21T02:50+0530')?.toISOString()).toBe('2026-10-20T21:20:00.000Z');
    expect(parseTimestamp('2026-10-21T02:50:00.123456-04:00')?.toISOString()).toBe('2026-10-21T06:50:00.123Z');
  });

  it('rejects timestamps without an offset and invalid values', () => {
    for (const value of ['2026-10-21T02:50:00', '2026-10-21', '21/10/2026 02:50', '2026-02-30T10:00:00Z', '2026-10-21T25:00:00Z', 'yesterday']) {
      expect(parseTimestamp(value), value).toBeNull();
    }
  });
});

describe('timestamps show in the viewer timezone with a label', () => {
  const lastUpdate = new Date('2026-10-20T21:20:00Z');

  it.each([
    ['Asia/Kolkata', '21 Oct 2026, 02:50 GMT+5:30'],
    ['Europe/London', '20 Oct 2026, 22:20 BST'],
    ['America/Los_Angeles', '20 Oct 2026, 14:20 GMT-7'],
    ['UTC', '20 Oct 2026, 21:20 UTC'],
  ])('%s', (timeZone, expected) => {
    expect(formatTimestamp(lastUpdate, { locale: 'en-GB', timeZone })).toBe(expected);
  });

  it('shows only the time for today, and the full timestamp otherwise', () => {
    const options = { locale: 'en-GB', timeZone: 'Asia/Kolkata' };
    const now = new Date('2026-10-21T04:00:00Z');
    expect(formatTimeOrTimestamp(new Date('2026-10-21T03:30:00Z'), now, options)).toBe('09:00 GMT+5:30');
    expect(formatTimeOrTimestamp(lastUpdate, new Date('2026-10-23T04:00:00Z'), options)).toBe('21 Oct 2026, 02:50 GMT+5:30');
  });

  it('names the timezone being used', () => {
    expect(describeTimeZone(new Date('2026-10-21T00:00:00Z'), { locale: 'en-GB', timeZone: 'Asia/Kolkata' })).toBe(
      'Asia/Kolkata (GMT+5:30)',
    );
  });
});

describe('formatRelative', () => {
  const now = new Date('2026-10-21T12:00:00Z');
  const options = { locale: 'en-GB', timeZone: 'UTC' };

  it.each([
    ['2026-10-21T11:59:30Z', 'just now'],
    ['2026-10-21T11:55:00Z', '5 minutes ago'],
    ['2026-10-21T09:00:00Z', '3 hours ago'],
    ['2026-10-20T08:00:00Z', 'yesterday'],
    ['2026-10-17T12:00:00Z', '4 days ago'],
  ])('%s is %s', (iso, expected) => {
    expect(formatRelative(new Date(iso), now, options)).toBe(expected);
  });
});

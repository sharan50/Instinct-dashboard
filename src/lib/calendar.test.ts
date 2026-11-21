import { describe, expect, it } from 'vitest';
import { makeTask } from '../test/fixtures.ts';
import { calendarUrl, offersCalendarLink } from './calendar.ts';
import { parseCalendarDate, type CalendarDate } from './dates.ts';
import type { Task } from './tasks.ts';

const today = parseCalendarDate('2026-10-21') as CalendarDate;
const dated = (iso: string, overrides: Partial<Task> = {}) =>
  makeTask({ deadline: parseCalendarDate(iso), rawDeadline: iso, dateVerification: 'verified', ...overrides });

describe('offersCalendarLink', () => {
  it('offers the link for a verified date that is today or later', () => {
    expect(offersCalendarLink(dated('2026-10-21'), today)).toBe(true);
    expect(offersCalendarLink(dated('2027-03-01'), today)).toBe(true);
  });

  it('does not offer it for a date that has passed', () => {
    expect(offersCalendarLink(dated('2026-10-20'), today)).toBe(false);
  });

  it('does not offer it for a date that is not verified', () => {
    expect(offersCalendarLink(dated('2026-10-25', { dateVerification: 'planning' }), today)).toBe(false);
    expect(offersCalendarLink(dated('2026-10-25', { dateVerification: 'unknown' }), today)).toBe(false);
    expect(offersCalendarLink(dated('2026-10-25', { dateVerification: null }), today)).toBe(false);
  });

  it('does not offer it for a done task or a task with no readable date', () => {
    expect(offersCalendarLink(dated('2026-10-25', { status: 'done' }), today)).toBe(false);
    expect(offersCalendarLink(makeTask({ dateVerification: 'verified' }), today)).toBe(false);
    expect(offersCalendarLink(makeTask({ dateVerification: 'verified', rawDeadline: 'Friday' }), today)).toBe(false);
  });
});

describe('calendarUrl', () => {
  const params = (task: Task) => new URL(calendarUrl(task) ?? '').searchParams;

  it('opens Google Calendar with an all-day event on the recorded date', () => {
    const url = new URL(calendarUrl(dated('2026-10-23', { id: 'L02', title: 'Reply to the school trip form' })) ?? '');
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      action: 'TEMPLATE',
      text: 'Reply to the school trip form',
      dates: '20261023/20261024',
      details: 'Task L02 in the task tracker.',
    });
  });

  it('ends the event on the next day across a month and a year', () => {
    expect(params(dated('2026-10-31')).get('dates')).toBe('20261031/20261101');
    expect(params(dated('2026-12-31')).get('dates')).toBe('20261231/20270101');
    expect(params(dated('2028-02-28')).get('dates')).toBe('20280228/20280229');
  });

  it('sends only the task name and its ID: no notes, links, amounts or other cells', () => {
    const url = calendarUrl(
      dated('2026-10-23', {
        id: 'L02',
        title: 'Reply to the form',
        notes: 'private-note',
        rawLinks: 'https://example.org/private-link',
        moneyAtStake: 'private-amount',
        progress: 'private-progress',
        nextStep: 'private-step',
        area: 'private-area',
      }),
    );
    expect(url).not.toMatch(/private/);
  });

  it('escapes the task name', () => {
    const url = calendarUrl(dated('2026-10-23', { title: 'Tea & biscuits? #1 =yes' })) ?? '';
    expect(url).toContain('text=Tea+%26+biscuits%3F+%231+%3Dyes');
    expect(new URL(url).searchParams.get('text')).toBe('Tea & biscuits? #1 =yes');
  });

  it('falls back to the Task ID or the row when the name is blank', () => {
    expect(params(dated('2026-10-23', { id: 'L02', title: '' })).get('text')).toBe('L02');
    const unnamed = dated('2026-10-23', { id: '', title: '', rowNumber: 9 });
    expect(params(unnamed).get('text')).toBe('Task on row 9');
    expect(params(unnamed).get('details')).toBe('From the task tracker.');
  });

  it('gives no link without a date', () => {
    expect(calendarUrl(makeTask())).toBeNull();
  });
});

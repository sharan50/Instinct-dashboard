import { describe, expect, it } from 'vitest';
import { lifeValues, makeTask, sampleValues } from '../test/fixtures.ts';
import { parseCalendarDate, parseTimestamp, type CalendarDate } from './dates.ts';
import { DEFAULT_STATUS_FILTER, filterTasks } from './filters.ts';
import { countFlags, describeFlag, reviewFlags, reviewList, STALE_AFTER_DAYS } from './review.ts';
import { parseTaskSheet, type SheetColumns, type Task } from './tasks.ts';

const today = parseCalendarDate('2026-10-21') as CalendarDate;
const INDIA = 'Asia/Kolkata';
const NO_COLUMNS = parseTaskSheet(sampleValues()).columns;
const ALL_COLUMNS = parseTaskSheet(lifeValues()).columns;
const updated = (iso: string) => parseTimestamp(iso) as Date;
const kinds = (task: Task, columns: SheetColumns = ALL_COLUMNS) =>
  reviewFlags(task, today, columns, INDIA).map((flag) => flag.kind);
/** A task with nothing to flag. */
const tidy = (overrides: Partial<Task> = {}) =>
  makeTask({ lastUpdate: updated('2026-10-20T09:00:00+05:30'), area: 'Home', nextStep: 'Ring them', ...overrides });

describe('reviewFlags', () => {
  it('flags nothing on a task that is up to date and filled in', () => {
    expect(kinds(tidy())).toEqual([]);
  });

  it('flags a task with no update for 30 days, counted in whole calendar days', () => {
    expect(STALE_AFTER_DAYS).toBe(30);
    // 29 days back is not flagged; 30 days back is.
    expect(kinds(tidy({ lastUpdate: updated('2026-09-22T23:00:00+05:30') }))).toEqual([]);
    expect(reviewFlags(tidy({ lastUpdate: updated('2026-09-21T23:00:00+05:30') }), today, ALL_COLUMNS, INDIA)).toEqual([
      { kind: 'stale', days: 30 },
    ]);
  });

  it('counts the days on the viewer’s calendar, not in UTC', () => {
    // 20:00 UTC on 20 Sep is already 21 Sep in India (30 days back) but still 20 Sep in Los Angeles (31).
    const task = tidy({ lastUpdate: updated('2026-09-20T20:00:00Z') });
    expect(reviewFlags(task, today, ALL_COLUMNS, INDIA)).toEqual([{ kind: 'stale', days: 30 }]);
    expect(reviewFlags(task, today, ALL_COLUMNS, 'America/Los_Angeles')).toEqual([{ kind: 'stale', days: 31 }]);
  });

  it('flags a blank or unreadable last update as not recorded, without guessing an age', () => {
    expect(kinds(tidy({ lastUpdate: null }))).toEqual(['no-update']);
    expect(kinds(tidy({ lastUpdate: null, rawLastUpdate: 'last Tuesday' }))).toEqual(['no-update']);
  });

  it('flags waiting on someone else only when there is no date to look again', () => {
    expect(kinds(tidy({ status: 'waiting on someone else' }))).toEqual(['waiting-undated']);
    expect(kinds(tidy({ status: 'waiting on someone else', deadline: parseCalendarDate('2026-12-01') }))).toEqual([]);
    expect(kinds(tidy({ status: 'waiting on you' }))).toEqual([]);
    // A date that is written but unreadable is flagged as that, not as missing.
    expect(kinds(tidy({ status: 'waiting on someone else', rawDeadline: 'soon' }))).toEqual(['bad-date']);
  });

  it('flags a Status or Deadline cell that cannot be read, whatever else the task has', () => {
    expect(kinds(tidy({ status: null, rawStatus: 'paused' }))).toEqual(['bad-status']);
    expect(kinds(tidy({ status: null, rawStatus: '' }))).toEqual(['bad-status']);
    expect(kinds(tidy({ rawDeadline: '25/10/2026' }))).toEqual(['bad-date']);
    expect(kinds(tidy({ status: null, rawStatus: 'paused', rawDeadline: 'Friday' }))).toEqual(['bad-status', 'bad-date']);
    // These two do not depend on any optional column.
    expect(kinds(tidy({ status: null, rawStatus: 'paused', area: '', nextStep: '' }), NO_COLUMNS)).toEqual(['bad-status']);
    expect(reviewFlags(tidy({ status: null }), today, ALL_COLUMNS, INDIA).map(describeFlag)).toEqual(['No valid status']);
    expect(reviewFlags(tidy({ rawDeadline: 'Friday' }), today, ALL_COLUMNS, INDIA).map(describeFlag)).toEqual(['Date not readable']);
  });

  it('flags a blank next step or area only when the sheet has that column', () => {
    const bare = tidy({ area: '', nextStep: '' });
    expect(kinds(bare)).toEqual(['no-next-step', 'no-area']);
    expect(kinds(bare, { ...ALL_COLUMNS, nextStep: false })).toEqual(['no-area']);
    expect(kinds(bare, { ...ALL_COLUMNS, area: false })).toEqual(['no-next-step']);
    expect(kinds(bare, NO_COLUMNS)).toEqual([]);
  });
});

describe('reviewList', () => {
  const active = (values: string[][]) =>
    filterTasks(parseTaskSheet(values).tasks, { statuses: DEFAULT_STATUS_FILTER, query: '', startedBy: today });

  it('lists only flagged tasks: most flags first, then the longest quiet, then sheet order', () => {
    const items = reviewList(active(lifeValues()), today, ALL_COLUMNS, INDIA);
    expect(items.map((item) => item.task.id)).toEqual(['L05', 'L10', 'L04', 'L07']);
    expect(items.map((item) => item.flags.map(describeFlag))).toEqual([
      ['No update for 41 days', 'Waiting on someone else, no date'],
      ['No last update recorded'],
      ['No next step'],
      ['No area'],
    ]);
  });

  it('counts how many tasks each check found', () => {
    const items = reviewList(active(lifeValues()), today, ALL_COLUMNS, INDIA);
    const none = { 'bad-status': 0, 'bad-date': 0, stale: 0, 'no-update': 0, 'waiting-undated': 0, 'no-next-step': 0, 'no-area': 0 };
    expect(countFlags(items)).toEqual({ ...none, stale: 1, 'no-update': 1, 'waiting-undated': 1, 'no-next-step': 1, 'no-area': 1 });
    expect(countFlags([])).toEqual(none);
  });

  it('works on a sheet with none of the optional columns', () => {
    // Every sample row was updated within the last few days and the one waiting task has a date.
    expect(reviewList(active(sampleValues()), today, NO_COLUMNS, INDIA)).toEqual([]);
  });

  it('puts an unknown last update ahead of a known old one when the flag counts are equal', () => {
    const tasks = [
      tidy({ id: 'old', rowNumber: 2, lastUpdate: updated('2026-01-01T10:00:00Z') }),
      tidy({ id: 'unknown', rowNumber: 3, lastUpdate: null }),
      tidy({ id: 'older', rowNumber: 4, lastUpdate: updated('2025-06-01T10:00:00Z') }),
    ];
    expect(reviewList(tasks, today, ALL_COLUMNS, INDIA).map((item) => item.task.id)).toEqual(['unknown', 'older', 'old']);
  });
});

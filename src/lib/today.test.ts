import { describe, expect, it } from 'vitest';
import { lifeValues, makeTask, sampleValues } from '../test/fixtures.ts';
import { parseCalendarDate, parseTimestamp, type CalendarDate } from './dates.ts';
import { DEFAULT_STATUS_FILTER, filterTasks } from './filters.ts';
import { parseTaskSheet, type Task } from './tasks.ts';
import { todaySections } from './today.ts';

const today = parseCalendarDate('2026-10-21') as CalendarDate;
const date = (iso: string) => parseCalendarDate(iso) as CalendarDate;
const ids = (tasks: Task[]) => tasks.map((task) => task.id);

/** What the dashboard hands to the Today view: tasks that are not done and have started. */
function active(values: string[][]): Task[] {
  return filterTasks(parseTaskSheet(values).tasks, { statuses: DEFAULT_STATUS_FILTER, query: '', startedBy: today });
}

describe('todaySections', () => {
  it('splits the tasks into Your move, Next 7 days and Chase', () => {
    const sections = todaySections(active(lifeValues()), today);
    expect(ids(sections.yourMove)).toEqual(['L02', 'L01']);
    expect(ids(sections.nextDays)).toEqual(['L04', 'L03', 'L11', 'L10']);
    expect(ids(sections.chase)).toEqual(['L05', 'L06']);
    // L07 is open with no date: on none of the three lists, but counted.
    expect(sections.elsewhere).toBe(1);
  });

  it('lists each task once, in the first group it fits', () => {
    const tasks = [
      // Waiting on you with a date this week: Your move, not Next 7 days.
      makeTask({ id: 'A', rowNumber: 2, status: 'waiting on you', deadline: date('2026-10-22') }),
      // Waiting on someone else with a date this week: Next 7 days, not Chase.
      makeTask({ id: 'B', rowNumber: 3, status: 'waiting on someone else', deadline: date('2026-10-22') }),
      makeTask({ id: 'C', rowNumber: 4, status: 'waiting on someone else' }),
    ];
    const sections = todaySections(tasks, today);
    expect(ids(sections.yourMove)).toEqual(['A']);
    expect(ids(sections.nextDays)).toEqual(['B']);
    expect(ids(sections.chase)).toEqual(['C']);
    expect(sections.elsewhere).toBe(0);
  });

  it('counts "Next 7 days" from today to exactly 7 days ahead', () => {
    const on = (id: string, iso: string) => makeTask({ id, deadline: date(iso) });
    const tasks = [on('yesterday', '2026-10-20'), on('today', '2026-10-21'), on('day7', '2026-10-28'), on('day8', '2026-10-29')];
    const sections = todaySections(tasks, today);
    expect(ids(sections.nextDays)).toEqual(['today', 'day7']);
    // A date that has passed, and one further ahead, are left to the other views.
    expect(sections.elsewhere).toBe(2);
  });

  it('puts verified dates first in Next 7 days, then earliest first', () => {
    const tasks = [
      makeTask({ id: 'planning-tomorrow', rowNumber: 2, deadline: date('2026-10-22'), dateVerification: 'planning' }),
      makeTask({ id: 'unknown-today', rowNumber: 3, deadline: date('2026-10-21') }),
      makeTask({ id: 'verified-day6', rowNumber: 4, deadline: date('2026-10-27'), dateVerification: 'verified' }),
      makeTask({ id: 'verified-day2', rowNumber: 5, deadline: date('2026-10-23'), dateVerification: 'verified' }),
      // A value the dashboard does not recognise is not verified.
      makeTask({ id: 'odd-today', rowNumber: 6, deadline: date('2026-10-21'), dateVerification: null }),
    ];
    expect(ids(todaySections(tasks, today).nextDays)).toEqual([
      'verified-day2',
      'verified-day6',
      'unknown-today',
      'odd-today',
      'planning-tomorrow',
    ]);
  });

  it('orders Your move by financial priority', () => {
    const mine = (id: string, rowNumber: number, overrides: Partial<Task>) =>
      makeTask({ id, rowNumber, status: 'waiting on you', ...overrides });
    const tasks = [
      mine('no-basis', 2, {}),
      mine('opportunity', 3, { basis: 'opportunity' }),
      mine('charge', 4, { basis: 'avoidable charge' }),
    ];
    expect(ids(todaySections(tasks, today).yourMove)).toEqual(['charge', 'opportunity', 'no-basis']);
  });

  it('orders Chase by the longest time without an update, unknown first', () => {
    const waiting = (id: string, rowNumber: number, lastUpdate: string | null) =>
      makeTask({ id, rowNumber, status: 'waiting on someone else', lastUpdate: lastUpdate ? parseTimestamp(lastUpdate) : null });
    const tasks = [
      waiting('recent', 2, '2026-10-20T10:00:00Z'),
      waiting('old', 3, '2026-08-01T10:00:00Z'),
      waiting('never', 4, null),
      waiting('older-row', 5, '2026-08-01T10:00:00Z'),
    ];
    expect(ids(todaySections(tasks, today).chase)).toEqual(['never', 'old', 'older-row', 'recent']);
  });

  it('works on a sheet with none of the optional columns', () => {
    const sections = todaySections(active(sampleValues()), today);
    // Both have no basis; in financial priority order the one with a recorded date comes first.
    expect(ids(sections.yourMove)).toEqual(['T006', 'T002']);
    // T003's date has passed, so it is under Chase; T001's date is 8 days ahead.
    expect(ids(sections.nextDays)).toEqual([]);
    expect(ids(sections.chase)).toEqual(['T003']);
    expect(sections.elsewhere).toBe(2);
  });

  it('never guesses from text: a date written in the notes or the next step moves nothing', () => {
    const tasks = [makeTask({ id: 'A', notes: 'Needed by 2026-10-22', nextStep: 'Pay tomorrow', moneyAtStake: '500' })];
    const sections = todaySections(tasks, today);
    expect(sections.nextDays).toEqual([]);
    expect(sections.elsewhere).toBe(1);
  });

  it('leaves the given list untouched', () => {
    const tasks = active(lifeValues());
    const before = ids(tasks);
    todaySections(tasks, today);
    expect(ids(tasks)).toEqual(before);
  });
});

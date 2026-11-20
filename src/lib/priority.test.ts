import { describe, expect, it } from 'vitest';
import { HEADER, makeTask, planningValues, sampleValues } from '../test/fixtures.ts';
import { parseCalendarDate, type CalendarDate } from './dates.ts';
import { DEFAULT_STATUS_FILTER, filterTasks, sortByDeadline } from './filters.ts';
import {
  PASSED_NOTE,
  priorityRank,
  priorityReason,
  PROMOTED_NOTE,
  PROMOTION_WINDOW_DAYS,
  sortByPriority,
} from './priority.ts';
import { parseTaskSheet, type Task } from './tasks.ts';

const today = parseCalendarDate('2026-10-21') as CalendarDate;

/** [id, deadline, basis, date verified, money at stake, status]. Rows keep the order they are given in. */
type Row = [id: string, deadline: string, basis: string, verified: string, money?: string, status?: string];

/** Invented rows, parsed the same way the dashboard parses the sheet. */
function parse(...rows: Row[]): Task[] {
  return parseTaskSheet([
    [...HEADER, 'Delay-cost basis', 'Date verified', 'Money at stake'],
    ...rows.map(([id, deadline, basis, verified, money = '', status = 'open']) => [
      id,
      `Task ${id}`,
      status,
      deadline,
      '',
      '',
      basis,
      verified,
      money,
    ]),
  ]).tasks;
}

const order = (tasks: Task[]) => sortByPriority(tasks, today).map((task) => task.id);
const reason = (row: Row) => priorityReason(parse(row)[0] as Task, today);

describe('tiers', () => {
  it('puts avoidable charge and deadline first, then opportunity, then unknown or blank, then sunk or reference', () => {
    const tasks = parse(
      ['sunk', '', 'sunk or reference', ''],
      ['blank', '', '', ''],
      ['opportunity', '', 'opportunity', ''],
      ['deadline', '', 'deadline', ''],
      ['charge', '', 'avoidable charge', ''],
      ['unknown', '', 'unknown', ''],
    );
    // "deadline" and "charge" share the top tier, and "blank" and "unknown" the third: those keep sheet order.
    expect(order(tasks)).toEqual(['deadline', 'charge', 'opportunity', 'blank', 'unknown', 'sunk']);
  });

  it('ranks a basis it does not recognise as unknown', () => {
    const tasks = parse(['sunk', '', 'sunk or reference', ''], ['odd', '', 'urgent!!', ''], ['opportunity', '', 'opportunity', '']);
    expect(order(tasks)).toEqual(['opportunity', 'odd', 'sunk']);
    expect(priorityRank(tasks[1] as Task, today).tier).toBe(priorityRank(makeTask({ basis: 'unknown' }), today).tier);
  });

  it('orders a tier by recorded date, past dates first, then soonest, then tasks with no date in sheet order', () => {
    const tasks = parse(
      ['none-1', '', 'avoidable charge', ''],
      ['later', '2026-11-10', 'avoidable charge', ''],
      ['past', '2026-10-19', 'avoidable charge', ''],
      ['tomorrow', '2026-10-22', 'avoidable charge', ''],
      ['none-2', '', 'avoidable charge', ''],
    );
    expect(order(tasks)).toEqual(['past', 'tomorrow', 'later', 'none-1', 'none-2']);
  });

  it('keeps the tier above the date: a later top-tier task still comes before an earlier lower-tier one', () => {
    const tasks = parse(
      ['sunk-past', '2026-10-01', 'sunk or reference', ''],
      ['blank-past', '2026-10-02', '', ''],
      ['opportunity-past', '2026-10-03', 'opportunity', ''],
      ['charge-later', '2026-12-24', 'avoidable charge', ''],
    );
    expect(order(tasks)).toEqual(['charge-later', 'opportunity-past', 'blank-past', 'sunk-past']);
  });
});

describe('free text is never a ranking signal', () => {
  it('does not move a task up because Money at stake is filled in', () => {
    const tasks = parse(
      ['plain', '', 'opportunity', ''],
      ['with-money', '', 'opportunity', '', '5000 at risk, due 2026-10-22, urgent'],
      // A blank basis stays in the unknown tier however large the text sounds.
      ['no-basis', '', '', '', 'Huge: 99999 if this slips past tomorrow'],
      ['sunk-with-money', '', 'sunk or reference', '', '1 000 000'],
    );
    expect(order(tasks)).toEqual(['plain', 'with-money', 'no-basis', 'sunk-with-money']);
  });

  it('gives the same order whether or not Money at stake has text', () => {
    const rows: Row[] = [
      ['a', '2026-10-25', 'opportunity', 'planning'],
      ['b', '', 'avoidable charge', ''],
      ['c', '2026-10-22', '', 'verified'],
      ['d', '', 'deadline', ''],
    ];
    const withMoney = rows.map(([id, ...rest], index): Row => [id, rest[0], rest[1], rest[2], `${(index + 1) * 1000} by 2026-10-2${index}`]);
    expect(order(parse(...withMoney))).toEqual(order(parse(...rows)));
  });

  it('takes the date only from the Deadline cell, never from a date written in the text', () => {
    const [task] = parse(['x', '', 'avoidable charge', 'verified', 'Charged on 2026-10-22']);
    expect(priorityRank(task as Task, today)).toMatchObject({ date: 'none', days: null });
    expect(priorityReason(task as Task, today).text).toBe('Avoidable charge, no date recorded');
  });
});

describe('an undated charge against a task with a date', () => {
  it('goes below every dated task of its own tier, even when it is first in the sheet', () => {
    const tasks = parse(
      ['undated-charge', '', 'avoidable charge', ''],
      ['deadline-tomorrow', '2026-10-22', 'deadline', ''],
      ['charge-past', '2026-10-18', 'avoidable charge', 'planning'],
    );
    expect(order(tasks)).toEqual(['charge-past', 'deadline-tomorrow', 'undated-charge']);
  });

  it('goes below an adjacent-tier task whose verified date is today or within 7 days', () => {
    const tasks = parse(
      ['undated-charge', '', 'avoidable charge', ''],
      ['opportunity-in-2-days', '2026-10-23', 'opportunity', 'verified'],
      ['opportunity-today', '2026-10-21', 'opportunity', 'verified'],
    );
    expect(order(tasks)).toEqual(['opportunity-today', 'opportunity-in-2-days', 'undated-charge']);
    expect(tasks.map((task) => priorityRank(task, today).lifted)).toEqual([false, true, true]);
  });

  it('stays above an adjacent-tier task whose verified date has passed, however recently or long ago', () => {
    const tasks = parse(
      ['opportunity-yesterday', '2026-10-20', 'opportunity', 'verified'],
      ['opportunity-last-year', '2025-10-21', 'opportunity', 'verified'],
      ['undated-charge', '', 'avoidable charge', ''],
      ['charge-planning-later', '2026-12-01', 'avoidable charge', 'planning'],
    );
    // Neither passed date crosses into the top tier; inside their own tier they stay in date order.
    expect(order(tasks)).toEqual(['charge-planning-later', 'undated-charge', 'opportunity-last-year', 'opportunity-yesterday']);
    expect(tasks.map((task) => priorityRank(task, today).lifted)).toEqual([false, false, false, false]);
  });

  it('stays above an adjacent-tier task whose date is not verified, however close that date is', () => {
    const tasks = parse(
      ['undated-charge', '', 'avoidable charge', ''],
      ['opportunity-tomorrow-planning', '2026-10-22', 'opportunity', 'planning'],
      ['opportunity-past-unknown', '2026-10-20', 'opportunity', ''],
      ['opportunity-today-misspelt', '2026-10-21', 'opportunity', 'verifed'],
    );
    expect(order(tasks)).toEqual([
      'undated-charge',
      'opportunity-past-unknown',
      'opportunity-today-misspelt',
      'opportunity-tomorrow-planning',
    ]);
    expect(tasks.map((task) => priorityRank(task, today).lifted)).toEqual([false, false, false, false]);
  });

  it('moves the verified task above top-tier tasks whose date is not verified, but not above a verified one', () => {
    const tasks = parse(
      ['charge-undated', '', 'avoidable charge', ''],
      ['charge-planning-today', '2026-10-21', 'avoidable charge', 'planning'],
      ['charge-verified-in-60-days', '2026-12-20', 'avoidable charge', 'verified'],
      ['opportunity-verified-tomorrow', '2026-10-22', 'opportunity', 'verified'],
    );
    expect(order(tasks)).toEqual([
      'charge-verified-in-60-days',
      'opportunity-verified-tomorrow',
      'charge-planning-today',
      'charge-undated',
    ]);
  });

  it('uses a fixed window of exactly 7 days: today and day 7 move up, yesterday and day 8 do not', () => {
    expect(PROMOTION_WINDOW_DAYS).toBe(7);
    const tasks = parse(
      ['undated-charge', '', 'avoidable charge', ''],
      ['day-8', '2026-10-29', 'opportunity', 'verified'],
      ['day-7', '2026-10-28', 'opportunity', 'verified'],
      ['day-6', '2026-10-27', 'opportunity', 'verified'],
      ['today', '2026-10-21', 'opportunity', 'verified'],
      ['yesterday', '2026-10-20', 'opportunity', 'verified'],
    );
    const lifted = Object.fromEntries(tasks.map((task) => [task.id, priorityRank(task, today).lifted]));
    expect(lifted).toEqual({
      'undated-charge': false,
      'day-8': false,
      'day-7': true,
      'day-6': true,
      today: true,
      yesterday: false,
    });
    expect(order(tasks)).toEqual(['today', 'day-6', 'day-7', 'undated-charge', 'yesterday', 'day-8']);
  });

  it('applies the same window whatever the text says is at stake: it is not a ranking by size', () => {
    const tasks = parse(
      ['undated-charge', '', 'avoidable charge', '', 'A very large amount, 1 000 000'],
      ['small-in-7-days', '2026-10-28', 'opportunity', 'verified', 'Pennies'],
      ['huge-in-8-days', '2026-10-29', 'opportunity', 'verified', 'Everything, 999 999 999 in any currency'],
    );
    expect(order(tasks)).toEqual(['small-in-7-days', 'undated-charge', 'huge-in-8-days']);
  });

  it('only applies to the tier next to the top: unknown and sunk-or-reference tasks are never moved up', () => {
    const tasks = parse(
      ['sunk-verified-today', '2026-10-21', 'sunk or reference', 'verified'],
      ['blank-verified-past', '2026-10-20', '', 'verified'],
      ['opportunity-undated', '', 'opportunity', ''],
      ['charge-undated', '', 'avoidable charge', ''],
    );
    expect(order(tasks)).toEqual(['charge-undated', 'opportunity-undated', 'blank-verified-past', 'sunk-verified-today']);
  });
});

describe('verified, planning and unknown dates', () => {
  it('puts verified dates first in a tier: a planning or unknown date never outranks one, however early it is', () => {
    const tasks = parse(
      ['none', '', 'avoidable charge', ''],
      ['planning-tomorrow', '2026-10-22', 'avoidable charge', 'planning'],
      ['unknown-past', '2026-10-16', 'avoidable charge', 'unknown'],
      ['verified-in-30-days', '2026-11-20', 'avoidable charge', 'verified'],
      ['blank-in-2-days', '2026-10-23', 'deadline', ''],
      ['verified-in-90-days', '2027-01-19', 'deadline', 'verified'],
    );
    expect(order(tasks)).toEqual([
      'verified-in-30-days',
      'verified-in-90-days',
      'unknown-past',
      'planning-tomorrow',
      'blank-in-2-days',
      'none',
    ]);
  });

  it('does the same in every tier', () => {
    for (const basis of ['opportunity', '', 'sunk or reference']) {
      const tasks = parse(
        ['none', '', basis, ''],
        ['planning-past', '2026-10-01', basis, 'planning'],
        ['verified-later', '2026-12-01', basis, 'verified'],
      );
      expect(order(tasks), basis || 'blank').toEqual(['verified-later', 'planning-past', 'none']);
    }
  });

  it('keeps a passed verified date in its place inside its own tier: before every date that is not verified', () => {
    const tasks = parse(
      ['none', '', 'opportunity', ''],
      ['planning-tomorrow', '2026-10-22', 'opportunity', 'planning'],
      ['verified-in-30-days', '2026-11-20', 'opportunity', 'verified'],
      ['verified-past', '2026-10-18', 'opportunity', 'verified'],
      ['unknown-older-past', '2026-10-01', 'opportunity', ''],
    );
    expect(order(tasks)).toEqual(['verified-past', 'verified-in-30-days', 'unknown-older-past', 'planning-tomorrow', 'none']);
  });

  it('counts "verified" without a usable date as no date at all', () => {
    const tasks = parse(
      ['verified-no-date', '', 'opportunity', 'verified'],
      ['verified-bad-date', 'next Friday', 'opportunity', 'verified'],
      ['planning-dated', '2026-12-01', 'opportunity', 'planning'],
    );
    expect(order(tasks)).toEqual(['planning-dated', 'verified-no-date', 'verified-bad-date']);
    expect(priorityRank(tasks[0] as Task, today)).toMatchObject({ date: 'none', lifted: false });
  });
});

describe('sortByPriority', () => {
  it('puts done tasks last, whatever their basis or date, and never moves one up', () => {
    const tasks = parse(
      ['done-charge', '2026-10-01', 'avoidable charge', 'verified', '', 'done'],
      ['open-sunk', '', 'sunk or reference', ''],
      // Its verified date is tomorrow: an open task like this would be moved up.
      ['done-opportunity', '2026-10-22', 'opportunity', 'verified', '', 'done'],
      ['open-opportunity', '2026-10-22', 'opportunity', 'verified'],
    );
    expect(order(tasks)).toEqual(['open-opportunity', 'open-sunk', 'done-charge', 'done-opportunity']);
    expect(tasks.map((task) => priorityRank(task, today).lifted)).toEqual([false, false, false, true]);
    expect(priorityReason(tasks[2] as Task, today)).toEqual({ text: 'Done, not ranked', note: null });
  });

  it('matches the recorded-date order when the sheet has none of the optional columns', () => {
    const { tasks } = parseTaskSheet(sampleValues());
    const active = filterTasks(tasks, { statuses: DEFAULT_STATUS_FILTER, query: '' });
    expect(sortByPriority(active, today)).toEqual(sortByDeadline(active));
  });

  it('orders the planning sample as documented', () => {
    const { tasks } = parseTaskSheet(planningValues());
    expect(order(tasks)).toEqual(['P07', 'P03', 'P01', 'P02', 'P04', 'P05', 'P06', 'P08']);
    expect(sortByDeadline(tasks.filter((task) => task.status !== 'done')).map((task) => task.id)).toEqual([
      'P05',
      'P04',
      'P03',
      'P01',
      'P07',
      'P02',
      'P06',
    ]);
  });

  it('does not change the list it is given', () => {
    const tasks = parse(['b', '', 'sunk or reference', ''], ['a', '', 'avoidable charge', '']);
    const before = tasks.map((task) => task.id);
    sortByPriority(tasks, today);
    expect(tasks.map((task) => task.id)).toEqual(before);
  });

  it('moves a task up only while its verified date is in the window: the move ends once the date has passed', () => {
    const tasks = parse(['undated-charge', '', 'avoidable charge', ''], ['opportunity', '2026-10-30', 'opportunity', 'verified']);
    const ids = (iso: string) => sortByPriority(tasks, parseCalendarDate(iso) as CalendarDate).map((task) => task.id);
    expect(ids('2026-10-22')).toEqual(['undated-charge', 'opportunity']); // 8 days ahead
    expect(ids('2026-10-23')).toEqual(['opportunity', 'undated-charge']); // 7 days ahead
    expect(ids('2026-10-30')).toEqual(['opportunity', 'undated-charge']); // today
    expect(ids('2026-10-31')).toEqual(['undated-charge', 'opportunity']); // yesterday
    expect(ids('2027-10-30')).toEqual(['undated-charge', 'opportunity']); // a year on: no lasting urgency
  });
});

describe('priorityReason', () => {
  it('names the basis and the recorded date, and says whether the date is verified', () => {
    expect(reason(['x', '2026-10-24', 'avoidable charge', ''])).toEqual({
      text: 'Avoidable charge, recorded date in 3 days (not verified)',
      note: null,
    });
    expect(reason(['x', '2026-11-20', 'deadline', 'verified']).text).toBe('Deadline basis, recorded date in 30 days (verified)');
    expect(reason(['x', '2026-10-22', 'opportunity', 'planning']).text).toBe(
      'Opportunity, recorded date tomorrow (planning, not verified)',
    );
    expect(reason(['x', '2026-10-19', '', 'unknown']).text).toBe('Basis unknown, recorded date 2 days ago (not verified)');
    expect(reason(['x', '2026-10-21', 'unknown', '']).text).toBe('Basis unknown, recorded date today (not verified)');
    expect(reason(['x', '2026-10-20', 'sunk or reference', 'verified']).text).toBe(
      'Sunk or reference, recorded date yesterday (verified)',
    );
  });

  it('says so when there is no date, instead of guessing one', () => {
    expect(reason(['x', '', 'avoidable charge', '']).text).toBe('Avoidable charge, no date recorded');
    expect(reason(['x', '', 'avoidable charge', 'verified']).text).toBe('Avoidable charge, no date recorded');
    expect(reason(['x', 'end of month', 'deadline', '']).text).toBe('Deadline basis, date not readable');
    expect(reason(['x', '', '', '', 'Could be 300 by 2026-10-22']).text).toBe('Basis unknown, no date recorded');
  });

  it('treats a value it does not recognise as not verified, and says when the basis is not recognised', () => {
    expect(reason(['x', '2026-10-24', 'penalty', 'confirmed']).text).toBe(
      'Basis not recognised, recorded date in 3 days (not verified)',
    );
  });

  it('says a task was moved up by the fixed rule, not by anything about its size', () => {
    expect(PROMOTED_NOTE).toBe('Moved up by the fixed 7-day rule: its verified date is within 7 days.');
    expect(reason(['x', '2026-10-23', 'opportunity', 'verified'])).toEqual({
      text: 'Opportunity, recorded date in 2 days (verified)',
      note: PROMOTED_NOTE,
    });
    expect(reason(['x', '2026-10-21', 'opportunity', 'verified', 'A huge amount']).note).toBe(PROMOTED_NOTE);
    expect(reason(['x', '2026-10-28', 'opportunity', 'verified']).note).toBe(PROMOTED_NOTE);
    // Not moved up: a day too far, a date that is not verified, or a task that is in the top tier already.
    expect(reason(['x', '2026-10-29', 'opportunity', 'verified']).note).toBeNull();
    expect(reason(['x', '2026-10-23', 'opportunity', 'planning']).note).toBeNull();
    expect(reason(['x', '2026-10-23', 'avoidable charge', 'verified']).note).toBeNull();
  });

  it('says a passed verified date has passed, and that what follows from it is not known', () => {
    expect(PASSED_NOTE).toBe('The date has passed; the dashboard does not know whether a consequence applies now.');
    expect(reason(['x', '2026-10-18', 'opportunity', 'verified'])).toEqual({
      text: 'Opportunity, recorded date 3 days ago (verified)',
      note: PASSED_NOTE,
    });
    for (const basis of ['avoidable charge', 'deadline', 'opportunity', 'sunk or reference', 'unknown', '', 'nonsense']) {
      expect(reason(['x', '2026-10-20', basis, 'verified', 'Fee of 250']).note, basis).toBe(PASSED_NOTE);
      expect(reason(['x', '2025-01-01', basis, 'verified']).note, basis).toBe(PASSED_NOTE);
    }
    // Nothing in it claims that anything was missed, charged or lost.
    expect(PASSED_NOTE).not.toMatch(/miss|late|overdue|due\b|lost|lose|loss|penalt|charg|fee|expire|forfeit|cost/i);
    // A past date nobody verified already says "not verified"; a date that is not past needs no such note.
    expect(reason(['x', '2026-10-18', 'opportunity', 'planning']).note).toBeNull();
    expect(reason(['x', '2026-10-18', 'avoidable charge', '']).note).toBeNull();
    expect(reason(['x', '2026-10-21', 'avoidable charge', 'verified']).note).toBeNull();
  });

  it('does not rank done tasks', () => {
    expect(reason(['x', '2026-10-01', 'avoidable charge', 'verified', '', 'done'])).toEqual({ text: 'Done, not ranked', note: null });
  });

  it('never words a recorded date as due or enforced, and never claims a loss', () => {
    const bases = ['avoidable charge', 'deadline', 'opportunity', 'sunk or reference', 'unknown', '', 'nonsense'];
    const dates = ['', '2026-10-01', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-28', '2027-03-01', 'soon'];
    const checks = ['verified', 'planning', 'unknown', '', 'yes'];
    for (const basis of bases) {
      for (const date of dates) {
        for (const check of checks) {
          const { text, note } = reason(['x', date, basis, check, 'Fee of 250 after 2026-10-22']);
          const words = `${text} ${note ?? ''}`;
          expect(words).not.toMatch(/\bdue\b|overdue|enforced|late|missed|loss|lose|cost|fee|250/i);
          // "deadline" may only appear as the name of the basis.
          expect(words.replace('Deadline basis', '')).not.toMatch(/deadline/i);
          if (date === '' || date === 'soon') expect(text).not.toMatch(/\d/);
        }
      }
    }
  });
});

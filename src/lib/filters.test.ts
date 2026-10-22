import { describe, expect, it } from 'vitest';
import { HEADER, sampleValues } from '../test/fixtures.ts';
import { parseCalendarDate, type CalendarDate } from './dates.ts';
import {
  countByStatus,
  deadlineState,
  DEFAULT_STATUS_FILTER,
  filterTasks,
  groupByDeadline,
  matchesOnlyInNotes,
  matchesSearch,
  sortByDeadline,
  type StatusKey,
} from './filters.ts';
import { parseTaskSheet, type Task } from './tasks.ts';

const today = parseCalendarDate('2026-10-21') as CalendarDate;
const sample = () => parseTaskSheet(sampleValues()).tasks;
const ids = (tasks: Task[]) => tasks.map((t) => t.id);

function task(overrides: Partial<Task>): Task {
  return {
    key: `id:${overrides.id ?? 'X'}`,
    rowNumber: 2,
    id: 'X',
    title: 'Task',
    status: 'open',
    rawStatus: 'open',
    deadline: null,
    rawDeadline: '',
    lastUpdate: null,
    rawLastUpdate: '',
    notes: '',
    links: [],
    rawLinks: '',
    ongoing: false,
    ...overrides,
  };
}

describe('countByStatus', () => {
  it('counts each status, including rows that need a valid status', () => {
    const { tasks } = parseTaskSheet([...sampleValues(), ['T7', 'Odd', 'paused']]);
    expect(countByStatus(tasks)).toEqual({
      open: 2,
      'waiting on you': 2,
      'waiting on someone else': 1,
      done: 1,
      unknown: 1,
    });
  });
});

describe('search', () => {
  const [libraryCard] = sample();

  it('matches Task ID, name and notes, ignoring case', () => {
    expect(libraryCard && matchesSearch(libraryCard, 't001')).toBe(true);
    expect(libraryCard && matchesSearch(libraryCard, 'LIBRARY')).toBe(true);
    expect(libraryCard && matchesSearch(libraryCard, 'proof of')).toBe(true);
    expect(libraryCard && matchesSearch(libraryCard, '  ')).toBe(true);
    expect(libraryCard && matchesSearch(libraryCard, 'dentist')).toBe(false);
  });

  it('needs every word to match', () => {
    expect(libraryCard && matchesSearch(libraryCard, 'card address')).toBe(true);
    expect(libraryCard && matchesSearch(libraryCard, 'card dentist')).toBe(false);
  });

  it('knows when a match is only inside the notes', () => {
    expect(libraryCard && matchesOnlyInNotes(libraryCard, 'address')).toBe(true);
    expect(libraryCard && matchesOnlyInNotes(libraryCard, 'library')).toBe(false);
    expect(libraryCard && matchesOnlyInNotes(libraryCard, '')).toBe(false);
  });
});

describe('filterTasks', () => {
  it('shows active tasks by default and hides done ones', () => {
    expect(ids(filterTasks(sample(), { statuses: DEFAULT_STATUS_FILTER, query: '' }))).toEqual([
      'T001',
      'T002',
      'T003',
      'T005',
      'T006',
    ]);
  });

  it('can include done tasks or show a single status', () => {
    const withDone = new Set<StatusKey>([...DEFAULT_STATUS_FILTER, 'done']);
    expect(filterTasks(sample(), { statuses: withDone, query: '' })).toHaveLength(6);
    expect(ids(filterTasks(sample(), { statuses: new Set<StatusKey>(['waiting on you']), query: '' }))).toEqual([
      'T002',
      'T006',
    ]);
  });

  it('combines status and search', () => {
    expect(ids(filterTasks(sample(), { statuses: DEFAULT_STATUS_FILTER, query: 'quote' }))).toEqual(['T003']);
    expect(ids(filterTasks(sample(), { statuses: DEFAULT_STATUS_FILTER, query: 'camera' }))).toEqual([]);
  });
});

describe('sortByDeadline', () => {
  it('puts the earliest deadline first and blank deadlines last, otherwise keeping sheet order', () => {
    expect(ids(sortByDeadline(sample()))).toEqual(['T004', 'T003', 'T001', 'T006', 'T002', 'T005']);
  });

  it('puts unreadable deadlines with the blanks', () => {
    const { tasks } = parseTaskSheet([HEADER, ['A', 'a', 'open', 'next week'], ['B', 'b', 'open', '2026-11-01'], ['C', 'c', 'open']]);
    expect(ids(sortByDeadline(tasks))).toEqual(['B', 'A', 'C']);
  });
});

describe('deadlineState', () => {
  const due = (iso: string, status: Task['status'] = 'open') =>
    deadlineState(task({ deadline: parseCalendarDate(iso), rawDeadline: iso, status }), today);

  it('classifies deadlines relative to today', () => {
    expect(due('2026-10-18')).toEqual({ kind: 'overdue', days: 3 });
    expect(due('2026-10-21')).toEqual({ kind: 'today' });
    expect(due('2026-10-22')).toEqual({ kind: 'soon', days: 1 });
    expect(due('2026-10-28')).toEqual({ kind: 'soon', days: 7 });
    expect(due('2026-10-29')).toEqual({ kind: 'later', days: 8 });
  });

  it('never calls done tasks or blank deadlines overdue', () => {
    expect(due('2026-10-01', 'done')).toEqual({ kind: 'closed' });
    expect(deadlineState(task({}), today)).toEqual({ kind: 'none' });
    expect(deadlineState(task({ rawDeadline: 'Friday' }), today)).toEqual({ kind: 'invalid' });
  });
});

describe('groupByDeadline', () => {
  it('groups active tasks into Overdue, Next 7 days, Later, Ongoing and No deadline', () => {
    const active = filterTasks(sample(), { statuses: DEFAULT_STATUS_FILTER, query: '' });
    const groups = groupByDeadline(active, today);
    expect(groups.map((g) => [g.id, ids(g.tasks)])).toEqual([
      ['overdue', ['T003']],
      ['soon', []],
      ['later', ['T001', 'T006']],
      ['ongoing', ['T005']],
      ['none', ['T002']],
    ]);
  });

  it('adds a Done group only when done tasks are shown', () => {
    const groups = groupByDeadline(sample(), today);
    expect(groups.at(-1)?.id).toBe('done');
    expect(ids(groups.at(-1)?.tasks ?? [])).toEqual(['T004']);
  });

  it('always keeps the Overdue, Next 7 days and No deadline groups, even when empty', () => {
    expect(groupByDeadline([], today).map((g) => g.id)).toEqual(['overdue', 'soon', 'none']);
  });

  it('sorts each group earliest first and lists unreadable deadlines separately', () => {
    const { tasks } = parseTaskSheet([
      HEADER,
      ['A', 'a', 'open', '2026-10-27'],
      ['B', 'b', 'open', '2026-10-21'],
      ['C', 'c', 'open', 'tomorrow'],
    ]);
    const groups = groupByDeadline(tasks, today);
    expect(ids(groups.find((g) => g.id === 'soon')?.tasks ?? [])).toEqual(['B', 'A']);
    expect(ids(groups.find((g) => g.id === 'invalid')?.tasks ?? [])).toEqual(['C']);
  });
});

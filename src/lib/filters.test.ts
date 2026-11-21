import { describe, expect, it } from 'vitest';
import { HEADER, lifeValues, LONG_NEXT_STEP, LONG_PROGRESS, makeTask, planningValues, sampleValues } from '../test/fixtures.ts';
import { parseCalendarDate, type CalendarDate } from './dates.ts';
import {
  countByArea,
  countByOrigin,
  countByStatus,
  deadlineState,
  DEFAULT_STATUS_FILTER,
  filterTasks,
  groupByDeadline,
  hasFoldedText,
  isListView,
  isNotStarted,
  matchesOnlyBehindDetails,
  matchesOnlyInFoldedText,
  matchesOnlyInNotes,
  matchesSearch,
  sortByDeadline,
  viewOrigin,
  type StatusKey,
} from './filters.ts';
import { areaKey, parseTaskSheet, type Task } from './tasks.ts';

const today = parseCalendarDate('2026-10-21') as CalendarDate;
const sample = () => parseTaskSheet(sampleValues()).tasks;
const ids = (tasks: Task[]) => tasks.map((t) => t.id);

const task = makeTask;

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

describe('origin views', () => {
  const planning = () => parseTaskSheet(planningValues()).tasks;
  const ALL = new Set<StatusKey>(['open', 'waiting on you', 'waiting on someone else', 'done', 'unknown']);

  it('maps each view to the origin it shows', () => {
    expect(viewOrigin('you-requested')).toBe('you requested');
    expect(viewOrigin('inbound')).toBe('inbound');
    expect(viewOrigin('list')).toBeNull();
    expect(viewOrigin('deadlines')).toBeNull();
    expect(viewOrigin('today')).toBeNull();
    expect(viewOrigin('review')).toBeNull();
  });

  it('knows which views are lists with status chips', () => {
    expect((['list', 'deadlines', 'you-requested', 'inbound'] as const).map(isListView)).toEqual([true, true, true, true]);
    expect((['today', 'review'] as const).map(isListView)).toEqual([false, false]);
  });

  it('shows only the matching origin, whatever its letter case in the sheet', () => {
    expect(ids(filterTasks(planning(), { statuses: DEFAULT_STATUS_FILTER, query: '', origin: 'you requested' }))).toEqual(['P01', 'P03']);
    // P02 is written "Inbound" in the sheet.
    expect(ids(filterTasks(planning(), { statuses: DEFAULT_STATUS_FILTER, query: '', origin: 'inbound' }))).toEqual(['P02', 'P06', 'P07']);
  });

  it('keeps rows with a blank or wrong Origin in the unfiltered list, and counts them', () => {
    const active = filterTasks(planning(), { statuses: DEFAULT_STATUS_FILTER, query: '' });
    expect(ids(active)).toEqual(['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07']);
    expect(ids(filterTasks(planning(), { statuses: DEFAULT_STATUS_FILTER, query: '', origin: null }))).toEqual(ids(active));
    expect(countByOrigin(active)).toEqual({ 'you requested': 2, inbound: 3, missing: 2 });
    // Nothing is lost: the two origin views and the missing count add up to the unfiltered list.
    const counts = countByOrigin(active);
    expect(counts['you requested'] + counts.inbound + counts.missing).toBe(active.length);
    expect(ids(active.filter((t) => t.origin === null))).toEqual(['P04', 'P05']);
  });

  it('counts every row as missing when the sheet has no Origin column', () => {
    expect(countByOrigin(sample())).toEqual({ 'you requested': 0, inbound: 0, missing: 6 });
    expect(filterTasks(sample(), { statuses: ALL, query: '', origin: 'inbound' })).toEqual([]);
  });

  it('combines with the status filters and the search', () => {
    expect(ids(filterTasks(planning(), { statuses: ALL, query: '', origin: 'you requested' }))).toEqual(['P01', 'P03', 'P08']);
    expect(ids(filterTasks(planning(), { statuses: new Set<StatusKey>(['waiting on you']), query: '', origin: 'inbound' }))).toEqual(['P02']);
    expect(ids(filterTasks(planning(), { statuses: DEFAULT_STATUS_FILTER, query: 'permit', origin: 'inbound' }))).toEqual(['P07']);
    expect(ids(filterTasks(planning(), { statuses: DEFAULT_STATUS_FILTER, query: 'permit', origin: 'you requested' }))).toEqual([]);
  });
});

describe('search in the free-text lines', () => {
  const planning = () => parseTaskSheet(planningValues()).tasks;
  const find = (query: string) => ids(filterTasks(planning(), { statuses: DEFAULT_STATUS_FILTER, query }));

  it('matches Progress, Money at stake, Hands-on effort and Expected finish', () => {
    expect(find('scanned')).toEqual(['P06']);
    expect(find('renews')).toEqual(['P02']);
    expect(find('20 minutes')).toEqual(['P01']);
    expect(find('saturday')).toEqual(['P01']);
    expect(find('ladder fee')).toEqual(['P01']);
  });

  it('does not match the origin, basis or "Date verified" values', () => {
    expect(find('inbound')).toEqual([]);
    expect(find('opportunity')).toEqual([]);
    expect(find('verified')).toEqual([]);
  });

  it('knows when a match is only in the folded part of a long text', () => {
    const club = planning()[2] as Task;
    expect(club.progress).toBe(LONG_PROGRESS);
    expect(matchesOnlyInFoldedText(club, 'pencil')).toBe(true);
    expect(matchesOnlyInFoldedText(club, 'club pencil')).toBe(true);
    // Visible at the start of the text, in the name, or in a link: no hint needed.
    expect(matchesOnlyInFoldedText(club, 'committee')).toBe(false);
    expect(matchesOnlyInFoldedText(club, 'membership')).toBe(false);
    expect(matchesOnlyInFoldedText(club, 'form')).toBe(false);
    expect(matchesOnlyInFoldedText(club, '')).toBe(false);
    expect(matchesOnlyInFoldedText(club, 'dentist')).toBe(false);
    expect(matchesOnlyInFoldedText(planning()[0] as Task, 'booked')).toBe(false);
  });

  it('still flags the folded text when the word is also in the notes', () => {
    const both = task({ notes: 'Bring a pencil.', progress: LONG_PROGRESS });
    expect(matchesOnlyInFoldedText(both, 'pencil')).toBe(true);
  });

  it('does not flag the folded text when the word is also in the Task ID or in a link, which are always on screen', () => {
    expect(matchesOnlyInFoldedText(task({ progress: LONG_PROGRESS }), 'pencil')).toBe(true);
    expect(matchesOnlyInFoldedText(task({ id: 'PENCIL-1', progress: LONG_PROGRESS }), 'pencil')).toBe(false);
    expect(
      matchesOnlyInFoldedText(task({ rawLinks: 'Pencil list: https://example.org/list', progress: LONG_PROGRESS }), 'pencil'),
    ).toBe(false);
    // The start of a folded text is on screen too.
    expect(matchesOnlyInFoldedText(task({ progress: LONG_PROGRESS }), 'downloaded')).toBe(false);
  });
});

describe('areas', () => {
  const life = () => parseTaskSheet(lifeValues()).tasks;
  const ALL = new Set<StatusKey>(['open', 'waiting on you', 'waiting on someone else', 'done', 'unknown']);

  it('compares areas without regard to letter case or extra spaces', () => {
    expect(areaKey('Home')).toBe(areaKey('  hOmE '));
    expect(areaKey('Home  office')).toBe('home office');
    expect(areaKey('')).toBe('');
    expect(areaKey('   ')).toBe('');
  });

  it('lists the areas in use A to Z with their counts, then the tasks with no area', () => {
    expect(countByArea(life())).toEqual([
      // "car" and "Car" are one area, named as its first row writes it.
      { key: 'car', name: 'car', count: 2, notDone: 2 },
      { key: 'family', name: 'Family', count: 1, notDone: 1 },
      { key: 'garden', name: 'Garden', count: 1, notDone: 1 },
      // One of the five Home tasks is done.
      { key: 'home', name: 'Home', count: 5, notDone: 4 },
      { key: 'travel', name: 'Travel', count: 1, notDone: 1 },
      { key: '', name: '', count: 1, notDone: 1 },
    ]);
  });

  it('leaves out "no area" when every task has one, and gives one entry when the sheet has no Area column', () => {
    expect(countByArea(life().filter((t) => t.area !== '')).map((area) => area.key)).not.toContain('');
    expect(countByArea(sample())).toEqual([{ key: '', name: '', count: 6, notDone: 5 }]);
    expect(countByArea([])).toEqual([]);
  });

  it('filters to one area, to the tasks with no area, or to every area', () => {
    const inArea = (area: string | null | undefined) => ids(filterTasks(life(), { statuses: ALL, query: '', area }));
    expect(inArea('home')).toEqual(['L01', 'L03', 'L05', 'L09', 'L11']);
    expect(inArea('car')).toEqual(['L06', 'L10']);
    expect(inArea('')).toEqual(['L07']);
    expect(inArea(null)).toHaveLength(11);
    expect(inArea(undefined)).toHaveLength(11);
    expect(inArea('nowhere')).toEqual([]);
  });

  it('combines with the status filters, the origin and the search', () => {
    expect(ids(filterTasks(life(), { statuses: DEFAULT_STATUS_FILTER, query: '', area: 'home' }))).toEqual(['L01', 'L03', 'L05', 'L11']);
    expect(ids(filterTasks(life(), { statuses: DEFAULT_STATUS_FILTER, query: 'deposit', area: 'home' }))).toEqual(['L11']);
    expect(ids(filterTasks(life(), { statuses: DEFAULT_STATUS_FILTER, query: 'deposit', area: 'car' }))).toEqual([]);
    expect(filterTasks(life(), { statuses: ALL, query: '', area: 'home', origin: 'inbound' })).toEqual([]);
  });

  it('finds a task by its area and by its next step', () => {
    const find = (query: string) => ids(filterTasks(life(), { statuses: DEFAULT_STATUS_FILTER, query }));
    expect(find('travel')).toEqual(['L04']);
    expect(find('engineer slot')).toEqual(['L01']);
    expect(find('seed catalogue')).toEqual(['L08']);
  });
});

describe('start dates', () => {
  const life = () => parseTaskSheet(lifeValues()).tasks;
  const starting = (iso: string, overrides: Partial<Task> = {}) => task({ start: parseCalendarDate(iso), rawStart: iso, ...overrides });

  it('counts a task as not started only while its Start date is ahead', () => {
    expect(isNotStarted(starting('2026-10-22'), today)).toBe(true);
    // Starting today, or earlier, is started.
    expect(isNotStarted(starting('2026-10-21'), today)).toBe(false);
    expect(isNotStarted(starting('2026-10-01'), today)).toBe(false);
  });

  it('treats a blank or unreadable Start as started, and a done task as never waiting to start', () => {
    expect(isNotStarted(task(), today)).toBe(false);
    expect(isNotStarted(task({ rawStart: 'next spring' }), today)).toBe(false);
    expect(isNotStarted(starting('2027-01-01', { status: 'done' }), today)).toBe(false);
  });

  it('leaves not-started tasks out only when asked to', () => {
    const active = (startedBy?: CalendarDate | null) => ids(filterTasks(life(), { statuses: DEFAULT_STATUS_FILTER, query: '', startedBy }));
    expect(active()).toContain('L08');
    expect(active(null)).toContain('L08');
    expect(active(today)).not.toContain('L08');
    // L10 started a week ago, so it stays.
    expect(active(today)).toContain('L10');
    // On the day it starts, L08 is back.
    expect(active(parseCalendarDate('2026-11-10'))).toContain('L08');
  });
});

describe('what a short card keeps behind "Show details"', () => {
  const short = task({
    id: 'L01',
    title: 'Book the boiler service',
    area: 'Home',
    nextStep: 'Ring the engineer',
    notes: 'Prefers mornings.',
    rawLinks: 'Manual: https://example.org/boiler',
    progress: 'Quote agreed.',
    moneyAtStake: 'Call-out fee',
    effort: 'Ten minutes',
    expectedFinish: 'Next week',
  });

  it('flags a match in the notes, links or labelled lines', () => {
    for (const word of ['mornings', 'manual', 'quote', 'call-out', 'ten', 'next week']) {
      expect(matchesOnlyBehindDetails(short, word), word).toBe(true);
    }
  });

  it('does not flag a match that is on the card: Task ID, name, area or next step', () => {
    for (const word of ['L01', 'boiler', 'home', 'engineer', 'ring home boiler']) {
      expect(matchesOnlyBehindDetails(short, word), word).toBe(false);
    }
    expect(matchesOnlyBehindDetails(short, '')).toBe(false);
    expect(matchesOnlyBehindDetails(short, 'dentist')).toBe(false);
  });

  it('flags a match in the folded part of a long next step, which the card cuts short', () => {
    const long = task({ nextStep: LONG_NEXT_STEP });
    expect(matchesOnlyBehindDetails(long, 'screwdriver')).toBe(true);
    expect(matchesOnlyBehindDetails(long, 'friday')).toBe(false);
    expect(matchesOnlyInFoldedText(long, 'screwdriver')).toBe(true);
  });

  it('does not flag the long next step once its full text is open: the whole of it is on the card then', () => {
    const long = task({ nextStep: LONG_NEXT_STEP, notes: 'Borrowed from next door.' });
    expect(matchesOnlyBehindDetails(long, 'screwdriver', true)).toBe(false);
    // The notes are behind the toggle either way.
    expect(matchesOnlyBehindDetails(long, 'borrowed', true)).toBe(true);
  });

  it('knows when a task has long text to fold', () => {
    expect(hasFoldedText(short)).toBe(false);
    expect(hasFoldedText(task({ nextStep: LONG_NEXT_STEP }))).toBe(true);
    expect(hasFoldedText(task({ progress: LONG_PROGRESS }))).toBe(true);
    // Notes have their own toggle.
    expect(hasFoldedText(task({ notes: LONG_PROGRESS }))).toBe(false);
  });
});

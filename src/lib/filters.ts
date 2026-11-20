import { compareCalendarDates, daysBetween, type CalendarDate } from './dates.ts';
import { clipText } from './preview.ts';
import {
  ACTIVE_STATUSES,
  areaKey,
  ORIGINS,
  STATUSES,
  TEXT_FIELDS,
  type Origin,
  type Status,
  type Task,
} from './tasks.ts';

/** A status filter value: one of the four statuses, or "unknown" for rows whose status needs fixing. */
export type StatusKey = Status | 'unknown';

export const DEFAULT_STATUS_FILTER: ReadonlySet<StatusKey> = new Set<StatusKey>([...ACTIVE_STATUSES, 'unknown']);

/** Days ahead (including today) that count as "Next 7 days". */
export const SOON_DAYS = 7;

export function statusKey(task: Task): StatusKey {
  return task.status ?? 'unknown';
}

export function countByStatus(tasks: readonly Task[]): Record<StatusKey, number> {
  const counts = Object.fromEntries([...STATUSES, 'unknown'].map((key) => [key, 0])) as Record<StatusKey, number>;
  for (const task of tasks) counts[statusKey(task)] += 1;
  return counts;
}

function searchTerms(query: string): string[] {
  return query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * Every word of the query must appear in the Task ID, task name, area, notes,
 * links, next step or one of the free-text lines (any case).
 */
export function matchesSearch(task: Task, query: string): boolean {
  const terms = searchTerms(query);
  if (terms.length === 0) return true;
  const details = TEXT_FIELDS.map((field) => task[field]).join('\n');
  const text = `${task.id}\n${task.title}\n${task.area}\n${task.notes}\n${task.rawLinks}\n${details}`.toLocaleLowerCase();
  return terms.every((term) => text.includes(term));
}

/** True when the query matches the notes but not the Task ID or name, so the match is hidden while notes are collapsed. */
export function matchesOnlyInNotes(task: Task, query: string): boolean {
  if (!query.trim()) return false;
  return matchesSearch({ ...task, notes: '', rawLinks: '' }, query) === false && matchesSearch({ ...task, rawLinks: '' }, query);
}

/**
 * True when a search word is in free text folded away behind "Show full text"
 * and nowhere in the Task ID, name, area, links or the visible start of those lines.
 */
export function matchesOnlyInFoldedText(task: Task, query: string): boolean {
  if (!matchesSearch(task, query)) return false;
  const lower = (parts: string[]) => parts.join('\n').toLocaleLowerCase();
  const shown = lower([
    task.id,
    task.title,
    task.area,
    task.rawLinks,
    ...TEXT_FIELDS.map((field) => clipText(task[field]).text),
  ]);
  const whole = lower(TEXT_FIELDS.map((field) => task[field]));
  return searchTerms(query).some((term) => !shown.includes(term) && whole.includes(term));
}

/** True when some of the task's free text is long enough to be folded behind "Show full text". */
export function hasFoldedText(task: Task): boolean {
  return TEXT_FIELDS.some((field) => clipText(task[field]).clipped);
}

/**
 * True when the task matches the search only through what a short card keeps
 * behind "Show details": its notes, links and labelled lines. The Task ID,
 * name, area and the visible start of the next step are always on the card.
 */
export function matchesOnlyBehindDetails(task: Task, query: string): boolean {
  if (!query.trim() || !matchesSearch(task, query)) return false;
  const front: Task = {
    ...task,
    notes: '',
    rawLinks: '',
    progress: '',
    moneyAtStake: '',
    effort: '',
    expectedFinish: '',
    nextStep: clipText(task.nextStep).text,
  };
  return !matchesSearch(front, query);
}

/**
 * True while a task's Start date is still ahead: nothing can be done on it yet.
 * A done task is never "not started", whatever its Start cell says.
 */
export function isNotStarted(task: Task, today: CalendarDate): boolean {
  return task.status !== 'done' && task.start !== null && daysBetween(today, task.start) > 0;
}

export interface TaskFilter {
  statuses: ReadonlySet<StatusKey>;
  query: string;
  /**
   * Narrows the list to one origin view ("You requested" or "Inbound"). Tasks
   * with a blank or unrecognised Origin are in neither: they stay in the
   * unfiltered list and are counted by countByOrigin.
   */
  origin?: Origin | null;
  /** One area, as an areaKey. "" means the tasks with no area. Leave out for every area. */
  area?: string | null;
  /** Leave out tasks whose Start date is after this day. Leave out the field to keep them. */
  startedBy?: CalendarDate | null;
}

export function filterTasks(tasks: readonly Task[], filter: TaskFilter): Task[] {
  const { area, startedBy } = filter;
  return tasks.filter(
    (task) =>
      filter.statuses.has(statusKey(task)) &&
      (!filter.origin || task.origin === filter.origin) &&
      (area === null || area === undefined || areaKey(task.area) === area) &&
      (!startedBy || !isNotStarted(task, startedBy)) &&
      matchesSearch(task, filter.query),
  );
}

/** An area in use, with how many of the given tasks are in it. */
export interface AreaCount {
  /** How the area is compared (see areaKey). "" for tasks with no area. */
  key: string;
  /** How the area is written in the first row that uses it. "" for tasks with no area. */
  name: string;
  count: number;
  /** Of those tasks, the ones that are not done. */
  notDone: number;
}

/** The areas the given tasks use, A to Z, then the tasks with no area (only if there are any). */
export function countByArea(tasks: readonly Task[]): AreaCount[] {
  const areas = new Map<string, AreaCount>();
  for (const task of tasks) {
    const key = areaKey(task.area);
    const area = areas.get(key) ?? { key, name: task.area, count: 0, notDone: 0 };
    area.count += 1;
    if (task.status !== 'done') area.notDone += 1;
    areas.set(key, area);
  }
  const named = [...areas.values()]
    .filter((area) => area.key !== '')
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.key.localeCompare(b.key));
  const none = areas.get('');
  return none ? [...named, none] : named;
}

/**
 * The views. "today" and "review" choose their own tasks; "list" and
 * "deadlines" show every origin; the origin views show one origin each.
 */
export type View = 'today' | 'list' | 'deadlines' | 'you-requested' | 'inbound' | 'review';

/** The views with status chips and a sort order: a list of tasks the viewer filters. */
export function isListView(view: View): boolean {
  return view !== 'today' && view !== 'review';
}

/** The origin a view is limited to, or null for the views that show every task. */
export function viewOrigin(view: View): Origin | null {
  if (view === 'you-requested') return 'you requested';
  return view === 'inbound' ? 'inbound' : null;
}

/** How the list views are ordered. "date" is the order the dashboard always had. */
export type SortOrder = 'priority' | 'date';

/** An origin view, or "missing" for rows whose Origin is blank or not one of the two values. */
export type OriginKey = Origin | 'missing';

export function countByOrigin(tasks: readonly Task[]): Record<OriginKey, number> {
  const counts = Object.fromEntries([...ORIGINS, 'missing'].map((key) => [key, 0])) as Record<OriginKey, number>;
  for (const task of tasks) counts[task.origin ?? 'missing'] += 1;
  return counts;
}

/** Earliest recorded date first; tasks without a usable date last; otherwise sheet order. */
export function compareByDeadline(a: Task, b: Task): number {
  if (a.deadline && b.deadline) {
    const byDate = compareCalendarDates(a.deadline, b.deadline);
    if (byDate !== 0) return byDate;
  } else if (a.deadline) {
    return -1;
  } else if (b.deadline) {
    return 1;
  }
  return a.rowNumber - b.rowNumber;
}

export function sortByDeadline(tasks: readonly Task[]): Task[] {
  return [...tasks].sort(compareByDeadline);
}

export type DeadlineState =
  | { kind: 'overdue'; days: number }
  | { kind: 'today' }
  | { kind: 'soon'; days: number }
  | { kind: 'later'; days: number }
  /** The task is done, so its deadline no longer counts. */
  | { kind: 'closed' }
  | { kind: 'none' }
  | { kind: 'invalid' };

/**
 * Where a task's recorded date (the Deadline column) stands relative to today.
 * "overdue" only means the date has passed: the date may be a planning or
 * check date, so the UI words it as a past date, not as a missed deadline.
 * Done tasks never count as past.
 */
export function deadlineState(task: Task, today: CalendarDate): DeadlineState {
  if (!task.deadline) return task.rawDeadline ? { kind: 'invalid' } : { kind: 'none' };
  if (task.status === 'done') return { kind: 'closed' };
  const days = daysBetween(today, task.deadline);
  if (days < 0) return { kind: 'overdue', days: -days };
  if (days === 0) return { kind: 'today' };
  if (days <= SOON_DAYS) return { kind: 'soon', days };
  return { kind: 'later', days };
}

export type DeadlineGroupId = 'overdue' | 'soon' | 'later' | 'invalid' | 'ongoing' | 'none' | 'done';

export interface DeadlineGroup {
  id: DeadlineGroupId;
  title: string;
  /** Shown when the group is empty; groups without it are hidden when empty. */
  emptyText?: string;
  tasks: Task[];
}

const GROUPS: Omit<DeadlineGroup, 'tasks'>[] = [
  { id: 'overdue', title: 'Recorded date passed', emptyText: 'No recorded date has passed.' },
  { id: 'soon', title: 'Next 7 days', emptyText: 'No recorded dates in the next 7 days.' },
  { id: 'later', title: 'Later' },
  { id: 'invalid', title: 'Date needs fixing' },
  { id: 'ongoing', title: 'Ongoing (no fixed date)' },
  { id: 'none', title: 'No recorded date', emptyText: 'Every task shown has a recorded date.' },
  { id: 'done', title: 'Done' },
];

function groupFor(task: Task, today: CalendarDate): DeadlineGroupId {
  if (task.status === 'done') return 'done';
  const state = deadlineState(task, today);
  switch (state.kind) {
    case 'overdue':
      return 'overdue';
    case 'today':
    case 'soon':
      return 'soon';
    case 'later':
    case 'closed':
      return 'later';
    case 'invalid':
      return 'invalid';
    case 'none':
      return task.ongoing ? 'ongoing' : 'none';
  }
}

/**
 * Splits tasks into Recorded date passed / Next 7 days / Later / No recorded
 * date (plus "Ongoing", "Date needs fixing" and "Done" when they have tasks).
 * Each group is sorted by recorded date, earliest first.
 */
export function groupByDeadline(tasks: readonly Task[], today: CalendarDate): DeadlineGroup[] {
  const buckets = new Map<DeadlineGroupId, Task[]>(GROUPS.map((group) => [group.id, []]));
  for (const task of sortByDeadline(tasks)) buckets.get(groupFor(task, today))?.push(task);
  return GROUPS.map((group) => ({ ...group, tasks: buckets.get(group.id) ?? [] })).filter(
    (group) => group.tasks.length > 0 || group.emptyText !== undefined,
  );
}

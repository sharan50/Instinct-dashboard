import { compareCalendarDates, daysBetween, type CalendarDate } from './dates.ts';
import { clipText } from './preview.ts';
import { ACTIVE_STATUSES, DETAIL_FIELDS, ORIGINS, STATUSES, type Origin, type Status, type Task } from './tasks.ts';

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
 * Every word of the query must appear in the Task ID, task name, notes, links
 * or one of the free-text lines (any case).
 */
export function matchesSearch(task: Task, query: string): boolean {
  const terms = searchTerms(query);
  if (terms.length === 0) return true;
  const details = DETAIL_FIELDS.map((field) => task[field]).join('\n');
  const text = `${task.id}\n${task.title}\n${task.notes}\n${task.rawLinks}\n${details}`.toLocaleLowerCase();
  return terms.every((term) => text.includes(term));
}

/** True when the query matches the notes but not the Task ID or name, so the match is hidden while notes are collapsed. */
export function matchesOnlyInNotes(task: Task, query: string): boolean {
  if (!query.trim()) return false;
  return matchesSearch({ ...task, notes: '', rawLinks: '' }, query) === false && matchesSearch({ ...task, rawLinks: '' }, query);
}

/**
 * True when a search word is in free text folded away behind "Show full text"
 * and nowhere in the Task ID, name, links or the visible start of those lines.
 */
export function matchesOnlyInFoldedText(task: Task, query: string): boolean {
  if (!matchesSearch(task, query)) return false;
  const lower = (parts: string[]) => parts.join('\n').toLocaleLowerCase();
  const shown = lower([task.id, task.title, task.rawLinks, ...DETAIL_FIELDS.map((field) => clipText(task[field]).text)]);
  const whole = lower(DETAIL_FIELDS.map((field) => task[field]));
  return searchTerms(query).some((term) => !shown.includes(term) && whole.includes(term));
}

/**
 * `origin` narrows the list to one origin view ("You requested" or "Inbound").
 * Tasks with a blank or unrecognised Origin are in neither: they stay in the
 * unfiltered list and are counted by countByOrigin.
 */
export function filterTasks(
  tasks: readonly Task[],
  filter: { statuses: ReadonlySet<StatusKey>; query: string; origin?: Origin | null },
): Task[] {
  return tasks.filter(
    (task) =>
      filter.statuses.has(statusKey(task)) &&
      (!filter.origin || task.origin === filter.origin) &&
      matchesSearch(task, filter.query),
  );
}

/** The list's views. "list" and "deadlines" show every origin; the other two show one origin each. */
export type View = 'list' | 'deadlines' | 'you-requested' | 'inbound';

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

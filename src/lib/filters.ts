import { compareCalendarDates, daysBetween, type CalendarDate } from './dates.ts';
import { ACTIVE_STATUSES, STATUSES, type Status, type Task } from './tasks.ts';

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

/** Every word of the query must appear in the Task ID, task name or notes (any case). */
export function matchesSearch(task: Task, query: string): boolean {
  const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const text = `${task.id}\n${task.title}\n${task.notes}`.toLocaleLowerCase();
  return terms.every((term) => text.includes(term));
}

/** True when the query matches the notes but not the Task ID or name, so the match is hidden while notes are collapsed. */
export function matchesOnlyInNotes(task: Task, query: string): boolean {
  if (!query.trim()) return false;
  return matchesSearch({ ...task, notes: '' }, query) === false && matchesSearch(task, query);
}

export function filterTasks(
  tasks: readonly Task[],
  filter: { statuses: ReadonlySet<StatusKey>; query: string },
): Task[] {
  return tasks.filter((task) => filter.statuses.has(statusKey(task)) && matchesSearch(task, filter.query));
}

/** Earliest deadline first; tasks without a usable deadline last; otherwise sheet order. */
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

/** Where a task's deadline stands relative to today. Done tasks are never overdue. */
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
  { id: 'overdue', title: 'Overdue', emptyText: 'Nothing overdue.' },
  { id: 'soon', title: 'Next 7 days', emptyText: 'Nothing due in the next 7 days.' },
  { id: 'later', title: 'Later' },
  { id: 'invalid', title: 'Deadline needs fixing' },
  { id: 'ongoing', title: 'Ongoing (no fixed date)' },
  { id: 'none', title: 'No deadline', emptyText: 'Every task shown has a deadline.' },
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
 * Splits tasks into Overdue / Next 7 days / Later / No deadline (plus
 * "Ongoing", "Deadline needs fixing" and "Done" when they have tasks).
 * Each group is sorted by deadline, earliest first.
 */
export function groupByDeadline(tasks: readonly Task[], today: CalendarDate): DeadlineGroup[] {
  const buckets = new Map<DeadlineGroupId, Task[]>(GROUPS.map((group) => [group.id, []]));
  for (const task of sortByDeadline(tasks)) buckets.get(groupFor(task, today))?.push(task);
  return GROUPS.map((group) => ({ ...group, tasks: buckets.get(group.id) ?? [] })).filter(
    (group) => group.tasks.length > 0 || group.emptyText !== undefined,
  );
}

import { daysBetween, todayIn, type CalendarDate } from './dates.ts';
import type { SheetColumns, Task } from './tasks.ts';

/**
 * The "Review" view: tasks that have gone quiet, are missing something or hold
 * a cell that cannot be read, for a regular tidy-up. Structured cells only;
 * nothing is inferred from text.
 */

/** A task with no update for this many days is flagged. */
export const STALE_AFTER_DAYS = 30;

export type ReviewFlag =
  /** The Status cell is blank or not one of the four statuses. */
  | { kind: 'bad-status' }
  /** The Deadline cell holds something that is not a YYYY-MM-DD date. */
  | { kind: 'bad-date' }
  /** No update for `days` days (STALE_AFTER_DAYS or more). */
  | { kind: 'stale'; days: number }
  /** The Last update cell is blank or not a readable time. */
  | { kind: 'no-update' }
  /** Waiting on someone else, with a blank Deadline cell: no recorded date to say when to look again. */
  | { kind: 'waiting-undated' }
  /** The sheet has a Next step column and this task's cell is blank. */
  | { kind: 'no-next-step' }
  /** The sheet has an Area column and this task's cell is blank. */
  | { kind: 'no-area' };

export type ReviewFlagKind = ReviewFlag['kind'];

export const REVIEW_FLAG_KINDS: readonly ReviewFlagKind[] = [
  'bad-status',
  'bad-date',
  'stale',
  'no-update',
  'waiting-undated',
  'no-next-step',
  'no-area',
];

export interface ReviewItem {
  task: Task;
  flags: ReviewFlag[];
}

/**
 * What a task is flagged for. `timeZone` decides which calendar day an update
 * fell on (the viewer's own when left out). The caller passes only tasks that
 * are not done: a finished task has nothing to chase.
 */
export function reviewFlags(task: Task, today: CalendarDate, columns: SheetColumns, timeZone?: string): ReviewFlag[] {
  const flags: ReviewFlag[] = [];
  if (task.status === null) flags.push({ kind: 'bad-status' });
  if (task.rawDeadline !== '' && !task.deadline) flags.push({ kind: 'bad-date' });
  if (!task.lastUpdate) {
    flags.push({ kind: 'no-update' });
  } else {
    const days = daysBetween(todayIn(task.lastUpdate, timeZone), today);
    if (days >= STALE_AFTER_DAYS) flags.push({ kind: 'stale', days });
  }
  // A date that is written but unreadable is flagged above as that, not as missing.
  if (task.status === 'waiting on someone else' && !task.deadline && task.rawDeadline === '') {
    flags.push({ kind: 'waiting-undated' });
  }
  if (columns.nextStep && !task.nextStep) flags.push({ kind: 'no-next-step' });
  if (columns.area && !task.area) flags.push({ kind: 'no-area' });
  return flags;
}

/** How long a task has gone without an update, for ordering: unknown counts as longest. */
function quietDays(item: ReviewItem): number {
  for (const flag of item.flags) {
    if (flag.kind === 'no-update') return Number.POSITIVE_INFINITY;
    if (flag.kind === 'stale') return flag.days;
  }
  return 0;
}

/** The flagged tasks: the most flags first, then the longest without an update, then sheet order. */
export function reviewList(
  tasks: readonly Task[],
  today: CalendarDate,
  columns: SheetColumns,
  timeZone?: string,
): ReviewItem[] {
  return tasks
    .map((task) => ({ task, flags: reviewFlags(task, today, columns, timeZone) }))
    .filter((item) => item.flags.length > 0)
    .sort((a, b) => {
      if (a.flags.length !== b.flags.length) return b.flags.length - a.flags.length;
      const [qa, qb] = [quietDays(a), quietDays(b)];
      if (qa !== qb) return qa > qb ? -1 : 1;
      return a.task.rowNumber - b.task.rowNumber;
    });
}

export function countFlags(items: readonly ReviewItem[]): Record<ReviewFlagKind, number> {
  const counts = Object.fromEntries(REVIEW_FLAG_KINDS.map((kind) => [kind, 0])) as Record<ReviewFlagKind, number>;
  for (const item of items) for (const flag of item.flags) counts[flag.kind] += 1;
  return counts;
}

/** The flag in a few plain words, as shown on the task. */
export function describeFlag(flag: ReviewFlag): string {
  switch (flag.kind) {
    case 'bad-status':
      return 'No valid status';
    case 'bad-date':
      return 'Date not readable';
    case 'stale':
      return `No update for ${flag.days} days`;
    case 'no-update':
      return 'No last update recorded';
    case 'waiting-undated':
      return 'Waiting on someone else, no date';
    case 'no-next-step':
      return 'No next step';
    case 'no-area':
      return 'No area';
  }
}

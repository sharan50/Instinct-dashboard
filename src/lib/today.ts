import { daysBetween, type CalendarDate } from './dates.ts';
import { compareByDeadline, SOON_DAYS } from './filters.ts';
import { sortByPriority } from './priority.ts';
import type { Task } from './tasks.ts';

/**
 * The "Today" view: what needs attention now, read from structured cells only
 * (Status, the date in Deadline, Date verified and Last update; "Your move" is
 * ordered by Financial priority, which also reads Delay-cost basis).
 *
 * Each task appears once, in the first group it fits:
 * 1. Your move: the status is "waiting on you".
 * 2. Next 7 days: any other task whose recorded date is today or within
 *    SOON_DAYS, verified dates first.
 * 3. Chase: the rest of the tasks waiting on someone else, the longest
 *    without an update first.
 *
 * What is left is split in two, so the view never says more than it knows:
 * `unplaced` holds the tasks whose Status or Deadline cell cannot be read
 * (nobody can say where they belong), and `elsewhere` counts the rest, which
 * are open with no recorded date in the next 7 days. The caller passes only
 * tasks that are not done.
 */
export interface TodaySections {
  yourMove: Task[];
  nextDays: Task[];
  chase: Task[];
  /** In none of the three groups because the Status or the Deadline cell cannot be read. In sheet order. */
  unplaced: Task[];
  /** In none of the three groups and readable: open, with no recorded date in the next 7 days. */
  elsewhere: number;
}

/** True when the Status cell is blank or not a status, or the Deadline cell holds something that is not a date. */
export function isUnreadable(task: Task): boolean {
  return task.status === null || (task.rawDeadline !== '' && task.deadline === null);
}

function isSoon(task: Task, today: CalendarDate): boolean {
  if (!task.deadline) return false;
  const days = daysBetween(today, task.deadline);
  return days >= 0 && days <= SOON_DAYS;
}

/** Verified dates first, then the others; inside each, earliest first, then sheet order. */
function compareSoon(a: Task, b: Task): number {
  const rank = (task: Task) => (task.dateVerification === 'verified' ? 0 : 1);
  return rank(a) - rank(b) || compareByDeadline(a, b);
}

/** Longest without an update first. A task with no readable last update leads: nobody knows how long it has waited. */
function compareWaiting(a: Task, b: Task): number {
  const time = (task: Task) => task.lastUpdate?.getTime() ?? Number.NEGATIVE_INFINITY;
  const [ta, tb] = [time(a), time(b)];
  if (ta !== tb) return ta < tb ? -1 : 1;
  return a.rowNumber - b.rowNumber;
}

export function todaySections(tasks: readonly Task[], today: CalendarDate): TodaySections {
  const yourMove = sortByPriority(
    tasks.filter((task) => task.status === 'waiting on you'),
    today,
  );
  const others = tasks.filter((task) => task.status !== 'waiting on you');
  const nextDays = others.filter((task) => isSoon(task, today)).sort(compareSoon);
  const later = others.filter((task) => !isSoon(task, today));
  const chase = later.filter((task) => task.status === 'waiting on someone else').sort(compareWaiting);
  const rest = later.filter((task) => task.status !== 'waiting on someone else');
  const unplaced = rest.filter(isUnreadable).sort((a, b) => a.rowNumber - b.rowNumber);
  return { yourMove, nextDays, chase, unplaced, elsewhere: rest.length - unplaced.length };
}

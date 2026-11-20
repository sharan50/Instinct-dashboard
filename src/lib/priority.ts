import { daysBetween, relativeDay, type CalendarDate } from './dates.ts';
import { compareByDeadline, SOON_DAYS } from './filters.ts';
import type { DateVerification, DelayCostBasis, Task } from './tasks.ts';

/**
 * "Financial priority" order.
 *
 * Only structured cells are used: Delay-cost basis, the date in the Deadline
 * column, Date verified, Status (done or not) and the row's position in the
 * sheet. Amounts or dates written inside Money at stake, Progress or any other
 * free text are never read, and a Money at stake entry never moves a task.
 *
 * The basis and the date are what the sheet says, not proof: the dashboard
 * cannot check that a charge is real or that a date is enforced. The Deadline
 * column holds recorded dates, which may be planning or check dates. So only a
 * date the sheet marks as verified can move a task up; every other date just
 * orders tasks that are otherwise equal.
 *
 * 1. Tier by basis: avoidable charge and deadline, then opportunity, then
 *    unknown or blank, then sunk or reference.
 * 2. Inside a tier: verified dates (earliest first, so past dates lead), then
 *    planning or unknown dates (earliest first), then tasks without a date.
 * 3. One exception, so the basis alone never buries a real date: an
 *    opportunity task whose verified date is past or within SOON_DAYS goes
 *    above top-tier tasks that have no verified date.
 * 4. Ties keep sheet order. Done tasks, when shown, come last.
 */

/** Lower sorts first. "avoidable charge" and "deadline" share the top tier. */
export const BASIS_TIER: Record<DelayCostBasis, number> = {
  'avoidable charge': 0,
  deadline: 0,
  opportunity: 1,
  unknown: 2,
  'sunk or reference': 3,
};

const OPPORTUNITY_TIER = BASIS_TIER.opportunity;

/** How much the recorded date counts: only a verified date can move a task up. */
export type DateStanding = 'verified' | 'unverified' | 'none';

const DATE_ORDER: Record<DateStanding, number> = { verified: 0, unverified: 1, none: 2 };

/** Between "top tier, verified date" (0) and "top tier, date not verified" (1). */
const LIFTED_BAND = 0.5;
/** After every tier (the last one ends at 11). */
const DONE_BAND = 100;

export interface PriorityRank {
  /** Done tasks are not ranked: they go last. */
  done: boolean;
  /** From the Delay-cost basis. A blank or unrecognised basis counts as unknown. */
  tier: number;
  date: DateStanding;
  /** Days from today to the recorded date (negative: in the past). null without a usable date. */
  days: number | null;
  /** Rule 3 applied: this opportunity task was moved above top-tier tasks without a verified date. */
  lifted: boolean;
  /** The sort key: lower comes first. */
  band: number;
}

export function priorityRank(task: Task, today: CalendarDate): PriorityRank {
  const done = task.status === 'done';
  const tier = BASIS_TIER[task.basis ?? 'unknown'];
  const days = task.deadline ? daysBetween(today, task.deadline) : null;
  const date: DateStanding = days === null ? 'none' : task.dateVerification === 'verified' ? 'verified' : 'unverified';
  const lifted = !done && tier === OPPORTUNITY_TIER && date === 'verified' && days !== null && days <= SOON_DAYS;
  const band = done ? DONE_BAND : lifted ? LIFTED_BAND : tier * 3 + DATE_ORDER[date];
  return { done, tier, date, days, lifted, band };
}

/** Tasks in Financial priority order (see the rules at the top of this file). Does not change `tasks`. */
export function sortByPriority(tasks: readonly Task[], today: CalendarDate): Task[] {
  return tasks
    .map((task) => ({ task, band: priorityRank(task, today).band }))
    .sort((a, b) => a.band - b.band || compareByDeadline(a.task, b.task))
    .map(({ task }) => task);
}

const BASIS_REASON: Record<DelayCostBasis, string> = {
  'avoidable charge': 'Avoidable charge',
  // "Deadline basis", not "Deadline": this is the sheet's reason for the cost, not a date that is due.
  deadline: 'Deadline basis',
  opportunity: 'Opportunity',
  unknown: 'Basis unknown',
  'sunk or reference': 'Sunk or reference',
};

const VERIFICATION_REASON: Record<DateVerification, string> = {
  verified: 'verified',
  planning: 'planning, not verified',
  unknown: 'not verified',
};

export interface PriorityReason {
  /** For example "Avoidable charge, recorded date in 3 days (not verified)". */
  text: string;
  /** Set when rule 3 moved the task up. */
  note: string | null;
}

/**
 * The short "why this order" line for a task. Timing that the sheet does not
 * give is said to be missing, never guessed.
 */
export function priorityReason(task: Task, today: CalendarDate): PriorityReason {
  const rank = priorityRank(task, today);
  if (rank.done) return { text: 'Done, not ranked', note: null };

  const basis = task.basis === null ? 'Basis not recognised' : BASIS_REASON[task.basis];
  let date: string;
  if (rank.days === null) {
    date = task.rawDeadline ? 'date not readable' : 'no date recorded';
  } else {
    date = `recorded date ${relativeDay(rank.days)} (${VERIFICATION_REASON[task.dateVerification ?? 'unknown']})`;
  }

  let note: string | null = null;
  if (rank.lifted && rank.days !== null) {
    note =
      rank.days < 0
        ? 'Moved up because its verified date has passed.'
        : `Moved up because its verified date is within ${SOON_DAYS} days.`;
  }
  return { text: `${basis}, ${date}`, note };
}

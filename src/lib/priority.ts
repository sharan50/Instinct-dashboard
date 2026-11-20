import { daysBetween, relativeDay, type CalendarDate } from './dates.ts';
import { compareByDeadline } from './filters.ts';
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
 * 3. One fixed rule, so the basis alone never buries a checked date that is
 *    close: an opportunity task whose verified date is today or within the
 *    next PROMOTION_WINDOW_DAYS goes above top-tier tasks that have no
 *    verified date. Once that date has passed the task drops back to its
 *    place in its own tier: a date in the past never moves a task across
 *    tiers, so it cannot stay urgent forever.
 * 4. Ties keep sheet order. Done tasks, when shown, come last.
 *
 * This is not magnitude-aware. The dashboard cannot compare amounts,
 * currencies or the real cost of an opportunity, so the order reflects only
 * the basis label, the recorded date and whether that date is verified.
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

/**
 * Rule 3's window: a verified date from today up to this many days ahead moves
 * an opportunity task up. An arbitrary fixed threshold, not a measure of what
 * is at stake. It is deliberately its own number, not tied to the "Next 7
 * days" date group.
 */
export const PROMOTION_WINDOW_DAYS = 7;

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
  /**
   * Rule 3 applied: this opportunity task was moved above top-tier tasks without a verified date,
   * because its verified date is today or within PROMOTION_WINDOW_DAYS. Never true for a date in the past.
   */
  lifted: boolean;
  /** The sort key: lower comes first. */
  band: number;
}

export function priorityRank(task: Task, today: CalendarDate): PriorityRank {
  const done = task.status === 'done';
  const tier = BASIS_TIER[task.basis ?? 'unknown'];
  const days = task.deadline ? daysBetween(today, task.deadline) : null;
  const date: DateStanding = days === null ? 'none' : task.dateVerification === 'verified' ? 'verified' : 'unverified';
  const lifted =
    !done &&
    tier === OPPORTUNITY_TIER &&
    date === 'verified' &&
    days !== null &&
    days >= 0 &&
    days <= PROMOTION_WINDOW_DAYS;
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
  /** Set when rule 3 moved the task up, or when a verified date has passed. */
  note: string | null;
}

/** Said of a task that rule 3 moved up: it names the rule, so the move is not read as a judgement of size. */
export const PROMOTED_NOTE = `Moved up by the fixed ${PROMOTION_WINDOW_DAYS}-day rule: its verified date is within ${PROMOTION_WINDOW_DAYS} days.`;

/**
 * Said of a verified date that has passed. The dashboard only knows the date
 * is behind us; it has no way to know what, if anything, followed from that.
 */
export const PASSED_NOTE = 'The date has passed; the dashboard does not know whether a consequence applies now.';

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
  if (rank.lifted) note = PROMOTED_NOTE;
  else if (rank.date === 'verified' && rank.days !== null && rank.days < 0) note = PASSED_NOTE;
  return { text: `${basis}, ${date}`, note };
}

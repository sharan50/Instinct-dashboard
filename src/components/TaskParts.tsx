import { Fragment, useId, type ReactNode } from 'react';
import { useFormat } from '../format.ts';
import { calendarUrl, offersCalendarLink } from '../lib/calendar.ts';
import { formatCalendarDate, formatRelative, formatTimestamp, relativeDay, type CalendarDate } from '../lib/dates.ts';
import { deadlineState, hasFoldedText, isNotStarted } from '../lib/filters.ts';
import { splitLinks } from '../lib/linkify.ts';
import { clipText } from '../lib/preview.ts';
import { PASSED_NOTE, priorityReason } from '../lib/priority.ts';
import { describeFlag, type ReviewFlag } from '../lib/review.ts';
import {
  hasDetailColumns,
  ORIGIN_LABELS,
  STATUS_LABELS,
  type DateVerification,
  type DelayCostBasis,
  type SheetColumns,
  type Task,
} from '../lib/tasks.ts';

function taskName(task: Task): string {
  return task.title || task.id || `row ${task.rowNumber}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function StatusBadge({ task }: { task: Task }) {
  if (!task.status) {
    return (
      <span className="badge badge--unknown">
        {task.rawStatus ? `Unknown status: ${task.rawStatus}` : 'No status'}
      </span>
    );
  }
  return (
    <span className={`badge badge--${task.status.replaceAll(' ', '-')}`}>{STATUS_LABELS[task.status]}</span>
  );
}

/** The part of life the task belongs to (the sheet's "Area" column). Nothing for a blank cell. */
export function AreaBadge({ task }: { task: Task }) {
  if (!task.area) return null;
  return <span className="badge badge--area badge--wrap">{task.area}</span>;
}

/** Who started the task (the sheet's "Origin" column). A blank or wrong value is shown, not hidden. */
export function OriginBadge({ task }: { task: Task }) {
  if (task.origin) return <span className="badge badge--origin">{ORIGIN_LABELS[task.origin]}</span>;
  return (
    <span className="badge badge--warning badge--wrap">
      {task.rawOrigin ? `Origin not recognised: ${task.rawOrigin}` : 'Origin missing'}
    </span>
  );
}

const VERIFICATION_BADGE: Record<DateVerification, { label: string; className: string }> = {
  verified: { label: 'Verified', className: 'badge badge--verified' },
  planning: { label: 'Planning date', className: 'badge badge--unverified' },
  unknown: { label: 'Not verified', className: 'badge badge--unverified' },
};

/** The sheet's "Date verified" value. One the dashboard does not recognise is shown, not passed off as blank. */
function VerificationBadge({ task }: { task: Task }) {
  if (task.dateVerification === null) {
    return (
      <span className="badge badge--warning badge--wrap">
        Date verified not recognised: {task.rawDateVerification}
      </span>
    );
  }
  const check = VERIFICATION_BADGE[task.dateVerification];
  return <span className={check.className}>{check.label}</span>;
}

/**
 * "Add to calendar": offered for a verified date that is today or later (see
 * lib/calendar.ts). A plain link; nothing is sent unless it is followed.
 */
export function CalendarLink({ task, today }: { task: Task; today: CalendarDate }) {
  if (!offersCalendarLink(task, today)) return null;
  return (
    <a
      className="calendar-link"
      href={calendarUrl(task) ?? undefined}
      target="_blank"
      rel="noopener noreferrer"
      // Starts with the words on screen, so voice control can find the link by them.
      aria-label={`Add to calendar: ${taskName(task)} (opens Google Calendar in a new tab)`}
    >
      Add to calendar
    </a>
  );
}

/**
 * The date from the sheet's Deadline column. It is a recorded date that may be
 * a planning or check date, so it is worded as a date ("in 3 days"), never as
 * something due or enforced, and always carries its "Date verified" badge.
 *
 * `passedNote` adds, under a verified date that has passed, that the dashboard
 * does not know whether a consequence applies now. It is set wherever the
 * "why this order" line, which says the same, is not shown.
 *
 * `calendarLink` adds "Add to calendar" under the date (see CalendarLink).
 */
export function RecordedDate({
  task,
  today,
  passedNote = false,
  calendarLink = false,
}: {
  task: Task;
  today: CalendarDate;
  passedNote?: boolean;
  calendarLink?: boolean;
}) {
  const format = useFormat();
  const state = deadlineState(task, today);

  if (!task.deadline) {
    // Without a date there is nothing to verify, but a value that is not one of the three is still shown.
    const unrecognised =
      task.dateVerification === null ? (
        <>
          {' '}
          <VerificationBadge task={task} />
        </>
      ) : null;
    if (state.kind === 'invalid') {
      return (
        <span>
          “{task.rawDeadline}” <span className="badge badge--warning">Not a YYYY-MM-DD date</span>
          {unrecognised}
        </span>
      );
    }
    return (
      <span>
        <span className="muted">{task.ongoing ? 'Ongoing, no fixed date' : 'No recorded date'}</span>
        {unrecognised}
      </span>
    );
  }

  let when: ReactNode = null;
  switch (state.kind) {
    case 'overdue':
      // A past date, verified or not, is only a past date: the dashboard does not know whether
      // a consequence applies now, so it is never shown in the red used for problems.
      when = <span className="badge badge--warning">{capitalize(relativeDay(-state.days))}</span>;
      break;
    case 'today':
      when = <span className="badge badge--today">Today</span>;
      break;
    case 'soon':
      when = <span className="badge badge--soon">{capitalize(relativeDay(state.days))}</span>;
      break;
    default:
      break;
  }

  return (
    <span>
      <time dateTime={task.deadline.iso}>{formatCalendarDate(task.deadline, format)}</time> {when}{' '}
      <VerificationBadge task={task} />
      {passedNote && state.kind === 'overdue' && task.dateVerification === 'verified' ? (
        <span className="detail-note muted">{PASSED_NOTE}</span>
      ) : null}
      {calendarLink ? <CalendarLink task={task} today={today} /> : null}
    </span>
  );
}

/** The sheet's "Start": the first day the task can be acted on. Only drawn when the cell has something in it. */
export function StartInfo({ task, today }: { task: Task; today: CalendarDate }) {
  const format = useFormat();
  if (!task.start) {
    return (
      <span>
        “{task.rawStart}” <span className="badge badge--warning">Not a YYYY-MM-DD date</span>
      </span>
    );
  }
  return (
    <span>
      <time dateTime={task.start.iso}>{formatCalendarDate(task.start, format)}</time>
      {isNotStarted(task, today) ? (
        <>
          {' '}
          <span className="badge badge--unverified">Not started yet</span>
        </>
      ) : null}
    </span>
  );
}

export function LastUpdate({ task, now }: { task: Task; now: number }) {
  const format = useFormat();
  if (task.lastUpdate) {
    return (
      <span>
        <time dateTime={task.lastUpdate.toISOString()}>{formatTimestamp(task.lastUpdate, format)}</time>{' '}
        <span className="muted last-update__relative">({formatRelative(task.lastUpdate, new Date(now), format)})</span>
      </span>
    );
  }
  if (task.rawLastUpdate) {
    return (
      <span>
        “{task.rawLastUpdate}” <span className="badge badge--warning">Time not readable</span>
      </span>
    );
  }
  return <span className="muted">Not recorded</span>;
}

/** Sheet text as plain text: web addresses become links, nothing is read as HTML. */
function LinkedText({ text }: { text: string }) {
  return (
    <>
      {splitLinks(text).map((part, index) =>
        part.type === 'link' ? (
          <a key={index} href={part.href} target="_blank" rel="noopener noreferrer">
            {part.text}
          </a>
        ) : (
          <Fragment key={index}>{part.text}</Fragment>
        ),
      )}
    </>
  );
}

/** Notes as plain text: web addresses become links, nothing is read as HTML. */
export function NotesText({ text }: { text: string }) {
  return (
    <p className="notes-text">
      <LinkedText text={text} />
    </p>
  );
}

/** The button that folds notes or long text away. */
function FoldToggle({
  task,
  action,
  expanded,
  controls,
  matches,
  onToggle,
}: {
  task: Task;
  action: string;
  expanded: boolean;
  controls: string;
  matches: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="notes-toggle"
      aria-expanded={expanded}
      aria-controls={controls}
      aria-label={`${action} for ${taskName(task)}${matches ? ' (matches your search)' : ''}`}
      onClick={onToggle}
    >
      <span aria-hidden="true" className="notes-toggle__icon">
        {expanded ? '▾' : '▸'}
      </span>
      {action}
      {matches ? <span className="notes-match">matches your search</span> : null}
    </button>
  );
}

export function Notes({
  task,
  expanded,
  onToggle,
  matchInNotes,
}: {
  task: Task;
  expanded: boolean;
  onToggle: () => void;
  matchInNotes: boolean;
}) {
  const id = useId();
  if (!task.notes) return <p className="muted notes-empty">No notes</p>;
  return (
    <div className="notes">
      <FoldToggle
        task={task}
        action={expanded ? 'Hide notes' : 'Show notes'}
        expanded={expanded}
        controls={id}
        matches={matchInNotes && !expanded}
        onToggle={onToggle}
      />
      <div id={id} className="notes-body" hidden={!expanded}>
        <NotesText text={task.notes} />
      </div>
    </div>
  );
}

/** Work delivered for the task (the sheet's "Links" column), always visible. */
export function TaskLinks({ task }: { task: Task }) {
  if (task.links.length === 0) return null;
  return (
    <ul className="task-links" aria-label={`Links for ${task.title || task.id}`}>
      {task.links.map((link, index) => (
        <li key={index}>
          {link.href ? (
            <a href={link.href} target="_blank" rel="noopener noreferrer">
              <span aria-hidden="true" className="task-links__icon">
                ↗
              </span>
              {link.label}
            </a>
          ) : (
            <span className="muted">{link.label}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Why the task sits where it does in Financial priority order. */
export function WhyThisOrder({ task, today }: { task: Task; today: CalendarDate }) {
  const reason = priorityReason(task, today);
  return (
    <p className="why-order">
      <span className="why-order__label">Why this order:</span> {reason.text}
      {reason.note ? `. ${reason.note}` : null}
    </p>
  );
}

const BASIS_BADGE: Record<DelayCostBasis, { label: string; className: string }> = {
  'avoidable charge': { label: 'Basis: avoidable charge', className: 'badge badge--basis-top' },
  deadline: { label: 'Basis: deadline', className: 'badge badge--basis-top' },
  opportunity: { label: 'Basis: opportunity', className: 'badge badge--basis-opportunity' },
  'sunk or reference': { label: 'Basis: sunk or reference', className: 'badge' },
  unknown: { label: 'Basis unknown', className: 'badge' },
};

/** The sheet's "Delay-cost basis" for the task: the sheet's own label, not something the dashboard checked. */
export function BasisBadge({ task }: { task: Task }) {
  if (task.basis === null) {
    return <span className="badge badge--warning badge--wrap">Basis not recognised: {task.rawBasis}</span>;
  }
  const badge = BASIS_BADGE[task.basis];
  return <span className={`${badge.className} badge--wrap`}>{badge.label}</span>;
}

/** One free-text cell, shown as written. Long text shows its beginning until `full` is set. */
function DetailText({ text, full }: { text: string; full: boolean }) {
  if (!text) return <span className="muted">Not recorded</span>;
  const preview = clipText(text);
  const folded = preview.clipped && !full;
  return (
    <span className="detail-text">
      <LinkedText text={folded ? preview.text : text} />
      {folded ? '…' : null}
    </span>
  );
}

/**
 * Progress, Money at stake (with its basis badge), Hands-on effort and
 * Expected finish as separate labelled lines. A line appears when the sheet
 * has its column; a blank cell reads "Not recorded". A sheet with a basis
 * column but no Money at stake column gets a "Delay-cost basis" line instead.
 * Long text shows its beginning until `expanded` is set (see FullTextToggle).
 */
export function TaskDetails({
  task,
  columns,
  expanded,
  id,
}: {
  task: Task;
  columns: SheetColumns;
  expanded: boolean;
  id: string;
}) {
  if (!hasDetailColumns(columns)) return null;
  return (
    <div className="task-details">
      <dl className="task-meta" id={id}>
        {columns.progress ? (
          <div>
            <dt>Progress</dt>
            <dd>
              <DetailText text={task.progress} full={expanded} />
            </dd>
          </div>
        ) : null}
        {columns.moneyAtStake ? (
          <div>
            <dt>Money at stake</dt>
            <dd>
              <DetailText text={task.moneyAtStake} full={expanded} />
              {columns.basis ? (
                <>
                  {' '}
                  <BasisBadge task={task} />
                </>
              ) : null}
            </dd>
          </div>
        ) : columns.basis ? (
          <div>
            <dt>Delay-cost basis</dt>
            <dd>
              <BasisBadge task={task} />
            </dd>
          </div>
        ) : null}
        {columns.effort ? (
          <div>
            <dt>Hands-on effort</dt>
            <dd>
              <DetailText text={task.effort} full={expanded} />
            </dd>
          </div>
        ) : null}
        {columns.expectedFinish ? (
          <div>
            <dt>Expected finish</dt>
            <dd>
              <DetailText text={task.expectedFinish} full={expanded} />
              {task.expectedFinish ? (
                task.status === 'waiting on someone else' ? (
                  <>
                    {' '}
                    <span className="badge badge--waiting-on-someone-else badge--wrap">
                      Includes waiting on someone else
                    </span>
                  </>
                ) : (
                  <span className="detail-note muted">Includes any waiting on others, not just hands-on time.</span>
                )
              ) : null}
            </dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

/** The very next thing to do (the sheet's "Next step"), ahead of everything else about the task. */
export function NextStep({ task, full, id }: { task: Task; full: boolean; id: string }) {
  return (
    <p className="next-step" id={id}>
      <span className="next-step__label">Next step:</span> <DetailText text={task.nextStep} full={full} />
    </p>
  );
}

/** One toggle per task for all of its long text. Drawn only when something is folded. */
export function FullTextToggle({
  task,
  expanded,
  controls,
  matchInFoldedText,
  onToggle,
}: {
  task: Task;
  expanded: boolean;
  /** The ids of the parts of the task that hold the text, separated by spaces. */
  controls: string;
  matchInFoldedText: boolean;
  onToggle: () => void;
}) {
  if (!hasFoldedText(task)) return null;
  return (
    <FoldToggle
      task={task}
      action={expanded ? 'Show less text' : 'Show full text'}
      expanded={expanded}
      controls={controls}
      matches={matchInFoldedText && !expanded}
      onToggle={onToggle}
    />
  );
}

/** Opens and closes a short card (the Today and Review views). */
export function DetailsToggle({
  task,
  open,
  controls,
  matches,
  onToggle,
}: {
  task: Task;
  open: boolean;
  controls: string;
  matches: boolean;
  onToggle: () => void;
}) {
  return (
    <FoldToggle
      task={task}
      action={open ? 'Hide details' : 'Show details'}
      expanded={open}
      controls={controls}
      matches={matches && !open}
      onToggle={onToggle}
    />
  );
}

/** What the Review view flags a task for. */
export function ReviewFlags({ flags }: { flags: readonly ReviewFlag[] }) {
  return (
    <ul className="review-flags" aria-label="Flagged for">
      {flags.map((flag) => (
        <li key={flag.kind} className="badge badge--warning badge--wrap">
          {describeFlag(flag)}
        </li>
      ))}
    </ul>
  );
}

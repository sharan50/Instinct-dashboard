import { Fragment, useId } from 'react';
import { useFormat } from '../format.ts';
import { formatCalendarDate, formatRelative, formatTimestamp, type CalendarDate } from '../lib/dates.ts';
import { deadlineState } from '../lib/filters.ts';
import { splitLinks } from '../lib/linkify.ts';
import { STATUS_LABELS, type Task } from '../lib/tasks.ts';

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'}`;
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

export function DeadlineInfo({ task, today }: { task: Task; today: CalendarDate }) {
  const format = useFormat();
  const state = deadlineState(task, today);

  if (!task.deadline) {
    if (state.kind === 'invalid') {
      return (
        <span>
          “{task.rawDeadline}” <span className="badge badge--warning">Not a YYYY-MM-DD date</span>
        </span>
      );
    }
    return <span className="muted">{task.ongoing ? 'Ongoing, no fixed date' : 'No deadline'}</span>;
  }

  const date = <time dateTime={task.deadline.iso}>{formatCalendarDate(task.deadline, format)}</time>;
  switch (state.kind) {
    case 'overdue':
      return (
        <span>
          {date} <span className="badge badge--overdue">Overdue by {plural(state.days, 'day')}</span>
        </span>
      );
    case 'today':
      return (
        <span>
          {date} <span className="badge badge--today">Due today</span>
        </span>
      );
    case 'soon':
      return (
        <span>
          {date}{' '}
          <span className="badge badge--soon">{state.days === 1 ? 'Due tomorrow' : `Due in ${state.days} days`}</span>
        </span>
      );
    default:
      return date;
  }
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

/** Notes as plain text: web addresses become links, nothing is read as HTML. */
export function NotesText({ text }: { text: string }) {
  return (
    <p className="notes-text">
      {splitLinks(text).map((part, index) =>
        part.type === 'link' ? (
          <a key={index} href={part.href} target="_blank" rel="noopener noreferrer">
            {part.text}
          </a>
        ) : (
          <Fragment key={index}>{part.text}</Fragment>
        ),
      )}
    </p>
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
  const action = expanded ? 'Hide notes' : 'Show notes';
  const showMatch = matchInNotes && !expanded;
  return (
    <div className="notes">
      <button
        type="button"
        className="notes-toggle"
        aria-expanded={expanded}
        aria-controls={id}
        aria-label={`${action} for ${task.title || task.id || `row ${task.rowNumber}`}${showMatch ? ' (matches your search)' : ''}`}
        onClick={onToggle}
      >
        <span aria-hidden="true" className="notes-toggle__icon">
          {expanded ? '▾' : '▸'}
        </span>
        {action}
        {showMatch ? <span className="notes-match">matches your search</span> : null}
      </button>
      <div id={id} className="notes-body" hidden={!expanded}>
        <NotesText text={task.notes} />
      </div>
    </div>
  );
}

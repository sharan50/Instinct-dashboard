import { useId } from 'react';
import type { CalendarDate } from '../lib/dates.ts';
import {
  groupByDeadline,
  matchesOnlyBehindDetails,
  matchesOnlyInFoldedText,
  matchesOnlyInNotes,
} from '../lib/filters.ts';
import { countFlags, STALE_AFTER_DAYS, type ReviewFlag, type ReviewItem } from '../lib/review.ts';
import { hasDetailColumns, OPTIONAL_COLUMNS, type SheetColumns, type Task } from '../lib/tasks.ts';
import type { TodaySections } from '../lib/today.ts';
import {
  AreaBadge,
  DetailsToggle,
  FullTextToggle,
  LastUpdate,
  NextStep,
  Notes,
  OriginBadge,
  RecordedDate,
  ReviewFlags,
  StartInfo,
  StatusBadge,
  TaskDetails,
  TaskLinks,
  WhyThisOrder,
} from './TaskParts.tsx';

export interface TaskViewProps {
  tasks: Task[];
  /** Which optional columns the sheet has: their lines and badges only appear when it does. */
  columns: SheetColumns;
  today: CalendarDate;
  now: number;
  query: string;
  expanded: ReadonlySet<string>;
  onToggleNotes: (key: string) => void;
  /** Tasks whose long free text is shown in full. */
  fullText: ReadonlySet<string>;
  onToggleFullText: (key: string) => void;
  /** Short cards (Today and Review) that are open. */
  openCards: ReadonlySet<string>;
  onToggleCard: (key: string) => void;
  /** Show each task's "why this order" line. Only true in Financial priority order. */
  showReason: boolean;
}

type CardOptions = {
  /** A short card: name, next step and date, with everything else behind "Show details". */
  compact?: boolean;
  /** Short cards only: keep the last update on show (for tasks that are waiting or have gone quiet). */
  showUpdate?: boolean;
};

type CardProps = Omit<TaskViewProps, 'tasks'> &
  CardOptions & {
    task: Task;
    /** Review view: what the task is flagged for. */
    flags?: readonly ReviewFlag[];
  };

export function TaskCard({
  task,
  columns,
  today,
  now,
  query,
  expanded,
  onToggleNotes,
  fullText,
  onToggleFullText,
  openCards,
  onToggleCard,
  showReason,
  compact = false,
  showUpdate = false,
  flags,
}: CardProps) {
  const titleId = useId();
  const textId = useId();
  const bodyId = useId();
  const open = !compact || openCards.has(task.key);
  // The "why this order" line is on screen: always on a full card, and on a short one once it is open.
  const reasonUp = showReason && open;
  const full = fullText.has(task.key);
  // A short card shows the date only when the sheet has one, and the last update only where it matters.
  const dateUp = !compact || task.rawDeadline !== '';
  const updateUp = !compact || showUpdate;
  const textIds = [columns.nextStep ? `${textId}-next` : '', hasDetailColumns(columns) && open ? `${textId}-details` : '']
    .filter(Boolean)
    .join(' ');

  const dateRow = (
    <div>
      <dt>Recorded date</dt>
      <dd>
        <RecordedDate task={task} today={today} passedNote={!reasonUp} calendarLink={open} />
      </dd>
    </div>
  );
  const updateRow = (
    <div>
      <dt>Last update</dt>
      <dd>
        <LastUpdate task={task} now={now} />
      </dd>
    </div>
  );
  const startRow = task.rawStart ? (
    <div>
      <dt>Start</dt>
      <dd>
        <StartInfo task={task} today={today} />
      </dd>
    </div>
  ) : null;

  return (
    <article className={task.status === 'done' ? 'task-card task-card--done' : 'task-card'} aria-labelledby={titleId}>
      <div className="task-card__top">
        <span className="task-id">{task.id || `Row ${task.rowNumber}`}</span>
        <StatusBadge task={task} />
        {task.ongoing ? <span className="badge badge--ongoing">Ongoing</span> : null}
        {columns.area ? <AreaBadge task={task} /> : null}
        {columns.origin && open ? <OriginBadge task={task} /> : null}
      </div>
      <h3 id={titleId} className="task-title">
        {task.title || '(No task name)'}
      </h3>
      {flags ? <ReviewFlags flags={flags} /> : null}
      {columns.nextStep ? <NextStep task={task} full={full} id={`${textId}-next`} /> : null}
      {reasonUp && !compact ? <WhyThisOrder task={task} today={today} /> : null}
      {dateUp || updateUp ? (
        <dl className="task-meta">
          {dateUp ? dateRow : null}
          {!compact ? startRow : null}
          {updateUp ? updateRow : null}
        </dl>
      ) : null}
      {compact ? (
        <DetailsToggle
          task={task}
          open={open}
          controls={bodyId}
          matches={matchesOnlyBehindDetails(task, query)}
          onToggle={() => onToggleCard(task.key)}
        />
      ) : null}
      <div className="task-card__body" id={bodyId} hidden={!open}>
        {open ? (
          <>
            {reasonUp && compact ? <WhyThisOrder task={task} today={today} /> : null}
            {compact && (!dateUp || startRow || !updateUp) ? (
              <dl className="task-meta">
                {!dateUp ? dateRow : null}
                {startRow}
                {!updateUp ? updateRow : null}
              </dl>
            ) : null}
            <TaskDetails task={task} columns={columns} expanded={full} id={`${textId}-details`} />
            <FullTextToggle
              task={task}
              expanded={full}
              controls={textIds}
              matchInFoldedText={matchesOnlyInFoldedText(task, query)}
              onToggle={() => onToggleFullText(task.key)}
            />
            <TaskLinks task={task} />
            <Notes
              task={task}
              expanded={expanded.has(task.key)}
              onToggle={() => onToggleNotes(task.key)}
              matchInNotes={matchesOnlyInNotes(task, query)}
            />
          </>
        ) : null}
      </div>
    </article>
  );
}

function CardList(props: TaskViewProps & CardOptions) {
  const { tasks, ...rest } = props;
  return (
    <ul className="task-cards">
      {tasks.map((task) => (
        <li key={task.key}>
          <TaskCard task={task} {...rest} />
        </li>
      ))}
    </ul>
  );
}

/** Desktop only: a table when the screen is wide enough for it to fit without scrolling sideways. */
export function TaskTable({
  tasks,
  columns,
  today,
  now,
  query,
  expanded,
  onToggleNotes,
  fullText,
  onToggleFullText,
  showReason,
  caption,
}: TaskViewProps & { caption: string }) {
  // The next step and the labelled lines share the last column with the notes, so the table
  // keeps six columns. The "why this order" line sits there too, not in the row header: a
  // screen reader repeats the row header for every cell of the row, so it holds only the
  // name, badges and links.
  const details = hasDetailColumns(columns) || columns.nextStep;
  const textId = useId();
  return (
    <table className={details ? 'task-table task-table--details' : 'task-table'}>
      <caption className="visually-hidden">{caption}</caption>
      <colgroup>
        <col className="col-id" />
        <col className="col-task" />
        <col className="col-status" />
        <col className="col-deadline" />
        <col className="col-updated" />
        <col className="col-notes" />
      </colgroup>
      <thead>
        <tr>
          <th scope="col">ID</th>
          <th scope="col">Task</th>
          <th scope="col">Status</th>
          <th scope="col">Recorded date</th>
          <th scope="col">Last update</th>
          <th scope="col">{details ? 'Progress and notes' : 'Notes'}</th>
        </tr>
      </thead>
      <tbody>
        {tasks.map((task) => {
          const full = fullText.has(task.key);
          const ids = { next: `${textId}-${task.rowNumber}-next`, details: `${textId}-${task.rowNumber}-details` };
          const textIds = [columns.nextStep ? ids.next : '', hasDetailColumns(columns) ? ids.details : '']
            .filter(Boolean)
            .join(' ');
          return (
            <tr key={task.key} className={task.status === 'done' ? 'row--done' : undefined}>
              <td className="task-id">{task.id || `Row ${task.rowNumber}`}</td>
              <th scope="row" className="task-title-cell">
                <span>{task.title || '(No task name)'}</span>
                {task.ongoing ? (
                  <>
                    {' '}
                    <span className="badge badge--ongoing">Ongoing</span>
                  </>
                ) : null}
                {columns.area && task.area ? (
                  <>
                    {' '}
                    <AreaBadge task={task} />
                  </>
                ) : null}
                {columns.origin ? (
                  <>
                    {' '}
                    <OriginBadge task={task} />
                  </>
                ) : null}
                <TaskLinks task={task} />
              </th>
              <td>
                <StatusBadge task={task} />
              </td>
              <td>
                <RecordedDate task={task} today={today} passedNote={!showReason} calendarLink />
                {task.rawStart ? (
                  <p className="start-line">
                    <span className="muted">Start</span> <StartInfo task={task} today={today} />
                  </p>
                ) : null}
              </td>
              <td>
                <LastUpdate task={task} now={now} />
              </td>
              <td>
                {columns.nextStep ? <NextStep task={task} full={full} id={ids.next} /> : null}
                {showReason ? <WhyThisOrder task={task} today={today} /> : null}
                <TaskDetails task={task} columns={columns} expanded={full} id={ids.details} />
                <FullTextToggle
                  task={task}
                  expanded={full}
                  controls={textIds}
                  matchInFoldedText={matchesOnlyInFoldedText(task, query)}
                  onToggle={() => onToggleFullText(task.key)}
                />
                <Notes
                  task={task}
                  expanded={expanded.has(task.key)}
                  onToggle={() => onToggleNotes(task.key)}
                  matchInNotes={matchesOnlyInNotes(task, query)}
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function TaskList(props: TaskViewProps & { wide: boolean; caption: string }) {
  const { wide, caption, ...rest } = props;
  if (props.tasks.length === 0) return null;
  return wide ? <TaskTable caption={caption} {...rest} /> : <CardList {...rest} />;
}

/** The "By date" view: tasks grouped by where their recorded date falls, earliest first in each group. */
export function DeadlinesView(props: TaskViewProps) {
  const { tasks, today, ...rest } = props;
  const groups = groupByDeadline(tasks, today);
  return (
    <div className="deadline-groups">
      {groups.map((group) => (
        <section key={group.id} className={`deadline-group deadline-group--${group.id}`} aria-labelledby={`group-${group.id}`}>
          <h2 id={`group-${group.id}`} className="deadline-group__title">
            {group.title} <span className="count">{group.tasks.length}</span>
          </h2>
          {group.tasks.length === 0 ? (
            <p className="muted deadline-group__empty">{group.emptyText}</p>
          ) : (
            <CardList tasks={group.tasks} today={today} {...rest} />
          )}
        </section>
      ))}
    </div>
  );
}

/**
 * The "Today" view: what needs attention now, in three short groups (see
 * lib/today.ts). Each task appears once, as a short card. The line at the end
 * says how many tasks the view leaves out, so nothing is dropped silently.
 */
export function TodayView({
  sections,
  filtered,
  onSeeAll,
  ...rest
}: Omit<TaskViewProps, 'tasks' | 'showReason'> & {
  sections: TodaySections;
  /** A search or an area is narrowing the view, so an empty group may only mean "no match". */
  filtered: boolean;
  onSeeAll: () => void;
}) {
  const groups = [
    {
      id: 'your-move',
      title: 'Your move',
      hint: 'Waiting on you, in Financial priority order.',
      empty: 'Nothing is waiting on you.',
      tasks: sections.yourMove,
      showUpdate: false,
      // The one group in Financial priority order: an open card says why it sits where it does.
      showReason: true,
    },
    {
      id: 'next-days',
      title: 'Next 7 days',
      hint: 'Other tasks with a recorded date from today to 7 days ahead, verified dates first.',
      empty: 'No other recorded dates in the next 7 days.',
      tasks: sections.nextDays,
      showUpdate: false,
      showReason: false,
    },
    {
      id: 'chase',
      title: 'Chase',
      hint: 'Other tasks waiting on someone else, the longest without an update first.',
      empty: 'Nothing else is waiting on someone else.',
      tasks: sections.chase,
      showUpdate: true,
      showReason: false,
    },
  ];
  return (
    <div className="today">
      <div className="today__groups">
        {groups.map((group) => (
          <section key={group.id} className="today__group" aria-labelledby={`today-${group.id}`}>
            <h2 id={`today-${group.id}`} className="deadline-group__title">
              {group.title} <span className="count">{group.tasks.length}</span>
            </h2>
            <p className="muted today__hint">{group.hint}</p>
            {group.tasks.length === 0 ? (
              <p className="muted deadline-group__empty">
                {filtered ? 'No task here matches the search or area.' : group.empty}
              </p>
            ) : (
              <CardList
                tasks={group.tasks}
                compact
                showUpdate={group.showUpdate}
                showReason={group.showReason}
                {...rest}
              />
            )}
          </section>
        ))}
      </div>
      {sections.elsewhere > 0 ? (
        <p className="view-note">
          {sections.elsewhere} more {sections.elsewhere === 1 ? 'task that is not done is' : 'tasks that are not done are'}{' '}
          not on this screen: not waiting on anyone, and no recorded date in the next 7 days.
          <button type="button" className="btn-link" onClick={onSeeAll}>
            See all tasks
          </button>
        </p>
      ) : null}
    </div>
  );
}

/**
 * The "Review" view: tasks that have gone quiet or are missing something (see
 * lib/review.ts), each as a short card that says what it is flagged for.
 */
export function ReviewView({
  items,
  ...rest
}: Omit<TaskViewProps, 'tasks' | 'showReason'> & { items: ReviewItem[] }) {
  const { columns } = rest;
  const counts = countFlags(items);
  const checks = [
    { label: `No update for ${STALE_AFTER_DAYS} days or more`, count: counts.stale },
    { label: 'No last update recorded', count: counts['no-update'] },
    { label: 'Waiting on someone else with no recorded date', count: counts['waiting-undated'] },
    ...(columns.nextStep ? [{ label: 'No next step', count: counts['no-next-step'] }] : []),
    ...(columns.area ? [{ label: 'No area', count: counts['no-area'] }] : []),
  ];
  return (
    <section className="review" aria-labelledby="review-heading">
      <h2 id="review-heading" className="deadline-group__title">
        Needs a look <span className="count">{items.length}</span>
      </h2>
      <p className="muted">Tasks that are not done, have started, and have gone quiet or are missing something.</p>
      <ul className="review-checks">
        {checks.map((check) => (
          <li key={check.label}>
            {check.label}: <strong>{check.count}</strong>
          </li>
        ))}
      </ul>
      {columns.nextStep ? null : (
        <p className="muted">
          The Tasks tab has no “{OPTIONAL_COLUMNS.nextStep}” column yet, so next steps are not checked.
        </p>
      )}
      {columns.area ? null : (
        <p className="muted">The Tasks tab has no “{OPTIONAL_COLUMNS.area}” column yet, so areas are not checked.</p>
      )}
      {items.length === 0 ? (
        <p className="muted deadline-group__empty">Nothing needs a look.</p>
      ) : (
        <ul className="task-cards task-cards--grid">
          {items.map(({ task, flags }) => (
            <li key={task.key}>
              <TaskCard task={task} flags={flags} compact showUpdate showReason={false} {...rest} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

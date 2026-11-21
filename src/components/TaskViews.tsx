import { useId } from 'react';
import type { CalendarDate } from '../lib/dates.ts';
import { groupByDeadline, matchesOnlyInFoldedText, matchesOnlyInNotes } from '../lib/filters.ts';
import { hasDetailColumns, type SheetColumns, type Task } from '../lib/tasks.ts';
import {
  LastUpdate,
  Notes,
  OriginBadge,
  RecordedDate,
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
  /** Show each task's "why this order" line. Only true in Financial priority order. */
  showReason: boolean;
}

type CardProps = Omit<TaskViewProps, 'tasks'> & { task: Task };

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
  showReason,
}: CardProps) {
  const titleId = useId();
  return (
    <article className={task.status === 'done' ? 'task-card task-card--done' : 'task-card'} aria-labelledby={titleId}>
      <div className="task-card__top">
        <span className="task-id">{task.id || `Row ${task.rowNumber}`}</span>
        <StatusBadge task={task} />
        {task.ongoing ? <span className="badge badge--ongoing">Ongoing</span> : null}
        {columns.origin ? <OriginBadge task={task} /> : null}
      </div>
      <h3 id={titleId} className="task-title">
        {task.title || '(No task name)'}
      </h3>
      {showReason ? <WhyThisOrder task={task} today={today} /> : null}
      <dl className="task-meta">
        <div>
          <dt>Recorded date</dt>
          <dd>
            <RecordedDate task={task} today={today} passedNote={!showReason} />
          </dd>
        </div>
        <div>
          <dt>Last update</dt>
          <dd>
            <LastUpdate task={task} now={now} />
          </dd>
        </div>
      </dl>
      <TaskDetails
        task={task}
        columns={columns}
        expanded={fullText.has(task.key)}
        onToggle={() => onToggleFullText(task.key)}
        matchInFoldedText={matchesOnlyInFoldedText(task, query)}
      />
      <TaskLinks task={task} />
      <Notes
        task={task}
        expanded={expanded.has(task.key)}
        onToggle={() => onToggleNotes(task.key)}
        matchInNotes={matchesOnlyInNotes(task, query)}
      />
    </article>
  );
}

function CardList(props: TaskViewProps) {
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
  // The labelled lines share the last column with the notes, so the table keeps six columns.
  // The "why this order" line sits there too, not in the row header: a screen reader repeats
  // the row header for every cell of the row, so it holds only the name, badges and links.
  const details = hasDetailColumns(columns);
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
        {tasks.map((task) => (
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
              <RecordedDate task={task} today={today} passedNote={!showReason} />
            </td>
            <td>
              <LastUpdate task={task} now={now} />
            </td>
            <td>
              {showReason ? <WhyThisOrder task={task} today={today} /> : null}
              <TaskDetails
                task={task}
                columns={columns}
                expanded={fullText.has(task.key)}
                onToggle={() => onToggleFullText(task.key)}
                matchInFoldedText={matchesOnlyInFoldedText(task, query)}
              />
              <Notes
                task={task}
                expanded={expanded.has(task.key)}
                onToggle={() => onToggleNotes(task.key)}
                matchInNotes={matchesOnlyInNotes(task, query)}
              />
            </td>
          </tr>
        ))}
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

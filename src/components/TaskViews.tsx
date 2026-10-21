import { useId } from 'react';
import type { CalendarDate } from '../lib/dates.ts';
import { groupByDeadline, matchesOnlyInNotes } from '../lib/filters.ts';
import type { Task } from '../lib/tasks.ts';
import { DeadlineInfo, LastUpdate, Notes, StatusBadge } from './TaskParts.tsx';

export interface TaskViewProps {
  tasks: Task[];
  today: CalendarDate;
  now: number;
  query: string;
  expanded: ReadonlySet<string>;
  onToggleNotes: (key: string) => void;
}

type CardProps = Omit<TaskViewProps, 'tasks'> & { task: Task };

export function TaskCard({ task, today, now, query, expanded, onToggleNotes }: CardProps) {
  const titleId = useId();
  return (
    <article className={task.status === 'done' ? 'task-card task-card--done' : 'task-card'} aria-labelledby={titleId}>
      <div className="task-card__top">
        <span className="task-id">{task.id || `Row ${task.rowNumber}`}</span>
        <StatusBadge task={task} />
        {task.ongoing ? <span className="badge badge--ongoing">Ongoing</span> : null}
      </div>
      <h3 id={titleId} className="task-title">
        {task.title || '(No task name)'}
      </h3>
      <dl className="task-meta">
        <div>
          <dt>Deadline</dt>
          <dd>
            <DeadlineInfo task={task} today={today} />
          </dd>
        </div>
        <div>
          <dt>Last update</dt>
          <dd>
            <LastUpdate task={task} now={now} />
          </dd>
        </div>
      </dl>
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
export function TaskTable({ tasks, today, now, query, expanded, onToggleNotes }: TaskViewProps) {
  return (
    <table className="task-table">
      <caption className="visually-hidden">Tasks, earliest deadline first</caption>
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
          <th scope="col">Deadline</th>
          <th scope="col">Last update</th>
          <th scope="col">Notes</th>
        </tr>
      </thead>
      <tbody>
        {tasks.map((task) => (
          <tr key={task.key} className={task.status === 'done' ? 'row--done' : undefined}>
            <td className="task-id">{task.id || `Row ${task.rowNumber}`}</td>
            <th scope="row" className="task-title-cell">
              {task.title || '(No task name)'}
              {task.ongoing ? <span className="badge badge--ongoing">Ongoing</span> : null}
            </th>
            <td>
              <StatusBadge task={task} />
            </td>
            <td>
              <DeadlineInfo task={task} today={today} />
            </td>
            <td>
              <LastUpdate task={task} now={now} />
            </td>
            <td>
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

export function TaskList(props: TaskViewProps & { wide: boolean }) {
  const { wide, ...rest } = props;
  if (props.tasks.length === 0) return null;
  return wide ? <TaskTable {...rest} /> : <CardList {...rest} />;
}

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

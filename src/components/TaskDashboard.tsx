import { useMemo, useState } from 'react';
import { useFormat } from '../format.ts';
import type { DashboardController, DashboardData } from '../hooks/useDashboard.ts';
import { useMediaQuery } from '../hooks/useMediaQuery.ts';
import { useNow } from '../hooks/useNow.ts';
import { todayIn } from '../lib/dates.ts';
import {
  countByStatus,
  deadlineState,
  DEFAULT_STATUS_FILTER,
  filterTasks,
  sortByDeadline,
  type StatusKey,
} from '../lib/filters.ts';
import { STATUSES } from '../lib/tasks.ts';
import { authProblemText, fetchProblemText } from '../messages.ts';
import { DataIssues, Footer, Header, ProblemPanel, SyncBar } from './Chrome.tsx';
import { SearchBox, StatusFilter, ViewSwitch, type View } from './Filters.tsx';
import { ProblemActions } from './Screens.tsx';
import { DeadlinesView, TaskList } from './TaskViews.tsx';

const ALL_STATUSES: ReadonlySet<StatusKey> = new Set<StatusKey>([...STATUSES, 'unknown']);
/** Below this width the cards are used; the table only appears where it fits without sideways scrolling. */
export const WIDE_SCREEN_QUERY = '(min-width: 960px)';

function sameSet<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  return a.size === b.size && [...a].every((value) => b.has(value));
}

export function TaskDashboard({
  controller,
  data,
  sheetHref,
  accountHint,
}: {
  controller: DashboardController;
  data: DashboardData;
  sheetHref: string;
  accountHint: string | null;
}) {
  const { state, refresh, connect, cancelConnect, signOut, revokeAccess } = controller;
  const now = useNow();
  const format = useFormat();
  const wide = useMediaQuery(WIDE_SCREEN_QUERY);
  const [statuses, setStatuses] = useState<ReadonlySet<StatusKey>>(DEFAULT_STATUS_FILTER);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<View>('list');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  const today = todayIn(new Date(now), format.timeZone);
  const counts = useMemo(() => countByStatus(data.tasks), [data.tasks]);
  const shown = useMemo(() => sortByDeadline(filterTasks(data.tasks, { statuses, query })), [data.tasks, statuses, query]);
  const hiddenMatches = useMemo(
    () => filterTasks(data.tasks, { statuses: ALL_STATUSES, query }).length - shown.length,
    [data.tasks, query, shown.length],
  );
  const overdue = data.tasks.filter((task) => deadlineState(task, today).kind === 'overdue').length;
  const filtered = query.trim() !== '' || !sameSet(statuses, DEFAULT_STATUS_FILTER);

  const toggleStatus = (key: StatusKey) =>
    setStatuses((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const toggleNotes = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const resetFilters = () => {
    setStatuses(DEFAULT_STATUS_FILTER);
    setQuery('');
  };

  const reconnect = () => connect();
  const chooseAccount = () => connect({ chooseAccount: true });
  const viewProps = { today, now, query, expanded, onToggleNotes: toggleNotes };
  const problem = state.fetchError ? fetchProblemText(state.fetchError, accountHint) : null;
  const authProblem = state.authProblem ? authProblemText(state.authProblem.problem) : null;

  return (
    <>
      <Header sheetHref={sheetHref} onSignOut={signOut} />
      <SyncBar state={state} now={now} onRefresh={refresh} onReconnect={reconnect} />
      <main className="page" id="main">
        {state.phase === 'authorizing' ? (
          <ProblemPanel
            tone="info"
            title="Finish signing in in the Google window"
            actions={
              <button type="button" className="btn btn-secondary" onClick={cancelConnect}>
                Cancel
              </button>
            }
          />
        ) : null}
        {authProblem ? (
          <ProblemPanel tone="error" title={authProblem.title} technical={state.authProblem?.detail || undefined}>
            <p>{authProblem.body}</p>
          </ProblemPanel>
        ) : null}
        {state.phase === 'expired' ? (
          <ProblemPanel
            tone="warn"
            title="Your Google sign-in expired"
            actions={
              <button type="button" className="btn btn-primary" onClick={reconnect}>
                Reconnect
              </button>
            }
          >
            <p>The tasks below are from the last successful fetch and may be out of date. Reconnect to refresh them.</p>
          </ProblemPanel>
        ) : null}
        {problem && state.fetchError && state.phase !== 'expired' ? (
          <ProblemPanel
            tone="error"
            title={problem.title}
            details={state.fetchError.details}
            technical={state.fetchError.detail || state.fetchError.kind}
            actions={
              <ProblemActions
                action={problem.action}
                onRetry={refresh}
                onChooseAccount={chooseAccount}
                onReconnect={reconnect}
              />
            }
          >
            <p>{problem.body}</p>
            <p>The tasks below are from the last successful fetch and may be out of date.</p>
          </ProblemPanel>
        ) : null}

        <h1 className="page-title">Your tasks</h1>

        <section className="controls" aria-label="Filters">
          <StatusFilter counts={counts} selected={statuses} onToggle={toggleStatus} />
          <div className="controls__row">
            <SearchBox value={query} onChange={setQuery} />
            <ViewSwitch view={view} onChange={setView} />
          </div>
        </section>

        {overdue > 0 ? (
          <p className="overdue-note">
            <strong>
              {overdue} overdue {overdue === 1 ? 'task' : 'tasks'}
            </strong>
            {view === 'list' ? (
              <>
                {' '}
                <button type="button" className="btn-link" onClick={() => setView('deadlines')}>
                  See deadlines
                </button>
              </>
            ) : null}
          </p>
        ) : null}

        <div className="results-bar">
          <p className="results-count" aria-live="polite">
            Showing {shown.length} of {data.tasks.length} {data.tasks.length === 1 ? 'task' : 'tasks'}
          </p>
          {filtered ? (
            <button type="button" className="btn-link" onClick={resetFilters}>
              Reset filters
            </button>
          ) : null}
        </div>

        {data.tasks.length === 0 ? (
          <div className="empty">
            <h2>No tasks yet</h2>
            <p>The Tasks tab has a header row but no tasks. Add rows in the sheet, then refresh.</p>
          </div>
        ) : shown.length === 0 ? (
          <div className="empty">
            <h2>No tasks match</h2>
            <p>
              {hiddenMatches > 0
                ? `${hiddenMatches} ${hiddenMatches === 1 ? 'task matches' : 'tasks match'} with a status that is hidden right now (for example Done).`
                : 'Try a different word, or show more statuses.'}
            </p>
            <button type="button" className="btn btn-secondary" onClick={resetFilters}>
              Reset filters
            </button>
          </div>
        ) : view === 'list' ? (
          <section aria-labelledby="list-heading">
            <h2 id="list-heading" className="visually-hidden">
              Tasks, earliest deadline first
            </h2>
            <TaskList tasks={shown} wide={wide} {...viewProps} />
          </section>
        ) : (
          <DeadlinesView tasks={shown} {...viewProps} />
        )}

        <DataIssues issues={data.issues} />
      </main>
      <Footer now={now} onRevoke={state.token ? revokeAccess : undefined} />
    </>
  );
}

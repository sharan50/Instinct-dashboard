import { useMemo, useState } from 'react';
import { useFormat } from '../format.ts';
import type { DashboardController, DashboardData } from '../hooks/useDashboard.ts';
import { useMediaQuery } from '../hooks/useMediaQuery.ts';
import { useNow } from '../hooks/useNow.ts';
import { todayIn } from '../lib/dates.ts';
import {
  countByOrigin,
  countByStatus,
  deadlineState,
  DEFAULT_STATUS_FILTER,
  filterTasks,
  sortByDeadline,
  viewOrigin,
  type SortOrder,
  type StatusKey,
  type View,
} from '../lib/filters.ts';
import { sortByPriority } from '../lib/priority.ts';
import { ORIGIN_LABELS, STATUSES } from '../lib/tasks.ts';
import { authProblemText, fetchProblemText } from '../messages.ts';
import { DataIssues, Footer, Header, ProblemPanel, SyncBar } from './Chrome.tsx';
import { OrderExplainer, OriginNote, SearchBox, SortControl, StatusFilter, ViewSwitch } from './Filters.tsx';
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
  const [order, setOrder] = useState<SortOrder>('priority');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [fullText, setFullText] = useState<ReadonlySet<string>>(() => new Set());

  const today = useMemo(() => todayIn(new Date(now), format.timeZone), [now, format.timeZone]);
  const origin = viewOrigin(view);
  const counts = useMemo(() => countByStatus(data.tasks), [data.tasks]);
  // Every task that passes the status chips and the search, whatever its origin.
  const matching = useMemo(() => filterTasks(data.tasks, { statuses, query }), [data.tasks, statuses, query]);
  // Of those, the ones an origin view would leave out are counted, so they are never dropped silently.
  const originCounts = useMemo(() => countByOrigin(matching), [matching]);
  const shown = useMemo(() => {
    const inView = origin ? matching.filter((task) => task.origin === origin) : matching;
    return order === 'priority' ? sortByPriority(inView, today) : sortByDeadline(inView);
  }, [matching, origin, order, today]);
  const hiddenMatches = useMemo(
    () => filterTasks(data.tasks, { statuses: ALL_STATUSES, query, origin }).length - shown.length,
    [data.tasks, query, origin, shown.length],
  );
  // Recorded dates that have passed. The sheet's "Date verified" column says which of them were checked;
  // nothing says whether a consequence applies now, so this is a count, never an alarm.
  const past = data.tasks.filter((task) => deadlineState(task, today).kind === 'overdue');
  const pastVerified = past.filter((task) => task.dateVerification === 'verified').length;
  const filtered = query.trim() !== '' || !sameSet(statuses, DEFAULT_STATUS_FILTER);
  const originUnused = origin !== null && data.tasks.every((task) => task.origin !== origin);
  const listTitle = order === 'priority' ? 'Tasks by financial priority' : 'Tasks, earliest recorded date first';

  const toggleStatus = (key: StatusKey) =>
    setStatuses((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const toggleIn = (current: ReadonlySet<string>, key: string): ReadonlySet<string> => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };
  const toggleNotes = (key: string) => setExpanded((current) => toggleIn(current, key));
  const toggleFullText = (key: string) => setFullText((current) => toggleIn(current, key));
  const resetFilters = () => {
    setStatuses(DEFAULT_STATUS_FILTER);
    setQuery('');
  };

  const reconnect = () => connect();
  const chooseAccount = () => connect({ chooseAccount: true });
  const viewProps = {
    columns: data.columns,
    today,
    now,
    query,
    expanded,
    onToggleNotes: toggleNotes,
    fullText,
    onToggleFullText: toggleFullText,
  };
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
          <OriginNote missing={originCounts.missing} hasColumn={data.columns.origin} inOriginView={origin !== null} />
          {view === 'deadlines' ? null : (
            <div className="controls__order">
              <SortControl order={order} onChange={setOrder} />
              <OrderExplainer columns={data.columns} />
            </div>
          )}
        </section>

        {past.length > 0 ? (
          <p className="date-note">
            <strong>
              {past.length} {past.length === 1 ? 'task has' : 'tasks have'} a recorded date in the past
            </strong>{' '}
            <span>({pastVerified > 0 ? `${pastVerified} verified` : 'none verified'})</span>
            {view === 'deadlines' ? null : (
              <>
                {' '}
                <button type="button" className="btn-link" onClick={() => setView('deadlines')}>
                  See by date
                </button>
              </>
            )}
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
        ) : origin && originUnused ? (
          <div className="empty">
            <h2>No tasks marked “{ORIGIN_LABELS[origin]}”</h2>
            <p>
              {data.columns.origin
                ? `No row in the Tasks tab has “${origin}” in its Origin column.`
                : 'The Tasks tab has no Origin column yet. Add one with “you requested” or “inbound” on each row.'}
            </p>
            <button type="button" className="btn btn-secondary" onClick={() => setView('list')}>
              Show all tasks
            </button>
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
        ) : view === 'deadlines' ? (
          <DeadlinesView tasks={shown} {...viewProps} showReason={false} />
        ) : (
          <section aria-labelledby="list-heading">
            <h2 id="list-heading" className="visually-hidden">
              {listTitle}
            </h2>
            <TaskList tasks={shown} wide={wide} caption={listTitle} {...viewProps} showReason={order === 'priority'} />
          </section>
        )}

        <DataIssues issues={data.issues} />
      </main>
      <Footer now={now} onRevoke={state.token ? revokeAccess : undefined} columns={data.columns} />
    </>
  );
}

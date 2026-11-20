import { useMemo, useState } from 'react';
import { useFormat } from '../format.ts';
import type { DashboardController, DashboardData } from '../hooks/useDashboard.ts';
import { useMediaQuery } from '../hooks/useMediaQuery.ts';
import { useNow } from '../hooks/useNow.ts';
import { todayIn } from '../lib/dates.ts';
import {
  countByArea,
  countByOrigin,
  countByStatus,
  deadlineState,
  DEFAULT_STATUS_FILTER,
  filterTasks,
  isListView,
  isNotStarted,
  sortByDeadline,
  viewOrigin,
  type SortOrder,
  type StatusKey,
  type View,
} from '../lib/filters.ts';
import { sortByPriority } from '../lib/priority.ts';
import { reviewList } from '../lib/review.ts';
import { ORIGIN_LABELS, STATUSES } from '../lib/tasks.ts';
import { todaySections } from '../lib/today.ts';
import { authProblemText, fetchProblemText } from '../messages.ts';
import { DataIssues, Footer, Header, ProblemPanel, SyncBar } from './Chrome.tsx';
import {
  AreaFilter,
  NotStartedToggle,
  OrderExplainer,
  OriginNote,
  SearchBox,
  SortControl,
  StatusFilter,
  ViewSwitch,
} from './Filters.tsx';
import { ProblemActions } from './Screens.tsx';
import { DeadlinesView, ReviewView, TaskList, TodayView } from './TaskViews.tsx';

const ALL_STATUSES: ReadonlySet<StatusKey> = new Set<StatusKey>([...STATUSES, 'unknown']);
/** Below this width the cards are used; the table only appears where it fits without sideways scrolling. */
export const WIDE_SCREEN_QUERY = '(min-width: 960px)';

function sameSet<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  return a.size === b.size && [...a].every((value) => b.has(value));
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
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
  const [view, setView] = useState<View>('today');
  const [order, setOrder] = useState<SortOrder>('priority');
  const [area, setArea] = useState<string | null>(null);
  const [showNotStarted, setShowNotStarted] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [fullText, setFullText] = useState<ReadonlySet<string>>(() => new Set());
  const [openCards, setOpenCards] = useState<ReadonlySet<string>>(() => new Set());

  const today = useMemo(() => todayIn(new Date(now), format.timeZone), [now, format.timeZone]);
  const origin = viewOrigin(view);
  const listView = isListView(view);

  const areas = useMemo(() => countByArea(data.tasks), [data.tasks]);
  // An area that is no longer in the sheet (renamed since the last refresh) stops filtering.
  const activeArea = area !== null && areas.some((entry) => entry.key === area) ? area : null;
  const notStarted = useMemo(
    () => data.tasks.filter((task) => isNotStarted(task, today)).length,
    [data.tasks, today],
  );
  // What every view starts from: the chosen area, without the tasks that have not started
  // yet unless they are asked for.
  const scope = useMemo(
    () =>
      filterTasks(data.tasks, {
        statuses: ALL_STATUSES,
        query: '',
        area: activeArea,
        startedBy: showNotStarted ? null : today,
      }),
    [data.tasks, activeArea, showNotStarted, today],
  );
  // The chips count the tasks of the view on screen: every task in scope, or one origin's.
  const counts = useMemo(
    () => countByStatus(origin ? scope.filter((task) => task.origin === origin) : scope),
    [scope, origin],
  );
  // Every task that passes the status chips and the search, whatever its origin.
  const matching = useMemo(() => filterTasks(scope, { statuses, query }), [scope, statuses, query]);
  // Of those, the ones an origin view would leave out are counted, so they are never dropped silently.
  const originCounts = useMemo(() => countByOrigin(matching), [matching]);
  const shown = useMemo(() => {
    const inView = origin ? matching.filter((task) => task.origin === origin) : matching;
    return order === 'priority' ? sortByPriority(inView, today) : sortByDeadline(inView);
  }, [matching, origin, order, today]);
  // Today and Review choose from the tasks that are not done; the status chips do not apply there.
  const active = useMemo(() => filterTasks(scope, { statuses: DEFAULT_STATUS_FILTER, query }), [scope, query]);
  const sections = useMemo(() => todaySections(active, today), [active, today]);
  const reviewItems = useMemo(
    () => reviewList(active, today, data.columns, format.timeZone),
    [active, today, data.columns, format.timeZone],
  );
  const onScreen = view === 'today' ? active.length - sections.elsewhere : view === 'review' ? reviewItems.length : shown.length;
  // Matches the view leaves out: behind an unticked status chip, or not started yet.
  const hiddenByStatus = useMemo(
    () => (listView ? filterTasks(scope, { statuses: ALL_STATUSES, query, origin }).length - shown.length : 0),
    [listView, scope, query, origin, shown.length],
  );
  const hiddenNotStarted = useMemo(
    () =>
      showNotStarted
        ? 0
        : filterTasks(data.tasks, {
            statuses: listView ? statuses : DEFAULT_STATUS_FILTER,
            query,
            origin,
            area: activeArea,
          }).filter((task) => isNotStarted(task, today)).length,
    [showNotStarted, data.tasks, listView, statuses, query, origin, activeArea, today],
  );
  // Recorded dates that have passed. The sheet's "Date verified" column says which of them were checked;
  // nothing says whether a consequence applies now, so this is a count, never an alarm.
  const past = scope.filter((task) => deadlineState(task, today).kind === 'overdue');
  const pastVerified = past.filter((task) => task.dateVerification === 'verified').length;
  const narrowed = query.trim() !== '' || activeArea !== null;
  const filtered = narrowed || showNotStarted || (listView && !sameSet(statuses, DEFAULT_STATUS_FILTER));
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
  const toggleCard = (key: string) => setOpenCards((current) => toggleIn(current, key));
  const resetFilters = () => {
    setStatuses(DEFAULT_STATUS_FILTER);
    setQuery('');
    setArea(null);
    setShowNotStarted(false);
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
    openCards,
    onToggleCard: toggleCard,
  };
  // Why nothing is on screen, when matching tasks exist but the view leaves them out.
  const noMatchReasons = [
    hiddenByStatus > 0
      ? `${plural(hiddenByStatus, 'task matches', 'tasks match')} with a status that is hidden right now (for example Done).`
      : '',
    hiddenNotStarted > 0
      ? `${plural(hiddenNotStarted, 'matching task has', 'matching tasks have')} not started yet: tick “Not started yet” to see ${hiddenNotStarted === 1 ? 'it' : 'them'}.`
      : '',
  ].filter(Boolean);
  const noMatch = (
    <div className="empty">
      <h2>No tasks match</h2>
      {noMatchReasons.length > 0 ? (
        noMatchReasons.map((reason) => <p key={reason}>{reason}</p>)
      ) : (
        <p>{listView ? 'Try a different word, or show more statuses.' : 'Try a different word or another area.'}</p>
      )}
      {filtered ? (
        <button type="button" className="btn btn-secondary" onClick={resetFilters}>
          Reset filters
        </button>
      ) : null}
    </div>
  );
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

        <ViewSwitch view={view} onChange={setView} />

        <section className="controls" aria-label="Filters">
          {listView ? <StatusFilter counts={counts} selected={statuses} onToggle={toggleStatus} /> : null}
          <div className="controls__row">
            <SearchBox value={query} onChange={setQuery} />
            {data.columns.area ? <AreaFilter areas={areas} value={activeArea} onChange={setArea} /> : null}
            <NotStartedToggle count={notStarted} checked={showNotStarted} onChange={setShowNotStarted} />
          </div>
          {listView ? (
            <OriginNote missing={originCounts.missing} hasColumn={data.columns.origin} inOriginView={origin !== null} />
          ) : null}
          {view === 'list' || origin ? (
            <div className="controls__order">
              <SortControl order={order} onChange={setOrder} />
              <OrderExplainer columns={data.columns} />
            </div>
          ) : null}
        </section>

        {past.length > 0 && view !== 'review' ? (
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
            Showing {onScreen} of {data.tasks.length} {data.tasks.length === 1 ? 'task' : 'tasks'}
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
        ) : !listView ? (
          active.length === 0 && narrowed ? (
            noMatch
          ) : view === 'today' ? (
            <TodayView sections={sections} filtered={narrowed} onSeeAll={() => setView('list')} {...viewProps} />
          ) : (
            <ReviewView items={reviewItems} {...viewProps} />
          )
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
          noMatch
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

import { useState, type ReactNode } from 'react';
import { useFormat } from '../format.ts';
import { STALE_AFTER_MS, type DashboardState } from '../hooks/useDashboard.ts';
import { describeTimeZone, formatRelative, formatTimeOrTimestamp } from '../lib/dates.ts';
import type { DataIssue } from '../lib/tasks.ts';

export function Header({ sheetHref, onSignOut }: { sheetHref: string | null; onSignOut?: () => void }) {
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <div className="site-header__titles">
          <p className="site-title">Task dashboard</p>
          <p className="site-subtitle">Read-only view of your tracker sheet</p>
        </div>
        <div className="site-actions">
          {sheetHref ? (
            <a
              className="btn btn-secondary"
              href={sheetHref}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open sheet (opens in a new tab)"
            >
              Open sheet
            </a>
          ) : null}
          {onSignOut ? (
            <button type="button" className="btn btn-secondary" onClick={onSignOut}>
              Sign out
            </button>
          ) : null}
        </div>
      </div>
    </header>
  );
}

type Tone = 'ok' | 'busy' | 'warn' | 'error';

/**
 * Always-visible freshness line. It never calls old data current: it shows
 * when the sheet was last fetched and turns amber or red when that is not
 * recent or the last refresh failed.
 */
export function SyncBar({
  state,
  now,
  onRefresh,
  onReconnect,
}: {
  state: DashboardState;
  now: number;
  onRefresh: () => void;
  onReconnect: () => void;
}) {
  const format = useFormat();
  const fetchedAt = state.data?.fetchedAt ?? null;
  const stale = fetchedAt !== null && now - fetchedAt > STALE_AFTER_MS;

  let tone: Tone = 'ok';
  let headline = 'Synced with your sheet';
  let button: ReactNode = (
    <button type="button" className="btn btn-primary" onClick={onRefresh}>
      Refresh
    </button>
  );
  if (state.phase === 'expired') {
    tone = 'warn';
    headline = 'Google sign-in expired: tasks may be out of date';
    button = (
      <button type="button" className="btn btn-primary" onClick={onReconnect}>
        Reconnect
      </button>
    );
  } else if (state.phase === 'authorizing') {
    tone = 'busy';
    headline = 'Waiting for Google sign-in…';
    button = null;
  } else if (state.fetching) {
    tone = 'busy';
    headline = 'Refreshing…';
    button = (
      <button type="button" className="btn btn-primary" disabled>
        Refreshing…
      </button>
    );
  } else if (state.fetchError) {
    tone = 'error';
    headline = 'Refresh failed: tasks may be out of date';
    button = (
      <button type="button" className="btn btn-primary" onClick={onRefresh}>
        Try again
      </button>
    );
  } else if (stale) {
    tone = 'warn';
    headline = 'Tasks may be out of date';
  }

  const fetched =
    fetchedAt === null
      ? 'Not fetched yet'
      : `Last fetched ${formatTimeOrTimestamp(new Date(fetchedAt), new Date(now), format)} (${formatRelative(new Date(fetchedAt), new Date(now), format)})`;

  return (
    <div className={`sync-bar sync-bar--${tone}`}>
      <div className="sync-bar__inner">
        <p className="sync-bar__text">
          <span className="sync-bar__dot" aria-hidden="true" />
          <span>
            {/* A live region: screen readers hear state changes, not the ticking "minutes ago". */}
            <strong className="sync-bar__headline" role="status">
              {headline}
            </strong>
            <span className="sync-bar__detail">{fetched}</span>
          </span>
        </p>
        {button}
      </div>
    </div>
  );
}

export function ProblemPanel({
  tone,
  title,
  children,
  details = [],
  technical,
  actions,
}: {
  tone: 'error' | 'warn' | 'info';
  title: string;
  children?: ReactNode;
  details?: string[];
  technical?: string;
  actions?: ReactNode;
}) {
  return (
    <section className={`panel panel--${tone}`} role={tone === 'info' ? 'status' : 'alert'}>
      <h2 className="panel__title">{title}</h2>
      {children}
      {details.length > 0 ? (
        <ul className="panel__details">
          {details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      ) : null}
      {actions ? <div className="panel__actions">{actions}</div> : null}
      {technical ? (
        <details className="technical">
          <summary>Technical details</summary>
          <p>
            <code>{technical}</code>
          </p>
        </details>
      ) : null}
    </section>
  );
}

export function DataIssues({ issues }: { issues: DataIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <details className="data-issues">
      <summary>
        {issues.length} {issues.length === 1 ? 'problem' : 'problems'} found in the sheet
      </summary>
      <p>These rows are still shown. Fix them in the Tasks tab; the dashboard picks up changes on the next refresh.</p>
      <ul>
        {issues.map((issue, index) => (
          <li key={index}>{issue.message}</li>
        ))}
      </ul>
    </details>
  );
}

export function Footer({ now, onRevoke }: { now: number; onRevoke?: () => void }) {
  const format = useFormat();
  const [confirming, setConfirming] = useState(false);
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <p>
          Times are shown in your timezone, {describeTimeZone(new Date(now), format)}. Deadlines are calendar dates
          and are the same everywhere.
        </p>
        <p>
          Read-only: this dashboard can’t change the sheet, and it updates only when it fetches the sheet again. Your
          tasks and Google sign-in are kept in this tab’s memory only and are cleared when you sign out or close the
          tab. On a shared device, sign out when you’re done.
        </p>
        {onRevoke ? (
          confirming ? (
            <div className="revoke-confirm" role="group" aria-label="Remove access">
              <p>
                Remove the dashboard’s access to your Google account? You’ll be signed out and asked to allow access
                again next time.
              </p>
              <button type="button" className="btn btn-danger" onClick={onRevoke}>
                Remove access
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setConfirming(false)}>
                Keep access
              </button>
            </div>
          ) : (
            <button type="button" className="btn-link" onClick={() => setConfirming(true)}>
              Remove this dashboard’s access to your Google account
            </button>
          )
        ) : null}
      </div>
    </footer>
  );
}

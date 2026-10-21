import { ENV, SETUP_GUIDE_URL, type ConfigProblem } from '../config.ts';
import type { DashboardState, FetchProblem } from '../hooks/useDashboard.ts';
import { authProblemText, fetchProblemText, noticeText, type ProblemAction } from '../messages.ts';
import { ProblemPanel } from './Chrome.tsx';

/** Shown when the site was built without its settings. Never shows any task data. */
export function SetupScreen({ problems }: { problems: ConfigProblem[] }) {
  const exposed = problems.filter((problem) => problem.severity === 'danger');
  return (
    <main className="screen" id="main">
      <h1>Finish setting up your dashboard</h1>
      <p>
        This dashboard shows your private Google Sheet only after you sign in with Google. Before sign-in can work, the
        site needs two settings. No task data is shown until then.
      </p>

      {exposed.length > 0 ? (
        <ProblemPanel tone="error" title="A secret may have been published">
          <ul>
            {exposed.map((problem) => (
              <li key={problem.name}>
                <code>{problem.name}</code>: {problem.message}
              </li>
            ))}
          </ul>
          <p>
            See “If a key or secret is exposed” in the <a href={SETUP_GUIDE_URL}>setup guide</a>.
          </p>
        </ProblemPanel>
      ) : null}

      <h2>Settings</h2>
      <ul className="setup-list">
        {[ENV.clientId, ENV.spreadsheetId].map((name) => {
          const problem = problems.find((p) => p.name === name);
          return (
            <li key={name} className={problem ? 'setup-item setup-item--todo' : 'setup-item setup-item--done'}>
              <span className="setup-item__mark" aria-hidden="true">
                {problem ? '✕' : '✓'}
              </span>
              <span>
                <code>{name}</code>: {problem ? problem.message : 'set.'}
              </span>
            </li>
          );
        })}
      </ul>

      <h2>What to do</h2>
      <ol className="steps">
        <li>
          In Google Cloud, create an OAuth client ID of type <strong>Web application</strong> (setup guide, “Google
          Cloud setup”).
        </li>
        <li>
          Put the values in a file called <code>.env</code> on your computer (copy <code>.env.example</code>), or on
          Netlify under <strong>Project configuration → Environment variables</strong>.
        </li>
        <li>
          The settings are built into the site, so restart <code>npm run dev</code>, or start a new deploy on Netlify
          (<strong>Deploys → Trigger deploy</strong>).
        </li>
      </ol>
      <p>
        <a className="btn btn-primary" href={SETUP_GUIDE_URL}>
          Open the step-by-step setup guide
        </a>
      </p>
    </main>
  );
}

export function ConnectScreen({
  state,
  accountHint,
  onConnect,
  onCancel,
}: {
  state: DashboardState;
  accountHint: string | null;
  onConnect: () => void;
  onCancel: () => void;
}) {
  const { phase, authProblem, notice, libraryError } = state;
  const expired = phase === 'expired' || (phase === 'authorizing' && state.resumePhase === 'expired');
  const problem = authProblem ? authProblemText(authProblem.problem) : null;

  return (
    <main className="screen" id="main">
      <h1>{expired ? 'Reconnect to your tracker' : 'Connect to your task tracker'}</h1>
      {notice ? (
        <ProblemPanel tone="info" title={notice === 'revoked' ? 'Access removed' : 'Signed out'}>
          <p>{noticeText(notice)}</p>
        </ProblemPanel>
      ) : null}
      {expired && !problem ? (
        <ProblemPanel tone="warn" title="Your Google sign-in expired">
          <p>Google sign-ins for this dashboard last a limited time. Connect again to load your tasks.</p>
        </ProblemPanel>
      ) : null}
      {problem ? (
        <ProblemPanel tone="error" title={problem.title} technical={authProblem?.detail || undefined}>
          <p>{problem.body}</p>
        </ProblemPanel>
      ) : null}

      <p>
        Sign in with Google to see your tasks. The dashboard asks only for <strong>read-only</strong> access to your
        Google Sheets, reads just the “Tasks” tab of your tracker, and can’t change anything.
      </p>
      <p>
        {accountHint ? (
          <>
            Use the account <strong>{accountHint}</strong>.
          </>
        ) : (
          'Use the Google account that owns the tracker sheet.'
        )}
      </p>

      {phase === 'library-error' ? (
        <ProblemPanel
          tone="error"
          title="Google sign-in couldn’t load"
          technical={libraryError ?? undefined}
          actions={
            <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
              Reload the page
            </button>
          }
        >
          <p>Check your internet connection. If you use a content blocker, allow accounts.google.com on this site.</p>
        </ProblemPanel>
      ) : phase === 'authorizing' ? (
        <div className="authorizing">
          <p role="status">Finish signing in in the Google window…</p>
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>
      ) : (
        <button type="button" className="btn btn-primary btn-large" onClick={onConnect} disabled={phase === 'loading'}>
          {phase === 'loading' ? 'Loading Google sign-in…' : expired ? 'Reconnect Google account' : 'Connect Google account'}
        </button>
      )}

      <details className="help">
        <summary>What to expect from Google’s screens</summary>
        <ul>
          <li>Google opens a small window to sign in. If nothing appears, allow pop-ups for this site.</li>
          <li>
            While your app is in Google’s “Testing” mode, Google may say it hasn’t verified the app. That is expected for
            a personal app you set up yourself: check that the app name is the one you created, then continue.
          </li>
          <li>
            Google may ask you to allow access again from time to time (for apps in Testing, Google currently says
            about once a week).
          </li>
          <li>Nothing is saved on this device: reloading or closing the tab means connecting again.</li>
        </ul>
      </details>
    </main>
  );
}

export function LoadingScreen() {
  return (
    <main className="screen" id="main" aria-busy="true">
      <h1>Loading your tasks…</h1>
      <p role="status">Reading the Tasks tab of your Google Sheet.</p>
    </main>
  );
}

export function ProblemActions({
  action,
  onRetry,
  onChooseAccount,
  onReconnect,
}: {
  action: ProblemAction;
  onRetry: () => void;
  onChooseAccount: () => void;
  onReconnect: () => void;
}) {
  switch (action) {
    case 'choose-account':
      return (
        <>
          <button type="button" className="btn btn-primary" onClick={onChooseAccount}>
            Use a different Google account
          </button>
          <button type="button" className="btn btn-secondary" onClick={onRetry}>
            Try again
          </button>
        </>
      );
    case 'reconnect':
      return (
        <button type="button" className="btn btn-primary" onClick={onReconnect}>
          Connect again
        </button>
      );
    case 'retry':
      return (
        <button type="button" className="btn btn-primary" onClick={onRetry}>
          Try again
        </button>
      );
  }
}

/** The first fetch failed, so there is nothing to show yet. */
export function ErrorScreen({
  problem,
  accountHint,
  onRetry,
  onChooseAccount,
  onReconnect,
}: {
  problem: FetchProblem;
  accountHint: string | null;
  onRetry: () => void;
  onChooseAccount: () => void;
  onReconnect: () => void;
}) {
  const text = fetchProblemText(problem, accountHint);
  return (
    <main className="screen" id="main">
      <h1>Couldn’t load your tasks</h1>
      <ProblemPanel
        tone="error"
        title={text.title}
        details={problem.details}
        technical={problem.detail || problem.kind}
        actions={
          <ProblemActions
            action={text.action}
            onRetry={onRetry}
            onChooseAccount={onChooseAccount}
            onReconnect={onReconnect}
          />
        }
      >
        <p>{text.body}</p>
      </ProblemPanel>
    </main>
  );
}

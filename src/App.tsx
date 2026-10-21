import { sheetUrl, type AppConfig, type ConfigResult } from './config.ts';
import { Footer, Header } from './components/Chrome.tsx';
import { ConnectScreen, ErrorScreen, LoadingScreen, SetupScreen } from './components/Screens.tsx';
import { TaskDashboard } from './components/TaskDashboard.tsx';
import { FormatContext } from './format.ts';
import { useDashboard } from './hooks/useDashboard.ts';
import { useNow } from './hooks/useNow.ts';
import type { FormatOptions } from './lib/dates.ts';
import { loadGoogleIdentity, type GoogleIdentity } from './lib/googleAuth.ts';

export interface AppProps {
  configResult: ConfigResult;
  /** Replaced in tests with a fake Google library. */
  loadGoogle?: () => Promise<GoogleIdentity>;
  fetchImpl?: typeof fetch;
  format?: FormatOptions;
}

export function App({ configResult, loadGoogle = loadGoogleIdentity, fetchImpl, format = {} }: AppProps) {
  return (
    <FormatContext value={format}>
      {configResult.ok ? (
        <Dashboard config={configResult.config} loadGoogle={loadGoogle} fetchImpl={fetchImpl} />
      ) : (
        <>
          <Header sheetHref={null} />
          <SetupScreen problems={configResult.problems} />
        </>
      )}
    </FormatContext>
  );
}

function Dashboard({
  config,
  loadGoogle,
  fetchImpl,
}: {
  config: AppConfig;
  loadGoogle: () => Promise<GoogleIdentity>;
  fetchImpl?: typeof fetch;
}) {
  const controller = useDashboard({ config, loadGoogle, fetchImpl });
  const now = useNow();
  const { state } = controller;
  const href = sheetUrl(config);

  if (state.data) {
    return <TaskDashboard controller={controller} data={state.data} sheetHref={href} accountHint={config.accountHint} />;
  }

  const signedIn = state.token !== null;
  let screen;
  if (state.phase === 'connected' && state.fetchError) {
    screen = (
      <ErrorScreen
        problem={state.fetchError}
        accountHint={config.accountHint}
        onRetry={controller.refresh}
        onChooseAccount={() => controller.connect({ chooseAccount: true })}
        onReconnect={() => controller.connect()}
      />
    );
  } else if (state.phase === 'connected') {
    screen = <LoadingScreen />;
  } else {
    screen = (
      <ConnectScreen
        state={state}
        accountHint={config.accountHint}
        onConnect={() => controller.connect()}
        onCancel={controller.cancelConnect}
      />
    );
  }

  return (
    <>
      <Header sheetHref={href} onSignOut={signedIn ? controller.signOut : undefined} />
      {screen}
      <Footer now={now} />
    </>
  );
}

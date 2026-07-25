import { onCleanup, onMount } from 'solid-js';
import { useCryptoAlgoDashboard } from '../hooks/useCryptoAlgoDashboard';
import { useCryptoAlgoExecutions } from '../hooks/useCryptoAlgoExecutions';
import { useCryptoAlgoPositions } from '../hooks/useCryptoAlgoPositions';
import { useCryptoAlgoSurveillance } from '../hooks/useCryptoAlgoSurveillance';
import { useAlgoWorkerQueueStatus } from '../hooks/useAlgoWorkerQueueStatus';
import { onGlobalRefresh } from '../socket';
import { CryptoAlgoCapitalDashboard } from './CryptoAlgoCapitalDashboard';
import { CryptoAlgoExecutionsPanel } from './CryptoAlgoExecutionsPanel';
import { CryptoAlgoFutureMarketsPanel } from './CryptoAlgoFutureMarketsPanel';
import { CryptoAlgoHeader } from './CryptoAlgoHeader';
import { CryptoAlgoInactiveMarketsPanel } from './CryptoAlgoInactiveMarketsPanel';
import { CryptoAlgoLiveMarketsPanel } from './CryptoAlgoLiveMarketsPanel';
import { CryptoAlgoPositionsPanel } from './CryptoAlgoPositionsPanel';
import { CryptoAlgoSurveillancePanel } from './CryptoAlgoSurveillancePanel';

const STATUS_POLL_MS = 10_000;

export interface CryptoAlgoPageProps {
  fullPage?: boolean;
  onToggleFullPage?: () => void;
  onOpenReports?: () => void;
}

export function CryptoAlgoPage(props: CryptoAlgoPageProps = {}) {
  const surveillance = useCryptoAlgoSurveillance();
  const queueStatus = useAlgoWorkerQueueStatus();
  const executions = useCryptoAlgoExecutions();
  const positions = useCryptoAlgoPositions();
  const dashboard = useCryptoAlgoDashboard({
    onMarketsChanged: () => {
      surveillance.refresh();
    },
    exitEmitBlockedPositions: () =>
      positions.positions().map((p) => ({
        id: p.id,
        status: p.status,
        lastExitBlockReason: p.lastExitBlockReason,
        lastExitBlockCloseReason: p.lastExitBlockCloseReason,
        firstExitBlockAt: p.firstExitBlockAt,
        exitEmitBlockedCount: p.exitEmitBlockedCount,
      })),
  });

  onMount(() => {
    const poll = setInterval(() => {
      void dashboard.refresh();
      surveillance.refresh();
      void queueStatus.refresh();
      void positions.refresh();
      executions.refresh();
    }, STATUS_POLL_MS);

    const unsub = onGlobalRefresh(() => {
      void positions.refresh();
      surveillance.refresh();
    });

    onCleanup(() => {
      clearInterval(poll);
      unsub();
    });
  });

  return (
    <div class="crypto-algo-page-v2">
      <CryptoAlgoHeader
        status={dashboard.status()}
        cryptoAlgoEnabled={dashboard.cryptoAlgoEnabled()}
        realTradingEnabled={dashboard.realTradingEnabled()}
        healthAlerts={dashboard.healthAlerts()}
        fullPage={props.fullPage}
        onToggleFullPage={props.onToggleFullPage}
        onAutoTrackChange={() => void dashboard.refetchMarketPrices()}
        onOpenReports={props.onOpenReports}
      />
      <CryptoAlgoCapitalDashboard
        capital={dashboard.capital()}
        realTradingEnabled={dashboard.realTradingEnabled()}
        creds={dashboard.creds}
        onToggleRealTrading={() => void dashboard.toggleRealTrading()}
      />
      <div class="algo-two-col">
        <CryptoAlgoLiveMarketsPanel
          markets={dashboard.liveMarkets()}
          now={dashboard.now}
        />
        <CryptoAlgoFutureMarketsPanel
          markets={dashboard.futureMarkets()}
          now={dashboard.now}
        />
      </div>
      <CryptoAlgoInactiveMarketsPanel markets={dashboard.inactiveMarkets()} />
      <CryptoAlgoSurveillancePanel
        surveillance={surveillance}
        queueStatus={queueStatus}
        now={dashboard.now}
      />
      <CryptoAlgoExecutionsPanel executions={executions} />
      <CryptoAlgoPositionsPanel positions={positions} />
    </div>
  );
}

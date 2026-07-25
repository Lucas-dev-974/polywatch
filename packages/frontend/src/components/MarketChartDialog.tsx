import { For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import {
  CRYPTO_CHART_RESOLUTIONS,
  buildMarketChartTitle,
  decimateUpDownPoints,
  formatChartPositionSelectorLabel,
  hasUsableEntryBidVwap,
  listChartPositions,
  parseMarketWindowMs,
  resolveActiveChartPosition,
  usesCryptoChartResolution,
  type CryptoChartResolution,
  type MarketChartContext,
  type OutcomeSideLabels,
  type UpDownPricePoint,
} from '../lib/market-chart';
import { UPDOWN_CHART_CONFIG } from '../lib/updown-price-chart';
import { useMarketChart } from '../hooks/useMarketChart';
import { useMarketOrderSize } from '../hooks/useMarketOrderSize';
import { useExitAttempts } from '../hooks/useExitAttempts';
import { useAlgoOpenExecutionsForCondition } from '../hooks/useAlgoOpenExecutionsForCondition';
import { useMaxSlippagePercent } from '../hooks/useMaxSlippagePercent';
import { Dialog } from './Dialog';
import { MarketChartMeta } from './MarketChartMeta';
import { MarketChartMosMeta } from './MarketChartMosMeta';
import { MarketChartDebugPanel } from './MarketChartDebugPanel';
import { UpDownPriceChart } from './UpDownPriceChart';
import { TimeframeSelector } from './TimeframeSelector';

const RESOLUTION_1MIN_MS = 60_000;

export interface MarketChartDialogProps extends MarketChartContext {
  onClose: () => void;
}

export function MarketChartDialog(props: MarketChartDialogProps) {
  const chartPositions = createMemo(() => listChartPositions(props));
  const [selectedPositionId, setSelectedPositionId] = createSignal<number | null>(
    props.copiedPositionId ?? chartPositions()[0]?.id ?? null,
  );

  const active = createMemo(() =>
    resolveActiveChartPosition(props, selectedPositionId()),
  );

  const isCryptoUpDown = () => props.cryptoSymbol != null;
  const useResolution = createMemo(() =>
    usesCryptoChartResolution(props.cryptoSymbol, props.interval),
  );
  const [selectedTimeframe, setSelectedTimeframe] = createSignal('max');
  const [selectedResolution, setSelectedResolution] =
    createSignal<CryptoChartResolution>('1s');

  /** Crypto courts : historique complet (résolution côté client). Sinon : période lookback. */
  const chartTimeframe = () => (useResolution() ? 'max' : selectedTimeframe());

  const chart = useMarketChart(
    props.conditionId,
    isCryptoUpDown(),
    active()?.assetId ?? props.assetId ?? undefined,
    chartTimeframe,
  );
  const orderSize = useMarketOrderSize(() => active()?.assetId);
  const exitAttempts = useExitAttempts(() => active()?.id);
  const algoOpenExecutions = useAlgoOpenExecutionsForCondition(() => props.conditionId ?? null);
  const maxSlippagePercent = useMaxSlippagePercent();
  const [hoverPoint, setHoverPoint] = createSignal<UpDownPricePoint | null>(null);
  const marketStartMs = () => parseMarketWindowMs(props.marketStartAt);
  const marketEndMs = () => parseMarketWindowMs(props.marketEndAt);

  const displayPoints = createMemo(() => {
    const points = chart.points();
    if (!useResolution() || selectedResolution() !== '1min') return points;
    return decimateUpDownPoints(points, RESOLUTION_1MIN_MS);
  });

  const canGoLive = createMemo(() => {
    const end = marketEndMs();
    return isCryptoUpDown() && end != null && Date.now() < end;
  });

  function toggleLive() {
    if (chart.liveEnabled()) {
      chart.setLiveEnabled(false);
      return;
    }
    if (!useResolution()) {
      setSelectedTimeframe('max');
    }
    chart.setLiveEnabled(true);
  }

  // Activer le live par défaut à l'ouverture du dialog pour les marchés crypto ouverts
  const [liveInitialized, setLiveInitialized] = createSignal(false);
  createEffect(() => {
    if (!liveInitialized() && canGoLive()) {
      chart.setLiveEnabled(true);
      setLiveInitialized(true);
    }
  });

  createEffect(() => {
    if (!chart.liveEnabled()) return;
    const end = marketEndMs();
    if (end == null) return;

    const checkMarketEnded = () => {
      if (Date.now() >= end) {
        chart.setLiveEnabled(false);
      }
    };

    checkMarketEnded();
    const timerId = setInterval(checkMarketEnded, 1000);
    onCleanup(() => clearInterval(timerId));
  });

  createEffect(() => {
    if (!canGoLive() && chart.liveEnabled()) {
      chart.setLiveEnabled(false);
    }
  });

  const outcomeLabels = createMemo((): OutcomeSideLabels | null => {
    return chart.outcomeLabels() ?? props.outcomeLabels ?? null;
  });

  const overlaysUnavailable = createMemo(() => {
    const pos = active();
    if (!pos || pos.id == null) return false;
    return !hasUsableEntryBidVwap(pos.entryBidVwap);
  });

  const positionLevels = () => {
    const pos = active();
    if (!pos || !hasUsableEntryBidVwap(pos.entryBidVwap)) return null;
    return {
      entryBidVwap: pos.entryBidVwap!,
      slBidPoints: pos.slBidPoints,
      tpBidPoints: pos.tpBidPoints,
      openedAtMs: pos.openedAt ? Date.parse(pos.openedAt) : null,
      closedAtMs: pos.closedAt ? Date.parse(pos.closedAt) : null,
      outcome: pos.outcome,
      exitBidVwap: pos.exitBidVwap,
    };
  };

  return (
    <Dialog
      open
      onClose={() => {
        chart.setLiveEnabled(false);
        props.onClose();
      }}
      title={buildMarketChartTitle(props.cryptoSymbol, props.interval)}
      titleId="market-chart-dialog-title"
      class="dialog-market-chart"
      bodyClass="dialog-body-market-chart"
      headerExtra={
        <div class="market-chart-header-extra">
          <Show when={chartPositions().length > 1}>
            <label class="market-chart-position-select">
              <select
                aria-label="Position"
                value={selectedPositionId() ?? ''}
                onChange={(e) => {
                  const raw = e.currentTarget.value;
                  const id = Number(raw);
                  setSelectedPositionId(Number.isFinite(id) ? id : null);
                }}
              >
                <For each={chartPositions()}>
                  {(pos) => (
                    <option value={pos.id}>
                      {formatChartPositionSelectorLabel(pos, outcomeLabels())}
                    </option>
                  )}
                </For>
              </select>
            </label>
          </Show>
          <Show when={active()?.id != null}>
            <span class="panel-count text-mono" title="ID position">
              #{active()!.id}
            </span>
          </Show>
        </div>
      }
    >
      <MarketChartMeta
        question={props.question}
        cryptoSymbol={props.cryptoSymbol}
        interval={props.interval}
        marketStartAt={props.marketStartAt}
        marketEndAt={props.marketEndAt}
      />

      <Show when={overlaysUnavailable()}>
        <div class="market-chart-state market-chart-state-warn" role="status">
          Overlays entrée / SL / TP indisponibles — entryBidVwap manquant pour
          la position #{active()?.id}.
        </div>
      </Show>

      <MarketChartMosMeta
        loading={orderSize.loading()}
        error={orderSize.error()}
        info={orderSize.info()}
        positionQuantity={active()?.positionQuantity ?? null}
      />

      <div class="market-chart-toolbar">
        <Show
          when={useResolution()}
          fallback={
            <TimeframeSelector
              value={selectedTimeframe()}
              onChange={setSelectedTimeframe}
            />
          }
        >
          <TimeframeSelector
            value={selectedResolution()}
            onChange={(v) => setSelectedResolution(v as CryptoChartResolution)}
            options={CRYPTO_CHART_RESOLUTIONS}
            label="Résolution :"
          />
        </Show>
        <Show when={isCryptoUpDown()}>
          <button
            type="button"
            class="btn btn-secondary btn-sm market-chart-live-btn"
            classList={{ 'is-live': chart.liveEnabled() }}
            aria-pressed={chart.liveEnabled()}
            disabled={!canGoLive()}
            title={
              canGoLive()
                ? chart.liveEnabled()
                  ? 'Arrêter la lecture live'
                  : 'Activer la lecture live'
                : 'Marché terminé — lecture live indisponible'
            }
            onClick={toggleLive}
          >
            Live
          </button>
        </Show>
      </div>

      <Show when={chart.loading()}>
        <div class="market-chart-state">Chargement du graphique…</div>
      </Show>

      <Show when={!chart.loading() && chart.error()}>
        <div class="market-chart-state market-chart-state-error">
          <p>{chart.error()}</p>
          <button
            type="button"
            class="btn btn-secondary btn-sm"
            onClick={() => void chart.reload()}
          >
            Réessayer
          </button>
        </div>
      </Show>

      <Show when={!chart.loading() && !chart.error()}>
        <UpDownPriceChart
          points={displayPoints()}
          marketStartMs={marketStartMs()}
          marketEndMs={marketEndMs()}
          height={UPDOWN_CHART_CONFIG.dialogHeight}
          onHoverPointChange={setHoverPoint}
          positionLevels={positionLevels()}
          exitAttempts={exitAttempts.items()}
          outcomeLabels={outcomeLabels()}
          conditionId={props.conditionId ?? null}
          executions={algoOpenExecutions.executions()}
          maxSlippagePercent={maxSlippagePercent()}
        />
        <Show when={displayPoints().length > 0}>
          <MarketChartDebugPanel
            points={displayPoints()}
            hoverPoint={hoverPoint}
            isCryptoUpDown={isCryptoUpDown()}
            entryPrice={active()?.entryPrice ?? null}
            outcomeLabels={outcomeLabels()}
            exitAttempts={
              active()?.id != null ? exitAttempts.items() : undefined
            }
            exitAttemptsError={
              active()?.id != null ? exitAttempts.error() : null
            }
          />
        </Show>
      </Show>
    </Dialog>
  );
}

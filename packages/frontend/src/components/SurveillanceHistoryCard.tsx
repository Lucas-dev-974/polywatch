import { For, Show, createMemo } from 'solid-js';
import {
  isSurveillanceAwaitingClose,
  isSurveillanceLive,
} from '@polywatch/core/algo/surveillance-constants';
import { formatShortDateTime } from '../lib/date';
import { displayAlgoSymbol, formatAlgoPriceCents } from '../lib/algo-market-display';
import type { AlgoSurveillanceSnapshot } from '../lib/algo-surveillance';
import {
  formatSurveillancePositionEntryOffset,
  normalizeSurveillancePositions,
  surveillanceOutcomeClass,
  surveillancePositionCloseReasonBadgeClass,
  surveillancePositionCloseReasonLabel,
  surveillancePositionDisplayQuantity,
  surveillancePositionFailureHint,
  surveillancePositionPnl,
  surveillancePositionStatusLabel,
} from '../lib/algo-surveillance-positions';
import { formatPnlAmount, pnlClass } from '../lib/position';
import { surveillanceToMarketChartContext } from '../lib/surveillance-market-chart';
import { openMarketChart } from '../stores/marketChartStore';
import { AlgoMarketChartTrigger } from './algo/AlgoMarketChartTrigger';

function formatWindow(start: string | null, end: string | null): string {
  if (!start && !end) return '—';
  const startLabel = start ? formatShortDateTime(start) : '—';
  const endLabel = end ? formatShortDateTime(end) : '—';
  return `${startLabel} → ${endLabel}`;
}

export interface SurveillanceHistoryCardProps {
  snapshot: AlgoSurveillanceSnapshot;
  now?: number;
}

export function SurveillanceHistoryCard(props: SurveillanceHistoryCardProps) {
  const snap = () => props.snapshot;
  const nowMs = () => props.now ?? Date.now();
  const positions = () => normalizeSurveillancePositions(snap().positions);
  const chartCtx = createMemo(() => surveillanceToMarketChartContext(snap()));
  const isUnresolved = () => Boolean(snap().unresolvedAt);
  const isLive = createMemo(
    () => !isUnresolved() && isSurveillanceLive(snap(), nowMs()),
  );
  const isPending = createMemo(
    () => !isUnresolved() && isSurveillanceAwaitingClose(snap(), nowMs()),
  );

  function openChartForPosition(positionId: number) {
    openMarketChart(surveillanceToMarketChartContext(snap(), positionId));
  }

  return (
    <article class="algo-surveillance-card">
      <div class="algo-surveillance-card-top">
        <div class="algo-surveillance-card-identity">
          <span class="algo-surveillance-card-symbol">{displayAlgoSymbol(snap().cryptoSymbol)}</span>
          <Show when={snap().interval}>
            <span class="algo-surveillance-card-interval">{snap().interval}</span>
          </Show>
        </div>
        <Show when={snap().winningOutcome}>
          <span class={`algo-surveillance-winner ${snap().winningOutcome?.toLowerCase()}`}>
            {snap().winningOutcome}
          </span>
        </Show>
        <Show when={isLive()}>
          <span class="algo-surveillance-badge live">Live</span>
        </Show>
        <Show when={isPending()}>
          <span class="algo-surveillance-badge pending">Résolution…</span>
        </Show>
        <Show when={isUnresolved()}>
          <span class="algo-surveillance-badge unresolved">Non résolu</span>
        </Show>
        <AlgoMarketChartTrigger
          buttonClass="btn btn-ghost btn-sm algo-surveillance-chart-btn"
          title="Cours marché (Up/Down)"
          conditionId={chartCtx().conditionId}
          copiedPositionId={chartCtx().copiedPositionId}
          chartPositions={chartCtx().chartPositions}
          cryptoSymbol={chartCtx().cryptoSymbol}
          interval={chartCtx().interval}
          question={chartCtx().question}
          marketStartAt={chartCtx().marketStartAt}
          marketEndAt={chartCtx().marketEndAt}
        />
      </div>

      <Show when={snap().question}>
        <p class="algo-surveillance-question" title={snap().question ?? undefined}>
          {snap().question}
        </p>
      </Show>

      <div class="algo-surveillance-window">
        <span class="algo-surveillance-window-label">Fenêtre</span>
        <span class="algo-surveillance-window-value">
          {formatWindow(snap().marketStartAt, snap().marketEndAt)}
        </span>
      </div>

      <div class="algo-surveillance-prices">
        <div class="algo-surveillance-price-block open">
          <div class="algo-surveillance-price-header">
            <span class="algo-surveillance-price-title">Ouverture (+5s)</span>
            <Show when={snap().openCapturedAt}>
              <span class="algo-surveillance-price-time">
                {formatShortDateTime(snap().openCapturedAt!)}
              </span>
            </Show>
          </div>
          <div class="algo-surveillance-price-row">
            <span class="algo-surveillance-outcome up">Up</span>
            <span class="algo-surveillance-price-value">{formatAlgoPriceCents(snap().openUpPrice)}</span>
          </div>
          <div class="algo-surveillance-price-row">
            <span class="algo-surveillance-outcome down">Down</span>
            <span class="algo-surveillance-price-value">{formatAlgoPriceCents(snap().openDownPrice)}</span>
          </div>
        </div>

        <div class="algo-surveillance-price-block close">
          <div class="algo-surveillance-price-header">
            <span class="algo-surveillance-price-title">Fermeture (+2s)</span>
            <Show when={snap().closeCapturedAt}>
              <span class="algo-surveillance-price-time">
                {formatShortDateTime(snap().closeCapturedAt!)}
              </span>
            </Show>
          </div>
          <div class="algo-surveillance-price-row">
            <span class="algo-surveillance-outcome up">Up</span>
            <span class="algo-surveillance-price-value">{formatAlgoPriceCents(snap().closeUpPrice)}</span>
          </div>
          <div class="algo-surveillance-price-row">
            <span class="algo-surveillance-outcome down">Down</span>
            <span class="algo-surveillance-price-value">{formatAlgoPriceCents(snap().closeDownPrice)}</span>
          </div>
        </div>
      </div>

      <div class="algo-surveillance-positions">
        <div class="algo-surveillance-positions-header">
          <span class="algo-surveillance-positions-title">Positions algo</span>
          <span class="algo-surveillance-positions-count">{positions().length}</span>
        </div>
        <Show
          when={positions().length > 0}
          fallback={<p class="algo-surveillance-positions-empty">Aucune position sur ce marché.</p>}
        >
          <ul class="algo-surveillance-positions-list">
            <For each={positions()}>
              {(pos) => {
                const displayQty = () => surveillancePositionDisplayQuantity(pos);
                const pnl = () => surveillancePositionPnl(pos);
                const entryOffset = () =>
                  formatSurveillancePositionEntryOffset(pos.openedAt, snap().marketStartAt);
                const failureHint = () => surveillancePositionFailureHint(pos);
                const closeReasonLabel = () => surveillancePositionCloseReasonLabel(pos);
                const closeReasonClass = () => surveillancePositionCloseReasonBadgeClass(pos);
                return (
                  <li class="algo-surveillance-position-item">
                    <button
                      type="button"
                      class="algo-surveillance-position-btn"
                      title={`Cours marché — position #${pos.id}`}
                      onClick={() => openChartForPosition(pos.id)}
                    >
                      <div class="algo-surveillance-position-main">
                        <span class="algo-surveillance-position-id text-mono">#{pos.id}</span>
                        <span
                          class={`algo-surveillance-outcome ${surveillanceOutcomeClass(pos.outcome)}`}
                        >
                          {pos.outcome}
                        </span>
                        <span class={`algo-mode-badge ${pos.mode}`}>
                          {pos.mode === 'real' ? 'Réel' : 'Sim'}
                        </span>
                        <span class="algo-surveillance-position-status">
                          {surveillancePositionStatusLabel(pos.status)}
                        </span>
                        <Show when={closeReasonLabel()}>
                          <span
                            class={`algo-surveillance-position-close-reason badge badge-xs ${closeReasonClass()}`}
                            title={`Clôturée par ${closeReasonLabel()}`}
                          >
                            {closeReasonLabel()}
                          </span>
                        </Show>
                        <Show when={entryOffset()}>
                          <span
                            class="algo-surveillance-position-offset text-mono"
                            title={
                              pos.openedAt
                                ? `Entrée : ${formatShortDateTime(pos.openedAt)}`
                                : undefined
                            }
                          >
                            {entryOffset()}
                          </span>
                        </Show>
                      </div>
                      <div class="algo-surveillance-position-meta">
                        <span class="text-mono">
                          {displayQty() != null ? displayQty()!.toFixed(2) : '—'} @{' '}
                          {pos.entryPrice.toFixed(4)}
                        </span>
                        <span class={`text-mono ${pnlClass(pnl())}`}>
                          {formatPnlAmount(pnl(), true)}
                        </span>
                      </div>
                      <Show when={failureHint()}>
                        <p class="algo-surveillance-position-hint" title={failureHint()!}>
                          {failureHint()}
                        </p>
                      </Show>
                    </button>
                  </li>
                );
              }}
            </For>
          </ul>
        </Show>
      </div>

    </article>
  );
}

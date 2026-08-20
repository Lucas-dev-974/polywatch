import { Show } from 'solid-js';
import type { BacktestPositionDto } from '../../../api';
import { EXIT_REASON_LABEL } from '@polywatch/core/backtest/exit-reasons';
import { fmtUsd, formatTs, fmtHolding } from '../format';

interface RidgePlayTooltipProps {
  position: BacktestPositionDto | null;
  x: number;
  y: number;
}

/** Tooltip affichant les détails d'une position au survol d'un marker du player. */
export function RidgePlayTooltip(props: RidgePlayTooltipProps) {
  return (
    <Show when={props.position}>
      {(pos) => {
        const p = pos();
        const pnl = p.pnl;
        const pnlClass = pnl != null && pnl >= 0 ? 'ridge-play-tooltip-pnl-pos' : 'ridge-play-tooltip-pnl-neg';
        const pnlSign = pnl != null ? (pnl >= 0 ? '+' : '') : '';
        const exitReason = p.exitReason ? (EXIT_REASON_LABEL[p.exitReason] ?? p.exitReason) : '—';
        const holdingMs =
          p.entryAt && p.exitAt ? Date.parse(p.exitAt) - Date.parse(p.entryAt) : null;
        const sideClass = p.side === 'YES' ? 'ridge-play-tooltip-side-yes' : 'ridge-play-tooltip-side-no';
        return (
          <div
            class="ridge-play-tooltip"
            style={{ left: `${props.x}px`, top: `${props.y}px` }}
          >
            <div class="ridge-play-tooltip-head">
              <span class={`ridge-play-tooltip-side ${sideClass}`}>{p.side}</span>
              <span class="ridge-play-tooltip-city">{p.city ?? '—'}</span>
            </div>
            <div class="ridge-play-tooltip-cond">{p.conditionId.slice(0, 20)}…</div>

            <div class="ridge-play-tooltip-pnl-row">
              <span class="ridge-play-tooltip-pnl-label">P&L</span>
              <span class={`ridge-play-tooltip-pnl ${pnlClass}`}>
                {pnl != null ? `${pnlSign}${fmtUsd(pnl)}` : '—'}
              </span>
            </div>

            <dl class="ridge-play-tooltip-grid">
              <dt>Qté</dt>
              <dd>{p.qty}</dd>
              <dt>Entrée</dt>
              <dd>{fmtUsd(p.entryPrice)}</dd>
              <dt>Sortie</dt>
              <dd>{p.exitPrice != null ? fmtUsd(p.exitPrice) : 'Ouverte'}</dd>
              <dt>Durée</dt>
              <dd>{holdingMs != null ? fmtHolding(holdingMs) : '—'}</dd>
              <dt>Frais</dt>
              <dd>{fmtUsd(p.fees)}</dd>
            </dl>

            <div class="ridge-play-tooltip-times">
              <div>
                <span class="ridge-play-tooltip-time-label">Entrée</span>
                <span class="ridge-play-tooltip-time">{formatTs(p.entryAt)}</span>
              </div>
              <div>
                <span class="ridge-play-tooltip-time-label">Sortie</span>
                <span class="ridge-play-tooltip-time">
                  {p.exitAt ? formatTs(p.exitAt) : '—'}
                </span>
              </div>
            </div>

            <div class="ridge-play-tooltip-exit">
              <span class="ridge-play-tooltip-exit-label">Motif exit</span>
              <span class="ridge-play-tooltip-exit-value">{exitReason}</span>
            </div>
          </div>
        );
      }}
    </Show>
  );
}

import { For, Show } from 'solid-js';
import type {
  BacktestEquityPointDto,
  BacktestMarketSeriesDto,
  BacktestPositionDto,
  BacktestRunDto,
} from '../../api';
import { BacktestEquityChart } from '../BacktestEquityChart';
import { BacktestMarketRidgeChart } from './BacktestMarketRidgeChart';
import { BacktestMetrics } from './BacktestMetrics';
import { BacktestPositionsTable } from './BacktestPositionsTable';
import { formatTs } from './format';

interface BacktestRunDetailProps {
  run: BacktestRunDto;
  equity: BacktestEquityPointDto[];
  positions: BacktestPositionDto[];
  marketSeries: BacktestMarketSeriesDto[];
  error: string | null;
  capital: number;
  onBack: () => void;
  onCancel: () => void;
  onDelete: () => void;
}

export function BacktestRunDetail(props: BacktestRunDetailProps) {
  const isRunning = () => props.run.status === 'running' || props.run.status === 'queued';
  // Période paramétrée de la run (params.from/to), source de vérité de l'étendue
  // des marchés affichés — pas la plage effective des données consommées.
  const runFrom = () => {
    const f = props.run.params?.from;
    return typeof f === 'string' ? f : null;
  };
  const runTo = () => {
    const t = props.run.params?.to;
    return typeof t === 'string' ? t : null;
  };

  return (
    <div class="backtest-detail">
      <div class="backtest-toolbar">
        <div class="backtest-toolbar-left">
          <button type="button" class="btn btn-sm btn-ghost" onClick={props.onBack}>
            ← Retour
          </button>
          <h3 class="settings-subheading">Backtest #{props.run.id}</h3>
        </div>
        <div class="backtest-toolbar-actions">
          <Show when={isRunning()}>
            <button type="button" class="btn btn-sm btn-secondary" onClick={props.onCancel}>
              Annuler
            </button>
          </Show>
          <button type="button" class="btn btn-sm btn-danger" onClick={props.onDelete}>
            Supprimer
          </button>
        </div>
      </div>

      <Show when={props.error}>
        <p class="form-hint weather-settings-error">{props.error}</p>
      </Show>

      <div class="backtest-detail-meta">
        <span>
          Statut : <strong>{props.run.status}</strong>
        </span>
        <span>
          Mode : <strong>{props.run.mode === 'replay' ? 'Rejouer' : 'Re-évaluer'}</strong>
        </span>
        <span>Lancé : {formatTs(props.run.startedAt)}</span>
        <span>Fini : {formatTs(props.run.finishedAt)}</span>
        <span>Plage : {formatTs(props.run.dataRangeFrom)} → {formatTs(props.run.dataRangeTo)}</span>
      </div>

      <Show when={isRunning()}>
        <div class="backtest-progress backtest-progress--wide">
          <div class="backtest-progress-track">
            <div class="backtest-progress-fill" style={{ width: `${props.run.progressPct}%` }} />
          </div>
          <span>{props.run.progressPct}%</span>
        </div>
      </Show>

      <Show when={props.run.status === 'failed' && props.run.error}>
        <p class="form-hint weather-settings-error">
          Erreur : <code>{props.run.error}</code>
        </p>
      </Show>

      <Show when={props.run.stats != null}>
        <BacktestMetrics stats={props.run.stats!} />
      </Show>

      <Show when={props.equity.length > 0}>
        <div class="backtest-section">
          <h4 class="settings-subheading">Courbe d’equity</h4>
          <BacktestEquityChart points={props.equity} capital={props.capital} />
        </div>
      </Show>

      <Show when={props.marketSeries.length > 0 && runFrom() && runTo()}>
        <div class="backtest-section">
          <h4 class="settings-subheading">Marchés parcourus ({props.marketSeries.length})</h4>
          <BacktestMarketRidgeChart
            series={props.marketSeries}
            positions={props.positions}
            from={runFrom()!}
            to={runTo()!}
          />
        </div>
      </Show>

      <Show when={props.run.fidelityWarnings && props.run.fidelityWarnings.length > 0}>
        <div class="backtest-fidelity">
          <h4 class="settings-subheading">Limites de fidélité</h4>
          <ul>
            <For each={props.run.fidelityWarnings!}>
              {(w) => <li>{w}</li>}
            </For>
          </ul>
        </div>
      </Show>

      <BacktestPositionsTable positions={props.positions} />
    </div>
  );
}

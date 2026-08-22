import { Show } from 'solid-js';
import type {
  BacktestEquityPointDto,
  BacktestExcludedTickDto,
  BacktestMarketSeriesDto,
  BacktestPositionDto,
  BacktestRunDto,
} from '../../api';
import { BacktestEquityChart } from '../BacktestEquityChart';
import { CollapsibleSection } from '../CollapsibleSection';
import { BacktestFidelityWarnings } from './BacktestFidelityWarnings';
import { BacktestMarketRidgeChart } from './BacktestMarketRidgeChart';
import { BacktestMetrics } from './BacktestMetrics';
import { BacktestPositionsTable } from './BacktestPositionsTable';
import { formatTs } from './format';

interface BacktestRunDetailProps {
  run: BacktestRunDto;
  equity: BacktestEquityPointDto[];
  excludedTicks: BacktestExcludedTickDto[];
  positions: BacktestPositionDto[];
  marketSeries: BacktestMarketSeriesDto[];
  marketTotal: number;
  marketLoading: boolean;
  error: string | null;
  capital: number;
  onBack: () => void;
  onCancel: () => void;
  onDelete: () => void;
}

export function BacktestRunDetail(props: BacktestRunDetailProps) {
  const isRunning = () => props.run.status === 'running' || props.run.status === 'queued';
  // Les marchés sont "en cours" tant que le run n'est pas terminé (il produit
  // encore des données) ou qu'un fetch est en vol. Évite d'afficher à tort
  // « Aucun marché » pendant l'exécution.
  const marketsBusy = () => isRunning() || props.marketLoading;
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
        <div class={`backtest-progress backtest-progress--wide${props.run.progressPct === 0 ? ' backtest-progress--preparing' : ''}`}>
          <div class="backtest-progress-track">
            <div class="backtest-progress-fill" style={{ width: `${props.run.progressPct}%` }} />
          </div>
          <span>
            {props.run.progressPct === 0
              ? 'Préparation des données…'
              : `${props.run.progressPct}%`}
          </span>
        </div>
      </Show>

      <Show when={props.run.status === 'failed' && props.run.error}>
        <p class="form-hint weather-settings-error">
          Erreur : <code>{props.run.error}</code>
        </p>
      </Show>

      <Show when={props.run.stats != null || props.equity.length > 0}>
        <CollapsibleSection
          title="Metrics"
          defaultCollapsed={false}
          persistKey="backtest-detail-metrics"
        >
          <Show when={props.run.stats != null}>
            <BacktestMetrics stats={props.run.stats!} />
          </Show>
          <Show when={props.equity.length > 0}>
            <BacktestEquityChart
              points={props.equity}
              excludedTicks={props.excludedTicks}
              capital={props.capital}
            />
          </Show>
        </CollapsibleSection>
      </Show>

      <Show when={runFrom() && runTo()}>
        <CollapsibleSection
          title={`Marchés parcourus (${marketsBusy() && props.marketSeries.length === 0 ? '…' : props.marketTotal})`}
          defaultCollapsed={false}
          persistKey="backtest-detail-markets"
          headerActions={
            <Show when={marketsBusy() && props.marketSeries.length === 0}>
              <span class="backtest-detail-header-loader" aria-label="Chargement des marchés">
                <span class="backtest-detail-header-loader-spinner" aria-hidden="true" />
              </span>
            </Show>
          }
        >
          <Show
            when={props.marketSeries.length > 0}
            fallback={
              <p class="form-hint">
                {marketsBusy()
                  ? 'Chargement des marchés…'
                  : 'Aucun marché parcouru sur cette plage.'}
              </p>
            }
          >
            <BacktestMarketRidgeChart
              series={props.marketSeries}
              positions={props.positions}
              excludedTicks={props.excludedTicks}
              from={runFrom()!}
              to={runTo()!}
            />
          </Show>
        </CollapsibleSection>
      </Show>

      <Show when={props.run.fidelityWarnings && props.run.fidelityWarnings.length > 0}>
        <CollapsibleSection
          title={`Limites de fidélité (${props.run.fidelityWarnings!.length})`}
          defaultCollapsed={true}
          persistKey="backtest-detail-fidelity"
        >
          <BacktestFidelityWarnings warnings={props.run.fidelityWarnings!} />
        </CollapsibleSection>
      </Show>

      <CollapsibleSection
        title={`Positions (${props.positions.length})`}
        defaultCollapsed={false}
        persistKey="backtest-detail-positions"
      >
        <BacktestPositionsTable positions={props.positions} />
      </CollapsibleSection>
    </div>
  );
}

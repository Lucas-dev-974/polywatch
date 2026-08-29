import { For } from 'solid-js';

interface FidelityWarning {
  icon: string;
  title: string;
  hint: string;
}

const KNOWN_WARNINGS: Record<string, FidelityWarning> = {
  no_events_in_range: {
    icon: '⚠️',
    title: 'Aucune donnée sur la plage',
    hint: 'Le backtest n’a trouvé aucun événement (ticks/forecasts) sur la période demandée.',
  },
  risk_sl_confirmation_ignored: {
    icon: '🎯',
    title: 'SL sans confirmation',
    hint: 'Le stop-loss se déclenche au 1er tick, sans attendre une confirmation de ticks.',
  },
  risk_sizing_simplified_fixed_usdc: {
    icon: '📏',
    title: 'Sizing simplifié',
    hint: 'La taille des positions est fixe (entryPusd ou fixedShareCount selon le mode) au lieu du sizing par score de signal.',
  },
  risk_sizing_mode_ignored: {
    icon: '📐',
    title: 'Mode de sizing non honoré',
    hint: 'Le sizingMode configuré pour la stratégie n’est pas pris en charge par le backtest ; la taille est calculée en pUSD fixe (fidélité réduite).',
  },
  risk_min_time_to_close_ignored: {
    icon: '⏱️',
    title: 'minTimeToClose ignoré',
    hint: 'Ce paramètre n’est pas appliqué en backtest ; les positions sont tenues jusqu’à la résolution ou une sortie SL/TP.',
  },
  fill_no_book_depth: {
    icon: '📖',
    title: 'Sans profondeur de carnet',
    hint: 'Les fills ne sont pas plafonnés par la liquidité du carnet d’ordres.',
  },
  market_lifecycle_filtered: {
    icon: '🔎',
    title: 'Ticks exclus (cycle marché)',
    hint: 'Des ticks ont été ignorés (marché fermé, tokens indisponibles, minHours…).',
  },
  unsupported_metric_or_bucket: {
    icon: '🧭',
    title: 'Métrique / bucket non supporté',
    hint: 'Un marché a été ignoré car sa métrique d’instantané n’est pas prise en charge.',
  },
  ghost_positions_forced_resolution: {
    icon: '👻',
    title: 'Positions forcées à la résolution',
    hint: 'Positions encore ouvertes en fin de run résolues sur la dernière cote connue.',
  },
  kill_switch_block_entries: {
    icon: '🛑',
    title: 'Kill-switch : entrées bloquées',
    hint: 'Le kill-switch est actif, les nouvelles entrées sont bloquées.',
  },
  kill_switch_force_close: {
    icon: '🚨',
    title: 'Kill-switch : clôture totale',
    hint: 'Le kill-switch a forcé la clôture de toutes les positions ouvertes.',
  },
  kill_switch_partial_close: {
    icon: '🔁',
    title: 'Kill-switch : clôture partielle',
    hint: 'Certaines clôtures ont échoué, nouvelle tentative au prochain tick.',
  },
  resolution_no_price_whatsoever: {
    icon: '🚫',
    title: 'Résolution sans prix',
    hint: 'Résolution impossible : aucun prix disponible (tick, mark ou entrée).',
  },
  resolution_price_fallback: {
    icon: '↩️',
    title: 'Résolution en repli de prix',
    hint: 'tick.yesPrice absent → résolution via markPrice ou entryPrice.',
  },
  resolution_by_price: {
    icon: '💲',
    title: 'Résolution par le prix',
    hint: 'Résolution par seuil de prix YES (≥0.99 → YES, ≤0.01 → NO), sans température observée.',
  },
  multi_position_stale_mark: {
    icon: '🧊',
    title: 'Marks sur tick périmé',
    hint: "Des positions ouvertes sont évaluées avec un tick plus vieux que la période de poll (markPrice en retard).",
  },
  markprice_stale_carry_forward: {
    icon: '🔁',
    title: 'markPrice reconduit',
    hint: 'markPrice confirmé à la dernière valeur connue (tick.yesPrice absent).',
  },
  fill_price_clamped: {
    icon: '🎯',
    title: 'Prix de fill clampé',
    hint: 'Le slippage a poussé le prix hors de [0,1] ; il a été clampé à la borne (1.0 à l\'entrée, 0 à la sortie).',
  },
  entry_skipped_market_resolved: {
    icon: '⛔',
    title: 'Entrée ignorée : marché résolu',
    hint: 'Le tick courant est déjà collé aux bornes (≤0.01 ou ≥0.99) ; pas de nouvelle position.',
  },
  entry_skipped_stale_price: {
    icon: '📉',
    title: 'Entrée ignorée : prix périmé',
    hint: 'Le prix de décision s’écarte trop du tick courant au flush (> 0.10) ; fill hors courbe évité.',
  },
  entry_skipped_immediate_sl: {
    icon: '🛑',
    title: 'Entrée ignorée : SL immédiat',
    hint: 'Le tick courant déclencherait le stop-loss dès l’ouverture.',
  },
};

function parseWarning(raw: string): { code: string; message: string } {
  const sep = raw.indexOf(': ');
  if (sep === -1) return { code: '', message: raw };
  return { code: raw.slice(0, sep), message: raw.slice(sep + 2) };
}

function metaFor(code: string): FidelityWarning {
  return (
    KNOWN_WARNINGS[code] ?? {
      icon: 'ℹ️',
      title: code || 'Avertissement',
      hint: 'Avertissement de fidélité du moteur de backtest.',
    }
  );
}

export function BacktestFidelityWarnings(props: { warnings: string[] }) {
  return (
    <ul class="backtest-fidelity-list">
      <For each={props.warnings}>
        {(raw) => {
          const { code, message } = parseWarning(raw);
          const meta = metaFor(code);
          return (
            <li class="backtest-fidelity-item">
              <span class="backtest-fidelity-icon" aria-hidden="true">
                {meta.icon}
              </span>
              <div class="backtest-fidelity-body">
                <span class="backtest-fidelity-title">{meta.title}</span>
                <span class="backtest-fidelity-message">{message}</span>
                <span class="backtest-fidelity-hint">{meta.hint}</span>
              </div>
            </li>
          );
        }}
      </For>
    </ul>
  );
}

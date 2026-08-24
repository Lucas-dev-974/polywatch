import { Show } from 'solid-js';
import { formatCloseReasonBreakdown, type MarketAnalyticsRow } from '../lib/market-analytics';

interface Props {
  markets: MarketAnalyticsRow[];
  selectedConditionId: string | null;
}

export function SimMarketYesNoBreakdown(props: Props) {
  const selectedMarket = () =>
    props.selectedConditionId != null
      ? props.markets.find((m) => m.conditionId === props.selectedConditionId)
      : null;

  const aggregate = () => {
    let yes = 0;
    let no = 0;
    let other = 0;
    const closeReasons = { sl: 0, tp: 0, trailing: 0, preClose: 0, manual: 0, copyClose: 0, redemption: 0, other: 0 };
    for (const m of props.markets) {
      yes += m.outcomeBreakdown.yes;
      no += m.outcomeBreakdown.no;
      other += m.outcomeBreakdown.other;
      for (const key of Object.keys(closeReasons) as (keyof typeof closeReasons)[]) {
        closeReasons[key] += m.closeReasonBreakdown[key];
      }
    }
    return { yes, no, other, closeReasons };
  };

  const data = () => {
    if (selectedMarket()) {
      const m = selectedMarket()!;
      return {
        yes: m.outcomeBreakdown.yes,
        no: m.outcomeBreakdown.no,
        other: m.outcomeBreakdown.other,
        closeReasons: m.closeReasonBreakdown,
        label: m.question ?? m.conditionId,
      };
    }
    const agg = aggregate();
    return {
      ...agg,
      label: 'Tous les marchés',
    };
  };

  const total = () => data().yes + data().no + data().other;

  return (
    <section class="sim-analytics-yesno-section">
      <h3 class="sim-analytics-section-title">
        Répartition Yes/No
        <Show when={props.selectedConditionId != null}>
          {' — '}{data().label}
        </Show>
      </h3>
      <Show when={total() > 0} fallback={<p class="form-hint">Aucune position.</p>}>
        <div class="sim-analytics-yesno-bars">
          <Show when={data().yes > 0}>
            <div class="sim-analytics-yesno-bar is-yes" style={{ width: `${(data().yes / total()) * 100}%` }}>
              Yes: {data().yes}
            </div>
          </Show>
          <Show when={data().no > 0}>
            <div class="sim-analytics-yesno-bar is-no" style={{ width: `${(data().no / total()) * 100}%` }}>
              No: {data().no}
            </div>
          </Show>
          <Show when={data().other > 0}>
            <div class="sim-analytics-yesno-bar is-other" style={{ width: `${(data().other / total()) * 100}%` }}>
              Autre: {data().other}
            </div>
          </Show>
        </div>
        <div class="sim-analytics-yesno-meta">
          <span>Total positions: {total()}</span>
          <span>Yes: {((data().yes / total()) * 100).toFixed(0)}%</span>
          <span>No: {((data().no / total()) * 100).toFixed(0)}%</span>
        </div>
        <div class="sim-analytics-yesno-close-reasons">
          <span class="form-hint">Raisons de sortie : </span>
          {formatCloseReasonBreakdown(data().closeReasons)}
        </div>
      </Show>
    </section>
  );
}

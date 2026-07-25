import {
  COLLATERAL_TOKEN,
  formatPnlAmount,
  pnlClass,
  type PnlSummary,
} from '../../lib/position';

interface Props {
  summary: PnlSummary;
  mode: string;
}

interface MetricProps {
  label: string;
  value: number;
  currency: string;
  valueClass: string;
  signed?: boolean;
}

function PnlMetric(props: MetricProps) {
  return (
    <span class="position-pnl-summary-item">
      <span class="position-pnl-summary-label">{props.label}</span>
      <span class={`text-mono ${props.valueClass}`}>
        {formatPnlAmount(props.value, props.signed)} {props.currency}
      </span>
    </span>
  );
}

export function PositionPnlSummary(props: Props) {
  const currency = () => COLLATERAL_TOKEN;
  const summary = () => props.summary;

  return (
    <div class="position-pnl-summary">
      <PnlMetric
        label="Pertes"
        value={summary().totalLosses}
        currency={currency()}
        valueClass="pnl-negative"
      />
      <span class="position-pnl-summary-sep">·</span>
      <PnlMetric
        label="Gains"
        value={summary().totalGains}
        currency={currency()}
        valueClass="pnl-positive"
      />
      <span class="position-pnl-summary-sep">·</span>
      <PnlMetric
        label="Somme"
        value={summary().net}
        currency={currency()}
        valueClass={pnlClass(summary().net)}
        signed
      />
    </div>
  );
}

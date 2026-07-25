import { formatPnlAmount } from '../lib/position';

type Props = {
  label: string;
  equity: number | null | undefined;
  cash: number | null | undefined;
  positions: number | null | undefined;
  sessionPnl?: number | null | undefined;
  openPnlSum?: number | null | undefined;
  closedPnlSum?: number | null | undefined;
  token?: string;
};

function formatAmount(value: number | null | undefined): string {
  return value != null ? value.toFixed(2) : '—';
}

function PnlMeta(props: { label: string; value: number | null | undefined }) {
  if (props.value == null) return null;
  return <>{' '}· {props.label} {formatPnlAmount(props.value, true)}</>;
}

export function ModeHeroBalanceStat(props: Props) {
  const token = () => props.token ?? 'pUSD';

  return (
    <div class="mode-hero-stat">
      <span class="mode-hero-label">{props.label}</span>
      <span class="mode-hero-value mono">
        {formatAmount(props.equity)}
        <span class="mode-hero-token">{token()}</span>
      </span>
      <span class="mode-hero-meta mono">
        Cash {formatAmount(props.cash)} · Positions {formatAmount(props.positions)}
        <PnlMeta label="PnL session" value={props.sessionPnl} />
        <PnlMeta label="Pos. ouv." value={props.openPnlSum} />
        <PnlMeta label="Historique" value={props.closedPnlSum} />
      </span>
    </div>
  );
}

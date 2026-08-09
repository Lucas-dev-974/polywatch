import { For, Show } from 'solid-js';
import type { BacktestEquityPointDto } from '../api';

const W = 720;
const H = 220;
const PAD_L = 56;
const PAD_R = 16;
const PAD_T = 16;
const PAD_B = 28;

function buildPath(
  points: BacktestEquityPointDto[],
): { path: string; points: { x: number; y: number }[] } {
  if (points.length === 0) return { path: '', points: [] };
  const minEquity = Math.min(...points.map((p) => p.equity));
  const maxEquity = Math.max(...points.map((p) => p.equity));
  const spanEquity = maxEquity - minEquity || 1;
  const times = points.map((p) => Date.parse(p.t));
  const minT = Math.min(...times);
  const maxT = Math.max(...times);
  const spanT = maxT - minT || 1;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const mapped = points.map((p) => {
    const t = Date.parse(p.t);
    const x = PAD_L + ((t - minT) / spanT) * innerW;
    const y = PAD_T + innerH - ((p.equity - minEquity) / spanEquity) * innerH;
    return { x, y };
  });
  const path = mapped.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  return { path, points: mapped };
}

function fmt(value: number): string {
  if (Number.isNaN(value) || !Number.isFinite(value)) return '—';
  return value.toFixed(0);
}

export function BacktestEquityChart(props: { points: BacktestEquityPointDto[]; capital: number }) {
  const points = () => props.points;
  const { path, points: mapped } = buildPath(points());
  const min = () =>
    points().length > 0 ? Math.min(...points().map((p) => p.equity)) : props.capital;
  const max = () =>
    points().length > 0 ? Math.max(...points().map((p) => p.equity)) : props.capital;
  const span = () => max() - min() || 1;
  const innerH = H - PAD_T - PAD_B;
  const last = () => (points().length > 0 ? points()[points().length - 1]! : null);

  return (
    <div class="backtest-equity-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Courbe d’equity du backtest"
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: 'auto' }}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const y = PAD_T + innerH * f;
          const val = max() - span() * f;
          return (
            <g key={f}>
              <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="var(--border)" stroke-dasharray="3 3" />
              <text x={PAD_L - 8} y={y + 4} text-anchor="end" class="backtest-chart-axis">
                {fmt(val)}
              </text>
            </g>
          );
        })}
        {points().length > 0 && (
          <line
            x1={PAD_L}
            y1={PAD_T + innerH - ((props.capital - min()) / span()) * innerH}
            x2={W - PAD_R}
            y2={PAD_T + innerH - ((props.capital - min()) / span()) * innerH}
            stroke="var(--muted)"
            stroke-dasharray="6 4"
          />
        )}
        {path && <path d={path} fill="none" stroke="var(--accent, #4f8cff)" stroke-width="2" />}
        {mapped.map((p) => (
          <circle cx={p.x} cy={p.y} r="2" fill="var(--accent, #4f8cff)" />
        ))}
      </svg>
      <Show when={last()}>
        <div class="backtest-chart-summary">
          <span>
            Equity finale <strong>{fmt(last()!.equity)}</strong>
          </span>
          <span>
            Cash <strong>{fmt(last()!.cash)}</strong>
          </span>
          <span>
            Positions ouvertes <strong>{last()!.openPositions}</strong>
          </span>
        </div>
      </Show>
    </div>
  );
}

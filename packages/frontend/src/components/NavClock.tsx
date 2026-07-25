import { useClock } from '../hooks/useClock';
import { useEasternTime } from '../hooks/useEasternTime';

function formatHhMm(timestampMs: number): string {
  const d = new Date(timestampMs);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

export function NavClock() {
  const now = useClock(1_000);
  const etTime = useEasternTime(1_000);

  return (
    <span class="nav-clock-group">
      <time class="nav-clock" datetime={new Date(now()).toISOString()} aria-live="off">
        {formatHhMm(now())}
      </time>
      <span class="nav-clock-sep">/</span>
      <time class="nav-clock nav-clock--et" datetime={new Date(now()).toISOString()} aria-live="off" title="Eastern Time (Polymarket)">
        {etTime()}
        <span class="nav-clock-tz">ET</span>
      </time>
    </span>
  );
}

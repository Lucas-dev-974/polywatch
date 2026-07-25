import { createMemo, Show } from 'solid-js';
import { getTimeRemaining, type TimeRemaining } from '../lib/markets-list';
import { useCountdownNow } from './CountdownContext';

interface Props {
  endDate: string | null;
}

export function CountdownTimer(props: Props) {
  const now = useCountdownNow();

  const remaining = createMemo<TimeRemaining | null>(() =>
    getTimeRemaining(props.endDate, now()),
  );

  const formatted = createMemo(() => {
    const value = remaining();
    if (!value || value.expired) return null;
    return {
      minutes: String(value.minutes).padStart(2, '0'),
      seconds: String(value.seconds).padStart(2, '0'),
    };
  });

  return (
    <Show when={formatted()}>
      {(data) => (
        <div class="market-card-timer" aria-label="Temps restant">
          <div class="market-card-timer-block">
            <span class="market-card-timer-value">{data().minutes}</span>
            <span class="market-card-timer-label">MIN</span>
          </div>
          <div class="market-card-timer-block">
            <span class="market-card-timer-value">{data().seconds}</span>
            <span class="market-card-timer-label">SECS</span>
          </div>
        </div>
      )}
    </Show>
  );
}

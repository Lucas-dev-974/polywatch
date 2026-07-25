import { createEffect, createSignal, Show } from 'solid-js';

interface Props {
  conditionId: string;
  label: string;
  size?: number;
}

export function marketIconProxyUrl(conditionId: string): string {
  return `/market-icons/${conditionId}`;
}

export function MarketIcon(props: Props) {
  const [failed, setFailed] = createSignal(false);
  const size = () => props.size ?? 28;

  createEffect(() => {
    props.conditionId;
    setFailed(false);
  });

  return (
    <Show
      when={!failed()}
      fallback={
        <span
          class="market-icon market-icon-fallback"
          style={{ width: `${size()}px`, height: `${size()}px` }}
          aria-hidden="true"
        >
          ◈
        </span>
      }
    >
      <img
        class="market-icon"
        src={marketIconProxyUrl(props.conditionId)}
        alt=""
        width={size()}
        height={size()}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    </Show>
  );
}

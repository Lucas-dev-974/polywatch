import { Show } from 'solid-js';

interface Props {
  hint: string | null | undefined;
}

export function RedemptionWaitHint(props: Props) {
  return (
    <Show when={props.hint}>
      <p class="position-redemption-hint">{props.hint}</p>
    </Show>
  );
}

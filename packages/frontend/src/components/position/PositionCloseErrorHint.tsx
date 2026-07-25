import { Show } from 'solid-js';

import {
  closeExecutionErrorHint,
  closeExecutionErrorLabel,
} from '../../lib/execution';
import { POSITION_TOOLTIPS } from '../../lib/position-tooltips';

interface Props {
  error: string | null | undefined;
}

export function PositionCloseErrorHint(props: Props) {
  const hint = () => closeExecutionErrorHint(props.error);
  const detail = () => closeExecutionErrorLabel(props.error);

  return (
    <Show when={hint()}>
      <p
        class="position-close-error"
        title={
          detail()
            ? `${POSITION_TOOLTIPS.closeError} — ${detail()}`
            : POSITION_TOOLTIPS.closeError
        }
      >
        {hint()}
      </p>
    </Show>
  );
}

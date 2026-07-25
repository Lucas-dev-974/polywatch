import { Show } from 'solid-js';

import { canManualClosePosition, type Position } from '../../lib/position';

interface Props {
  pos: Position;
  now: () => number;
  onClose: (id: number) => void;
}

export function PositionCloseButton(props: Props) {
  const pos = () => props.pos;
  const failed = () => pos().status === 'failed';
  const closing = () => pos().status === 'closing';
  const canClose = () => canManualClosePosition(pos(), props.now());

  return (
    <Show when={canClose()}>
      <button
        class={`btn btn-sm btn-icon ${failed() ? 'btn-danger' : 'btn-secondary'}`}
        title={
          closing()
            ? 'Clôture en cours…'
            : failed()
              ? 'Réessayer la clôture'
              : 'Fermer'
        }
        disabled={closing()}
        onClick={() => props.onClose(pos().id)}
      >
        {closing() ? '…' : failed() ? '↻' : '×'}
      </button>
    </Show>
  );
}

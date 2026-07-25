import { Icon } from '../Icon';
import type { PositionListLayout } from '../../lib/ui-persistence';

interface Props {
  layout: PositionListLayout;
  onToggle: () => void;
}

export function PositionListLayoutToggle(props: Props) {
  const isSplit = () => props.layout === 'split';

  return (
    <button
      type="button"
      class={`panel-collapse-btn${isSplit() ? ' is-active' : ''}`}
      title={
        isSplit()
          ? 'Vue par marché — cliquer pour liste plate'
          : 'Liste plate — cliquer pour vue par marché'
      }
      aria-pressed={isSplit()}
      onClick={props.onToggle}
    >
      <Icon name={isSplit() ? 'columns' : 'list'} />
    </button>
  );
}

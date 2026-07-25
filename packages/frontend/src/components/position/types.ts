import type { PositionListLayout, UiMode } from '../../lib/ui-persistence';
import type { Position } from '../../lib/position';

export interface PositionListBaseProps {
  mode: UiMode;
  layout: PositionListLayout;
  positions: Position[];
}

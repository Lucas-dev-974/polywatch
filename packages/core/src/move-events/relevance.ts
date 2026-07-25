import type { MoveEventType } from '../types/index.js';

/** Shown even when we have no open copied position on that market. */
export const ALWAYS_SHOWN_MOVE_EVENT_TYPES = ['OPENED'] as const satisfies readonly MoveEventType[];

/** Only persisted / surfaced when an open copied position exists for that market. */
export const COPIED_POSITION_REQUIRED_MOVE_EVENT_TYPES = [
  'INCREASED',
  'DECREASED',
  'CLOSED',
] as const satisfies readonly MoveEventType[];

const copiedPositionRequiredTypes = new Set<MoveEventType>(
  COPIED_POSITION_REQUIRED_MOVE_EVENT_TYPES,
);

export function requiresOpenCopiedPosition(type: MoveEventType): boolean {
  return copiedPositionRequiredTypes.has(type);
}

/** SQL fragment for MoveEventEntity query builders aliased as `m`. */
export const OPEN_COPIED_POSITION_EXISTS_SQL = `EXISTS (
  SELECT 1 FROM copied_positions p
  INNER JOIN watchlist w ON w.id = p.watchlist_id
  WHERE w.trader_address = m.trader_address
    AND p.condition_id = m.condition_id
    AND p.asset_id = m.asset_id
    AND p.status IN ('open', 'pending', 'closing')
)`;

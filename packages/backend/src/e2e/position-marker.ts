export type E2ePositionMarkerType = 'open' | 'update' | 'close';

export interface E2ePositionOpenMarker {
  e2e_position: 'open';
  runId: string | null;
  conditionId: string;
  marketQuestion?: string;
  cryptoSymbol?: string;
  interval?: string;
  outcome: string;
  side: string;
  entryPrice: number;
  quantity: number;
  openedAt: string;
}

export interface E2ePositionUpdateMarker {
  e2e_position: 'update';
  runId: string | null;
  conditionId: string;
  currentPrice: number;
  pnlPercent: number;
}

export interface E2ePositionCloseMarker {
  e2e_position: 'close';
  runId: string | null;
  conditionId: string;
  closeReason: string;
  realizedPnl: number;
  closedAt: string;
}

export type E2ePositionMarker =
  | E2ePositionOpenMarker
  | E2ePositionUpdateMarker
  | E2ePositionCloseMarker;

/**
 * Tente de parser une ligne stdout comme marker de position E2E.
 * Les markers sont des objets JSON sur une ligne contenant la clé "e2e_position".
 * Retourne null si la ligne n'est pas un marker valide.
 */
export function tryParseE2ePositionMarker(line: string): E2ePositionMarker | null {
  if (!line.includes('"e2e_position"')) return null;
  try {
    const obj = JSON.parse(line) as E2ePositionMarker;
    if (
      obj.e2e_position === 'open' ||
      obj.e2e_position === 'update' ||
      obj.e2e_position === 'close'
    ) {
      return obj;
    }
  } catch {
    // not a position marker
  }
  return null;
}
export const CRYPTO_ALGO_RUNTIME_STATUS_KEY = 'crypto-algo:runtime-status';

export interface CryptoAlgoRuntimeStatusPayload {
  enabledSelections: number;
  evaluableSelections: number;
  wsConnected: boolean;
  lastEvaluatedAt: string | null;
  lastSkipReason: string | null;
  lastSkipAt: string | null;
  /** Number of entries (accepted signals) in the last tick cycle. */
  entriesLastCycle: number;
  /** Number of markets evaluated in the last tick cycle. */
  evaluatedLastCycle: number;
}

export function parseCryptoAlgoRuntimeStatus(
  raw: string | null,
): CryptoAlgoRuntimeStatusPayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CryptoAlgoRuntimeStatusPayload>;
    return {
      enabledSelections: Number(parsed.enabledSelections) || 0,
      evaluableSelections: Number(parsed.evaluableSelections) || 0,
      wsConnected: parsed.wsConnected === true,
      lastEvaluatedAt: parsed.lastEvaluatedAt ?? null,
      lastSkipReason: parsed.lastSkipReason ?? null,
      lastSkipAt: parsed.lastSkipAt ?? null,
      entriesLastCycle: Number(parsed.entriesLastCycle) || 0,
      evaluatedLastCycle: Number(parsed.evaluatedLastCycle) || 0,
    };
  } catch {
    return null;
  }
}

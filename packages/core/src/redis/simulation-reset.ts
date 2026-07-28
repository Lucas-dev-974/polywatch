import type { Redis } from 'ioredis';
import type { SimAlgoKind } from '../simulation/algo-kind.js';

export const SIMULATION_RESET_CHANNEL = 'simulation-reset';

export interface SimulationResetPayload {
  at: number;
  algoKind: SimAlgoKind;
  sessionStartedAt?: string;
}

export async function publishSimulationReset(
  redis: Pick<Redis, 'publish'>,
  payload: Omit<SimulationResetPayload, 'at'>,
): Promise<void> {
  const message: SimulationResetPayload = {
    at: Date.now(),
    ...payload,
  };
  await redis.publish(SIMULATION_RESET_CHANNEL, JSON.stringify(message));
}

export function parseSimulationResetPayload(
  raw: string,
): SimulationResetPayload | null {
  try {
    const parsed = JSON.parse(raw) as SimulationResetPayload;
    if (typeof parsed.at !== 'number') return null;
    if (
      parsed.algoKind !== 'crypto' &&
      parsed.algoKind !== 'weather' &&
      parsed.algoKind !== 'copy'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

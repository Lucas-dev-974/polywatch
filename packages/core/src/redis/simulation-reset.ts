import type { Redis } from 'ioredis';

export const SIMULATION_RESET_CHANNEL = 'simulation-reset';

export interface SimulationResetPayload {
  at: number;
  sessionStartedAt?: string;
}

export async function publishSimulationReset(
  redis: Pick<Redis, 'publish'>,
  payload: Omit<SimulationResetPayload, 'at'> = {},
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
    return parsed;
  } catch {
    return null;
  }
}

import type { DataSource } from 'typeorm';
import {
  SimulationService,
  type SimulationSnapshot,
} from '@polywatch/core';
import { emitSimulationBalance } from '../websocket.js';

export function emitSimSnapshot(snapshot: SimulationSnapshot, algoKind?: string): void {
  emitSimulationBalance({ ...snapshot, algoKind: algoKind ?? 'crypto' });
}

export async function broadcastSimSnapshot(
  ds: DataSource,
): Promise<void> {
  const simulationService = new SimulationService(ds);
  for (const algoKind of ['crypto', 'weather', 'copy'] as const) {
    const snapshot = await simulationService.getSnapshot(algoKind);
    emitSimulationBalance({ ...snapshot, algoKind });
  }
}

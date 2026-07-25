import type { DataSource } from 'typeorm';
import {
  SimulationService,
  type SimulationSnapshot,
} from '@polywatch/core';
import { emitSimulationBalance } from '../websocket.js';

export function emitSimSnapshot(snapshot: SimulationSnapshot): void {
  emitSimulationBalance(snapshot);
}

export async function broadcastSimSnapshot(
  ds: DataSource,
): Promise<SimulationSnapshot> {
  const snapshot = await new SimulationService(ds).getSnapshot();
  emitSimSnapshot(snapshot);
  return snapshot;
}

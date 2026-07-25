import { api } from '../api';

export type WorkerQueueStatusLevel = 'ok' | 'warning' | 'critical';

export interface AlgoWorkerQueueStatus {
  workerAlive: boolean;
  workerLastSeenAt: string | null;
  algoOrderSignalsDepth: number;
  algoOrderSignalsProcessing: number;
  orderSignalsDepth: number;
  executionResultsDepth: number;
  level: WorkerQueueStatusLevel;
  hint: string | null;
}

export async function fetchAlgoWorkerQueueStatus(): Promise<AlgoWorkerQueueStatus> {
  return api<AlgoWorkerQueueStatus>('/algo/worker-queue-status');
}

export function workerQueueBadgeLabel(status: AlgoWorkerQueueStatus): string {
  const depth = status.algoOrderSignalsDepth;
  if (!status.workerAlive) {
    return depth > 0 ? `Worker arrêté · file ${depth}` : 'Worker arrêté';
  }
  return depth === 0 ? 'File algo vide' : `File algo : ${depth}`;
}

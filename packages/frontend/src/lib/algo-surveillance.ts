export type {
  AlgoSurveillancePositionSummary,
  AlgoSurveillanceSnapshotDto as AlgoSurveillanceSnapshot,
} from '@polywatch/core/algo/surveillance-constants';

import type { AlgoSurveillanceSnapshotDto as AlgoSurveillanceSnapshot } from '@polywatch/core/algo/surveillance-constants';

export interface SurveillanceHistoryResponse {
  items: AlgoSurveillanceSnapshot[];
  total: number;
}

import type {
  SimArchiveCandleDto,
  SimArchiveExecutionDto,
  SimArchiveExitAttemptDto,
  SimArchivePositionDto,
  SimArchiveSummary,
  SimArchiveSurveillanceDto,
  SimArchiveType,
} from '@polywatch/core';
import { api } from '../api';

export type {
  SimArchiveSummary,
  SimArchiveType,
  SimArchivePositionDto,
  SimArchiveExecutionDto,
  SimArchiveExitAttemptDto,
  SimArchiveSurveillanceDto,
  SimArchiveCandleDto,
};

export interface SimArchiveListResponse<T> {
  summary: SimArchiveSummary | null;
  items: T[];
  total: number;
}

export async function fetchSessionArchive<T>(
  sessionId: number,
  type: SimArchiveType,
  options?: { limit?: number; offset?: number },
): Promise<SimArchiveListResponse<T>> {
  const params = new URLSearchParams({ type });
  if (options?.limit != null) params.set('limit', String(options.limit));
  if (options?.offset != null) params.set('offset', String(options.offset));
  return api<SimArchiveListResponse<T>>(
    `/simulation-sessions/${sessionId}/archive?${params.toString()}`,
  );
}

import type {
  RealArchiveExecutionDto,
  RealArchiveExitAttemptDto,
  RealArchivePositionDto,
  RealArchiveSummary,
  RealArchiveType,
} from '@polywatch/core';
import { api } from '../api';

export type {
  RealArchiveSummary,
  RealArchiveType,
  RealArchivePositionDto,
  RealArchiveExecutionDto,
  RealArchiveExitAttemptDto,
};

export interface RealArchiveListResponse<T> {
  summary: RealArchiveSummary | null;
  items: T[];
  total: number;
}

export async function fetchRealSessionArchive<T>(
  sessionId: number,
  type: RealArchiveType,
  options?: { limit?: number; offset?: number },
): Promise<RealArchiveListResponse<T>> {
  const params = new URLSearchParams({ type });
  if (options?.limit != null) params.set('limit', String(options.limit));
  if (options?.offset != null) params.set('offset', String(options.offset));
  return api<RealArchiveListResponse<T>>(
    `/real-sessions/${sessionId}/archive?${params.toString()}`,
  );
}

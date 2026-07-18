export const ANALYSIS_SCHEMA_VERSION = 1 as const;

export type AnalysisValue = {
  moodScore?: number;
  entryType?: 'reflection' | 'mixed' | 'vent' | 'log' | 'unknown';
  tags?: string[];
};

export type AnalysisProvenance = {
  modelVersion: string;
  promptVersion: string;
};

export type AnalysisResult<T extends AnalysisValue = AnalysisValue> =
  | {
      schemaVersion: typeof ANALYSIS_SCHEMA_VERSION;
      status: 'available';
      value: T;
      provenance: AnalysisProvenance;
    }
  | {
      schemaVersion: typeof ANALYSIS_SCHEMA_VERSION;
      status: 'unavailable';
      reason: string;
    }
  | {
      schemaVersion: typeof ANALYSIS_SCHEMA_VERSION;
      status: 'processing';
      jobId: string;
    }
  | {
      schemaVersion: typeof ANALYSIS_SCHEMA_VERSION;
      status: 'failed';
      errorCode: string;
      retryable: boolean;
    };

export const analysisUnavailable = (reason: string): AnalysisResult => ({
  schemaVersion: ANALYSIS_SCHEMA_VERSION,
  status: 'unavailable',
  reason,
});

export const analysisFailed = (errorCode: string, retryable: boolean): AnalysisResult => ({
  schemaVersion: ANALYSIS_SCHEMA_VERSION,
  status: 'failed',
  errorCode,
  retryable,
});

export function parseAnalysisResult(value: unknown): AnalysisResult {
  if (!value || typeof value !== 'object') throw new Error('analysis_result_invalid');
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== ANALYSIS_SCHEMA_VERSION) {
    throw new Error('unsupported_analysis_schema');
  }
  if (candidate.status === 'available') {
    if (!candidate.provenance || typeof candidate.provenance !== 'object') {
      throw new Error('analysis_provenance_required');
    }
    const result = candidate as unknown as AnalysisResult;
    const mood = result.status === 'available' ? result.value.moodScore : undefined;
    if (mood !== undefined && (!Number.isFinite(mood) || mood < 0 || mood > 1)) {
      throw new Error('analysis_mood_invalid');
    }
    return result;
  }
  if (!['unavailable', 'processing', 'failed'].includes(String(candidate.status))) {
    throw new Error('analysis_status_invalid');
  }
  return candidate as unknown as AnalysisResult;
}

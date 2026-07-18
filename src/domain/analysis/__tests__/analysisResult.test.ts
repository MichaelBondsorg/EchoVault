import { analysisFailed, analysisUnavailable, parseAnalysisResult } from '../analysisResult';

describe('analysis result contract', () => {
  it('represents missing and failed analysis explicitly without a numeric mood fallback', () => {
    expect(analysisUnavailable('no_content')).toEqual({
      schemaVersion: 1,
      status: 'unavailable',
      reason: 'no_content',
    });
    expect(analysisFailed('model_timeout', true)).not.toHaveProperty('moodScore');
  });

  it('keeps a legitimate 0.5 distinguishable with model provenance', () => {
    expect(
      parseAnalysisResult({
        schemaVersion: 1,
        status: 'available',
        value: { moodScore: 0.5, entryType: 'mixed', tags: [] },
        provenance: { modelVersion: 'gemini-2', promptVersion: 'mood-v2' },
      })
    ).toMatchObject({ status: 'available', value: { moodScore: 0.5 } });
  });

  it('rejects unknown schemas and available values without provenance', () => {
    expect(() => parseAnalysisResult({ schemaVersion: 99, status: 'unavailable' })).toThrow(
      'unsupported_analysis_schema'
    );
    expect(() =>
      parseAnalysisResult({
        schemaVersion: 1,
        status: 'available',
        value: { moodScore: 0.5 },
      })
    ).toThrow('analysis_provenance_required');
  });
});

import { describe, it, expect, vi } from 'vitest';
import { hasTextMeaningfullyChanged, buildMeaningfulEditFields } from '../entryCorrectionFields';

describe('hasTextMeaningfullyChanged', () => {
  it('treats punctuation/casing-only edits as NOT meaningful', () => {
    expect(hasTextMeaningfullyChanged('Went for a run today.', 'went for a run today')).toBe(false);
  });

  it('treats a small typo fix (<=2 word delta) as NOT meaningful', () => {
    expect(hasTextMeaningfullyChanged('I fele great today', 'I feel great today')).toBe(false);
  });

  it('treats a substantial content edit as meaningful', () => {
    expect(hasTextMeaningfullyChanged(
      'Went for a run today',
      'Went for a run today and then had a huge fight with my sister about money'
    )).toBe(true);
  });

  it('treats missing old/new text as meaningful (defensive default)', () => {
    expect(hasTextMeaningfullyChanged('', 'new text')).toBe(true);
    expect(hasTextMeaningfullyChanged('old text', '')).toBe(true);
  });
});

describe('buildMeaningfulEditFields', () => {
  it('stamps entryInputVersion via the injected increment(1) sentinel', () => {
    const increment = vi.fn((n) => ({ __increment: n }));
    const fields = buildMeaningfulEditFields({ nextSignalExtractionVersion: 4, increment });
    expect(increment).toHaveBeenCalledWith(1);
    expect(fields.entryInputVersion).toEqual({ __increment: 1 });
  });

  it('stamps signalExtractionVersion, analysisStatus pending, and enrichment.status stale', () => {
    const increment = (n) => ({ __increment: n });
    const fields = buildMeaningfulEditFields({ nextSignalExtractionVersion: 4, increment });
    expect(fields.signalExtractionVersion).toBe(4);
    expect(fields.analysisStatus).toBe('pending');
    expect(fields['enrichment.status']).toBe('stale');
  });

  it('never touches raw transcription fields', () => {
    const increment = (n) => ({ __increment: n });
    const fields = buildMeaningfulEditFields({ nextSignalExtractionVersion: 2, increment });
    expect(fields).not.toHaveProperty('rawTranscript');
    expect(fields).not.toHaveProperty('transcription');
    expect(fields).not.toHaveProperty('text');
  });
});

// Approximates handleEntryUpdate's (App.jsx) branch decision end-to-end using
// the extracted primitives above: a non-meaningful edit (tag toggle: no
// `text` key at all, or a typo-only text edit) must NOT produce the
// version-bump fields; a meaningful text edit must.
describe('handleEntryUpdate correction-invalidation decision (via extracted primitives)', () => {
  const decide = (updates, oldText, currentSignalExtractionVersion, increment) => {
    if (updates.text === undefined) return null; // e.g. tag toggle
    if (!hasTextMeaningfullyChanged(oldText, updates.text)) return null; // typo fix
    return buildMeaningfulEditFields({
      nextSignalExtractionVersion: currentSignalExtractionVersion + 1,
      increment,
    });
  };

  it('tag toggle (no text field) does NOT bump entryInputVersion', () => {
    const increment = vi.fn((n) => ({ __increment: n }));
    const result = decide({ tags: ['@goal:fitness'] }, 'original text', 1, increment);
    expect(result).toBeNull();
    expect(increment).not.toHaveBeenCalled();
  });

  it('typo-only text edit does NOT bump entryInputVersion', () => {
    const increment = vi.fn((n) => ({ __increment: n }));
    const result = decide({ text: 'went for a run today' }, 'Went for a run today.', 1, increment);
    expect(result).toBeNull();
    expect(increment).not.toHaveBeenCalled();
  });

  it('meaningful text edit sets entryInputVersion, analysisStatus pending, enrichment.status stale', () => {
    const increment = vi.fn((n) => ({ __increment: n }));
    const result = decide(
      { text: 'Went for a run today and then had a huge fight with my sister about money' },
      'Went for a run today',
      1,
      increment
    );
    expect(result).toEqual({
      signalExtractionVersion: 2,
      entryInputVersion: { __increment: 1 },
      analysisStatus: 'pending',
      'enrichment.status': 'stale',
    });
  });
});

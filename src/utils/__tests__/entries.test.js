import { describe, it, expect } from 'vitest';
import { sanitizeEntry } from '../entries';

/**
 * sanitizeEntry — normalizer for raw Firestore entry data.
 *
 * R2 Task 6: futureMentions is retired (dead feature; Open Loops replaced
 * it in R1). This test locks in that the normalizer no longer defaults or
 * passes through a `futureMentions` field, for both legacy docs that still
 * carry the old array in Firestore (raw source history is immutable — we
 * just stop surfacing it through the normalizer) and fresh docs that never
 * had one.
 */
describe('sanitizeEntry', () => {
  it('does not include a futureMentions key when the raw doc has none', () => {
    const entry = sanitizeEntry('entry-1', { text: 'hello', category: 'personal' });
    expect(entry).not.toHaveProperty('futureMentions');
  });

  it('does not include a futureMentions key even when a legacy raw doc still carries the old array', () => {
    const entry = sanitizeEntry('entry-2', {
      text: 'hello',
      category: 'personal',
      futureMentions: [{ event: 'dentist', targetDate: new Date() }],
    });
    expect(entry).not.toHaveProperty('futureMentions');
  });
});

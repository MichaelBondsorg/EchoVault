/**
 * Embeddings v2 migration, plan task M2: same-space-or-nothing scoring.
 * See docs/superpowers/plans/2026-07-22-embeddings-v2-migration.md.
 */
import { describe, it, expect } from 'vitest';
import { cosineSimilarity, scoreEntryInBestSpace, toQueryVectors } from '../embeddingSpaces';

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it('returns 0 for mismatched-length vectors (no throw)', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0])).toBe(0);
  });

  it('returns 0 for null/undefined inputs', () => {
    expect(cosineSimilarity(null, [1, 0])).toBe(0);
    expect(cosineSimilarity([1, 0], undefined)).toBe(0);
  });
});

describe('scoreEntryInBestSpace — same-space-or-nothing (adversarial)', () => {
  // Deliberately equal-dimension v1/v2 vectors: a naive/buggy implementation
  // that just picked "any available vector pair" would silently produce a
  // plausible-looking score here. The adversarial fixture proves this is
  // structurally impossible in this implementation.
  const EQUAL_DIM_V1_QUERY = [1, 0, 0];
  const EQUAL_DIM_V2_QUERY = [0, 1, 0];
  const EQUAL_DIM_V1_ENTRY_VECTOR = [1, 0, 0]; // identical to the v1 query -> cosine 1 if paired correctly
  const EQUAL_DIM_V2_ENTRY_VECTOR = [0, 1, 0]; // identical to the v2 query -> cosine 1 if paired correctly

  it('never scores a v2 query vector against a v1-only entry, even with matching dims', () => {
    // If cross-space comparison were possible, cosine(EQUAL_DIM_V2_QUERY,
    // EQUAL_DIM_V1_ENTRY_VECTOR) = cosine([0,1,0],[1,0,0]) = 0 — a NUMBER,
    // not a null. A buggy implementation could return {score: 0, space: ...}
    // instead of correctly recognizing "no scoreable space" and returning
    // null. Assert null explicitly, not just "score !== garbage".
    const result = scoreEntryInBestSpace(
      { v2: EQUAL_DIM_V2_QUERY }, // no v1 query vector
      { embedding: EQUAL_DIM_V1_ENTRY_VECTOR } // only a v1 entry vector, no embeddingV2
    );
    expect(result).toBeNull();
  });

  it('never scores a v1 query vector against a v2-only entry, even with matching dims', () => {
    const result = scoreEntryInBestSpace(
      { v1: EQUAL_DIM_V1_QUERY }, // no v2 query vector
      { embeddingV2: EQUAL_DIM_V2_ENTRY_VECTOR } // only a v2 entry vector, no embedding
    );
    expect(result).toBeNull();
  });

  it('adversarial: query has BOTH spaces, entry has ONLY v1 with a vector identical to the v2 query — must score v1, never leak the v2 comparison', () => {
    const result = scoreEntryInBestSpace(
      { v1: [0.1, 0.2, 0.3], v2: EQUAL_DIM_V2_QUERY },
      { embedding: EQUAL_DIM_V2_QUERY } // same numbers as the v2 query, but stored as v1 (`embedding`)
    );
    // Correct: paired v1 query against v1 entry (dissimilar vectors) ->
    // low/negative score, space 'v1'. A cross-space bug would instead pair
    // queryVectors.v2 against entry.embedding here (same vector -> score 1,
    // space 'v2') since dims match and values are identical.
    expect(result).not.toBeNull();
    expect(result.space).toBe('v1');
    expect(result.score).not.toBeCloseTo(1);
  });

  it('proves the guarantee is structural: entry has BOTH v1 and v2 fields storing the OPPOSITE vector than expected in each space; correct output only comes from strict field pairing', () => {
    // entry.embedding (v1 field) holds the v2-query vector's numbers;
    // entry.embeddingV2 (v2 field) holds the v1-query vector's numbers.
    // If the comparator ever paired "space X query" with "space Y field" it
    // would report a suspiciously perfect match. Correct behavior: v2 is
    // preferred (both v2 sides present) and is scored against
    // entry.embeddingV2, which here is NOT equal to the v2 query, so the
    // score must NOT be ~1.
    const result = scoreEntryInBestSpace(
      { v1: EQUAL_DIM_V1_QUERY, v2: EQUAL_DIM_V2_QUERY },
      { embedding: EQUAL_DIM_V2_QUERY, embeddingV2: EQUAL_DIM_V1_QUERY }
    );
    expect(result.space).toBe('v2');
    expect(result.score).not.toBeCloseTo(1);
  });
});

describe('scoreEntryInBestSpace — space preference + fallback', () => {
  it('prefers v2 when both queryVectors.v2 and entry.embeddingV2 exist', () => {
    const result = scoreEntryInBestSpace(
      { v1: [1, 0], v2: [0, 1] },
      { embedding: [1, 0], embeddingV2: [0, 1] }
    );
    expect(result).toEqual({ score: expect.any(Number), space: 'v2' });
    expect(result.score).toBeCloseTo(1);
  });

  it('falls back to v1-v1 when the entry has no v2 vector', () => {
    const result = scoreEntryInBestSpace(
      { v1: [1, 0], v2: [0, 1] },
      { embedding: [1, 0] } // no embeddingV2
    );
    expect(result).toEqual({ score: expect.any(Number), space: 'v1' });
    expect(result.score).toBeCloseTo(1);
  });

  it('falls back to v1-v1 when the query has no v2 vector', () => {
    const result = scoreEntryInBestSpace(
      { v1: [1, 0] }, // no v2 query vector
      { embedding: [1, 0], embeddingV2: [0, 1] }
    );
    expect(result.space).toBe('v1');
  });

  it('returns null when no scoreable space exists at all (matches "no embedding" exclusion today)', () => {
    expect(scoreEntryInBestSpace({ v1: [1, 0] }, {})).toBeNull();
    expect(scoreEntryInBestSpace({}, { embedding: [1, 0] })).toBeNull();
    expect(scoreEntryInBestSpace(null, { embedding: [1, 0] })).toBeNull();
    expect(scoreEntryInBestSpace({ v1: [1, 0] }, null)).toBeNull();
  });
});

describe('toQueryVectors — legacy shape normalization', () => {
  it('wraps a raw vector array as {v1: array}', () => {
    expect(toQueryVectors([1, 2, 3])).toEqual({ v1: [1, 2, 3] });
  });

  it('passes through an already-shaped {v1, v2} object', () => {
    const shaped = { v1: [1, 0], v2: [0, 1] };
    expect(toQueryVectors(shaped)).toBe(shaped);
  });

  it('passes through a v2-only object', () => {
    const shaped = { v2: [0, 1] };
    expect(toQueryVectors(shaped)).toBe(shaped);
  });

  it('returns null for null/undefined/empty input', () => {
    expect(toQueryVectors(null)).toBeNull();
    expect(toQueryVectors(undefined)).toBeNull();
  });
});

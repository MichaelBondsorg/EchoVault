/**
 * Model registry resolution tests (plan task M1).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  WORKLOADS,
  MODEL_DEFAULTS,
  MODEL_FLAG_DEFAULTS,
  getModel,
  getModelSync,
  getModelFlag,
} from '../registry.js';
import { _clearFlagCacheForTest } from '../../shared/flags.js';

/** Fake Firestore whose config/flags doc returns the supplied field map. */
function makeDb(flagFields) {
  return {
    doc(path) {
      return {
        async get() {
          if (path !== 'config/flags') return { exists: false, data: () => ({}) };
          return { exists: true, data: () => flagFields };
        },
      };
    },
  };
}

beforeEach(() => {
  _clearFlagCacheForTest();
});

describe('registry — defaults', () => {
  it('every workload has a default model id', () => {
    for (const w of Object.values(WORKLOADS)) {
      expect(typeof MODEL_DEFAULTS[w]).toBe('string');
      expect(MODEL_DEFAULTS[w].length).toBeGreaterThan(0);
    }
  });

  it('retired/preview models are NOT in the defaults', () => {
    const values = Object.values(MODEL_DEFAULTS);
    expect(values).not.toContain('gemini-2.0-flash');
    expect(values).not.toContain('gemini-2.0-flash-exp');
    expect(values).not.toContain('gpt-4o-realtime-preview-2024-12-17');
    expect(values).not.toContain('gpt-5.6-terra');
  });

  it('getModelSync returns the compiled default', () => {
    expect(getModelSync('analyze')).toBe('gemini-3-flash-preview');
    expect(getModelSync('digest')).toBe('gemini-3.5-flash');
    expect(getModelSync('embeddingV2')).toBe('gemini-embedding-2');
  });

  it('getModelSync throws on an unknown workload', () => {
    expect(() => getModelSync('nope')).toThrow(/Unknown model workload/);
  });
});

describe('registry — getModel resolution', () => {
  it('returns the default when no flag override is present', async () => {
    const db = makeDb({});
    expect(await getModel(db, 'digest')).toBe('gemini-3.5-flash');
    expect(await getModel(db, 'classify')).toBe('gemini-3-flash-preview');
  });

  it('a config/flags string override wins over the default', async () => {
    const db = makeDb({ 'model.classify': 'gemini-2.5-flash' });
    expect(await getModel(db, 'classify')).toBe('gemini-2.5-flash');
  });

  it('ignores a blank/non-string override', async () => {
    expect(await getModel(makeDb({ 'model.analyze': '   ' }), 'analyze')).toBe(
      'gemini-3-flash-preview'
    );
    expect(await getModel(makeDb({ 'model.analyze': 123 }), 'analyze')).toBe(
      'gemini-3-flash-preview'
    );
  });

  it('falls back to the default when the flag read throws', async () => {
    const brokenDb = {
      doc() {
        return {
          async get() {
            throw new Error('firestore down');
          },
        };
      },
    };
    expect(await getModel(brokenDb, 'embedding')).toBe('text-embedding-004');
  });

  it('throws on an unknown workload', async () => {
    await expect(getModel(makeDb({}), 'bogus')).rejects.toThrow(/Unknown model workload/);
  });
});

describe('registry — model flags', () => {
  it('write-v2 and read-v2 default OFF', () => {
    expect(MODEL_FLAG_DEFAULTS['model.embeddingWriteV2']).toBe(false);
    expect(MODEL_FLAG_DEFAULTS['model.embeddingV2Read']).toBe(false);
  });

  it('getModelFlag returns the registered default when unset', async () => {
    expect(await getModelFlag(makeDb({}), 'model.embeddingWriteV2')).toBe(false);
  });

  it('getModelFlag honours an override', async () => {
    const db = makeDb({ 'model.embeddingWriteV2': true });
    expect(await getModelFlag(db, 'model.embeddingWriteV2')).toBe(true);
  });
});

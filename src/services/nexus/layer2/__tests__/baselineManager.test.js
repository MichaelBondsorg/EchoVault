/**
 * Privacy tests for baselineManager.js (R4 T2 — DR finding 5).
 *
 * baselineManager.js is not one of this task's primary-ownership files, but
 * the privacy sweep explicitly covers "any layer1/2 config" — this file had
 * hardcoded personal-entity/brand regex patterns ('spencer', 'sterling',
 * 'kobe', 'barrys') that are removed here. These tests lock that in.
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PERSONAL_TOKEN_DENYLIST } from '../../layer1/genericTriggers';

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  getDoc: vi.fn(),
  setDoc: vi.fn(),
  Timestamp: { now: () => ({ toMillis: () => Date.now() }) },
}));
vi.mock('../../../../config/firebase', () => ({ db: {} }));
vi.mock('../../../../config/constants', () => ({ APP_COLLECTION_ID: 'test-app' }));
vi.mock('../../../health/whoop', () => ({ getWhoopHistory: vi.fn() }));
vi.mock('../../../health/healthFormatter', () => ({ extractHealthSignals: vi.fn(() => ({})) }));
vi.mock('../../../environment/environmentFormatter', () => ({ extractEnvironmentSignals: vi.fn(() => ({})) }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const baselineManagerSource = fs.readFileSync(
  path.join(__dirname, '../baselineManager.js'),
  'utf8'
);

describe('baselineManager privacy', () => {
  it('source contains no known personal literal tokens', () => {
    const lower = baselineManagerSource.toLowerCase();
    for (const token of PERSONAL_TOKEN_DENYLIST) {
      expect(lower.includes(token), `baselineManager.js must not contain "${token}"`).toBe(false);
    }
  });

  it('no longer defines a per-named-entity baseline pattern map', () => {
    expect(baselineManagerSource).not.toMatch(/entityPatterns/);
  });
});

describe('calculateContextualBaselines — generic activity patterns', () => {
  it('still detects generic gym/yoga/dog-walk activity days without any brand or pet name', async () => {
    const { calculateContextualBaselines } = await import('../baselineManager');

    const entries = [
      { effectiveDate: '2026-07-01', text: 'Went to the gym and lifted for an hour, felt strong.' },
      { effectiveDate: '2026-07-02', text: 'Did yoga this morning, a nice vinyasa flow class.' },
      { effectiveDate: '2026-07-03', text: 'Walked the dog around the block twice today.' },
      { effectiveDate: '2026-07-04', text: 'Gym day again, lifted heavy and felt the workout.' },
      { effectiveDate: '2026-07-05', text: 'Another dog walk this evening, nice and calm.' },
      { effectiveDate: '2026-07-06', text: 'Walked the dog again before breakfast today.' },
      { effectiveDate: '2026-07-07', text: 'Gym session, lifted and did a full workout.' },
    ];

    const contextual = await calculateContextualBaselines({ days: [] }, entries, []);

    expect(contextual['activity:gym']).toBeDefined();
    expect(contextual['activity:dog_walk']).toBeDefined();
    // No entity-based keys should exist at all anymore.
    const entityKeys = Object.keys(contextual).filter((k) => k.startsWith('entity:'));
    expect(entityKeys).toEqual([]);
  });
});

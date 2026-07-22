/**
 * Client/server dismissal-key PARITY guard (Phase-0 closure review, Minor).
 *
 * `dismissalKeyFor` is deliberately duplicated across deployable packages
 * (client `insightDismissal.js` — authoritative; server mirror
 * `functions/src/reports/dismissalKey.js` — reports filtering). The sync
 * comments in both files are documentation; THIS test is the enforcement:
 * both implementations must produce identical keys over a shared fixture
 * set covering every derivation branch. A divergence means a report could
 * resurface an insight the user durably dismissed, with nothing else in CI
 * to catch it.
 */
import { describe, it, expect, vi } from 'vitest';

// insightDismissal.js pulls Firestore/client config at module scope — mock
// the boundary; dismissalKeyFor itself is pure.
vi.mock('../../../config/firebase', () => ({
  db: {},
  doc: vi.fn(),
  setDoc: vi.fn(),
  collection: vi.fn(),
  getDocs: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  setDoc: vi.fn(),
  collection: vi.fn(),
  getDocs: vi.fn(),
  Timestamp: { now: () => ({ toMillis: () => 0 }) },
}));

import { dismissalKeyFor as clientKeyFor } from '../insightDismissal';
import { dismissalKeyFor as serverKeyFor } from '../../../../functions/src/reports/dismissalKey.js';

// One fixture per derivation branch, plus edge shapes. Extend when a new
// branch is added to EITHER implementation.
const FIXTURES = [
  // synthesis (churned id → title-derived)
  { id: 'insight_1737400000000', title: 'The Evening Walk  Effect ', summary: 'x' },
  // synthesis fallback to summary when no title
  { id: 'insight_1737400000001', summary: 'A Quieter Morning Pattern' },
  // recommendation with interventionKey
  { id: 'recommendation_1737400000000', interventionKey: 'pet_walk', title: 'Try a walk' },
  // recommendation title fallback
  { id: 'recommendation_1737400000001', title: 'An Idea To Try' },
  // entity correlation, positive + negative direction
  { id: 'entity_gym_1737400000000', entityName: 'gym', moodDelta: 0.12 },
  { id: 'entity_gym_1737400000001', entityName: 'gym', moodDelta: -0.07 },
  // stable ids pass through
  { id: 'pattern_sleep_mood', title: 'whatever' },
  { id: 'calibration' },
  { id: 'control_anxiety', title: 'Cross-thread' },
  // degenerate shapes
  { id: 'insight_1737400000002' }, // no title, no summary
  null,
  {},
];

describe('dismissalKeyFor client/server parity', () => {
  it.each(FIXTURES.map((f, i) => [i, f]))('fixture %#: identical keys', (_i, fixture) => {
    expect(serverKeyFor(fixture)).toBe(clientKeyFor(fixture));
  });

  it('churned-id synthesis fixtures map to the SAME key (the reason keys exist)', () => {
    const a = clientKeyFor({ id: 'insight_1', title: 'The Evening Walk Effect' });
    const b = serverKeyFor({ id: 'insight_999999', title: '  the evening   walk effect' });
    expect(a).toBe(b);
    expect(a).toContain('synthesis:');
  });
});

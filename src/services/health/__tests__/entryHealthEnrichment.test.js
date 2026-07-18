import { vi } from 'vitest';

vi.mock('../../../config/firebase', () => ({
  auth: { currentUser: null },
  db: {},
}));
vi.mock('firebase/firestore', () => ({ doc: vi.fn(), updateDoc: vi.fn() }));
vi.mock('../healthDataService', () => ({ getHealthSummary: vi.fn() }));

const { resolveEntryDate } = await import('../entryHealthEnrichment');

describe('entry health enrichment dates', () => {
  it('uses the Date returned by a Firestore Timestamp', () => {
    const expected = new Date('2026-07-15T12:00:00.000Z');
    expect(resolveEntryDate({ toDate: () => expected })).toBe(expected);
  });

  it('passes through Date and rejects invalid values', () => {
    const expected = new Date('2026-07-15T12:00:00.000Z');
    expect(resolveEntryDate(expected)).toBe(expected);
    expect(() => resolveEntryDate('not-a-date')).toThrow('entry_date_invalid');
  });
});

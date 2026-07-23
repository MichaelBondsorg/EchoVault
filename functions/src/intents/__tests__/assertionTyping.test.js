import { describe, it, expect } from 'vitest';
import { deriveAssertion, buildIntent, ASSERTION_TYPES } from '../intentSchema.js';

const attrs = (over = {}) => ({
  agency: true, concrete: true, unfinished: true, temporalFit: true,
  negated: false, quoted: false, conditional: false, goalLanguage: false,
  otherOwned: false, completed: false, ...over,
});

describe('deriveAssertion', () => {
  it('"someone asked me to X" (otherOwned) is NOT the user\'s assertion', () => {
    expect(deriveAssertion('task', attrs({ otherOwned: true })).actor).toBe('other');
  });
  it('negation wins polarity; conditional/quoted degrade to uncertain', () => {
    expect(deriveAssertion('task', attrs({ negated: true })).polarity).toBe('negated');
    expect(deriveAssertion('task', attrs({ conditional: true })).polarity).toBe('uncertain');
    expect(deriveAssertion('task', attrs()).polarity).toBe('affirmed');
  });
  it('"I should maybe call" (no concrete commitment) is considered, not committed', () => {
    expect(deriveAssertion('task', attrs({ concrete: false })).status).toBe('considered');
    expect(deriveAssertion('task', attrs()).status).toBe('committed');
    expect(deriveAssertion('task', attrs({ completed: true })).status).toBe('completed');
  });
  it('maps every INTENT_KIND to a valid assertion type', () => {
    for (const [kind, type] of Object.entries({
      task: 'task', open_loop: 'intention', goal_habit: 'intention',
      conditional: 'possibility', event: 'event', completed: 'event',
      reflection: 'observation', external_action: 'event',
    })) {
      const a = deriveAssertion(kind, attrs());
      expect(a.type).toBe(type);
      expect(ASSERTION_TYPES).toContain(a.type);
    }
  });
  it('invalid tense collapses to unknown', () => {
    expect(deriveAssertion('task', attrs(), { tense: 'yesterday-ish' }).tense).toBe('unknown');
    expect(deriveAssertion('task', attrs(), { tense: 'past' }).tense).toBe('past');
  });
});

describe('buildIntent with assertion', () => {
  const base = {
    id: 'i1', ownerId: 'u1', entryId: 'e1', kind: 'task', state: 'abstain',
    sourceSpan: { start: 0, end: 10, text: 'call the bank' },
    attributes: attrs(), confidence: 0.9, activationReason: 'test', model: 'test-model',
  };
  it('stamps versions.schema = 2 when assertion present, 1 when absent', () => {
    const withA = buildIntent({ ...base, assertion: deriveAssertion('task', attrs()) });
    expect(withA.versions.schema).toBe(2);
    expect(withA.assertion.actor).toBe('user');
    expect(buildIntent({ ...base }).versions.schema).toBe(1);
  });
  it('rejects a malformed assertion', () => {
    expect(() => buildIntent({ ...base, assertion: { actor: 'me', type: 'task', status: 'unknown', tense: 'past', polarity: 'affirmed' } })).toThrow();
  });
});

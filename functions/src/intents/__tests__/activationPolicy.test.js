import { describe, it, expect } from 'vitest';
import { decideActivation, HARD_BLOCKERS } from '../activationPolicy.js';

const FAR_FUTURE = '3000-01-01T00:00:00.000Z';
const PAST = '2000-01-01T00:00:00.000Z';

// Base attributes: all false. Helper to flip specific ones on.
function attrs(overrides = {}) {
  return {
    agency: false, concrete: false, unfinished: false, temporalFit: false,
    negated: false, quoted: false, conditional: false, goalLanguage: false,
    otherOwned: false, completed: false,
    ...overrides,
  };
}

function candidate(overrides = {}) {
  return {
    kind: 'task',
    attributes: attrs(),
    confidence: 0.9,
    targetAt: null,
    explicitCommand: false,
    ...overrides,
  };
}

// A candidate that meets every ACTIVE criterion.
function qualified(overrides = {}) {
  return candidate({
    attributes: attrs({ agency: true, concrete: true, unfinished: true, temporalFit: true }),
    ...overrides,
  });
}

describe('decideActivation — the confidence-alone-never-activates contract', () => {
  it('confidence 0.99 with agency false -> NOT active (abstain)', () => {
    const r = decideActivation(candidate({
      confidence: 0.99,
      attributes: attrs({ agency: false, concrete: true, unfinished: true, temporalFit: true }),
    }));
    expect(r.state).toBe('abstain');
    expect(r.reason).toBe('no-agency');
  });

  it('confidence 1.0 with a hard blocker -> abstain', () => {
    const r = decideActivation(candidate({
      confidence: 1.0,
      attributes: attrs({ agency: true, concrete: true, unfinished: true, temporalFit: true, negated: true }),
    }));
    expect(r.state).toBe('abstain');
    expect(r.reason).toBe('blocked:negated');
  });

  it('a fully-qualified candidate activates even at LOW confidence (activation is structural)', () => {
    const r = decideActivation(qualified({ confidence: 0.05 }));
    expect(r.state).toBe('active');
  });
});

describe('decideActivation — ACTIVE path', () => {
  it('activates when agency+concrete+unfinished+temporalFit all true', () => {
    expect(decideActivation(qualified()).state).toBe('active');
  });

  it('activates a task with a plausible-future targetAt', () => {
    expect(decideActivation(qualified({ targetAt: FAR_FUTURE })).state).toBe('active');
  });

  it('does NOT activate when the targetAt is in the past (temporal veto)', () => {
    const r = decideActivation(qualified({ targetAt: PAST }));
    expect(r.state).not.toBe('active');
  });
});

describe('decideActivation — explicit command path', () => {
  it('activates an explicit command without a concreteness gate', () => {
    const r = decideActivation(candidate({
      explicitCommand: true,
      attributes: attrs({ agency: true, unfinished: true }), // concrete false, temporalFit false
    }));
    expect(r.state).toBe('active');
    expect(r.reason).toBe('explicit-command');
  });

  it('activates an explicit open_loop follow-up with a future targetAt', () => {
    const r = decideActivation(candidate({
      kind: 'open_loop',
      explicitCommand: true,
      targetAt: FAR_FUTURE,
      attributes: attrs({ agency: true, unfinished: true }),
    }));
    expect(r.state).toBe('active');
  });

  it('an explicit command still cannot override agency=false', () => {
    const r = decideActivation(candidate({
      explicitCommand: true,
      attributes: attrs({ agency: false, unfinished: true }),
    }));
    expect(r.state).toBe('abstain');
  });

  it('an explicit command with a past targetAt does not activate', () => {
    const r = decideActivation(candidate({
      explicitCommand: true,
      targetAt: PAST,
      attributes: attrs({ agency: true, unfinished: true }),
    }));
    expect(r.state).not.toBe('active');
  });
});

describe('decideActivation — SUGGESTED path', () => {
  it('suggests a plausible commitment failing exactly one soft criterion (not concrete)', () => {
    const r = decideActivation(candidate({
      confidence: 0.7,
      attributes: attrs({ agency: true, unfinished: true, temporalFit: true, concrete: false }),
    }));
    expect(r.state).toBe('suggested');
    expect(r.reason).toBe('soft:not-concrete');
  });

  it('suggests when temporal fit is uncertain but concrete is true', () => {
    const r = decideActivation(candidate({
      confidence: 0.8,
      attributes: attrs({ agency: true, unfinished: true, concrete: true, temporalFit: false }),
    }));
    expect(r.state).toBe('suggested');
    expect(r.reason).toBe('soft:temporal-uncertain');
  });

  it('abstains (not suggests) when confidence is below the floor', () => {
    const r = decideActivation(candidate({
      confidence: 0.59,
      attributes: attrs({ agency: true, unfinished: true, temporalFit: true, concrete: false }),
    }));
    expect(r.state).toBe('abstain');
  });

  it('abstains when TWO soft criteria fail', () => {
    const r = decideActivation(candidate({
      confidence: 0.95,
      attributes: attrs({ agency: true, unfinished: true, concrete: false, temporalFit: false }),
    }));
    expect(r.state).toBe('abstain');
  });
});

describe('decideActivation — hard blockers each abstain', () => {
  for (const blocker of HARD_BLOCKERS) {
    it(`abstains on ${blocker} even with all positive criteria`, () => {
      const r = decideActivation(qualified({
        attributes: attrs({ agency: true, concrete: true, unfinished: true, temporalFit: true, [blocker]: true }),
      }));
      expect(r.state).toBe('abstain');
      expect(r.reason).toBe(`blocked:${blocker}`);
    });
  }
});

describe('decideActivation — non-surfaceable kinds always abstain', () => {
  for (const kind of ['event', 'goal_habit', 'reflection', 'external_action', 'conditional', 'completed']) {
    it(`${kind} abstains even when every attribute is positive and confidence is 1.0`, () => {
      const r = decideActivation({
        kind,
        confidence: 1.0,
        explicitCommand: true,
        targetAt: FAR_FUTURE,
        attributes: attrs({ agency: true, concrete: true, unfinished: true, temporalFit: true }),
      });
      expect(r.state).toBe('abstain');
      expect(r.reason).toBe(`kind:${kind}-context-only`);
    });
  }

  it('an unknown/undefined kind abstains', () => {
    expect(decideActivation({ attributes: attrs() }).state).toBe('abstain');
  });
});

describe('decideActivation — base requirements', () => {
  it('abstains without agency', () => {
    expect(decideActivation(candidate({ attributes: attrs({ concrete: true, unfinished: true, temporalFit: true }) })).reason).toBe('no-agency');
  });
  it('abstains without unfinished', () => {
    expect(decideActivation(candidate({ attributes: attrs({ agency: true, concrete: true, temporalFit: true }) })).reason).toBe('not-unfinished');
  });
});

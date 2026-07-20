import { describe, it, expect } from 'vitest';
import {
  INTENT_KINDS,
  INTENT_STATES,
  INTENT_ATTRIBUTE_KEYS,
  buildIntent,
  isClientTransitionAllowed,
  validateUserIntentUpdate,
  buildUserDecision,
} from '../intentSchema.js';

function allAttrs(overrides = {}) {
  const base = {};
  for (const k of INTENT_ATTRIBUTE_KEYS) base[k] = false;
  return { ...base, ...overrides };
}

function validArgs(overrides = {}) {
  return {
    id: 'abc123',
    ownerId: 'user-1',
    entryId: 'entry-1',
    kind: 'task',
    state: 'active',
    sourceSpan: { start: 0, end: 10, text: 'call dentist' },
    attributes: allAttrs({ agency: true, concrete: true, unfinished: true, temporalFit: true }),
    confidence: 0.9,
    activationReason: 'all criteria met',
    targetAt: null,
    model: 'gemini-3.5-flash',
    ...overrides,
  };
}

describe('intent taxonomy constants', () => {
  it('exposes the 8 kinds and 5 states', () => {
    expect(INTENT_KINDS).toEqual([
      'task', 'open_loop', 'event', 'goal_habit', 'reflection',
      'external_action', 'conditional', 'completed',
    ]);
    expect(INTENT_STATES).toEqual(['active', 'suggested', 'abstain', 'dismissed', 'completed_state']);
  });

  it('has exactly the 10 policy attributes', () => {
    expect(INTENT_ATTRIBUTE_KEYS).toEqual([
      'agency', 'concrete', 'unfinished', 'temporalFit', 'negated',
      'quoted', 'conditional', 'goalLanguage', 'otherOwned', 'completed',
    ]);
  });
});

describe('buildIntent', () => {
  it('constructs a well-formed intent with closed authorization + provenance', () => {
    const intent = buildIntent(validArgs());
    expect(intent.kind).toBe('task');
    expect(intent.state).toBe('active');
    expect(intent.authorization).toEqual({ notifications: false });
    expect(intent.decidedBy).toBe('policy');
    expect(intent.versions).toMatchObject({ extraction: 1, model: 'gemini-3.5-flash', prompt: 1, schema: 1 });
    expect(intent.targetAt).toBeNull();
    expect(typeof intent.createdAt).toBe('string');
    expect(typeof intent.updatedAt).toBe('string');
    // all 10 attributes present as booleans
    for (const k of INTENT_ATTRIBUTE_KEYS) expect(typeof intent.attributes[k]).toBe('boolean');
  });

  it('authorization.notifications defaults false even when a truthy non-true value is passed', () => {
    const intent = buildIntent(validArgs({ authorization: { notifications: 'yes' } }));
    expect(intent.authorization.notifications).toBe(false);
  });

  it('honours an explicit notifications:true grant', () => {
    const intent = buildIntent(validArgs({ kind: 'open_loop', authorization: { notifications: true } }));
    expect(intent.authorization.notifications).toBe(true);
  });

  it('rejects unknown kind and state', () => {
    expect(() => buildIntent(validArgs({ kind: 'nope' }))).toThrow(/kind/);
    expect(() => buildIntent(validArgs({ state: 'nope' }))).toThrow(/state/);
  });

  it('rejects confidence outside [0,1]', () => {
    expect(() => buildIntent(validArgs({ confidence: 1.5 }))).toThrow(/confidence/);
    expect(() => buildIntent(validArgs({ confidence: -0.1 }))).toThrow(/confidence/);
    expect(() => buildIntent(validArgs({ confidence: 'high' }))).toThrow(/confidence/);
  });

  it('requires a locatable evidence span with non-empty text', () => {
    expect(() => buildIntent(validArgs({ sourceSpan: { start: 0, end: 5, text: '' } }))).toThrow(/evidence span/);
    expect(() => buildIntent(validArgs({ sourceSpan: { start: 5, end: 2, text: 'x' } }))).toThrow(/range/);
    expect(() => buildIntent(validArgs({ sourceSpan: null }))).toThrow(/sourceSpan/);
  });

  it('rejects a non-boolean attribute (no truthy coercion)', () => {
    expect(() => buildIntent(validArgs({ attributes: allAttrs({ agency: 'true' }) }))).toThrow(/agency/);
    const missing = allAttrs();
    delete missing.concrete;
    expect(() => buildIntent(validArgs({ attributes: missing }))).toThrow(/concrete/);
  });

  it('rejects a bad targetAt but accepts an ISO string', () => {
    expect(() => buildIntent(validArgs({ targetAt: 123 }))).toThrow(/targetAt/);
    const intent = buildIntent(validArgs({ targetAt: '2026-07-24T00:00:00.000Z' }));
    expect(intent.targetAt).toBe('2026-07-24T00:00:00.000Z');
  });

  it('requires model provenance', () => {
    expect(() => buildIntent(validArgs({ model: '' }))).toThrow(/model/);
  });
});

describe('isClientTransitionAllowed', () => {
  it('allows suggested -> active (keep)', () => {
    expect(isClientTransitionAllowed('suggested', 'active')).toBe(true);
  });
  it('allows active -> completed_state (complete)', () => {
    expect(isClientTransitionAllowed('active', 'completed_state')).toBe(true);
  });
  it('allows any -> dismissed', () => {
    for (const s of INTENT_STATES) expect(isClientTransitionAllowed(s, 'dismissed')).toBe(true);
  });
  it('allows a no-op (state unchanged, e.g. authorization-only edit)', () => {
    expect(isClientTransitionAllowed('active', 'active')).toBe(true);
  });
  it('FORBIDS abstain -> active (a hard-negative can never be kept active)', () => {
    expect(isClientTransitionAllowed('abstain', 'active')).toBe(false);
  });
  it('forbids suggested -> completed_state and active -> suggested', () => {
    expect(isClientTransitionAllowed('suggested', 'completed_state')).toBe(false);
    expect(isClientTransitionAllowed('active', 'suggested')).toBe(false);
  });
});

describe('validateUserIntentUpdate', () => {
  const base = buildIntent(validArgs({ state: 'suggested' }));

  it('permits a keep (suggested->active) touching only state/updatedAt', () => {
    const after = { ...base, state: 'active', updatedAt: 'later' };
    expect(validateUserIntentUpdate(base, after)).toBe(true);
  });

  it('rejects a mutation of an extraction-owned field', () => {
    const after = { ...base, state: 'active', confidence: 0.1 };
    expect(validateUserIntentUpdate(base, after)).toBe(false);
  });

  it('rejects tampering with attributes even alongside a legal state move', () => {
    const after = { ...base, state: 'dismissed', attributes: { ...base.attributes, agency: !base.attributes.agency } };
    expect(validateUserIntentUpdate(base, after)).toBe(false);
  });

  it('rejects a forbidden state transition', () => {
    const abstained = buildIntent(validArgs({ state: 'abstain' }));
    const after = { ...abstained, state: 'active' };
    expect(validateUserIntentUpdate(abstained, after)).toBe(false);
  });

  it('permits an authorization-only change (no state move)', () => {
    const active = buildIntent(validArgs({ state: 'active' }));
    const after = { ...active, authorization: { notifications: true }, updatedAt: 'later' };
    expect(validateUserIntentUpdate(active, after)).toBe(true);
  });
});

describe('buildUserDecision', () => {
  it('constructs a reversible intent decision', () => {
    const d = buildUserDecision({ targetId: 'i1', action: 'kept' });
    expect(d).toMatchObject({ targetId: 'i1', targetType: 'intent', action: 'kept', reasonCode: null, reversible: true });
    expect(typeof d.createdAt).toBe('string');
  });
  it('rejects an unknown action', () => {
    expect(() => buildUserDecision({ targetId: 'i1', action: 'frobnicate' })).toThrow(/action/);
  });
  it('carries a reasonCode when supplied', () => {
    const d = buildUserDecision({ targetId: 'i1', action: 'not_a_task', reasonCode: 'misheard' });
    expect(d.reasonCode).toBe('misheard');
  });
});

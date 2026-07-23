import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../config/constants', () => ({ APP_COLLECTION_ID: 'echo-vault-v5-fresh' }));

const addDocMock = vi.fn(async () => ({ id: 'event-1' }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn((db, ...segs) => ({ path: segs.join('/') })),
  addDoc: (...args) => addDocMock(...args),
}));

const setClaimStatusMock = vi.fn(async () => undefined);
vi.mock('../claimsService', () => ({
  setClaimStatus: (...args) => setClaimStatusMock(...args),
}));

const excludeSourceMock = vi.fn(async () => ({ id: 'excl-1' }));
vi.mock('../../sourceExclusions', () => ({
  excludeSource: (...args) => excludeSourceMock(...args),
}));

const recordFeedbackAndLearnMock = vi.fn(async () => ({ accuracyRate: 0.5 }));
vi.mock('../../../basicInsights/feedbackLearning', () => ({
  recordFeedbackAndLearn: (...args) => recordFeedbackAndLearnMock(...args),
}));

const recordInsightEngagementMock = vi.fn(async () => true);
vi.mock('../../../analytics/insightEngagement', () => ({
  recordInsightEngagement: (...args) => recordInsightEngagementMock(...args),
}));

const { FEEDBACK_OPTIONS, recordClaimFeedback } = await import('../claimFeedback');

const DB = { __db: true };
const UID = 'user-1';
const NOW = '2026-07-22T10:00:00.000Z';

const baseClaim = Object.freeze({
  id: 'claim_basic-activity-tag-gym-mood_abcd1234_v1',
  version: 1,
  parentClaimId: null,
  supersededByClaimId: null,
  claimType: 'pattern_to_watch',
  subject: 'gym',
  outcome: 'mood',
  direction: 'positive',
  questionWording: 'Does gym relate to mood?',
  wording: 'On days you mention gym, mood tends to run higher.',
  limitations: [],
  analysisPlan: {
    hypothesisFamilyId: 'basic:activity:tag:gym:mood',
    candidateId: 'tag:gym',
  },
  evidence: {
    sourceEntryIds: ['e1', 'e2'],
    effectMoodPoints: 7.2,
    totalCandidateDayCount: 24,
  },
  status: 'candidate',
});

function allMocks() {
  return [setClaimStatusMock, excludeSourceMock, recordFeedbackAndLearnMock, recordInsightEngagementMock, addDocMock];
}

beforeEach(() => {
  allMocks().forEach((m) => m.mockClear());
});

describe('FEEDBACK_OPTIONS', () => {
  it('exposes exactly the six diagnostic options, in order', () => {
    expect(FEEDBACK_OPTIONS.map((o) => o.id)).toEqual([
      'accurate', 'wrong_source', 'not_useful', 'not_causal', 'misunderstood', 'do_not_analyze',
    ]);
  });

  it('is frozen (cannot be mutated by a consumer)', () => {
    expect(Object.isFrozen(FEEDBACK_OPTIONS)).toBe(true);
  });
});

describe('recordClaimFeedback — routing', () => {
  it('"accurate" calls ONLY recordFeedbackAndLearn, with feedback:"accurate" and the claim feedback shape', async () => {
    await recordClaimFeedback(DB, UID, baseClaim, 'accurate', { entriesCount: 40 });

    expect(recordFeedbackAndLearnMock).toHaveBeenCalledTimes(1);
    expect(recordFeedbackAndLearnMock).toHaveBeenCalledWith(
      UID,
      {
        insightId: baseClaim.id,
        category: 'activity',
        insightText: baseClaim.wording,
        moodDelta: 7.2,
        sampleSize: 24,
        entryIds: ['e1', 'e2'],
        feedback: 'accurate',
      },
      [{ id: 'e1', entryId: 'e1' }, { id: 'e2', entryId: 'e2' }],
      40,
    );
    expect(excludeSourceMock).not.toHaveBeenCalled();
    expect(recordInsightEngagementMock).not.toHaveBeenCalled();
    expect(setClaimStatusMock).not.toHaveBeenCalled();
  });

  it('"wrong_source" calls ONLY excludeSource, scoped to the claim\'s hypothesisFamilyId', async () => {
    await recordClaimFeedback(DB, UID, baseClaim, 'wrong_source', { entryId: 'e1' });

    expect(excludeSourceMock).toHaveBeenCalledTimes(1);
    expect(excludeSourceMock).toHaveBeenCalledWith(DB, UID, {
      entryId: 'e1',
      appliesTo: 'basic:activity:tag:gym:mood',
      reason: 'wrong_source',
    });
    expect(recordFeedbackAndLearnMock).not.toHaveBeenCalled();
    expect(recordInsightEngagementMock).not.toHaveBeenCalled();
    expect(setClaimStatusMock).not.toHaveBeenCalled();
  });

  it('"wrong_source" without entryId throws and calls no consumer or audit write', async () => {
    await expect(recordClaimFeedback(DB, UID, baseClaim, 'wrong_source')).rejects.toThrow(/entryId/);
    expect(excludeSourceMock).not.toHaveBeenCalled();
    expect(addDocMock).not.toHaveBeenCalled();
  });

  it('"not_useful" calls ONLY recordInsightEngagement with the claim-as-insight adapter', async () => {
    await recordClaimFeedback(DB, UID, baseClaim, 'not_useful');

    expect(recordInsightEngagementMock).toHaveBeenCalledTimes(1);
    expect(recordInsightEngagementMock).toHaveBeenCalledWith(UID, {
      id: baseClaim.id,
      type: 'claim',
      title: baseClaim.wording,
      category: 'basic:activity:tag:gym:mood',
    }, 'dismissed');
    expect(recordFeedbackAndLearnMock).not.toHaveBeenCalled();
    expect(excludeSourceMock).not.toHaveBeenCalled();
    expect(setClaimStatusMock).not.toHaveBeenCalled();
  });

  it('"not_causal" calls NO consumer (comprehension signal only, wording already non-causal)', async () => {
    await recordClaimFeedback(DB, UID, baseClaim, 'not_causal');

    expect(recordFeedbackAndLearnMock).not.toHaveBeenCalled();
    expect(excludeSourceMock).not.toHaveBeenCalled();
    expect(recordInsightEngagementMock).not.toHaveBeenCalled();
    expect(setClaimStatusMock).not.toHaveBeenCalled();
  });

  it('"misunderstood" calls ONLY recordFeedbackAndLearn with feedback:"inaccurate"', async () => {
    await recordClaimFeedback(DB, UID, baseClaim, 'misunderstood', { entriesCount: 12 });

    expect(recordFeedbackAndLearnMock).toHaveBeenCalledTimes(1);
    expect(recordFeedbackAndLearnMock).toHaveBeenCalledWith(
      UID,
      expect.objectContaining({ insightId: baseClaim.id, feedback: 'inaccurate' }),
      expect.any(Array),
      12,
    );
    expect(recordFeedbackAndLearnMock.mock.calls[0][1].suppressTopic).toBeUndefined();
    expect(excludeSourceMock).not.toHaveBeenCalled();
    expect(recordInsightEngagementMock).not.toHaveBeenCalled();
    expect(setClaimStatusMock).not.toHaveBeenCalled();
  });

  it('"do_not_analyze" calls BOTH setClaimStatus(suppressed) AND recordFeedbackAndLearn(suppressTopic:true)', async () => {
    await recordClaimFeedback(DB, UID, baseClaim, 'do_not_analyze', { now: NOW });

    expect(setClaimStatusMock).toHaveBeenCalledTimes(1);
    expect(setClaimStatusMock).toHaveBeenCalledWith(DB, UID, baseClaim.id, 'suppressed', { now: NOW });

    expect(recordFeedbackAndLearnMock).toHaveBeenCalledTimes(1);
    expect(recordFeedbackAndLearnMock).toHaveBeenCalledWith(
      UID,
      expect.objectContaining({ insightId: baseClaim.id, feedback: 'inaccurate', suppressTopic: true }),
      expect.any(Array),
      0,
    );
    expect(excludeSourceMock).not.toHaveBeenCalled();
    expect(recordInsightEngagementMock).not.toHaveBeenCalled();
  });

  it('throws on an unknown optionId and calls no consumer or audit write', async () => {
    await expect(recordClaimFeedback(DB, UID, baseClaim, 'bogus_option')).rejects.toThrow(/unknown option/);
    allMocks().forEach((m) => expect(m).not.toHaveBeenCalled());
  });
});

describe('recordClaimFeedback — audit event', () => {
  it.each(FEEDBACK_OPTIONS.map((o) => o.id))(
    'always appends a raw insightFeedback event for option "%s"',
    async (optionId) => {
      const opts = optionId === 'wrong_source' ? { entryId: 'e1', now: NOW } : { now: NOW };
      await recordClaimFeedback(DB, UID, baseClaim, optionId, opts);

      expect(addDocMock).toHaveBeenCalledTimes(1);
      const [collectionRef, event] = addDocMock.mock.calls[0];
      expect(collectionRef.path).toBe(`artifacts/echo-vault-v5-fresh/users/${UID}/insightFeedback`);
      expect(event).toEqual({
        claimId: baseClaim.id,
        familyId: 'basic:activity:tag:gym:mood',
        optionId,
        entryId: optionId === 'wrong_source' ? 'e1' : null,
        createdAt: NOW,
      });
    },
  );

  it('defaults createdAt to an ISO "now" when not provided', async () => {
    await recordClaimFeedback(DB, UID, baseClaim, 'accurate');
    const [, event] = addDocMock.mock.calls[0];
    expect(typeof event.createdAt).toBe('string');
    expect(() => new Date(event.createdAt).toISOString()).not.toThrow();
  });
});

describe('recordClaimFeedback — engine key derivation from hypothesisFamilyId', () => {
  it("parses 'basic:activity:mood' -> category 'activity' in the feedback shape", async () => {
    const claim = { ...baseClaim, analysisPlan: { hypothesisFamilyId: 'basic:activity:mood', candidateId: 'x' } };
    await recordClaimFeedback(DB, UID, claim, 'accurate');
    expect(recordFeedbackAndLearnMock.mock.calls[0][1].category).toBe('activity');
  });

  it('routes an experiment familyId\'s second segment (templateId) as category', async () => {
    const claim = { ...baseClaim, analysisPlan: { hypothesisFamilyId: 'experiment:sleep_wind_down:mood', candidateId: 'x' } };
    await recordClaimFeedback(DB, UID, claim, 'accurate');
    expect(recordFeedbackAndLearnMock.mock.calls[0][1].category).toBe('sleep_wind_down');
  });
});

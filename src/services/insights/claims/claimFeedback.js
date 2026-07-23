/**
 * Diagnostic feedback taxonomy for claims (R4 Phase 1, DR finding 10).
 *
 * A claim's "why am I seeing this?" sheet offers six structured feedback
 * options instead of a free-text box, and each one is routed to the ONE
 * consumer whose job matches what the user actually reported — corrections
 * (the claim's facts were derived from the wrong evidence) change what
 * future generations compute, while preferences (the claim is real but not
 * wanted) only change ranking/suppression. Mixing those up is exactly the
 * DR finding this closes: a "not useful" click must never quietly alter
 * facts, and a "wrong source" click must never merely hide the card while
 * leaving the bad source feeding every future generation.
 *
 * Routing (see FEEDBACK_OPTIONS below for the six ids):
 *   accurate       -> recordFeedbackAndLearn (positive learning signal)
 *   wrong_source   -> excludeSource (correction: the source entry is wrong
 *                     for this hypothesis family; excludeSource's own
 *                     onSourcesChanged fan-out is what makes the NEXT
 *                     generation re-derive and supersede this claim)
 *   not_useful     -> recordInsightEngagement (ranking only, facts untouched)
 *   not_causal     -> no consumer call. The claim's wording is already
 *                     non-causal (buildClaim rejects causal language up
 *                     front) — this option exists purely as a comprehension
 *                     signal for the Phase-2 gate, so only the raw audit
 *                     event below is written for it.
 *   misunderstood  -> recordFeedbackAndLearn (false-positive pattern signal)
 *   do_not_analyze -> setClaimStatus('suppressed') AND recordFeedbackAndLearn
 *                     with suppressTopic:true (drives the existing
 *                     patternType suppression machinery; liftable in
 *                     InsightControlCenter per D7)
 *
 * Every option, including the two that only ever write one thing, ALSO
 * appends a raw structured event to the `insightFeedback` collection — the
 * durable audit trail the DR requires ("record a structured reason for
 * every correction"). This happens unconditionally, after the routed
 * consumer call(s) succeed, so a write failure in the consumer call
 * surfaces as a thrown error rather than a silently-recorded-but-not-acted-
 * on event.
 */
import { collection, addDoc } from 'firebase/firestore';
import { APP_COLLECTION_ID } from '../../../config/constants';
import { setClaimStatus } from './claimsService';
import { excludeSource } from '../sourceExclusions';
import { recordFeedbackAndLearn } from '../../basicInsights/feedbackLearning';
import { recordInsightEngagement } from '../../analytics/insightEngagement';

export const FEEDBACK_OPTIONS = Object.freeze([
  { id: 'accurate', label: 'Accurate' },
  { id: 'wrong_source', label: 'Wrong source entries' }, // requires entryId
  { id: 'not_useful', label: 'Real, but not useful' },
  { id: 'not_causal', label: 'This doesn’t cause that' },
  { id: 'misunderstood', label: 'Misunderstood person/activity' },
  { id: 'do_not_analyze', label: "Don’t analyze this topic" },
]);

const VALID_OPTION_IDS = new Set(FEEDBACK_OPTIONS.map((o) => o.id));

/**
 * Engine key from a hypothesisFamilyId: 'basic:activity:mood' -> 'activity'.
 * Family ids are colon-delimited `<origin>:<category>[:...]`; segment index
 * 1 is always the category/engine key, no matter how many segments follow
 * it — this holds for experiment families too, where segment 1 is the
 * experiment's templateId (the category its own engine tracks feedback
 * under). A familyId with no colon at all (not emitted by any generator
 * today, but not assumed impossible) falls back to the whole string rather
 * than throwing.
 *
 * @param {string} familyId
 * @returns {string}
 */
function engineKeyFromFamilyId(familyId) {
  const parts = String(familyId).split(':');
  return parts.length > 1 ? parts[1] : familyId;
}

/**
 * Minimal cited-entries stand-in built from the claim's own evidence — this
 * module has no `entriesById` to resolve full entry objects from (unlike
 * ReceiptSheet's legacy-insight path), so each cited entry is represented
 * by its id alone, mirroring the same `{id, entryId}` synchronous-fallback
 * shape ReceiptSheet already uses when a source entry isn't in memory.
 *
 * @param {object} claim
 * @returns {Array<{id: string, entryId: string}>}
 */
function citedEntriesFor(claim) {
  return (claim.evidence.sourceEntryIds || []).map((id) => ({ id, entryId: id }));
}

/**
 * The `feedback` object shape `recordFeedbackAndLearn` expects (R4 Task 5
 * brief, step 2), built from the claim's own evidence.
 *
 * @param {object} claim
 * @param {'accurate'|'inaccurate'} feedback
 * @param {object} [extra] - additional keys merged in (e.g. suppressTopic)
 */
function claimFeedbackShape(claim, feedback, extra = {}) {
  return {
    insightId: claim.id,
    category: engineKeyFromFamilyId(claim.analysisPlan.hypothesisFamilyId),
    insightText: claim.wording,
    moodDelta: claim.evidence.effectMoodPoints,
    sampleSize: claim.evidence.totalCandidateDayCount,
    entryIds: claim.evidence.sourceEntryIds,
    feedback,
    ...extra,
  };
}

/**
 * `recordInsightEngagement`'s expected insight shape, adapted from a claim.
 * `category` here is deliberately the RAW hypothesisFamilyId (not the
 * parsed engine key `claimFeedbackShape` uses) — engagement events are
 * keyed by whatever the generating surface calls "category" for its own
 * analytics grouping, and the brief specifies this literal shape.
 *
 * @param {object} claim
 */
function claimAsInsight(claim) {
  return {
    id: claim.id,
    type: 'claim',
    title: claim.wording,
    category: claim.analysisPlan.hypothesisFamilyId,
  };
}

function feedbackEventsPath(uid) {
  return `artifacts/${APP_COLLECTION_ID}/users/${uid}/insightFeedback`;
}

/**
 * Record one of the six diagnostic feedback options against a claim,
 * routing it to the correct consumer(s) per the table in this module's
 * header comment, then always appending a raw audit event.
 *
 * @param {object} db
 * @param {string} uid
 * @param {object} claim - a claim doc (per claimSchema.js's buildClaim shape)
 * @param {string} optionId - one of FEEDBACK_OPTIONS' ids
 * @param {{entryId?: string|null, entriesCount?: number, now?: string}} [opts]
 * @returns {Promise<void>}
 */
export async function recordClaimFeedback(db, uid, claim, optionId, {
  entryId = null, entriesCount = 0, now,
} = {}) {
  if (!VALID_OPTION_IDS.has(optionId)) {
    throw new Error(`recordClaimFeedback: unknown option "${optionId}"`);
  }
  if (optionId === 'wrong_source' && !entryId) {
    throw new Error('recordClaimFeedback: wrong_source requires entryId');
  }

  const familyId = claim.analysisPlan.hypothesisFamilyId;
  const nowIso = now || new Date().toISOString();
  const citedEntries = citedEntriesFor(claim);

  switch (optionId) {
    case 'accurate':
      await recordFeedbackAndLearn(
        uid, claimFeedbackShape(claim, 'accurate'), citedEntries, entriesCount,
      );
      break;

    case 'wrong_source':
      await excludeSource(db, uid, { entryId, appliesTo: familyId, reason: 'wrong_source' });
      break;

    case 'not_useful':
      await recordInsightEngagement(uid, claimAsInsight(claim), 'dismissed');
      break;

    case 'not_causal':
      // Stored event only — see header comment. No consumer call.
      break;

    case 'misunderstood':
      await recordFeedbackAndLearn(
        uid, claimFeedbackShape(claim, 'inaccurate'), citedEntries, entriesCount,
      );
      break;

    case 'do_not_analyze':
      await setClaimStatus(db, uid, claim.id, 'suppressed', { now: nowIso });
      await recordFeedbackAndLearn(
        uid,
        claimFeedbackShape(claim, 'inaccurate', { suppressTopic: true }),
        citedEntries,
        entriesCount,
      );
      break;

    default:
      // Unreachable: VALID_OPTION_IDS check above already threw.
      throw new Error(`recordClaimFeedback: unknown option "${optionId}"`);
  }

  await addDoc(collection(db, feedbackEventsPath(uid)), {
    claimId: claim.id,
    familyId,
    optionId,
    entryId,
    createdAt: nowIso,
  });
}

export default { FEEDBACK_OPTIONS, recordClaimFeedback };

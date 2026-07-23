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
 *   do_not_analyze -> setClaimStatus('suppressed') AND recordFeedbackAndLearn.
 *                     Suppressing THIS specific claim is setClaimStatus's
 *                     job (it flips the claim doc's own status, done
 *                     unconditionally above regardless of what
 *                     recordFeedbackAndLearn does). The recordFeedbackAndLearn
 *                     call alongside it accumulates an 'inaccurate' data
 *                     point against this candidate's stable patternType
 *                     (see the routing note below) — enough repeated
 *                     'inaccurate' feedback for that patternType can ALSO
 *                     trip the legacy basicInsights engine's own
 *                     accuracy-threshold suppression for its equivalent
 *                     pattern, since the two share one learning doc by
 *                     design. That is a side effect of accumulation, not a
 *                     dedicated suppression flag — there never was one:
 *                     `suppressTopic` was a field nothing downstream read.
 *
 * Every option, including the two that only ever write one thing, ALSO
 * appends a raw structured event to the `insightFeedback` collection — the
 * durable audit trail the DR requires ("record a structured reason for
 * every correction"). This happens after the routed consumer call(s)
 * succeed, but is itself best-effort: an audit-write failure is logged and
 * swallowed rather than rejecting the whole call, so a Firestore hiccup on
 * the audit trail can never undo (or appear to undo) a consumer action that
 * already committed. See `recordClaimFeedback`'s own comment for why.
 *
 * Patternized-learning routing (Finding 1, R4 Phase 1 Task 9 review): the
 * `feedback` shape handed to `recordFeedbackAndLearn` must resolve to a
 * `patternType` that is STABLE across a claim's supersede chain — claim ids
 * change every time a claim is superseded (see `claimSchema.js#claimDocId`),
 * so keying learning off `claim.id` (via `insightId`) would silently reset
 * accuracy/suppression accumulation on every regeneration. Instead the
 * candidate's OWN identity — `analysisPlan.candidateId`, which does NOT
 * change across supersedes for the same candidate — drives it:
 *   candidateId 'tag:X'      -> activityKey: X  (patternType 'activity_X',
 *                                the same convention the legacy activity
 *                                engine already uses — intentionally shared,
 *                                so claim feedback and legacy feedback about
 *                                the same tag accumulate in ONE learning doc)
 *   candidateId 'entity:X'   -> peopleKey: X     (patternType 'people_X')
 *   candidateId 'health:F' /
 *   candidateId 'category:C' -> no activityKey/themeKey/peopleKey; `category`
 *                                is set to the stable string
 *                                `claim_<kind>_<rest>` (e.g.
 *                                'claim_health_sleepHours'), so
 *                                `recordFeedbackAndLearn`'s
 *                                activityKey->themeKey->peopleKey->insightId
 *                                ->category fallback chain lands on this
 *                                stable string rather than a per-claim id.
 * No shape built here ever sets `insightId` — the claim's id is carried
 * instead in `claimId`, a field `recordFeedbackAndLearn` doesn't read (audit
 * richness only; confirmed by reading that function before this change:
 * `insightId` there is destructured for exactly one purpose, the
 * patternType fallback, so dropping it has no other effect).
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
 * Stable patternType routing fields, derived from `analysisPlan.candidateId`
 * (NOT `claim.id`, which is ephemeral across supersedes — see this module's
 * header comment, Finding 1). candidateId is colon-delimited `<kind>:<rest>`
 * (`enumerateExposures` in `observations.js` is the source of this shape:
 * `tag:X`, `entity:X`, `category:X`, `health:field`); `rest` is everything
 * after the first colon (rejoined, in case it itself contains one).
 *
 * @param {string} candidateId
 * @returns {{activityKey: string}|{peopleKey: string}|{category: string}}
 */
function patternRoutingFor(candidateId) {
  const [kind, ...restParts] = String(candidateId).split(':');
  const rest = restParts.join(':');
  if (kind === 'tag') return { activityKey: rest };
  if (kind === 'entity') return { peopleKey: rest };
  // health / category (and any future kind not yet enumerated): no
  // activityKey/themeKey/peopleKey to key off, so hand recordFeedbackAndLearn
  // a stable category string instead of falling through to insightId (which
  // this module never sets — see header comment).
  return { category: `claim_${kind}_${rest}` };
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
 * brief, step 2), built from the claim's own evidence. `claimId` (not
 * `insightId`) carries the claim's id — audit richness only, see header
 * comment for why `insightId` is never set here.
 *
 * @param {object} claim
 * @param {'accurate'|'inaccurate'} feedback
 * @param {object} [extra] - additional keys merged in
 */
function claimFeedbackShape(claim, feedback, extra = {}) {
  return {
    claimId: claim.id,
    ...patternRoutingFor(claim.analysisPlan.candidateId),
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
        uid, claimFeedbackShape(claim, 'inaccurate'), citedEntries, entriesCount,
      );
      break;

    default:
      // Unreachable: VALID_OPTION_IDS check above already threw.
      throw new Error(`recordClaimFeedback: unknown option "${optionId}"`);
  }

  // Best-effort audit write (Finding 2, R4 Phase 1 Task 9 review): the
  // consumer call(s) above have already committed by this point, so an
  // addDoc failure here must NOT reject the whole call — doing so would
  // leave the consumer's effect standing while reporting failure to the
  // caller, and (per the retry pattern that would follow from an apparent
  // failure) risks calling the consumer a second time for one user action.
  // Losing the audit row on a Firestore hiccup is an acceptable trade-off
  // the DR's "record a structured reason for every correction" requirement
  // doesn't extend to guaranteeing on write failure; a console.warn keeps it
  // visible without escalating to a user-facing error for what is, from the
  // user's perspective, a successfully-recorded correction.
  try {
    await addDoc(collection(db, feedbackEventsPath(uid)), {
      claimId: claim.id,
      familyId,
      optionId,
      entryId,
      createdAt: nowIso,
    });
  } catch (error) {
    console.warn(
      `[claimFeedback] audit event write failed for claimId=${claim.id} optionId=${optionId}:`,
      error,
    );
  }
}

export default { FEEDBACK_OPTIONS, recordClaimFeedback };

/**
 * Server-authoritative AI-processing consent gate.
 *
 * Consent is stored in the authoritative doc
 *   artifacts/{APP_COLLECTION_ID}/users/{uid}/settings/consent
 * as `{ aiProcessing: boolean, ... }`. This module is the ONLY place that
 * decides whether AI processing is permitted for a user. It fails CLOSED:
 * if consent cannot be read, AI processing is denied.
 *
 * Never log journal text/transcripts here — only ids and structured status.
 */
import { HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { APP_COLLECTION_ID } from '../shared/constants.js';

const CONSENT_POLICY_VERSION = 1;
const PENDING_CANCEL_BATCH = 400;

function consentRef(db, uid) {
  return db.doc(`artifacts/${APP_COLLECTION_ID}/users/${uid}/settings/consent`);
}

/**
 * Read the raw authoritative consent doc.
 * @returns {Promise<object|null>} the doc data, or null if it does not exist.
 *   Throws if the underlying Firestore read fails (callers must fail closed).
 */
export async function readConsent(db, uid) {
  const snap = await consentRef(db, uid).get();
  return snap.exists ? snap.data() : null;
}

/**
 * Assert that AI processing is permitted for `uid`. For callable contexts.
 *
 * @param {object} db - Firestore instance.
 * @param {string} uid - Authenticated user id.
 * @param {object} [opts]
 * @param {object} [opts.entrySnapshot] - Optional entry data, used only as a
 *   legacy fallback when no authoritative consent doc exists yet.
 * @returns {Promise<{allowed:true, source:'settings'|'legacy-default'|'entry-snapshot', checkedAt:string}>}
 * @throws {HttpsError} 'failed-precondition' ('ai-consent-revoked') when denied,
 *   or 'unavailable' ('ai-consent-check-failed') when consent cannot be read.
 */
export async function assertAiConsent(db, uid, { entrySnapshot } = {}) {
  if (!uid || typeof uid !== 'string') {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  let data;
  try {
    data = await readConsent(db, uid);
  } catch (err) {
    // Fail closed: an unreadable consent record must block AI processing.
    throw new HttpsError('unavailable', 'ai-consent-check-failed');
  }

  const checkedAt = new Date().toISOString();

  // Authoritative settings doc wins.
  if (data && data.aiProcessing === false) {
    throw new HttpsError('failed-precondition', 'ai-consent-revoked');
  }
  if (data && data.aiProcessing === true) {
    return { allowed: true, source: 'settings', checkedAt };
  }

  // No authoritative doc yet — honour a legacy per-entry opt-out if provided,
  // otherwise default to allowed (pre-consent-doc behaviour).
  if (entrySnapshot && entrySnapshot.aiProcessingConsent === false) {
    throw new HttpsError('failed-precondition', 'ai-consent-revoked');
  }
  return { allowed: true, source: 'legacy-default', checkedAt };
}

/**
 * Boolean consent check for trigger/scheduled (non-callable) contexts.
 * Never throws; a read error or a denial both resolve to `false` (fail closed).
 */
export async function isAiAllowed(db, uid, { entrySnapshot } = {}) {
  try {
    const result = await assertAiConsent(db, uid, { entrySnapshot });
    return result.allowed === true;
  } catch (err) {
    return false;
  }
}

/**
 * Grant AI processing consent (authoritative doc write).
 */
export async function grantConsent(db, uid) {
  await consentRef(db, uid).set(
    {
      aiProcessing: true,
      grantedAt: FieldValue.serverTimestamp(),
      policyVersion: CONSENT_POLICY_VERSION,
    },
    { merge: true }
  );
  return { granted: true };
}

/**
 * Revoke AI processing consent and cancel queued work.
 *
 * Writes the authoritative doc and flips every entry still in
 * `analysisStatus == 'pending'` to `'disabled'` in batches of <=400 so no
 * server-side AI job picks them up afterwards.
 * @returns {Promise<{cancelled:number}>} number of queued entries cancelled.
 */
export async function revokeConsent(db, uid) {
  await consentRef(db, uid).set(
    {
      aiProcessing: false,
      revokedAt: FieldValue.serverTimestamp(),
      policyVersion: CONSENT_POLICY_VERSION,
    },
    { merge: true }
  );

  const entriesRef = db.collection(
    `artifacts/${APP_COLLECTION_ID}/users/${uid}/entries`
  );

  let cancelled = 0;
  // Once flipped to 'disabled' the docs no longer match the pending filter, so
  // re-querying from the top each pass terminates without a cursor.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const snap = await entriesRef
      .where('analysisStatus', '==', 'pending')
      .limit(PENDING_CANCEL_BATCH)
      .get();

    if (snap.empty) break;

    const batch = db.batch();
    snap.docs.forEach((d) => batch.update(d.ref, { analysisStatus: 'disabled' }));
    await batch.commit();

    cancelled += snap.size;
    if (snap.size < PENDING_CANCEL_BATCH) break;
  }

  return { cancelled };
}

export default {
  readConsent,
  assertAiConsent,
  isAiAllowed,
  grantConsent,
  revokeConsent,
};

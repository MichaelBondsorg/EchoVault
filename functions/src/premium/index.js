/**
 * Server-Side Premium Entitlement Check
 *
 * Same logic as client-side but uses firebase-admin for Firestore access.
 * Called by Cloud Functions that need to gate premium features.
 */

import { getFirestore } from 'firebase-admin/firestore';
import { APP_COLLECTION_ID } from '../shared/constants.js';
import { isKnownFeature, requiresPremium } from './features.js';

/**
 * Check if a user has active premium subscription.
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
export async function isPremium(userId) {
  if (!userId || typeof userId !== 'string') return false;
  try {
    const db = getFirestore();
    const subscriptionRef = db.doc(
      `artifacts/${APP_COLLECTION_ID}/users/${userId}/settings/subscription`
    );

    const snap = await subscriptionRef.get();
    if (!snap.exists) return false;

    const { status, expiresAt } = snap.data();

    if (status === 'active' || status === 'trialing') {
      if (expiresAt) {
        const expiryDate = expiresAt.toDate ? expiresAt.toDate() : new Date(expiresAt);
        return expiryDate > new Date();
      }
      return true;
    }

    if (status === 'cancelled' && expiresAt) {
      const expiryDate = expiresAt.toDate ? expiresAt.toDate() : new Date(expiresAt);
      return expiryDate > new Date();
    }

    return false;
  } catch (e) {
    console.error('[premium] Server-side premium check failed:', e);
    return false;
  }
}

/**
 * Check if a user is entitled to a specific feature (server-side).
 * @param {string} userId
 * @param {string} featureKey
 * @returns {Promise<{ entitled: boolean, reason: string }>}
 */
export async function checkEntitlement(userId, featureKey) {
  if (!isKnownFeature(featureKey)) {
    return { entitled: false, reason: 'unknown_feature' };
  }

  if (!requiresPremium(featureKey)) {
    return { entitled: true, reason: 'free_feature' };
  }

  const premium = await isPremium(userId);
  if (premium) {
    return { entitled: true, reason: 'premium_active' };
  }

  return { entitled: false, reason: 'premium_required' };
}

export { isKnownFeature, requiresPremium, PREMIUM_FEATURES } from './features.js';

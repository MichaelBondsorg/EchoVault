/**
 * Premium Entitlement Service
 *
 * Central service for checking user premium status and feature entitlements.
 * Reads from Firestore: artifacts/echo-vault-v5-fresh/users/{userId}/settings/subscription
 *
 * Subscription document expected shape:
 * {
 *   status: 'active' | 'trialing' | 'expired' | 'cancelled',
 *   plan: 'monthly' | 'annual',
 *   expiresAt: Timestamp | null,
 *   subscribedAt: Timestamp,
 *   platform: 'ios' | 'android' | 'web'
 * }
 *
 * Fail-closed: any error returns false/not-entitled.
 */

import { isKnownFeature, requiresPremium } from './features';

/**
 * Derive premium status from subscription data (pure function, no Firestore).
 * @param {Object|null} sub - Subscription document data
 * @returns {boolean}
 */
export function derivePremiumFromSubscription(sub) {
  if (!sub) return false;

  const { status, expiresAt } = sub;

  // Active or trialing are premium
  if (status === 'active' || status === 'trialing') {
    if (expiresAt) {
      const expiryDate = expiresAt.toDate ? expiresAt.toDate() : new Date(expiresAt);
      return expiryDate > new Date();
    }
    return true; // No expiry = indefinite
  }

  // Cancelled but not yet expired
  if (status === 'cancelled' && expiresAt) {
    const expiryDate = expiresAt.toDate ? expiresAt.toDate() : new Date(expiresAt);
    return expiryDate > new Date();
  }

  return false;
}

/**
 * Check if a user has active premium subscription.
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
export async function isPremium(userId) {
  if (!userId || typeof userId !== 'string') return false;
  try {
    const sub = await getSubscription(userId);
    return derivePremiumFromSubscription(sub);
  } catch (e) {
    console.error('[premium] Error checking premium status:', e);
    return false;
  }
}

/**
 * Check if a user is entitled to a specific feature.
 * @param {string} userId
 * @param {string} featureKey - e.g., 'reports.monthly', 'voice.insights'
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

/**
 * Get raw subscription data for a user.
 * @param {string} userId
 * @returns {Promise<Object|null>}
 */
export async function getSubscription(userId) {
  if (!userId || typeof userId !== 'string') return null;
  try {
    const { doc, getDoc } = await import('firebase/firestore');
    const { db } = await import('../../config/firebase');
    const { APP_COLLECTION_ID } = await import('../../config/constants');

    const subscriptionRef = doc(
      db,
      'artifacts',
      APP_COLLECTION_ID,
      'users',
      userId,
      'settings',
      'subscription'
    );

    const snap = await getDoc(subscriptionRef);
    if (!snap.exists()) return null;
    return snap.data();
  } catch (e) {
    console.error('[premium] Error fetching subscription:', e);
    return null;
  }
}

// Re-export feature utilities
export { PREMIUM_FEATURES, isKnownFeature, requiresPremium } from './features';

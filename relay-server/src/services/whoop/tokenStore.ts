/**
 * Whoop Token Store
 * Handles encrypted storage and retrieval of Whoop OAuth tokens in Firestore
 * Uses AES-256-GCM encryption for refresh tokens
 */

import crypto from 'crypto';
import { firestore, APP_COLLECTION_ID } from '../../auth/firebase.js';
import { config } from '../../config/index.js';

export interface WhoopTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scopes: string[];
  linkedAt: Date;
  whoopUserId?: string;
}

interface StoredTokens {
  access_token: string;
  refresh_token_encrypted: string;
  refresh_token_iv: string;
  refresh_token_tag: string;
  expires_at: FirebaseFirestore.Timestamp;
  scopes: string[];
  linked_at: FirebaseFirestore.Timestamp;
  whoop_user_id?: string;
}

const ALGORITHM = 'aes-256-gcm';

/**
 * Get encryption key from config (base64 encoded 32-byte key)
 */
const getEncryptionKey = (): Buffer => {
  const key = config.whoopTokenEncryptionKey;
  if (!key) {
    throw new Error('WHOOP_TOKEN_ENCRYPTION_KEY not configured');
  }
  return Buffer.from(key, 'base64');
};

/**
 * Encrypt a string using AES-256-GCM
 */
const encrypt = (text: string): { encrypted: string; iv: string; tag: string } => {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  const tag = cipher.getAuthTag();

  return {
    encrypted,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
};

/**
 * Decrypt a string using AES-256-GCM
 */
const decrypt = (encrypted: string, iv: string, tag: string): string => {
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(iv, 'base64')
  );

  decipher.setAuthTag(Buffer.from(tag, 'base64'));

  let decrypted = decipher.update(encrypted, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
};

/**
 * Get the Firestore document reference for a user's Whoop integration
 */
const getTokenDocRef = (userId: string) => {
  return firestore
    .collection('artifacts')
    .doc(APP_COLLECTION_ID)
    .collection('users')
    .doc(userId)
    .collection('integrations')
    .doc('whoop');
};

/**
 * Store Whoop tokens for a user
 */
export const storeTokens = async (
  userId: string,
  tokens: WhoopTokens
): Promise<void> => {
  const docRef = getTokenDocRef(userId);

  // Encrypt the refresh token
  const { encrypted, iv, tag } = encrypt(tokens.refreshToken);

  const storedData: StoredTokens = {
    access_token: tokens.accessToken,
    refresh_token_encrypted: encrypted,
    refresh_token_iv: iv,
    refresh_token_tag: tag,
    expires_at: firestore.Timestamp.fromDate(tokens.expiresAt),
    scopes: tokens.scopes,
    linked_at: firestore.Timestamp.fromDate(tokens.linkedAt),
    whoop_user_id: tokens.whoopUserId,
  };

  await docRef.set(storedData);

  // Also update the user's profile to indicate Whoop is linked
  const userDocRef = firestore
    .collection('artifacts')
    .doc(APP_COLLECTION_ID)
    .collection('users')
    .doc(userId);

  await userDocRef.set(
    { hasWhoopLinked: true, whoopLinkedAt: storedData.linked_at },
    { merge: true }
  );
};

/**
 * Get Whoop tokens for a user
 * Returns null if no tokens are stored
 */
export const getTokens = async (userId: string): Promise<WhoopTokens | null> => {
  const docRef = getTokenDocRef(userId);
  const doc = await docRef.get();

  if (!doc.exists) {
    return null;
  }

  const data = doc.data() as StoredTokens;

  // Decrypt the refresh token
  const refreshToken = decrypt(
    data.refresh_token_encrypted,
    data.refresh_token_iv,
    data.refresh_token_tag
  );

  return {
    accessToken: data.access_token,
    refreshToken,
    expiresAt: data.expires_at.toDate(),
    scopes: data.scopes,
    linkedAt: data.linked_at.toDate(),
    whoopUserId: data.whoop_user_id,
  };
};

/**
 * Update access token after a refresh
 */
export const updateAccessToken = async (
  userId: string,
  newAccessToken: string,
  newExpiresAt: Date,
  newRefreshToken?: string
): Promise<void> => {
  const docRef = getTokenDocRef(userId);

  const updateData: Partial<StoredTokens> = {
    access_token: newAccessToken,
    expires_at: firestore.Timestamp.fromDate(newExpiresAt),
  };

  // If a new refresh token is provided, encrypt and store it
  if (newRefreshToken) {
    const { encrypted, iv, tag } = encrypt(newRefreshToken);
    updateData.refresh_token_encrypted = encrypted;
    updateData.refresh_token_iv = iv;
    updateData.refresh_token_tag = tag;
  }

  await docRef.update(updateData);
};

/**
 * Delete Whoop tokens for a user (disconnect)
 */
export const deleteTokens = async (userId: string): Promise<void> => {
  const docRef = getTokenDocRef(userId);
  await docRef.delete();

  // Update the user's profile to indicate Whoop is no longer linked
  const userDocRef = firestore
    .collection('artifacts')
    .doc(APP_COLLECTION_ID)
    .collection('users')
    .doc(userId);

  await userDocRef.set(
    { hasWhoopLinked: false, whoopLinkedAt: null },
    { merge: true }
  );
};

/**
 * Check if a user has Whoop linked
 */
export const hasWhoopLinked = async (userId: string): Promise<boolean> => {
  const docRef = getTokenDocRef(userId);
  const doc = await docRef.get();
  return doc.exists;
};

/**
 * Check if tokens are expired (with 5-minute buffer)
 */
export const isTokenExpired = (expiresAt: Date): boolean => {
  const bufferMs = 5 * 60 * 1000; // 5 minutes
  return new Date().getTime() >= expiresAt.getTime() - bufferMs;
};

/**
 * Whoop OAuth `state` signing.
 *
 * SECURITY: the OAuth callback is unauthenticated (it's a browser redirect), so
 * it must not trust a `userId` carried in an unsigned state blob — an attacker
 * could craft a state for any victim UID and link their own Whoop account to it
 * (CSRF account-injection). We HMAC-sign the state and verify it in the
 * callback, so only states minted by this server are accepted.
 *
 * The HMAC key is derived from the already-provisioned WHOOP_TOKEN_ENCRYPTION_KEY
 * (domain-separated with a label) so no new secret needs provisioning.
 */

import crypto from 'crypto';
import { config } from '../../config/index.js';

const STATE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface StatePayload {
  userId: string;
  timestamp: number;
}

function getStateHmacKey(): Buffer {
  const base = config.whoopTokenEncryptionKey;
  if (!base) {
    throw new Error('WHOOP_TOKEN_ENCRYPTION_KEY not configured');
  }
  // Domain-separate the HMAC key from the AES encryption key.
  return crypto.createHash('sha256').update(`${base}:whoop-oauth-state`).digest();
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function computeSignature(payloadB64: string): string {
  return b64url(crypto.createHmac('sha256', getStateHmacKey()).update(payloadB64).digest());
}

/**
 * Create a signed state string binding the given userId.
 */
export function signState(userId: string): string {
  const payload: StatePayload = { userId, timestamp: Date.now() };
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = computeSignature(payloadB64);
  return `${payloadB64}.${sig}`;
}

/**
 * Verify a signed state string. Returns the payload if the signature is valid
 * and not expired, otherwise null. Never throws on malformed input.
 */
export function verifyState(state: string): StatePayload | null {
  if (typeof state !== 'string' || !state.includes('.')) return null;

  const [payloadB64, sig] = state.split('.');
  if (!payloadB64 || !sig) return null;

  const expectedSig = computeSignature(payloadB64);

  // Constant-time comparison over equal-length base64url signatures.
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  let payload: StatePayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch {
    return null;
  }

  if (!payload || typeof payload.userId !== 'string' || typeof payload.timestamp !== 'number') {
    return null;
  }

  if (Date.now() - payload.timestamp > STATE_TTL_MS) {
    return null;
  }

  return payload;
}

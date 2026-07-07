/**
 * Apple "Sign in with Apple" identity-token verification.
 *
 * SECURITY: Apple identity tokens are JWTs signed by Apple with RS256. They
 * MUST be cryptographically verified against Apple's published public keys
 * (JWKS) before any claim (sub/email/aud) is trusted. Decoding the payload and
 * checking iss/aud/exp WITHOUT verifying the signature lets an attacker forge a
 * token for any user and mint a Firebase session — full account takeover.
 *
 * Apple has no server-side tokeninfo endpoint (unlike Google), so verification
 * is done locally with the JWKS at https://appleid.apple.com/auth/keys.
 */

import { createRemoteJWKSet, jwtVerify } from 'jose';

const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_JWKS_URL = new URL('https://appleid.apple.com/auth/keys');

// createRemoteJWKSet caches keys in-memory and refreshes on unknown `kid`,
// so this is created once per instance and reused across invocations.
let jwks = null;
function getJwks() {
  if (!jwks) {
    jwks = createRemoteJWKSet(APPLE_JWKS_URL);
  }
  return jwks;
}

/**
 * Build the allowed audience list (app bundle ID + optional web service ID).
 * @param {string|undefined} appleServiceId process.env.APPLE_SERVICE_ID
 * @returns {string[]}
 */
export function getValidAudiences(appleServiceId) {
  return ['com.echovault.app', appleServiceId].filter(Boolean);
}

/**
 * Verify an Apple identity token and return its trusted claims.
 * Throws on any verification failure (bad signature, issuer, audience, expiry).
 *
 * @param {string} identityToken raw JWT from the client
 * @param {object} [opts]
 * @param {string} [opts.appleServiceId] optional web service ID audience
 * @param {*} [opts.keySet] injectable JWKS for testing
 * @returns {Promise<{sub: string, email?: string, emailVerified?: boolean}>}
 */
export async function verifyAppleIdentityToken(identityToken, opts = {}) {
  if (!identityToken || typeof identityToken !== 'string') {
    throw new Error('identityToken is required');
  }

  const audiences = getValidAudiences(opts.appleServiceId);
  const keySet = opts.keySet || getJwks();

  const { payload } = await jwtVerify(identityToken, keySet, {
    issuer: APPLE_ISSUER,
    audience: audiences,
  });

  if (!payload.sub) {
    throw new Error('Apple token missing sub claim');
  }

  return {
    sub: payload.sub,
    email: payload.email,
    // Apple sends email_verified as a boolean or the string "true".
    emailVerified: payload.email_verified === true || payload.email_verified === 'true',
  };
}

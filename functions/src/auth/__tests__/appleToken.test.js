// @vitest-environment node
// jose v6 uses the WebCrypto API; jsdom does not expose crypto.subtle, so this
// suite runs in the node environment where Node 20's WebCrypto is available.
import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPair, SignJWT, exportJWK } from 'jose';
import { verifyAppleIdentityToken, getValidAudiences } from '../appleToken.js';

const APPLE_ISSUER = 'https://appleid.apple.com';
const BUNDLE_ID = 'com.echovault.app';

// A local JWKS-like key resolver jose can consume in place of Apple's remote set.
let privateKey;
let localKeySet;

async function signToken(claims, { key = privateKey, expiresIn = '1h', alg = 'RS256' } = {}) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg, kid: 'test-key' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key);
}

beforeAll(async () => {
  const { publicKey, privateKey: priv } = await generateKeyPair('RS256');
  privateKey = priv;
  // jose accepts a KeyLike / async resolver; a function returning the public key works.
  localKeySet = async () => publicKey;
  // sanity: the JWK is exportable (ensures a real RSA key was produced)
  await exportJWK(publicKey);
});

describe('getValidAudiences', () => {
  it('always includes the iOS bundle id', () => {
    expect(getValidAudiences(undefined)).toEqual([BUNDLE_ID]);
  });
  it('includes the web service id when provided', () => {
    expect(getValidAudiences('service.web.id')).toEqual([BUNDLE_ID, 'service.web.id']);
  });
});

describe('verifyAppleIdentityToken', () => {
  it('accepts a properly signed token with correct issuer/audience', async () => {
    const token = await signToken({
      iss: APPLE_ISSUER,
      aud: BUNDLE_ID,
      sub: '000123.abc',
      email: 'user@example.com',
      email_verified: 'true',
    });
    const claims = await verifyAppleIdentityToken(token, { keySet: localKeySet });
    expect(claims.sub).toBe('000123.abc');
    expect(claims.email).toBe('user@example.com');
    expect(claims.emailVerified).toBe(true);
  });

  it('rejects a token signed by an attacker key (bad signature)', async () => {
    const { privateKey: attackerKey } = await generateKeyPair('RS256');
    const forged = await signToken(
      { iss: APPLE_ISSUER, aud: BUNDLE_ID, sub: 'victim.uid' },
      { key: attackerKey }
    );
    await expect(
      verifyAppleIdentityToken(forged, { keySet: localKeySet })
    ).rejects.toThrow();
  });

  it('rejects a token with the wrong audience', async () => {
    const token = await signToken({ iss: APPLE_ISSUER, aud: 'com.evil.app', sub: 'x' });
    await expect(
      verifyAppleIdentityToken(token, { keySet: localKeySet })
    ).rejects.toThrow();
  });

  it('rejects a token with the wrong issuer', async () => {
    const token = await signToken({ iss: 'https://evil.example', aud: BUNDLE_ID, sub: 'x' });
    await expect(
      verifyAppleIdentityToken(token, { keySet: localKeySet })
    ).rejects.toThrow();
  });

  it('rejects an expired token', async () => {
    const token = await signToken(
      { iss: APPLE_ISSUER, aud: BUNDLE_ID, sub: 'x' },
      { expiresIn: '-1h' }
    );
    await expect(
      verifyAppleIdentityToken(token, { keySet: localKeySet })
    ).rejects.toThrow();
  });

  it('accepts the web service id audience when configured', async () => {
    const token = await signToken({ iss: APPLE_ISSUER, aud: 'service.web.id', sub: 'w' });
    const claims = await verifyAppleIdentityToken(token, {
      keySet: localKeySet,
      appleServiceId: 'service.web.id',
    });
    expect(claims.sub).toBe('w');
  });

  it('throws on empty input', async () => {
    await expect(verifyAppleIdentityToken('', { keySet: localKeySet })).rejects.toThrow();
  });
});

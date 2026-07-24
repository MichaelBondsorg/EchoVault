import { describe, it, expect } from 'vitest';
import {
  STORAGE_REGISTRY,
  OWNER_SCOPE,
  SENSITIVITY,
  SIGN_OUT_BEHAVIOR,
  LEGACY_MIGRATION,
  getRegistryEntry,
  signOutRemovalKeysFor,
  highSensitivityUserKeys,
} from '../storageRegistry.js';

describe('storageRegistry.js (PRIV-01)', () => {
  it('every entry declares the full required shape — new sensitive keys cannot be added without an ownership declaration', () => {
    for (const entry of STORAGE_REGISTRY) {
      expect(entry.id, 'id').toBeTruthy();
      expect(Object.values(OWNER_SCOPE), `${entry.id}.ownerScope`).toContain(entry.ownerScope);
      expect(Object.values(SENSITIVITY), `${entry.id}.sensitivity`).toContain(entry.sensitivity);
      expect(Object.values(SIGN_OUT_BEHAVIOR), `${entry.id}.signOutBehavior`).toContain(entry.signOutBehavior);
      expect(Object.values(LEGACY_MIGRATION), `${entry.id}.legacyMigration`).toContain(entry.legacyMigration);
      expect(typeof entry.ownerKeyFor, `${entry.id}.ownerKeyFor`).toBe('function');
      expect(['remove-on-read', 'none'], `${entry.id}.expiryEnforcement`).toContain(entry.expiryEnforcement);
      // retentionMs must be a positive number or explicitly null — never
      // undefined (an unset retention should be a documented decision).
      expect(
        entry.retentionMs === null || (typeof entry.retentionMs === 'number' && entry.retentionMs > 0),
        `${entry.id}.retentionMs`
      ).toBe(true);
    }
  });

  it('ownerKeyFor produces a distinct key per uid (never a shared/global key)', () => {
    for (const entry of STORAGE_REGISTRY) {
      const args = Array.isArray(entry.categories) ? [entry.categories[0]] : [];
      const keyA = entry.ownerKeyFor('user-a', ...args);
      const keyB = entry.ownerKeyFor('user-b', ...args);
      expect(keyA, entry.id).not.toBe(keyB);
      expect(keyA, entry.id).toContain('user-a');
      expect(keyB, entry.id).toContain('user-b');
    }
  });

  it('getRegistryEntry finds a known id and throws on an unknown one', () => {
    expect(getRegistryEntry('voice.transcript').id).toBe('voice.transcript');
    expect(() => getRegistryEntry('not.a.real.entry')).toThrow();
  });

  it('signOutRemovalKeysFor returns nothing without a uid (never a device-wide wipe)', () => {
    expect(signOutRemovalKeysFor(undefined)).toEqual([]);
    expect(signOutRemovalKeysFor(null)).toEqual([]);
    expect(signOutRemovalKeysFor('')).toEqual([]);
  });

  it('signOutRemovalKeysFor includes every registered ownerScope:user + signOutBehavior:remove key, expanded per category where relevant', () => {
    const keys = signOutRemovalKeysFor('user-a');
    const ids = keys.map((k) => k.id);

    expect(ids).toContain('voice.transcript');
    expect(ids).toContain('memory.sessionBuffer');
    expect(ids).toContain('health.contextCache');
    expect(ids).toContain('environment.locationCache');
    // Retained (not swept at sign-out) — isolation comes from key scoping.
    expect(ids).not.toContain('prompts.dismissed');

    for (const { key } of keys) {
      expect(key).toContain('user-a');
    }
  });

  it('highSensitivityUserKeys is exactly the set the generated two-account contract test must cover', () => {
    const ids = highSensitivityUserKeys().map((e) => e.id).sort();
    expect(ids).toEqual([
      'environment.locationCache',
      'health.contextCache',
      'memory.sessionBuffer',
      'voice.transcript',
    ]);
  });
});

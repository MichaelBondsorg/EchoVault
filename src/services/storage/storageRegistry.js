/**
 * Storage Registry (PRIV-01)
 *
 * ONE typed inventory of every sensitive local-storage key in the app. Per
 * docs/superpowers/plans/2026-07-24-full-product-review.md's PRIV-01
 * ("account-scoped local storage + registry"), a new sensitive Preferences/
 * localStorage/sessionStorage key must be added HERE, with an explicit
 * ownership declaration, before it ships — this file (not tribal knowledge)
 * is the source of truth `clearOwnerCaches` and the generated two-account
 * contract test (`src/__tests__/validationMatrix.test.js`) both read from.
 *
 * Design precedent: docs/adr/0001-owner-scoped-local-data.md and the
 * WHOOP-cache pattern already shipped in `src/services/health/whoop.js`
 * (owner uid resolved from the live Firebase auth session — never cached at
 * module scope — Preferences keys suffixed `::${uid}`, unowned legacy
 * global keys quarantined/deleted the first time they're discovered, never
 * adopted by whichever account happens to be signed in). Every entry below
 * follows that same shape for its own backend.
 *
 * Fields:
 * - `id`            Stable identifier (dot-namespaced), used in test output.
 * - `module`         Where the real read/write logic lives (documentation
 *                     only — this registry does not re-implement storage
 *                     I/O; it describes it and, where useful, re-exposes the
 *                     owner-key function the real module already uses so
 *                     `clearOwnerCaches` and tests can address the exact
 *                     same key without duplicating the format).
 * - `backend`         'preferences' | 'localStorage' | 'sessionStorage+localStorage'
 * - `ownerScope`      'user' (must be uid-scoped) | 'device' (intentionally
 *                     shared) | 'anonymous' (intentionally unowned).
 * - `sensitivity`     'high' | 'medium' | 'low' — drives which keys the
 *                     generated two-account contract test exercises (every
 *                     ownerScope:'user' + sensitivity:'high' key gets a row).
 * - `retentionMs`     How long a value stays valid before it must be treated
 *                     as expired, or null if the key has no freshness window.
 * - `expiryEnforcement` 'remove-on-read' (an expired value is deleted, not
 *                     just ignored — the PRIV-01 acceptance requirement) or
 *                     'none'.
 * - `signOutBehavior` 'remove' (deleted at sign-out — either automatically,
 *                     because a Preferences key suffixed `::uid` is already
 *                     covered by clearOwnerCaches' generic sweep, or
 *                     explicitly via `ownerKeyFor` below for backends that
 *                     sweep doesn't reach) | 'retain' (owner-scoped but
 *                     intentionally left for the SAME owner's next session —
 *                     isolation from other accounts already comes from key
 *                     scoping, matching the ADR's reasoning for drafts/
 *                     consent/audio-vault; clearOwnerCaches deliberately
 *                     skips these).
 * - `legacyMigration` 'delete-on-access' (the pre-migration unowned global
 *                     key is deleted the first time any owner-scoped read
 *                     finds it — never claimed by whoever happens to be
 *                     signed in) | 'quarantine-at-startup' (deleted
 *                     unconditionally at app/module load, independent of any
 *                     particular read, because nothing has ever legitimately
 *                     written it) | 'none'.
 * - `ownerKeyFor`     `(uid, ...params) => key` — the exact key the real
 *                     module reads/writes, re-exposed for tooling.
 * - `legacyKeyFor`    `(...params) => key | key[]` — the pre-migration
 *                     unowned key(s), or undefined if there's a single
 *                     static `legacyKey`.
 */
import { ownerStorageKey } from './ownerScopedStorage';

export const OWNER_SCOPE = Object.freeze({
  USER: 'user',
  DEVICE: 'device',
  ANONYMOUS: 'anonymous',
});

export const SENSITIVITY = Object.freeze({ HIGH: 'high', MEDIUM: 'medium', LOW: 'low' });

export const SIGN_OUT_BEHAVIOR = Object.freeze({ REMOVE: 'remove', RETAIN: 'retain' });

export const LEGACY_MIGRATION = Object.freeze({
  DELETE_ON_ACCESS: 'delete-on-access',
  QUARANTINE_AT_STARTUP: 'quarantine-at-startup',
  NONE: 'none',
});

// Personalized prompt state is filed per journaling category — a closed,
// small set (see src/stores/uiStore.js's `category` default plus every
// category toggle in the app, e.g. EntryCard.jsx's work/personal switch).
// Enumerable, so clearOwnerCaches can address every prompt key by name
// exactly like it already does for the WHOOP keys, without needing generic
// key discovery on a backend (localStorage) that doesn't offer one in every
// test/runtime environment the way Preferences.keys() does.
export const PROMPT_CATEGORIES = Object.freeze(['personal', 'work']);

export const STORAGE_REGISTRY = Object.freeze([
  {
    id: 'health.contextCache',
    module: 'src/services/health/platformHealth.js',
    backend: 'preferences',
    ownerScope: OWNER_SCOPE.USER,
    sensitivity: SENSITIVITY.HIGH,
    retentionMs: 24 * 60 * 60 * 1000,
    expiryEnforcement: 'remove-on-read',
    // Removed at sign-out: a cached full health summary (sleep/HRV/steps/
    // workouts) must not linger past logout on a shared device. In practice
    // this also happens automatically via clearOwnerCaches' generic
    // Preferences `::uid` suffix sweep (same convention as WHOOP), since the
    // owner key below uses that format — `ownerKeyFor` is still listed
    // explicitly here so the registry stays the single source of truth
    // rather than relying on incidental string-matching.
    signOutBehavior: SIGN_OUT_BEHAVIOR.REMOVE,
    legacyMigration: LEGACY_MIGRATION.DELETE_ON_ACCESS,
    legacyKey: 'health_context_cache',
    ownerKeyFor: (uid) => `health_context_cache::${uid}`,
    description: 'Cached health summary (sleep/HRV/steps/workouts) for web fallback access.',
  },
  {
    id: 'health.permissionStatus',
    module: 'src/services/health/platformHealth.js',
    backend: 'preferences',
    ownerScope: OWNER_SCOPE.USER,
    sensitivity: SENSITIVITY.LOW,
    retentionMs: null,
    expiryEnforcement: 'none',
    signOutBehavior: SIGN_OUT_BEHAVIOR.REMOVE,
    legacyMigration: LEGACY_MIGRATION.DELETE_ON_ACCESS,
    legacyKey: 'health_permission_status',
    ownerKeyFor: (uid) => `health_permission_status::${uid}`,
    description: 'Cached HealthKit/Google Fit permission grant status.',
  },
  {
    id: 'environment.locationCache',
    module: 'src/services/environment/environmentService.js',
    backend: 'preferences',
    ownerScope: OWNER_SCOPE.USER,
    sensitivity: SENSITIVITY.HIGH,
    // Matches the reader's actual current threshold. PRIV-02 separately
    // tracks the mismatch between this and the (unused, doc-only)
    // CACHE_DURATION_MS constant in environmentService.js — not this
    // ticket's fix.
    retentionMs: 24 * 60 * 60 * 1000,
    expiryEnforcement: 'remove-on-read',
    signOutBehavior: SIGN_OUT_BEHAVIOR.REMOVE,
    legacyMigration: LEGACY_MIGRATION.DELETE_ON_ACCESS,
    legacyKey: 'env_location_cache',
    ownerKeyFor: (uid) => `env_location_cache::${uid}`,
    description: 'Cached last-known coarse location (lat/lng/accuracy/timestamp).',
  },
  {
    id: 'voice.transcript',
    module: 'src/hooks/useVoiceRelay.js',
    backend: 'localStorage',
    ownerScope: OWNER_SCOPE.USER,
    sensitivity: SENSITIVITY.HIGH,
    retentionMs: 30 * 60 * 1000,
    expiryEnforcement: 'remove-on-read',
    // Explicit removal is required here (unlike the Preferences-backed rows
    // above): clearOwnerCaches' generic sweep only walks Preferences.keys(),
    // never localStorage, so a 'remove' localStorage row must be listed
    // explicitly for clearOwnerCaches to reach it — see clearOwnerCaches.js.
    signOutBehavior: SIGN_OUT_BEHAVIOR.REMOVE,
    // 'delete-on-access' here is best-effort: this key used to be
    // `voice_transcript_${sessionId}` (unowned, one per session). The
    // CURRENT session's legacy key is deleted opportunistically the moment
    // the owner-scoped key is written (see useVoiceRelay.js) — any OLDER
    // per-session legacy key from before this migration shipped is simply
    // orphaned (its sessionId will never match a live session again, so
    // nothing ever reads or adopts it) rather than swept by name, since the
    // per-session id makes it unenumerable without a localStorage key-listing
    // API this app doesn't rely on elsewhere.
    legacyMigration: LEGACY_MIGRATION.DELETE_ON_ACCESS,
    legacyKeyForSession: (sessionId) => `voice_transcript_${sessionId}`,
    ownerKeyFor: (uid) => ownerStorageKey(uid, 'voice/transcript'),
    description: 'In-progress voice session transcript, kept only for reconnect-after-drop recovery.',
  },
  {
    id: 'prompts.dismissed',
    module: 'src/services/prompts/activePrompts.js',
    backend: 'localStorage',
    ownerScope: OWNER_SCOPE.USER,
    sensitivity: SENSITIVITY.MEDIUM,
    retentionMs: null,
    expiryEnforcement: 'none',
    // Retained across sign-out: this is a durable "don't show me this again"
    // preference for the SAME returning owner, the same category as
    // consent/accent/audio-vault in the ADR — isolation from a DIFFERENT
    // account comes entirely from the owner-scoped key, not from wiping it
    // at logout.
    signOutBehavior: SIGN_OUT_BEHAVIOR.RETAIN,
    legacyMigration: LEGACY_MIGRATION.DELETE_ON_ACCESS,
    categories: PROMPT_CATEGORIES,
    legacyKeyForCategory: (category) => `reflections_dismissed_${category}`,
    ownerKeyFor: (uid, category) => ownerStorageKey(uid, `prompts/dismissed/${category}`),
    description: 'Dismissed reflection-prompt questions, filed per journaling category.',
  },
  {
    id: 'memory.sessionBuffer',
    module: 'src/services/memory/sessionBuffer.js',
    backend: 'sessionStorage+localStorage',
    ownerScope: OWNER_SCOPE.USER,
    sensitivity: SENSITIVITY.HIGH,
    retentionMs: 5 * 60 * 1000,
    expiryEnforcement: 'remove-on-read',
    signOutBehavior: SIGN_OUT_BEHAVIOR.REMOVE,
    // No 'delete-on-access' here: the legacy global key was never a real
    // per-owner value in the first place (no production write call was ever
    // found writing it — see the module's own header comment), so there is
    // nothing to migrate away from access-by-access. It is quarantined
    // (deleted) unconditionally, once, at module load / login instead — see
    // `quarantineLegacySessionBuffer` in sessionBuffer.js.
    legacyMigration: LEGACY_MIGRATION.QUARANTINE_AT_STARTUP,
    legacyKey: 'engram_session_buffer',
    ownerKeyFor: (uid) => ownerStorageKey(uid, 'session/buffer'),
    description: 'Volatile "just journaled" entry text/analysis bridging the sync gap into chat context.',
  },
]);

/** Look up one registry entry by id. Throws on an unknown id (typo guard). */
export function getRegistryEntry(id) {
  const entry = STORAGE_REGISTRY.find((e) => e.id === id);
  if (!entry) throw new Error(`storageRegistry: unknown entry id "${id}"`);
  return entry;
}

/**
 * Every registry row that must be actively removed at sign-out for the
 * given owner, expanded to concrete {backend, key} pairs (categories/
 * sessions collapse to their static owner key list). Used by
 * clearOwnerCaches so the registry — not a second hand-maintained list — is
 * the source of truth for what logout deletes.
 */
export function signOutRemovalKeysFor(uid) {
  if (!uid) return [];
  const out = [];
  for (const entry of STORAGE_REGISTRY) {
    if (entry.ownerScope !== OWNER_SCOPE.USER) continue;
    if (entry.signOutBehavior !== SIGN_OUT_BEHAVIOR.REMOVE) continue;

    if (Array.isArray(entry.categories)) {
      for (const category of entry.categories) {
        out.push({ id: entry.id, backend: entry.backend, key: entry.ownerKeyFor(uid, category) });
      }
    } else {
      out.push({ id: entry.id, backend: entry.backend, key: entry.ownerKeyFor(uid) });
    }
  }
  return out;
}

/** Every registered key this ticket's two-account contract test must cover. */
export function highSensitivityUserKeys() {
  return STORAGE_REGISTRY.filter(
    (e) => e.ownerScope === OWNER_SCOPE.USER && e.sensitivity === SENSITIVITY.HIGH
  );
}

export default {
  STORAGE_REGISTRY,
  OWNER_SCOPE,
  SENSITIVITY,
  SIGN_OUT_BEHAVIOR,
  LEGACY_MIGRATION,
  PROMPT_CATEGORIES,
  getRegistryEntry,
  signOutRemovalKeysFor,
  highSensitivityUserKeys,
};

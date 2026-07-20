/**
 * Server-side feature-flag reads.
 *
 * Reads the same top-level `config/flags` doc the client reads (see
 * src/config/flags.js), cached in-process for 60s so a hot callable path
 * doesn't hit Firestore on every invocation. Never throws: a read failure
 * (or a missing doc/field) resolves to the caller-supplied `defaultValue`.
 */

const CACHE_TTL_MS = 60_000;

// Module-level cache: a single entry keyed by the doc path, holding the
// fetched field map plus the time it expires.
const cache = new Map();
const CACHE_KEY = 'config/flags';

async function readFlagsDoc(db) {
  const cached = cache.get(CACHE_KEY);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.data;
  }

  const snap = await db.doc('config/flags').get();
  const data = snap.exists ? snap.data() || {} : {};
  cache.set(CACHE_KEY, { data, expiresAt: now + CACHE_TTL_MS });
  return data;
}

/**
 * Read a single flag field from `config/flags`.
 * @param {object} db - Firestore instance (admin SDK).
 * @param {string} name - Flag field name.
 * @param {*} defaultValue - Returned when the field/doc is missing, or the
 *   underlying Firestore read fails.
 */
export async function getServerFlag(db, name, defaultValue) {
  try {
    const data = await readFlagsDoc(db);
    return data && Object.prototype.hasOwnProperty.call(data, name)
      ? data[name]
      : defaultValue;
  } catch (error) {
    console.warn('[flags] getServerFlag read failed, using default', {
      name,
      err: error?.message,
    });
    return defaultValue;
  }
}

/** Test-only: clear the module-level cache so the next read hits Firestore. */
export function _clearFlagCacheForTest() {
  cache.clear();
}

export default { getServerFlag, _clearFlagCacheForTest };

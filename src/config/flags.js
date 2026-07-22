/**
 * Client feature-flag service — Firestore-backed with a localStorage dev
 * override.
 *
 * Flags live in a single top-level doc `config/flags` (see firestore.rules:
 * authenticated read-only for that one doc, all client writes denied — only
 * the Admin SDK/console can change flag values). `initFlags` reads it once
 * at app startup and caches the merged result in module state; `getFlag` is
 * a synchronous read after that so call sites never need to await it
 * inline.
 *
 * Flag reads must never block first paint: `initFlags` is fired
 * fire-and-forget from app startup (see App.jsx), and `getFlag` called
 * before it resolves simply falls back to the localStorage override or the
 * hardcoded defaults below.
 */
import { doc, getDoc } from './firebase';

export const FLAG_DEFAULTS = {
  coreFirstSave: true,             // WS-C: core-first save validated by tests; server flag doc can force off in prod
  serverAnalysisOrchestrator: false,
  nativeBackgroundUpload: false,
  webChunkPersistence: true,       // additive durability, safe default-on
  intentExtraction: false,
  'model.gemini35flash': false,
  'model.embeddingV2Read': false,
  'model.fusedTranscription35': false,
  openLoops: false,
  contextSpaces: false,
  insightBudget: false,
  insightReceipts: false,
  voiceChapters: false,
  reflectionRecipes: false,
  sessionPrep: false,
  gentleRevisit: false,
  personalExperiments: false,   // R3 Personal Experiments: gated on Michael signing docs/quality/experiments-data-method.md
};

const LOCAL_OVERRIDE_PREFIX = 'engram:flag:';

// null until initFlags resolves (success or failure), then always a full
// {...FLAG_DEFAULTS, ...remote} object.
let fetchedFlags = null;
let initPromise = null;
let loggedInitFailure = false;

/**
 * Fetch `config/flags` once and cache the result merged over the defaults.
 * Never throws: a read failure logs a warning and falls back to defaults.
 * Safe to call multiple times/concurrently — only one `getDoc` is in
 * flight at a time. A *successful* fetch latches permanently (later calls
 * are no-ops that return the already-resolved promise); a *failed* fetch
 * does NOT latch — it clears the in-flight promise so the next call (e.g.
 * once `config/flags` becomes readable after auth resolves, see App.jsx)
 * retries against Firestore instead of being stuck on defaults forever.
 */
export async function initFlags(db) {
  if (!initPromise) {
    initPromise = (async () => {
      try {
        const snap = await getDoc(doc(db, 'config', 'flags'));
        const remote = snap.exists() ? snap.data() : {};
        fetchedFlags = { ...FLAG_DEFAULTS, ...remote };
      } catch (error) {
        if (!loggedInitFailure) {
          loggedInitFailure = true;
          console.warn('[flags] initFlags failed, using defaults:', error?.message);
        }
        fetchedFlags = { ...FLAG_DEFAULTS };
        // Do not latch a failure: allow a later initFlags() call to retry
        // rather than permanently locking the session onto defaults.
        initPromise = null;
      }
    })();
  }
  return initPromise;
}

function readLocalOverride(name) {
  try {
    const raw = localStorage.getItem(LOCAL_OVERRIDE_PREFIX + name);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Synchronous flag read. Precedence: localStorage dev override > fetched
 * `config/flags` doc (once `initFlags` has resolved) > `FLAG_DEFAULTS`.
 * An unknown flag name throws in DEV (catches typos early) and returns
 * `false` in PROD (never breaks a production build over a flag lookup).
 */
export function getFlag(name) {
  if (!(name in FLAG_DEFAULTS)) {
    if (import.meta.env.DEV) {
      throw new Error(`[flags] Unknown flag: "${name}"`);
    }
    return false;
  }

  const override = readLocalOverride(name);
  if (override !== undefined) return override;

  const source = fetchedFlags || FLAG_DEFAULTS;
  return source[name];
}

/** Test-only: reset all cached/module state so a fresh initFlags() re-fetches. */
export function _resetFlagsForTest() {
  fetchedFlags = null;
  initPromise = null;
  loggedInitFailure = false;
}

export default { FLAG_DEFAULTS, initFlags, getFlag, _resetFlagsForTest };

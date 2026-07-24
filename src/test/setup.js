/**
 * Vitest Test Setup
 *
 * This file runs before each test file.
 * Used for global mocks and test utilities.
 */

import { vi } from 'vitest';
import '@testing-library/jest-dom';

// DOM-dependent mocks only apply when running under jsdom. Node-environment
// suites (e.g. crypto/JWT verification) skip these but still get the shared
// utilities below.
const hasWindow = typeof window !== 'undefined';

const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};

if (hasWindow) {
  // Mock window.matchMedia
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(query => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  // Mock localStorage
  Object.defineProperty(window, 'localStorage', {
    value: localStorageMock,
  });

  // Mock sessionStorage
  const sessionStorageMock = {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  };
  Object.defineProperty(window, 'sessionStorage', {
    value: sessionStorageMock,
  });

  // Mock IntersectionObserver
  class MockIntersectionObserver {
    constructor(callback) {
      this.callback = callback;
    }
    observe() { return null; }
    unobserve() { return null; }
    disconnect() { return null; }
  }
  window.IntersectionObserver = MockIntersectionObserver;

  // Mock ResizeObserver
  class MockResizeObserver {
    observe() { return null; }
    unobserve() { return null; }
    disconnect() { return null; }
  }
  window.ResizeObserver = MockResizeObserver;

  // Mock scrollTo
  window.scrollTo = vi.fn();
}

// Provide a stable randomUUID for tests WITHOUT clobbering the real WebCrypto
// implementation (jose/JWKS verification needs crypto.subtle).
if (!globalThis.crypto) {
  globalThis.crypto = {};
}
if (!globalThis.crypto.randomUUID) {
  globalThis.crypto.randomUUID = () => 'test-uuid-' + Math.random().toString(36).substr(2, 9);
}

// Mock fetch
global.fetch = vi.fn();

// Reset all mocks before each test
beforeEach(() => {
  vi.clearAllMocks();
  localStorageMock.getItem.mockClear();
  localStorageMock.setItem.mockClear();
});

// Global test utilities
global.sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * QA-01: strict console failure.
 *
 * Any unallowlisted console.error/console.warn call during a test FAILS
 * that test. This catches real bugs (React act() misuse, prop-type
 * violations, silently-swallowed exceptions) that a merely-green assertion
 * count would hide.
 *
 * Two allowlist tiers, both matched by REGEX against the joined message
 * text (not exact string) so a call is allowed only if its *known* stable
 * prefix matches — a genuinely new/different message from the same module
 * still fails the test:
 *
 *  - REACT_DEV_WARNING_ALLOWLIST: React's own internal dev-mode warnings
 *    (act(), refs-on-function-components, Router future-flag notices).
 *    These are pre-existing test-hygiene debt across many files — NOT
 *    fixed as part of QA-01 (out of scope; see task-qa01-report.md for the
 *    full per-file occurrence count). Matched globally (not per-file)
 *    because the message text itself is what identifies them, and it's
 *    identical regardless of which component/test triggers it.
 *  - EXPECTED_APP_ERROR_ALLOWLIST / EXPECTED_APP_WARN_ALLOWLIST: this
 *    app's OWN console.error/console.warn calls that are the *designed*
 *    output of a test deliberately exercising an error-handling branch
 *    (e.g. "Firestore write fails, assert the UI recovers gracefully").
 *    These are not bugs — they're the code doing exactly what it's
 *    supposed to do under a failure scenario the test constructs on
 *    purpose. Each entry is scoped to a specific, stable, tag-prefixed
 *    message so an unrelated NEW console.error in the same module still
 *    fails the gate.
 *
 * A file that manages its own console spy locally (`vi.spyOn(console,
 * 'error')`/`vi.restoreAllMocks()`) transparently shadows or restores past
 * this gate for the duration it's active — that's intentional: those
 * files already assert on console output themselves and are exempt by
 * construction, not by an allowlist entry.
 *
 * To add an entry: reproduce the failure locally, copy the EXACT stable
 * prefix vitest prints, and add ONE new regex with a one-line reason. Do
 * not widen an existing pattern to "fix" a different message — add a new,
 * separately-justified entry instead.
 */
const REACT_DEV_WARNING_ALLOWLIST = [
  {
    pattern: /not wrapped in act\(/,
    reason: 'React act() warning — pre-existing test-hygiene debt across 13 files (163 occurrences); not fixed under QA-01.',
  },
  {
    pattern: /Function components cannot be given refs/,
    reason: 'React ref-on-function-component warning — pre-existing, 5 files (5 occurrences); not fixed under QA-01.',
  },
  {
    pattern: /React Router Future Flag Warning/,
    reason: 'React Router v7 future-flag notice, if/when it appears — framework noise, not an app bug.',
  },
];

const EXPECTED_APP_ERROR_ALLOWLIST = [
  { pattern: /\[InsightDismissal\] Failed to load dismissed insight keys:/, reason: 'activePrompts/InsightDismissal error-path test (malformed/missing snapshot).' },
  { pattern: /\[useClaims\] failed to load claims:/, reason: 'useClaims hook error-path test (Firestore query rejection).' },
  { pattern: /\[report\] \d+\/\d+ active nexus insights are missing a receipt/, reason: 'report generator receipts-invariant violation test (intentionally missing receipt).' },
  { pattern: /Failed to get location:/, reason: 'environmentService geolocation-failure test.' },
  { pattern: /Embedding Cloud Function returned no embedding values/, reason: 'embeddings service empty-response test.' },
  { pattern: /\[report\] Failed to read source_exclusions — failing closed:/, reason: 'report generator fail-closed-on-read-error test.' },
  { pattern: /\[narrative\] Failed to generate section narrative_arc:/, reason: 'report narrative generation LLM-failure test.' },
  { pattern: /Error fetching Whoop summary:/, reason: 'whoop.cache service network/relay-failure tests.' },
  { pattern: /askJournalAI error:/, reason: 'askJournalAI top-level error-path test.' },
  { pattern: /generateEmbeddingV2: Invalid or empty text provided/, reason: 'embeddings v2 input-validation test.' },
  { pattern: /generateQueryEmbeddings: Invalid or empty text provided/, reason: 'embeddings v2 query input-validation test.' },
  { pattern: /\[Synthesizer\] Synthesis failed:/, reason: 'AI council/synthesizer LLM-failure test.' },
  { pattern: /askJournalAI: verified claims load failed, proceeding without/, reason: 'askJournalAI degraded-mode (claims load failure) test.' },
  { pattern: /\[Recording\] Setup error:/, reason: 'voice recording setup-permission-denied test.' },
  { pattern: /\[Recording\] No audio data captured!/, reason: 'voice recording empty-capture test.' },
  { pattern: /Failed to set budget mode:/, reason: 'insightBudget settings save-failure test.' },
  { pattern: /Failed to load budget mode:/, reason: 'insightBudget settings load-failure test.' },
  { pattern: /\[gentleRevisitDaily\] failed for/, reason: 'gentleRevisitDaily per-user failure-isolation test.' },
  { pattern: /\[report\] Failed to generate weekly-.* for user/, reason: 'report generator per-user weekly-report failure test.' },
  { pattern: /\[engagementTracker\] Failed to write engagement for user/, reason: 'engagementTracker retry-exhausted write-failure test.' },
  { pattern: /\[recordInsightEngagement\] failed:/, reason: 'insightEngagement analytics write-failure test.' },
  { pattern: /generateEmbedding \(v2\) error:/, reason: 'embeddings v2 generation-failure test.' },
  { pattern: /"type":"embedding-v1-failed"/, reason: 'embeddings v1-fallback structured-log failure test.' },
  { pattern: /\[embeddingV2\] API error/, reason: 'generateEmbeddingCallable v2 API-error test.' },
  { pattern: /\[embeddingV2\] exception/, reason: 'generateEmbeddingCallable v2 thrown-exception test.' },
  { pattern: /Fused transcription returned no content/, reason: 'fusedTranscription empty-result test.' },
  { pattern: /Fused transcription exception \(attempt/, reason: 'fusedTranscription retry-attempt exception tests.' },
  { pattern: /All fused transcription attempts failed:/, reason: 'fusedTranscription all-retries-exhausted test.' },
  { pattern: /\[reportsStore\] Failed to fetch reports:/, reason: 'reportsStore fetch-failure test.' },
  { pattern: /\[reportsStore\] PDF export failed:/, reason: 'reportsStore PDF-export-failure test.' },
  { pattern: /\[premium\] Error fetching subscription:/, reason: 'premium subscription fetch-failure test.' },
  { pattern: /\[gapPromptGenerator\] Gap detection failed:/, reason: 'gapPromptGenerator Firestore-failure test.' },
  { pattern: /\[gapPromptGenerator\] Invalid domain:/, reason: 'gapPromptGenerator invalid-input validation test.' },
  { pattern: /\[gapPromptGenerator\] Invalid promptStyle:/, reason: 'gapPromptGenerator invalid-input validation test.' },
  { pattern: /\[gapPromptGenerator\] Invalid response:/, reason: 'gapPromptGenerator invalid-LLM-response test.' },
  { pattern: /\[gapPromptGenerator\] Failed to track engagement:/, reason: 'gapPromptGenerator engagement-write-failure test.' },
  { pattern: /classifyEntry error:/, reason: 'analysis classifyEntry error-path test.' },
  { pattern: /\[gapSafety\] Risk check failed, suppressing prompts:/, reason: 'gapSafety fail-closed-on-malformed-entry test.' },
];

const EXPECTED_APP_WARN_ALLOWLIST = [
  { pattern: /generateEmbeddingV2 exception:/, reason: 'embeddings v2 exception-path test.' },
  { pattern: /\[flags\] getServerFlag read failed, using default/, reason: 'flags service read-failure-falls-back-to-default test.' },
  { pattern: /\[gentleRevisitDaily\] safety coverage unknown/, reason: 'gentleRevisitDaily safety-read-cap-hit degrade test.' },
  { pattern: /\[engagementTracker\] Transient error on attempt/, reason: 'engagementTracker retry-with-backoff test.' },
  { pattern: /\[runRecipe\] no embedding for question/, reason: 'runRecipe embedding-unavailable degrade-to-recency test.' },
  { pattern: /\[claimsPipeline\] LLM writer path unavailable this run/, reason: 'claimsPipeline writer-fallback-to-deterministic test.' },
  { pattern: /\[report\] Failed to read entries:/, reason: 'report generator entries-read-failure test.' },
  { pattern: /generateEmbeddingV2: callable returned no embedding values/, reason: 'embeddings v2 empty-callable-response test.' },
  { pattern: /\[Recording\] marker persistence failed:/, reason: 'voice recording chapter-marker persistence-failure test.' },
  { pattern: /\[Spaces\] failed to load default Ask Journal scope:/, reason: 'spacesService default-scope load-failure test.' },
  { pattern: /generateQueryEmbeddings: v2 embedding unavailable, degrading to v1-only/, reason: 'embeddings v2-degrades-to-v1 test.' },
  { pattern: /\[report\] Failed to read nexus data:/, reason: 'report generator nexus-data read-failure test.' },
  { pattern: /Wake Lock API failed:/, reason: 'useWakeLock API-denied test.' },
  { pattern: /\[rebuildInsights\] exclusions read failed; aborting rebuild/, reason: 'rebuildInsights exclusions-read-failure test.' },
  { pattern: /\[rebuildInsights\] claims read failed/, reason: 'rebuildInsights claims-read-failure test.' },
  { pattern: /\[Whoop\] Status verification unavailable:/, reason: 'whoop.cache status-verification-unavailable test.' },
  { pattern: /generateEmbedding: legacy v1 request declined/, reason: 'embeddings v1-retired-upstream test.' },
  { pattern: /\[gapDetector\] Exclusion check failed for/, reason: 'gapDetector per-domain exclusion-read-failure tests (8 domains).' },
  { pattern: /\[Capture\] resume: op recovery failed, continuing:/, reason: 'resumeOperations non-blocking recovery-failure test.' },
  { pattern: /\[audioVault\] saveRecording failed:/, reason: 'audioVault save-failure test.' },
  { pattern: /\[audioVault\] could not persist owner index:/, reason: 'audioVault owner-index quota-exceeded test.' },
  { pattern: /\[enrichmentRunner\] updateDoc failed \(non-blocking\):/, reason: 'enrichmentRunner non-blocking updateDoc-failure test.' },
  { pattern: /\[templates\] Unknown notification type:/, reason: 'notification templates unknown-type test.' },
  { pattern: /\[deepLinks\] Unknown notification type:/, reason: 'deepLinks unknown-notification-type test.' },
  { pattern: /\[Capture\] background upload enqueue failed, caller should fall back:/, reason: 'nativeBackgroundUpload (CAP-01) ticket/plugin-rejection falls-back-to-foreground test.' },
  { pattern: /\[Capture\] background upload failed/, reason: 'nativeBackgroundUpload (CAP-01) captureUploadFailed-event handler test.' },
  { pattern: /\[Capture\] background-upload reconcile failed for one op, continuing:/, reason: 'nativeBackgroundUpload (CAP-01) non-blocking per-op reconcile-failure test.' },
];

function formatConsoleArgs(args) {
  return args
    .map((a) => {
      if (a instanceof Error) return a.stack || a.message;
      if (typeof a === 'object' && a !== null) {
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      }
      return String(a);
    })
    .join(' ');
}

function isAllowlisted(message, lists) {
  return lists.some((list) => list.some(({ pattern }) => pattern.test(message)));
}

let __consoleErrorSpy;
let __consoleWarnSpy;
let __unexpectedErrors;
let __unexpectedWarns;

beforeEach(() => {
  __unexpectedErrors = [];
  __unexpectedWarns = [];
  __consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {
    const message = formatConsoleArgs(args);
    if (!isAllowlisted(message, [REACT_DEV_WARNING_ALLOWLIST, EXPECTED_APP_ERROR_ALLOWLIST])) {
      __unexpectedErrors.push(message);
    }
  });
  __consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation((...args) => {
    const message = formatConsoleArgs(args);
    if (!isAllowlisted(message, [REACT_DEV_WARNING_ALLOWLIST, EXPECTED_APP_WARN_ALLOWLIST])) {
      __unexpectedWarns.push(message);
    }
  });
});

afterEach(() => {
  // A test that manages its own console spy (vi.spyOn/vi.restoreAllMocks)
  // may have already restored these — mockRestore() on an inactive spy is
  // a safe no-op.
  __consoleErrorSpy.mockRestore();
  __consoleWarnSpy.mockRestore();

  const errors = __unexpectedErrors;
  const warns = __unexpectedWarns;
  __unexpectedErrors = [];
  __unexpectedWarns = [];

  const problems = [
    ...errors.map((m) => `console.error: ${m}`),
    ...warns.map((m) => `console.warn: ${m}`),
  ];
  if (problems.length > 0) {
    throw new Error(
      `Unexpected console output (QA-01 strict-console gate):\n\n${problems.join('\n---\n')}\n\n` +
      `If this is a genuinely expected message from a test deliberately exercising an ` +
      `error/warn path, add a scoped regex entry (with a one-line reason) to the ` +
      `appropriate allowlist in src/test/setup.js — do not widen an existing pattern.`
    );
  }
});

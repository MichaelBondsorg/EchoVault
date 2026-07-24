/**
 * `scripts/generate-feature-manifest.js` — OPS-01 generated feature manifest.
 *
 * Regenerates `docs/ops/feature-manifest.md`: one table row per feature
 * flag / model-workload override / dark code constant that gates shipped
 * Engram behavior, sourced by PARSING the actual code (not by hand-copying
 * prose) so the manifest can't silently drift from what's really deployed:
 *
 *   - `src/config/flags.js`         -> FLAG_DEFAULTS (client flag defaults)
 *   - `scripts/flip-flag.mjs`       -> ALLOWED / STRING_ALLOWED (the prod
 *                                      flip mechanism + its typo-guard)
 *   - `functions/src/models/registry.js` -> MODEL_DEFAULTS / WORKLOADS /
 *                                      MODEL_FLAG_DEFAULTS (server model
 *                                      registry)
 *   - every `functions/src/**\/*.js` PLUS the top-level `functions/index.js`
 *     monolith (excluding __tests__) -> every literal `getServerFlag(db,
 *     'name', default)` call site (server-only flags a client never reads,
 *     e.g. `intentAbstainAudit`) AND every literal `getModelFlag(db,
 *     'name')` call site (model-boolean flags like `model.embeddingWriteV2`
 *     that are wired through the registry's own accessor, not a raw
 *     getServerFlag literal). `functions/index.js` is a real, ~4,900-line,
 *     pre-modularization scan root, NOT an incidental extra dir — an
 *     earlier version of this generator only walked `functions/src/`,
 *     which produced a manifest row asserting `model.embeddingWriteV2` had
 *     "zero callers repo-wide" when in fact `functions/index.js`'s
 *     `generateEmbeddingInternal()` reads it on every embedding write (see
 *     `scripts/__tests__/feature-manifest.test.js`'s "blind spot" tests,
 *     which pin this specific regression).
 *   - every `src/**\/*.js` + `functions/src/**\/*.js` + `functions/index.js`
 *     (excluding __tests__/node_modules/dist) -> every `export const
 *     SCREAMING_CASE = true|false;` (dark code-constant kill switches with
 *     no Firestore doc at all, e.g. `LLM_WRITER_ENABLED`,
 *     `USE_FUSED_TRANSCRIPTION`)
 *
 * ---- Parsing approach (documented per the task's "your call" note) -------
 *
 * Values are pulled by locating the `(export )?const NAME = <literal>`
 * declaration textually, then walking the source character-by-character
 * from the literal's opening `{`/`[` to find its balanced closing
 * bracket — a tiny hand-rolled scanner (see `findMatchingBracket`) that
 * tracks whether it is inside a string/template literal or a line/block
 * comment so stray `{`/`}`/`[`/`]` characters *inside* a comment (e.g. this
 * file's own docblocks) or a string never miscount the depth. The extracted
 * literal text is then evaluated with `new Function('return (...)')` — safe
 * here because every source in question is a plain object/array literal of
 * primitives owned by this repo, not external/user input.
 *
 * This is deliberately NOT a regex-over-comment-text approach (comments can
 * change freely without breaking the parse) and NOT a full JS parser
 * (no new dependency; the literals in question are simple enough that a
 * bracket-balancer + `Function` eval is both correct and auditable in ~40
 * lines). It IS sensitive to the actual declaration changing shape (e.g.
 * `FLAG_DEFAULTS` stops being an object literal) — that's intentional: a
 * genuine structural change should fail loud, not silently produce a wrong
 * manifest.
 *
 * ---- Determinism -----------------------------------------------------
 *
 * `renderManifest()` is a pure function of `buildManifestData()`'s return
 * value; both are deterministic given the same source tree (object key
 * order matches source declaration order — never a `Set`/`Map` iteration
 * order that could vary — and every filesystem walk result is sorted before
 * use). Running the generator twice back to back on an unchanged tree
 * produces byte-identical output (verified in
 * `scripts/__tests__/feature-manifest.test.js`).
 *
 * Usage:
 *   node scripts/generate-feature-manifest.js          # regenerate + write
 *   node scripts/generate-feature-manifest.js --check  # exit 1 on drift, write nothing
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import { dirname, join, relative, sep } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(__dirname, '..');
const OUT_PATH = join(ROOT, 'docs', 'ops', 'feature-manifest.md');

// ---------------------------------------------------------------------------
// Balanced-literal extraction (see file header)
// ---------------------------------------------------------------------------

export function findMatchingBracket(source, openIndex) {
  const openChar = source[openIndex];
  const pairs = { '{': '}', '[': ']' };
  const closeChar = pairs[openChar];
  if (!closeChar) throw new Error(`findMatchingBracket: unsupported open char "${openChar}"`);

  let depth = 0;
  let state = 'code'; // code | line-comment | block-comment | single | double | template
  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (state === 'code') {
      if (ch === '/' && next === '/') { state = 'line-comment'; i++; continue; }
      if (ch === '/' && next === '*') { state = 'block-comment'; i++; continue; }
      if (ch === "'") { state = 'single'; continue; }
      if (ch === '"') { state = 'double'; continue; }
      if (ch === '`') { state = 'template'; continue; }
      if (ch === openChar) depth++;
      else if (ch === closeChar) {
        depth--;
        if (depth === 0) return i;
      }
    } else if (state === 'line-comment') {
      if (ch === '\n') state = 'code';
    } else if (state === 'block-comment') {
      if (ch === '*' && next === '/') { state = 'code'; i++; }
    } else if (state === 'single') {
      if (ch === '\\') { i++; continue; }
      if (ch === "'") state = 'code';
    } else if (state === 'double') {
      if (ch === '\\') { i++; continue; }
      if (ch === '"') state = 'code';
    } else if (state === 'template') {
      if (ch === '\\') { i++; continue; }
      if (ch === '`') state = 'code';
    }
  }
  throw new Error('findMatchingBracket: reached end of source with unbalanced brackets');
}

function firstBracketIndexFrom(source, fromIndex) {
  for (let i = fromIndex; i < source.length; i++) {
    if (source[i] === '{' || source[i] === '[') return i;
  }
  throw new Error(`No "{" or "[" found after index ${fromIndex}`);
}

/**
 * Locate `(export )?const NAME = <literal>` (the literal may be wrapped,
 * e.g. `Object.freeze({...})` — the scan simply finds the first `{`/`[`
 * after `=` and balances from there, which lands on the intended literal
 * for every declaration shape used in this repo) and return the evaluated
 * value.
 */
export function extractExportedLiteral(source, name) {
  const anchorRe = new RegExp(`(?:export\\s+)?const\\s+${name}\\s*=\\s*`);
  const m = anchorRe.exec(source);
  if (!m) throw new Error(`extractExportedLiteral: could not find declaration for "${name}"`);
  const afterEq = m.index + m[0].length;
  const openIdx = firstBracketIndexFrom(source, afterEq);
  const closeIdx = findMatchingBracket(source, openIdx);
  const literalText = source.slice(openIdx, closeIdx + 1);
  // eslint-disable-next-line no-new-func -- trusted, repo-owned literal text only
  return new Function(`return (${literalText});`)();
}

// ---------------------------------------------------------------------------
// Filesystem walk
//
// `collectFiles` accepts a mix of DIRECTORY roots (walked recursively) and
// FILE roots (included directly if their extension matches) — the latter
// exists specifically so a monolith like `functions/index.js` can be added
// as a scan root alongside directory trees like `functions/src`, without
// every scanner needing its own directory-vs-file special case.
// ---------------------------------------------------------------------------

function walkFiles(dir, { excludeDirs = ['node_modules', '__tests__', 'dist'], exts = ['.js'] } = {}) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (excludeDirs.includes(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walkFiles(full, { excludeDirs, exts }));
    } else if (exts.some((ext) => entry.endsWith(ext))) {
      out.push(full);
    }
  }
  return out.sort();
}

/**
 * Resolve a list of roots (directories and/or individual files) into a
 * deduplicated, sorted list of absolute file paths matching `exts`.
 */
function collectFiles(roots, opts = {}) {
  const { exts = ['.js'] } = opts;
  const seen = new Set();
  const out = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const st = statSync(root);
    if (st.isFile()) {
      if (exts.some((ext) => root.endsWith(ext)) && !seen.has(root)) {
        seen.add(root);
        out.push(root);
      }
    } else if (st.isDirectory()) {
      for (const f of walkFiles(root, opts)) {
        if (!seen.has(f)) {
          seen.add(f);
          out.push(f);
        }
      }
    }
  }
  return out.sort();
}

function toRelPosix(absPath) {
  return relative(ROOT, absPath).split(sep).join('/');
}

/** 1-based line number of `index` within `text` (for file:line call-site references). */
function lineNumberAt(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === '\n') line++;
  }
  return line;
}

// ---------------------------------------------------------------------------
// Source-derived scans
//
// Every scanner below takes an array of ROOTS (directories and/or files —
// see `collectFiles`) rather than a single directory, specifically so
// `functions/index.js` (the pre-modularization monolith — see the file
// header) can be included alongside `functions/src`/`src` everywhere a
// scanner might otherwise miss a real call site living in it.
// ---------------------------------------------------------------------------

/**
 * Every literal `getServerFlag(db, 'name', default)` call site under the
 * given roots (excluding __tests__). Returns a Map name -> { defaults:
 * Set<string>, files: string[] } — `defaults` holds every distinct literal
 * default text seen (normally exactly one; more than one is a real
 * inconsistency worth surfacing, not hiding). `files` entries are
 * `relative/path.js:LINE` so a reader can jump straight to the call site.
 */
export function scanServerFlagReads(roots) {
  const re = /getServerFlag\(\s*db\s*,\s*['"]([\w.]+)['"]\s*,\s*(true|false|null)\s*\)/g;
  const result = new Map();
  for (const file of collectFiles(roots, { exts: ['.js'] })) {
    const text = readFileSync(file, 'utf8');
    let m;
    while ((m = re.exec(text)) !== null) {
      const [, name, def] = m;
      if (!result.has(name)) result.set(name, { defaults: new Set(), files: [] });
      result.get(name).defaults.add(def);
      result.get(name).files.push(`${toRelPosix(file)}:${lineNumberAt(text, m.index)}`);
    }
  }
  for (const v of result.values()) v.files.sort();
  return result;
}

/**
 * Every literal `getModelFlag(db, 'name')` call site under the given roots
 * (excluding __tests__) — the registry's own accessor for boolean model
 * flags (`MODEL_FLAG_DEFAULTS`, e.g. `model.embeddingWriteV2`), distinct
 * from the raw `getServerFlag` literal pattern above because `getModel()`'s
 * per-workload override uses a template-literal flag name (not a string
 * literal), so it is intentionally NOT matched by either flag scanner —
 * that resolution path is documented instead via the model-workload table
 * (`MODEL_DEFAULTS`/`STRING_ALLOWED`). Returns a Map name -> string[] of
 * `relative/path.js:LINE` call sites.
 */
export function scanModelFlagReads(roots) {
  const re = /getModelFlag\(\s*db\s*,\s*['"]([\w.]+)['"]\s*\)/g;
  const result = new Map();
  for (const file of collectFiles(roots, { exts: ['.js'] })) {
    const text = readFileSync(file, 'utf8');
    let m;
    while ((m = re.exec(text)) !== null) {
      const name = m[1];
      if (!result.has(name)) result.set(name, []);
      result.get(name).push(`${toRelPosix(file)}:${lineNumberAt(text, m.index)}`);
    }
  }
  for (const v of result.values()) v.sort();
  return result;
}

/**
 * Every `export const SCREAMING_CASE = true|false;` under the given roots
 * (excluding __tests__/node_modules/dist) — the repo's dark
 * code-constant kill-switch naming convention (verified low-noise: as of
 * generation time this pattern matches exactly the two real toggles this
 * manifest documents, `LLM_WRITER_ENABLED` and `USE_FUSED_TRANSCRIPTION`;
 * a newly added one is picked up automatically on the next regen).
 */
export function scanDarkConstants(roots) {
  const re = /export\s+const\s+([A-Z][A-Z0-9_]*)\s*=\s*(true|false)\s*;/g;
  const rows = [];
  for (const file of collectFiles(roots, { exts: ['.js'] })) {
    const text = readFileSync(file, 'utf8');
    let m;
    while ((m = re.exec(text)) !== null) {
      rows.push({ name: m[1], value: m[2] === 'true', file: toRelPosix(file) });
    }
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

/** Set of every literal `getFlag('name')` call site found under the given roots (excluding __tests__). */
export function scanClientFlagReadSites(roots) {
  const found = new Set();
  for (const file of collectFiles(roots, { exts: ['.js', '.jsx'] })) {
    const text = readFileSync(file, 'utf8');
    const re = /getFlag\(\s*'([\w.]+)'\s*\)/g;
    let m;
    while ((m = re.exec(text)) !== null) found.add(m[1]);
  }
  return found;
}

// ---------------------------------------------------------------------------
// Curated annotations (hand-maintained; NOT parsed from PROJECT_STATUS.md —
// see the manifest header for why: PROJECT_STATUS.md is a live, frequently
// and concurrently edited document, and tying CI drift detection to its
// prose would make the drift test fire on unrelated edits. These notes are
// short pointers verified against PROJECT_STATUS.md and the flag's own
// call-site comments at the time they were written; re-verify by eye when a
// flag's rollout status changes, and keep entries in sync when a flag here
// is added/removed/renamed.)
// ---------------------------------------------------------------------------

const CLIENT_FLAG_NOTES = {
  coreFirstSave: {
    surface: 'Entry save path — WS-C core-first save (write locally, sync in background).',
    kpi: 'No dedicated log line. Watch Crashlytics for save-path errors and the capture-stage telemetry `queueDepth`/`errorCode` fields (functions/src/telemetry/stageLog.js) for a spike after flip.',
    ownerGate: 'None — already default ON, validated by tests per CLAUDE.md.',
  },
  serverAnalysisOrchestrator: {
    surface: 'functions/src/analysis/orchestrator.js — server-side entry analysis orchestration vs. the legacy client-driven path (functions/src/triggers/watchdogGuards.js, entryUpdateAnalysis.js both branch on this flag).',
    kpi: '`model_manifest` structured log lines (functions/src/models/registry.js logModelManifest) for the `classify`/`analyze` workloads — volume and `ok`/`durationMs` after flip; watchdogGuards\' stuck-run lease-timeout log for orphaned runs.',
    ownerGate: 'None on file beyond the general R1-era rollout posture.',
  },
  nativeBackgroundUpload: {
    surface: 'CAP-01 (product review, P0): native direct-to-storage background upload for capture, landed code-complete but DARK. Client call sites now exist — src/components/dashboard/EntryBar.jsx (native stopRecording branch, enqueue), src/App.jsx (launch-time listener attach + reconcile) — both via src/services/capture/nativeBackgroundUpload.js, and the server (functions/src/capture/{uploadTicket,onAudioUploaded}.js) + Swift (ios/App/App/Capture/{CapturePlugin,BackgroundUploader}.swift) sides are complete. Every call site checks this flag first and no-ops when it is off (verified by dedicated flag-off-inertness unit tests) — flipping requires Michael\'s physical-device validation (docs/quality/device-validation-matrix.md rows 5, 6, 11-14) first.',
    kpi: 'Capture-upload retention sweep `count` field (functions/src/telemetry/stageLog.js META_WHITELIST), plus capture success/duplicate-recovery test coverage (device-validation-matrix.md rows 5, 6, 11-14).',
    ownerGate: 'CAP-01 ships dark this sprint — do not flip until Michael completes the physical-device matrix rows (11-14: suspend/force-kill mid-upload, airplane-mode retry, duplicate-finalize) and signs off.',
  },
  webChunkPersistence: {
    surface: 'Additive web capture durability (chunked local persistence before upload).',
    kpi: 'Capture-stage telemetry `bytes`/`durationMs`/`queueDepth` fields (functions/src/telemetry/stageLog.js) for regressions after flip.',
    ownerGate: 'None — default-on, additive/safe per its own FLAG_DEFAULTS comment.',
  },
  intentExtraction: {
    surface: 'functions/src/intents/extractIntents.js — task/open-loop intent extraction, writes to the `intents` and `user_decisions` subcollections.',
    kpi: '`intents`/`user_decisions` document counts (owner-scoped Firestore query, no dashboard) for extraction volume; `intentAbstainAudit` (separate server-only flag, see below) gates whether abstained candidates are also persisted for review.',
    ownerGate: 'PRD 0B (I1-I4) — shipped, part of the R1 flag set.',
  },
  'model.gemini35flash': {
    surface: 'DECLARED IN FLAG_DEFAULTS BUT UNUSED — no `getFlag(\'model.gemini35flash\')` call site outside `src/config/__tests__/flags.test.js` (a generic getFlag-mechanism test, not a real feature gate). Not present in flip-flag.mjs ALLOWED or STRING_ALLOWED either.',
    kpi: 'N/A — nothing reads it.',
    ownerGate: 'Candidate for deletion per the plan\'s "delete expired flags" directive — confirm nothing external depends on the Firestore field, then remove from FLAG_DEFAULTS.',
  },
  'model.embeddingV2Read': {
    surface: 'src/services/ai/embeddings.js — gates reading the v2 (gemini-embedding-2) index vs. the legacy embedding index during the dual-index migration; also declared server-side in functions/src/models/registry.js MODEL_FLAG_DEFAULTS, but the server accessor `getModelFlag()` has no call site (client-only in practice today).',
    kpi: 'Retrieval-quality spot checks (no dedicated log line found) — see embeddings.js\'s own flag-OFF-nuance comment for what silently changes when this flips.',
    ownerGate: 'Part of the 2026-07-22 embeddings-v2-migration plan (docs/superpowers/plans/2026-07-22-embeddings-v2-migration.md).',
  },
  openLoops: {
    surface: 'OpenLoopsWidget + IntentSuggestionTray — in-app only, never notifies (R1).',
    kpi: '`intents` subcollection document counts filtered to open-loop type (owner-scoped query); dismissal is final so a dismissal-rate spike after flip is the signal to watch.',
    ownerGate: 'R1, shipped. Michael\'s R2 veto-window checklist item (1) covers the batch this shipped alongside but does not itself gate `openLoops`.',
  },
  contextSpaces: {
    surface: 'src/services/spaces/{spacesService,scopeFilter}.js — entries scoped via `spaceId`, strict filter enforced at every retrieval seam except digest/reports (stay cross-space until R2+).',
    kpi: 'No dedicated log line found — watch scopeFilter\'s own test suite plus a manual cold-start check.',
    ownerGate: 'Checklist item (6): R1 leftover, still open — manual cold-start last-space check required before this flag defaults on.',
  },
  insightBudget: {
    surface: 'src/services/insights/insightBudget.js — hard daily/weekly proactive-insight caps by mode (quiet/balanced/exploratory); never lowers confidence gates to fill the quota.',
    kpi: 'No dedicated log line found — watch for user-visible insight-starvation reports vs. cap math in insightBudget.js.',
    ownerGate: 'R1, shipped.',
  },
  insightReceipts: {
    surface: 'src/services/insights/receipts.js + InsightControlCenter/ReceiptSheet — every proactive insight carries {sources, scope, timeWindow, sampleSize, missingness, versions} regardless of the flag; the flag gates UI visibility + correction flow via `source_exclusions`.',
    kpi: '`source_exclusions` document counts (owner-scoped query) for correction volume; recompute.js\'s `onSourcesChanged` fan-out is same-seconds, so a lag there is the failure signal to watch.',
    ownerGate: 'Checklist item (5): first in the recommended R2 flip order (insightReceipts -> voiceChapters -> reflectionRecipes -> sessionPrep -> gentleRevisit).',
  },
  voiceChapters: {
    surface: 'Native `CaptureDraft` sidecar -> functions/src/transcription/fusedTranscription.js `computeChapterBoundaries` -> metadata-only `transcription.chapters` field. Raw text/rawTranscript/createdAt never touched by a chapter edit.',
    kpi: '`model_manifest` log lines for the `fusedTranscription` workload (volume/`ok`); chapter-edit operations do not mutate raw fields by construction, so a raw-field diff on a chapter edit would indicate a regression.',
    ownerGate: 'Checklist item (3): Xcode simulator build DONE (2026-07-22); the on-device physical-mic `markChapter` check is still open — required before this reaches native users, per the recommended flip order (2nd).',
  },
  reflectionRecipes: {
    surface: 'src/services/reflections/ — versioned, scope+exclusion-honoring reflection recipes over the existing scope-filtered Ask Journal seams; reuses the client-side jsPDF export pathway.',
    kpi: 'No dedicated log line found — watch export success/failure via client error reporting (crashReporting.js).',
    ownerGate: 'Checklist item (5): 3rd in the recommended R2 flip order.',
  },
  sessionPrep: {
    surface: 'src/services/reflections/ — since-date/scope-explicit brief + safety-reviewed jsPDF export (never emits `safety_flagged`/`has_warning_indicators` labels or a citation for an unsafe/removed source).',
    kpi: 'No dedicated log line found — export success/failure via crashReporting.js; safety-review correctness is covered by the validation matrix, not a runtime metric.',
    ownerGate: 'Checklist item (5): 4th in the recommended R2 flip order.',
  },
  gentleRevisit: {
    surface: 'functions/src/revisit/selectRevisits.js — server-side, no-LLM heuristic job writing `revisit_queue`, suppressed by `revisit_exclusions`; enforces the plan/brief\'s six non-negotiable safety rules (GR1 added a legacy-fail-closed eligibility rule + retuned the mood floor within that set), PLUS two separate GR1 per-user "skip today" gates layered on top before selection even runs: a current-state pause gate (recent safety signal/sustained low mood) and a weekly cadence gate.',
    kpi: '`revisit_queue`/`revisit_exclusions` document counts and outcome fields (shown/dismissed) — owner-scoped Firestore query, no dashboard.',
    ownerGate: 'Checklist item (4): safety memo docs/quality/gentle-revisit-safety.md SIGNED 2026-07-22 (both boxes). Still gated by checklist item (5) — flip LAST, after insightReceipts/voiceChapters/reflectionRecipes/sessionPrep. The memo gate is separate from and in addition to the flag itself.',
  },
  personalExperiments: {
    surface: 'src/services/experiments/{templates,questionGate,estimator,computeResult,experimentsService,preflight}.js — entirely client-side 14/28-day observational experiments; plan-freeze + coverage-floor invariants enforced in firestore.rules and experimentsService.js.',
    kpi: '`experiments` collection document counts and result-state distribution (insufficient vs. estimated) — owner-scoped Firestore query, no dashboard.',
    ownerGate: 'Checklist item (8): safety/data-method memo docs/quality/experiments-data-method.md SIGNED 2026-07-22 (both boxes). No composite index needed (item 10).',
  },
  'model.embeddingWriteV2': {
    surface: 'functions/src/models/registry.js MODEL_FLAG_DEFAULTS — gates writing embeddings through the v2 (gemini-embedding-2) path during the dual-index migration. WIRED: read via `getModelFlag(db, \'model.embeddingWriteV2\')` inside `generateEmbeddingInternal()` in the `functions/index.js` monolith (NOT `functions/src` — the exact file:line is auto-derived below). Flipping this ON activates the v2 dual-write for every subsequent embedding write; flipping it back OFF stops new v2 writes (existing v2 vectors already written are untouched).',
    kpi: 'v2-embedding write volume — no dedicated log line found; watch `embeddingV2` field presence rate on newly-written entry docs (owner-scoped Firestore query) before/after flip, and the `model_manifest` log lines for the `embeddingV2` workload once a write-path call logs through `logModelManifest` (confirm at flip time — not verified as wired to that log call specifically).',
    ownerGate: 'Part of the 2026-07-22 embeddings-v2-migration plan (docs/superpowers/plans/2026-07-22-embeddings-v2-migration.md). Rollback = flip back to false via `node scripts/flip-flag.mjs model.embeddingWriteV2 false` — the v1 legacy path in `generateEmbeddingInternal()` runs independently in its own try/catch regardless of this flag, so flipping OFF does not remove v1 coverage.',
  },
  insightClaims: {
    surface: 'src/services/insights/{observations,testingLedger}.js + src/services/insights/claims/ — canonical, versioned, immutable-with-lineage InsightClaim store; writes to `insight_claims` and `testing_ledger` collections.',
    kpi: '`insight_claims` document counts by status (verified/expired/suppressed) and `testing_ledger` candidate counts per family — owner-scoped Firestore query, no dashboard.',
    ownerGate: 'Checklist item (11): no memo required — flip after Michael eyeballs claim cards on his own data (deterministic wording, no LLM at Phase 1).',
  },
};

const SERVER_FLAG_NOTES = {
  intentAbstainAudit: {
    surface: 'functions/src/intents/extractIntents.js — persists abstained intent-extraction candidates for review; the OpenLoopsWidget never reads abstains regardless of this flag.',
    kpi: 'Persisted-abstain document count under the same `intents` collection extraction writes to.',
    ownerGate: 'Not in scripts/flip-flag.mjs ALLOWED — no CLI flip mechanism exists today. Must be set via a direct Admin SDK/Firestore-console write to `config/flags.intentAbstainAudit`; add the name to ALLOWED to wire up the typo-guarded CLI path.',
  },
};

const MODEL_WORKLOAD_NOTES = {
  fusedTranscription: 'Wired via flip-flag.mjs STRING_ALLOWED (accepts gemini-3.5-flash/gemini-2.5-flash/default).',
  insightWriter: 'Wired via flip-flag.mjs STRING_ALLOWED (R4 Phase 2 claim-wording writer). Deliberately defaults to a DIFFERENT model than insightVerifier — do not set both the same without reading registry.js\'s comment first.',
  insightVerifier: 'Wired via flip-flag.mjs STRING_ALLOWED (R4 Phase 2 claim-wording verifier). See insightWriter note.',
  realtimeNA: 'Owned by relay-server via env var REALTIME_MODEL, not this registry — recorded here for inventory completeness only (per registry.js\'s own comment); no flip-flag.mjs mechanism applies.',
};

const DARK_CONSTANT_NOTES = {
  LLM_WRITER_ENABLED: {
    surface: 'functions/src/insights/{claimWriter,claimVerifier}.js + the `writeClaimWording` callable — the ONLY path an LLM can ever author a claim\'s `wording` (never its evidence). Rides the `insightClaims` flag as a prerequisite but is an independent code-level gate on top of it.',
    kpi: '`model_manifest` log lines (functions/src/models/registry.js logModelManifest) for the `insightWriter`/`insightVerifier` workloads once flipped; claimsPipeline.js emits one `console.warn` per RUN (not per claim) when the LLM writer path falls back to the deterministic template — a sustained non-zero rate of that warning after flip is the signal to watch.',
    ownerGate: 'Checklist item (12): no memo required — decide after eyeballing verifier behavior on real data (dev-build flip or ask for flag promotion).',
  },
  USE_FUSED_TRANSCRIPTION: {
    surface: 'src/config/ai.js — kill switch; `false` restores the legacy whisper-1 + separate tone pipeline (transcribeWithTone) with no server redeploy required on the FUNCTIONS side (the constant itself still needs a frontend rebuild+deploy to flip, since it is baked into the client bundle at build time).',
    kpi: '`model_manifest` log lines for the `fusedTranscription` / `transcriptionFallback` workloads — a shift in which workload is being resolved after flip is directly visible there.',
    ownerGate: 'None on file.',
  },
};

// A short, explicitly-verified list of formerly-dark constants whose live
// declaration this generator's own `scanDarkConstants()` no longer finds —
// kept here as historical narrative, re-verified at every generation (see
// buildManifestData: a name reappearing in the live scan is an anomaly,
// surfaced automatically rather than silently contradicting this list).
const RETIRED_DARK_CONSTANTS = [
  {
    name: 'RISKY_CLAIMS_ENABLED',
    note: 'Retired R4 Phase 3 (2026-07-23, plan docs/superpowers/plans/2026-07-23-r4-phase3-action-loop.md, decision P3-D1). Gated four claim types (counterfactuals, belief dissonance, intervention outcomes, personalized recommendations); the modules using it (`counterfactual.js`, `beliefDissonance.js`, `interventionTracker.js`) were deleted whole and `recommendationEngine.js` reduced to a generic ideas-only engine — nothing left to gate. Only historical tombstone comments and a test-description string remain (src/services/nexus/orchestrator.js, src/__tests__/validationMatrix.test.js).',
  },
];

// ---------------------------------------------------------------------------
// Build + render
// ---------------------------------------------------------------------------

export function buildManifestData() {
  const flagsJsPath = join(ROOT, 'src', 'config', 'flags.js');
  const flipFlagPath = join(ROOT, 'scripts', 'flip-flag.mjs');
  const registryPath = join(ROOT, 'functions', 'src', 'models', 'registry.js');
  const functionsSrcDir = join(ROOT, 'functions', 'src');
  const functionsIndexPath = join(ROOT, 'functions', 'index.js');
  const srcDir = join(ROOT, 'src');

  const flagsJsSrc = readFileSync(flagsJsPath, 'utf8');
  const flipFlagSrc = readFileSync(flipFlagPath, 'utf8');
  const registrySrc = readFileSync(registryPath, 'utf8');

  const FLAG_DEFAULTS = extractExportedLiteral(flagsJsSrc, 'FLAG_DEFAULTS');
  const ALLOWED = extractExportedLiteral(flipFlagSrc, 'ALLOWED');
  const STRING_ALLOWED = extractExportedLiteral(flipFlagSrc, 'STRING_ALLOWED');
  const MODEL_DEFAULTS = extractExportedLiteral(registrySrc, 'MODEL_DEFAULTS');
  const MODEL_FLAG_DEFAULTS = extractExportedLiteral(registrySrc, 'MODEL_FLAG_DEFAULTS');

  // Every scan root list below includes `functions/index.js` explicitly —
  // the pre-modularization monolith is a real, live call-site location
  // (see the file header's "blind spot" note), not covered by
  // `functions/src` alone.
  const functionsRoots = [functionsSrcDir, functionsIndexPath];
  const serverFlagReads = scanServerFlagReads(functionsRoots);
  const modelFlagReads = scanModelFlagReads(functionsRoots);
  const clientReadSites = scanClientFlagReadSites([srcDir, functionsIndexPath]);
  const darkConstants = scanDarkConstants([srcDir, functionsSrcDir, functionsIndexPath]);

  // --- Unified flags table (client + server-only + model-boolean flags) ---
  const names = new Set([
    ...Object.keys(FLAG_DEFAULTS),
    ...Object.keys(MODEL_FLAG_DEFAULTS),
    ...serverFlagReads.keys(),
    ...modelFlagReads.keys(),
  ]);

  const flagRows = [...names].sort().map((name) => {
    const inClientDefaults = Object.prototype.hasOwnProperty.call(FLAG_DEFAULTS, name);
    const inModelFlagDefaults = Object.prototype.hasOwnProperty.call(MODEL_FLAG_DEFAULTS, name);
    const serverInfo = serverFlagReads.get(name);
    const modelInfo = modelFlagReads.get(name); // string[] of file:line, or undefined

    let defaultValue;
    let defaultSource;
    if (inClientDefaults) {
      defaultValue = FLAG_DEFAULTS[name];
      defaultSource = 'src/config/flags.js FLAG_DEFAULTS';
    } else if (inModelFlagDefaults) {
      defaultValue = MODEL_FLAG_DEFAULTS[name];
      defaultSource = 'functions/src/models/registry.js MODEL_FLAG_DEFAULTS';
    } else if (serverInfo) {
      const defs = [...serverInfo.defaults];
      defaultValue = defs.length === 1 ? defs[0] === 'true' : `INCONSISTENT (${defs.join(' vs ')})`;
      defaultSource = `getServerFlag() call-site default (${serverInfo.files.join(', ')})`;
    } else {
      defaultValue = 'unknown';
      defaultSource = 'unknown';
    }

    const inAllowed = ALLOWED.includes(name);
    const inStringAllowed = Object.prototype.hasOwnProperty.call(STRING_ALLOWED, name);
    // NOTE: `inStringAllowed` is currently always false at this point in the
    // unified flags loop — STRING_ALLOWED's keys (model.fusedTranscription,
    // model.insightWriter, model.insightVerifier) are read via getModel()'s
    // generic `getServerFlag(db, \`model.${workload}\`, null)` template-literal
    // call, which scanServerFlagReads' regex deliberately does NOT match (it
    // only matches string-LITERAL flag names), so no STRING_ALLOWED name can
    // ever land in `names` above via serverFlagReads/modelFlagReads, and none
    // are declared in FLAG_DEFAULTS/MODEL_FLAG_DEFAULTS either. The branch is
    // kept (not deleted) because a future flag COULD be both a plain boolean
    // and separately string-overridable — this guards that shape correctly
    // if it ever exists; today it is unexercised by real data (confirmed by
    // the "STRING_ALLOWED-only" test in feature-manifest.test.js).
    let flipMechanism;
    let takesEffect;
    let rollback;
    if (inAllowed) {
      flipMechanism = `node scripts/flip-flag.mjs ${name} true`;
      rollback = `node scripts/flip-flag.mjs ${name} false`;
    } else if (inStringAllowed) {
      const values = STRING_ALLOWED[name].join(' | ');
      flipMechanism = `node scripts/flip-flag.mjs ${name} <${values}>`;
      rollback = `node scripts/flip-flag.mjs ${name} default  (deletes the Firestore override; registry default applies again)`;
    } else {
      flipMechanism = `NOT WIRED in scripts/flip-flag.mjs — direct Admin SDK/Firestore-console write to \`config/flags.${name}\` required; add "${name}" to ALLOWED to get the CLI typo-guard.`;
      rollback = `Direct Admin SDK/Firestore-console write: delete/false the \`config/flags.${name}\` field.`;
    }

    // Timing is a property of WHERE the flag is read (client getFlag / server
    // getServerFlag+getModelFlag caching), not of how the Firestore field got
    // written — so it applies the same whether the write came from
    // flip-flag.mjs or a direct console edit. Kept in its own column (not
    // spliced onto the flip-mechanism command) so that cell stays a single,
    // cleanly copy-pasteable command — matching the Rollback column.
    const readsClientSide = clientReadSites.has(name);
    const readsServerSide = Boolean(serverInfo) || Boolean(modelInfo);
    const timingParts = [];
    if (readsClientSide) timingParts.push('client: next app load');
    if (readsServerSide) timingParts.push('server: within 60s (getServerFlag 60s in-process cache)');
    takesEffect = timingParts.length > 0 ? `${timingParts.join('; ')} — no deploy` : 'unknown — see Gaps (no confirmed read site)';

    const notes = CLIENT_FLAG_NOTES[name] || SERVER_FLAG_NOTES[name] || {
      surface: '(not yet annotated — add an entry to CLIENT_FLAG_NOTES/SERVER_FLAG_NOTES in scripts/generate-feature-manifest.js)',
      kpi: '(not yet annotated)',
      ownerGate: '(not yet annotated)',
    };

    // Auto-derived, self-correcting evidence: appended programmatically
    // (not hand-typed) so a future new/moved call site is reflected even if
    // the curated prose above goes stale — this is the direct fix for the
    // false "zero callers repo-wide" claim a hand-typed note previously made
    // about `model.embeddingWriteV2` before functions/index.js was a scan root.
    let surface = notes.surface;
    if (modelInfo && modelInfo.length > 0) {
      surface += ` [derived: read via getModelFlag() at ${modelInfo.join(', ')}]`;
    }
    if (serverInfo && serverInfo.files.length > 0) {
      surface += ` [derived: read via getServerFlag() at ${serverInfo.files.join(', ')}]`;
    }

    const gaps = [];
    if (inClientDefaults && !readsClientSide && name !== 'model.gemini35flash') {
      // model.gemini35flash's dead-flag gap is already called out in its own note.
      gaps.push('No `getFlag(...)` call site found in src/ at generation time.');
    }
    if ((inClientDefaults || inModelFlagDefaults) && !readsClientSide && !readsServerSide && name !== 'model.gemini35flash') {
      gaps.push('No read call site (getFlag/getServerFlag/getModelFlag) found anywhere at generation time — declared but unwired.');
    }
    if (!inAllowed && !inStringAllowed) {
      gaps.push('No flip-flag.mjs entry (see mechanism column).');
    }

    return {
      name,
      surface: 'flag',
      default: defaultValue,
      defaultSource,
      clientDefined: inClientDefaults,
      serverReadFiles: serverInfo ? serverInfo.files : [],
      modelFlagReadFiles: modelInfo || [],
      flipMechanism,
      takesEffect,
      rollback,
      ...notes,
      surface,
      gaps,
    };
  });

  // --- Model workload override table ---
  const workloadRows = Object.keys(MODEL_DEFAULTS).sort().map((workload) => {
    const flagName = `model.${workload}`;
    const inStringAllowed = Object.prototype.hasOwnProperty.call(STRING_ALLOWED, flagName);
    const flipMechanism = inStringAllowed
      ? `node scripts/flip-flag.mjs ${flagName} <${STRING_ALLOWED[flagName].join(' | ')}>`
      : `NOT WIRED in scripts/flip-flag.mjs — direct Admin SDK/Firestore-console write to \`config/flags.${flagName}\` required.`;
    const rollback = inStringAllowed
      ? `node scripts/flip-flag.mjs ${flagName} default`
      : `Direct Admin SDK/Firestore-console write: delete the \`config/flags.${flagName}\` field.`;
    return {
      workload,
      defaultModelId: MODEL_DEFAULTS[workload],
      flipMechanism,
      rollback,
      note: MODEL_WORKLOAD_NOTES[workload] || '',
    };
  });

  // --- Dark code constants ---
  const darkRows = darkConstants.map((row) => ({
    ...row,
    ...(DARK_CONSTANT_NOTES[row.name] || {
      surface: '(not yet annotated — add an entry to DARK_CONSTANT_NOTES in scripts/generate-feature-manifest.js)',
      kpi: '(not yet annotated)',
      ownerGate: '(not yet annotated)',
    }),
    rollback: `Edit the constant in ${row.file} + redeploy (git commit -> push to main -> CI deploy). No Firestore involved.`,
  }));

  // Anomaly check: a "retired" constant that has reappeared live is worth
  // shouting about, not silently contradicting RETIRED_DARK_CONSTANTS.
  const reappearedRetired = RETIRED_DARK_CONSTANTS.filter((r) =>
    darkRows.some((d) => d.name === r.name)
  );

  return {
    generatedNote:
      'This file is GENERATED by `node scripts/generate-feature-manifest.js` from ' +
      'src/config/flags.js, scripts/flip-flag.mjs, functions/src/models/registry.js, ' +
      'and a repo-wide scan (functions/src/**, the functions/index.js monolith, and src/**) ' +
      'for getServerFlag()/getModelFlag()/getFlag()/dark-constant call sites. Do not hand-edit — ' +
      'edit the source files (or this generator\'s curated annotation maps) and regenerate. ' +
      'A vitest check (scripts/__tests__/feature-manifest.test.js) fails CI if this file drifts ' +
      'from a fresh regeneration.',
    flagRows,
    workloadRows,
    darkRows,
    reappearedRetired,
  };
}

function fmtDefault(v) {
  if (typeof v === 'boolean') return v ? 'ON (true)' : 'OFF (false)';
  return String(v);
}

function mdEscape(s) {
  return String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

export function renderManifest(data) {
  const lines = [];
  lines.push('# Engram Feature Manifest');
  lines.push('');
  lines.push('> ' + data.generatedNote);
  lines.push('>');
  lines.push(
    '> **This table documents code DEFAULTS and rollback MECHANISMS, not live production ' +
      'state.** Live `config/flags` values change without a commit (they are Firestore ' +
      'field writes via `scripts/flip-flag.mjs`) — cross-check PROJECT_STATUS.md\'s Active Work ' +
      'section for what is actually flipped ON in prod today; treat any such claim there as a ' +
      'point-in-time note, not something this generator re-verifies.'
  );
  lines.push('');

  lines.push('## Flags (client `src/config/flags.js` + server-only + model-boolean)');
  lines.push('');
  lines.push('The "Prod flip mechanism" and "Rollback" cells are always a single, cleanly copy-pasteable command (or a plain sentence when nothing is wired) — timing is reported separately in "Takes effect" so a reader never has to strip prose off a command before pasting it.');
  lines.push('');
  lines.push('| Flag | Default | Prod flip mechanism | Takes effect | Rollback | Surface | KPI to watch after flip | Owner-gate notes | Gaps |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const r of data.flagRows) {
    lines.push(
      `| \`${r.name}\` | ${fmtDefault(r.default)} | ${mdEscape(r.flipMechanism)} | ${mdEscape(r.takesEffect)} | ${mdEscape(r.rollback)} | ${mdEscape(r.surface)} | ${mdEscape(r.kpi)} | ${mdEscape(r.ownerGate)} | ${r.gaps.length ? mdEscape(r.gaps.join(' ')) : '—'} |`
    );
  }
  lines.push('');

  lines.push('## Model workload overrides (`functions/src/models/registry.js` MODEL_DEFAULTS)');
  lines.push('');
  lines.push('String-valued `model.<workload>` overrides on the same `config/flags` doc, resolved by `getModel()` (registry default if no override is set).');
  lines.push('');
  lines.push('| Workload | Default model id | Prod flip mechanism | Rollback | Note |');
  lines.push('|---|---|---|---|---|');
  for (const r of data.workloadRows) {
    lines.push(
      `| \`${r.workload}\` | \`${r.defaultModelId}\` | ${mdEscape(r.flipMechanism)} | ${mdEscape(r.rollback)} | ${mdEscape(r.note)} |`
    );
  }
  lines.push('');

  lines.push('## Dark code constants (no Firestore doc at all)');
  lines.push('');
  lines.push('`export const SCREAMING_CASE = true|false;` kill switches. Rollback requires a code change + redeploy, never a flip-flag.mjs invocation.');
  lines.push('');
  lines.push('| Constant | Current value | Declared in | Rollback | Surface | KPI to watch after flip | Owner-gate notes |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const r of data.darkRows) {
    lines.push(
      `| \`${r.name}\` | ${fmtDefault(r.value)} | \`${r.file}\` | ${mdEscape(r.rollback)} | ${mdEscape(r.surface)} | ${mdEscape(r.kpi)} | ${mdEscape(r.ownerGate)} |`
    );
  }
  lines.push('');

  lines.push('## Retired dark constants (historical)');
  lines.push('');
  if (data.reappearedRetired.length > 0) {
    lines.push('> **ANOMALY:** the following were expected retired but a live declaration was found in the current scan above — investigate before trusting this section.');
    for (const r of data.reappearedRetired) lines.push(`> - \`${r.name}\``);
    lines.push('');
  }
  for (const r of RETIRED_DARK_CONSTANTS) {
    lines.push(`- **\`${r.name}\`** — ${r.note}`);
  }
  lines.push('');

  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

function main() {
  const checkOnly = process.argv.includes('--check');
  const data = buildManifestData();
  const rendered = renderManifest(data);

  if (checkOnly) {
    const existing = existsSync(OUT_PATH) ? readFileSync(OUT_PATH, 'utf8') : null;
    if (existing !== rendered) {
      console.error(
        `[generate-feature-manifest] DRIFT: ${toRelPosix(OUT_PATH)} does not match a fresh regeneration.\n` +
          `Run \`node scripts/generate-feature-manifest.js\` and commit the result.`
      );
      process.exit(1);
    }
    console.log('[generate-feature-manifest] OK — manifest is in sync.');
    return;
  }

  writeFileSync(OUT_PATH, rendered, 'utf8');
  console.log(`[generate-feature-manifest] Wrote ${toRelPosix(OUT_PATH)} (${data.flagRows.length} flags, ${data.workloadRows.length} model workloads, ${data.darkRows.length} dark constants).`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

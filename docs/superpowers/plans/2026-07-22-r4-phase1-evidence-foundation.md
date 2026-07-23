# R4 Phase 1 — Evidence Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the canonical evidence layer the deep review (DR) demands — daily observation rollup, hypothesis-family testing ledger, versioned immutable `InsightClaim` store with an evidence builder riding the experiments estimator, typed assertions, claim-backed Quick Insights, and the 6-option diagnostic feedback taxonomy — all behind a new `insightClaims` flag (default OFF).

**Architecture:** Claims are generated client-side alongside basicInsights generation (same trigger, same entries window). Deterministic code produces ALL evidence and wording in Phase 1 — there is NO LLM writer yet (that is Phase 2's constrained writer + verifier; a deterministic template wording is verified-by-construction, so Phase-1 claims are written `status:'verified'`). The estimator (`src/services/experiments/estimator.js`) is the single statistics engine: the evidence builder reuses `pairObservations`/`runAnalysisPlan` and adds the DR "emerging association" floor on top. Multiple testing is handled by a durable per-family ledger + Bonferroni-adjusted CI level threaded into the estimator as `plan.ciLevel`.

**Tech Stack:** React 18 / Vite, Firestore (client SDK), Vitest, firestore.rules emulator tests, Cloud Functions (Node 20) for the intents schema task only.

## Global Constraints

- Execution model identical to R1–R4 Phase 0: work on `main`, green batches, implementers NEVER push, adversarial review per task, SDD ledger `.superpowers/sdd/progress.md` updated after every task.
- Gate before every push: `npm test` green, `npm run build` green; `npm run test:rules` additionally green for any task touching `firestore.rules`.
- Commit with pathspecs (`git add <paths> && git commit <paths>` or commit-with-paths), verify `git diff --cached --stat` before committing, check vitest EXIT CODES (never `| grep -c`), assert every scripted edit landed.
- Mood: 0–1 internal (`Mood01`), 0–100 ONLY at analysis/display boundary via `normalizeMoodTo100` (rejects out-of-domain → null, NEVER clamps, NEVER infers unit from magnitude).
- Tri-state missingness everywhere: `UNKNOWN` sentinel ≠ `[]` (known-empty) ≠ absent. A day with UNKNOWN tags is OMITTED from a tag-exposure series, never counted as 0.
- All day math on user-local `dateKey`s via `localDateKeyForMs`/`resolveDeviceTimezone` from `src/services/experiments/computeResult.js`. IANA timezone frozen into every analysis plan.
- Non-causal copy ONLY (co-movement phrasing, per experiments templates precedent). No causal verbs in titles or bodies.
- Nothing user-facing changes with flags off: `insightClaims` default OFF; legacy Quick Insights render exactly as today when OFF.
- New collections need: firestore.rules block + `functions/src/__tests__/firestoreRules.test.js` coverage + runbook note.
- `RISKY_CLAIMS_ENABLED` stays `false` — Phase 1 does NOT reactivate counterfactuals/beliefDissonance/intervention-outcomes/personalized recs.
- Plan-freeze discipline (DR gate 2): a candidate's analysis plan — including `candidateTestsCount` and `ciLevel` — is frozen BEFORE `runAnalysisPlan` is called. Ledger registration happens BEFORE analysis so inconclusive candidates still count.
- App collection prefix: `artifacts/${APP_COLLECTION_ID}/users/{uid}/...` (`APP_COLLECTION_ID = 'echo-vault-v5-fresh'`).

## Ratified design decisions (controller, from DR + R4 plan; Michael veto-window as usual)

| # | Decision | Why |
|---|----------|-----|
| D1 | Claims generated client-side, flag `insightClaims` (client flag + flip-flag whitelist), default OFF | basicInsights already generates client-side over the fetched entries window; no new server surface needed for Phase 1 |
| D2 | No LLM in Phase 1; deterministic template wording; claims written `status:'verified'` | DR gate 7 satisfied by construction; writer+verifier are Phase 2 per the R4 plan |
| D3 | Multiple-testing correction = Bonferroni-adjusted CI level `1 − 0.05/m` per hypothesis family (m = distinct candidates ever tested in the family, inconclusive included) | DR stat-req 9 ("correction or hierarchical shrinkage"); simplest honest scheme composable with the existing bootstrap CI |
| D4 | Daily observation rollup is a PURE in-memory module (not persisted) | Generation already holds the entries window; persistence adds sync/staleness risk with zero Phase-1 consumer (YAGNI; revisit for server-side generation in Phase 2) |
| D5 | Claim doc immutable except `status`/`supersededByClaimId`/`updatedAt`; corrections create a NEW claim version linked via `parentClaimId`; owner delete allowed in rules (user data rights) but app code never deletes | DR "claims are immutable facts...never silently overwrite history" |
| D6 | Phase-1 claim surface = Quick Insights section only; claim type emitted = `pattern_to_watch` (plus `experiment_result` already covered by R3). Time-of-day engine stays legacy (hour grouping doesn't fit day-level exposure/outcome) | DR single-feed is Phase 2; sparser-but-honest is the intended outcome |
| D7 | "Do not analyze this topic" feedback maps to the existing feedbackLearning suppression (per patternType) + claim `status:'suppressed'`; liftable in InsightControlCenter | Reuses shipped, liftable suppression instead of a new exclusion subsystem |
| D8 | Experiments retrofit: `analysisPlan.hypothesisFamilyId` + `analysisPlan.ciLevel` frozen at CREATE from ledger count; existing experiments untouched (absent fields → estimator defaults) | Retroactively adjusting old frozen plans would violate plan-freeze |
| D9 | Themes/emotions claims will naturally emit ZERO claims (adapter returns UNKNOWN — never written by analysis) — this is correct behavior, documented, not "fixed" | Honest abstention; extraction of themes is future work |

## Shared contracts (referenced by multiple tasks)

```js
// Observation row (T1 produces, T5/T6 consume):
// { dateKey: 'YYYY-MM-DD', entryIds: string[], mood100: number|null,
//   tags: string[]|UNKNOWN, entities: string[]|UNKNOWN, category: string|UNKNOWN,
//   healthSignals: Object|null, sensitive: boolean }

// ExposureSpec (T1 defines, T5/T6 consume):
// { key: string,            // stable candidate id, e.g. 'tag:gym', 'health:sleep_hours'
//   label: string,          // display, e.g. 'gym'
//   kind: 'tag'|'entity'|'category'|'health',
//   field?: string,         // health only: key inside healthSignals
//   splitMode: 'binary'|'median' }

// Frozen candidate plan (T5 freezeCandidatePlan produces):
// { frozenAt, hypothesisFamilyId, candidateId, candidateTestsCount, ciLevel,
//   outcomeUnit:'mood_0_100', timezone, datePolicy:'user_local_calendar_day',
//   exposureDefinition, outcomeDefinition:'daily mean mood (0-100)', lagDays:0,
//   splitMode, minExposureContrast:0, minimumTotalDays:14, minimumSpanDays:21,
//   practicalEffectFloorMoodPoints:5, adapterVersion, observationSchemaVersion,
//   evidenceBuilderVersion, estimatorThresholds:{minPairedObservations:10, minGroupSize:5,
//   minGroupFraction:0.25, bootstrapResamples:2000} }

// Claim doc (T3 buildClaim validates; T5/T6 produce):
// { id, version:number>=1, parentClaimId:string|null, supersededByClaimId:string|null,
//   claimType:'observation'|'pattern_to_watch'|'experiment_result',
//   subject:string, outcome:'mood', direction:'positive'|'negative',
//   questionWording:string, wording:string, limitations:string[],
//   analysisPlan:<frozen candidate plan>, evidence:<see T5>, receipt:<buildReceipt shape>,
//   status:'candidate'|'verified'|'suppressed'|'expired',
//   provenance:{generatorVersion:number, evidenceBuilderVersion:number, wordingSource:'deterministic_template_v1'},
//   createdAt:ISO, updatedAt:ISO }
```

**Batching (file-conflict boundaries, R4-Phase-0 style):**
- **P1a (parallel):** T1 (observations) ∥ T2 (estimator ciLevel + ledger) ∥ T3 (claim schema/service + rules) ∥ T4 (assertion typing, functions/) ∥ T8 (dead-code sweep) → gate → push.
- **P1b (after P1a):** T5 (evidence builder) → T6 (pipeline bridge + flag) ∥ T7 (experiments retrofit) → gate → push.
- **P1c (after P1b):** T9 (feedback taxonomy) → T10 (ClaimCard + InsightsPage) → T11 (QA/matrix/docs) → gate → push → whole-phase review.

---

### Task 1: Daily observation rollup (`observations.js`)

**Files:**
- Create: `src/services/insights/observations.js`
- Test: `src/services/insights/__tests__/observations.test.js`

**Interfaces:**
- Consumes: `normalizeEntriesForInsights(entries, {timeZone})`, `UNKNOWN`, `isUnknown` from `src/services/insights/entryAdapter.js`.
- Produces: `OBSERVATION_SCHEMA_VERSION = 1`; `buildDailyObservations(entries, {timeZone} = {})` → Observation rows (shared contract) sorted ascending by dateKey; `observationSeriesFor(observations, exposureSpec)` → `[{dateKey, value}]` (estimator-ready exposure series); `moodSeriesFor(observations)` → `[{dateKey, value}]` (0–100); `enumerateExposures(observations, {minPresentDays = 3, minHealthDays = 5} = {})` → `ExposureSpec[]`.

- [ ] **Step 1: Write the failing tests**

```js
// src/services/insights/__tests__/observations.test.js
import { describe, it, expect } from 'vitest';
import {
  OBSERVATION_SCHEMA_VERSION, buildDailyObservations,
  observationSeriesFor, moodSeriesFor, enumerateExposures,
} from '../observations';
import { UNKNOWN } from '../entryAdapter';

const entry = (id, iso, over = {}) => ({
  id, createdAt: iso, text: 'sample text for the day',
  analysis: { mood_score: 0.6 }, tags: ['gym'], entry_type: 'reflection',
  ...over,
});

describe('buildDailyObservations', () => {
  it('groups entries by local dateKey with mean mood on the 0-100 scale', () => {
    const obs = buildDailyObservations([
      entry('a', '2026-07-01T09:00:00Z', { analysis: { mood_score: 0.4 } }),
      entry('b', '2026-07-01T20:00:00Z', { analysis: { mood_score: 0.8 } }),
      entry('c', '2026-07-02T09:00:00Z', { analysis: { mood_score: 0.5 } }),
    ], { timeZone: 'UTC' });
    expect(obs).toHaveLength(2);
    expect(obs[0]).toMatchObject({ dateKey: '2026-07-01', mood100: 60 });
    expect(obs[0].entryIds).toEqual(['a', 'b']);
    expect(obs[1].mood100).toBe(50);
  });

  it('mood100 is null (not 0) when no entry that day has a valid mood', () => {
    const obs = buildDailyObservations(
      [entry('a', '2026-07-01T09:00:00Z', { analysis: {} })], { timeZone: 'UTC' });
    expect(obs[0].mood100).toBeNull();
  });

  it('day tags are UNKNOWN only when EVERY entry that day has UNKNOWN tags; union otherwise', () => {
    const obs = buildDailyObservations([
      entry('a', '2026-07-01T09:00:00Z', { tags: undefined, analysis: { mood_score: 0.5 } }),
      entry('b', '2026-07-01T12:00:00Z', { tags: ['run'] }),
      entry('c', '2026-07-02T09:00:00Z', { tags: undefined, analysis: { mood_score: 0.5 } }),
    ], { timeZone: 'UTC' });
    expect(obs[0].tags).toEqual(['gym', 'run'].sort());
    expect(obs[1].tags).toBe(UNKNOWN);
  });

  it('flags a day sensitive when any entry is safety_flagged or has_warning_indicators', () => {
    const obs = buildDailyObservations([
      entry('a', '2026-07-01T09:00:00Z', { safety_flagged: true }),
      entry('b', '2026-07-02T09:00:00Z'),
    ], { timeZone: 'UTC' });
    expect(obs[0].sensitive).toBe(true);
    expect(obs[1].sensitive).toBe(false);
  });
});

describe('observationSeriesFor', () => {
  const obs = buildDailyObservations([
    entry('a', '2026-07-01T09:00:00Z', { tags: ['gym'] }),
    entry('b', '2026-07-02T09:00:00Z', { tags: [] }),
    entry('c', '2026-07-03T09:00:00Z', { tags: undefined }),
  ], { timeZone: 'UTC' });

  it('binary tag exposure: present=1, known-absent=0, UNKNOWN day OMITTED (never 0)', () => {
    const series = observationSeriesFor(obs, { key: 'tag:gym', kind: 'tag', label: 'gym', splitMode: 'binary' });
    expect(series).toEqual([
      { dateKey: '2026-07-01', value: 1 },
      { dateKey: '2026-07-02', value: 0 },
    ]); // 07-03 omitted: tags UNKNOWN
  });

  it('health exposure: numeric value per day, days without the field omitted', () => {
    const withHealth = buildDailyObservations([
      entry('a', '2026-07-01T09:00:00Z', { healthContext: { sleep: { hoursSlept: 7.5 } } }),
      entry('b', '2026-07-02T09:00:00Z'),
    ], { timeZone: 'UTC' });
    const spec = { key: 'health:sleep_hours', kind: 'health', field: 'sleep_hours', label: 'sleep hours', splitMode: 'median' };
    const series = observationSeriesFor(withHealth, spec);
    expect(series).toHaveLength(1);
    expect(series[0].dateKey).toBe('2026-07-01');
    expect(series[0].value).toBeCloseTo(7.5);
  });
});

describe('moodSeriesFor', () => {
  it('emits only days with a valid mood, 0-100', () => {
    const obs = buildDailyObservations([
      entry('a', '2026-07-01T09:00:00Z', { analysis: { mood_score: 0.7 } }),
      entry('b', '2026-07-02T09:00:00Z', { analysis: {} }),
    ], { timeZone: 'UTC' });
    expect(moodSeriesFor(obs)).toEqual([{ dateKey: '2026-07-01', value: 70 }]);
  });
});

describe('enumerateExposures', () => {
  it('emits a tag spec only at >= minPresentDays present-days; health at >= minHealthDays observed days', () => {
    const entries = [];
    for (let d = 1; d <= 6; d += 1) {
      entries.push(entry(`t${d}`, `2026-07-0${d}T09:00:00Z`, {
        tags: d <= 3 ? ['gym'] : ['other'],
        healthContext: d <= 5 ? { sleep: { hoursSlept: 6 + d } } : undefined,
      }));
    }
    const specs = enumerateExposures(buildDailyObservations(entries, { timeZone: 'UTC' }));
    const keys = specs.map((s) => s.key);
    expect(keys).toContain('tag:gym');       // 3 present days
    expect(keys).toContain('tag:other');     // 3 present days
    expect(keys).toContain('health:sleep_hours'); // 5 observed days
  });

  it('exposure keys are stable and lowercase (candidate identity across runs)', () => {
    const specs = enumerateExposures(buildDailyObservations(
      [entry('a', '2026-07-01T09:00:00Z', { tags: ['Gym'] }),
       entry('b', '2026-07-02T09:00:00Z', { tags: ['gym'] }),
       entry('c', '2026-07-03T09:00:00Z', { tags: ['GYM'] })], { timeZone: 'UTC' }), { minPresentDays: 3 });
    expect(specs.filter((s) => s.kind === 'tag').map((s) => s.key)).toEqual(['tag:gym']);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/services/insights/__tests__/observations.test.js` → FAIL (module not found).

- [ ] **Step 3: Implement `src/services/insights/observations.js`**

```js
/**
 * Daily observation rollup (R4 Phase 1, DR "daily observation rollup" stage).
 * PURE — no Firestore, no clock. One row per user-local calendar day.
 * Tri-state discipline: a day-level field is UNKNOWN only when every entry
 * that day left it UNKNOWN; a known-empty [] is evidence of absence.
 */
import { normalizeEntriesForInsights, UNKNOWN, isUnknown } from './entryAdapter';

export const OBSERVATION_SCHEMA_VERSION = 1;

// Health numeric fields eligible as exposures (keys inside normalized healthSignals).
export const HEALTH_EXPOSURE_FIELDS = Object.freeze([
  'sleep_hours', 'sleep_score', 'recovery_score', 'strain', 'steps',
  'activeCalories', 'distance',
]);

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function mergeArrayField(dayValues) {
  // dayValues: array of (string[]|UNKNOWN). UNKNOWN only if ALL are UNKNOWN.
  const known = dayValues.filter((v) => !isUnknown(v));
  if (!known.length) return UNKNOWN;
  const set = new Set();
  known.forEach((arr) => arr.forEach((x) => set.add(String(x).toLowerCase())));
  return [...set].sort();
}

export function buildDailyObservations(entries, { timeZone } = {}) {
  const normalized = normalizeEntriesForInsights(entries, { timeZone });
  const byDay = new Map();
  for (const n of normalized) {
    if (!n.dateKey) continue;
    if (!byDay.has(n.dateKey)) byDay.set(n.dateKey, []);
    byDay.get(n.dateKey).push(n);
  }
  const rawById = new Map((entries || []).filter((e) => e && e.id).map((e) => [e.id, e]));
  const rows = [];
  for (const [dateKey, dayEntries] of byDay.entries()) {
    const moods = dayEntries.map((e) => e.mood01).filter((m) => Number.isFinite(m));
    const healthNumeric = {};
    for (const field of HEALTH_EXPOSURE_FIELDS) {
      const vals = dayEntries
        .map((e) => e.healthSignals?.[field])
        .filter((v) => Number.isFinite(v));
      if (vals.length) healthNumeric[field] = mean(vals);
    }
    const sensitive = dayEntries.some((e) => {
      const raw = rawById.get(e.id);
      return raw?.safety_flagged === true || raw?.has_warning_indicators === true;
    });
    rows.push({
      dateKey,
      entryIds: dayEntries.map((e) => e.id),
      mood100: moods.length ? mean(moods) * 100 : null,
      tags: mergeArrayField(dayEntries.map((e) => e.tags)),
      entities: mergeArrayField(dayEntries.map((e) => e.entities)),
      category: (() => {
        const known = dayEntries.map((e) => e.category).filter((c) => !isUnknown(c));
        return known.length ? String(known[0]).toLowerCase() : UNKNOWN;
      })(),
      healthSignals: Object.keys(healthNumeric).length ? healthNumeric : null,
      sensitive,
    });
  }
  return rows.sort((a, b) => (a.dateKey < b.dateKey ? -1 : 1));
}

export function observationSeriesFor(observations, spec) {
  const out = [];
  for (const row of observations) {
    if (spec.kind === 'health') {
      const v = row.healthSignals?.[spec.field];
      if (Number.isFinite(v)) out.push({ dateKey: row.dateKey, value: v });
      continue;
    }
    const container = spec.kind === 'tag' ? row.tags
      : spec.kind === 'entity' ? row.entities
      : spec.kind === 'category' ? row.category
      : UNKNOWN;
    if (isUnknown(container)) continue; // unknown ≠ absent: omit the day entirely
    const target = spec.key.slice(spec.key.indexOf(':') + 1);
    const present = spec.kind === 'category'
      ? container === target
      : container.includes(target);
    out.push({ dateKey: row.dateKey, value: present ? 1 : 0 });
  }
  return out;
}

export function moodSeriesFor(observations) {
  return observations
    .filter((r) => Number.isFinite(r.mood100))
    .map((r) => ({ dateKey: r.dateKey, value: r.mood100 }));
}

export function enumerateExposures(observations, { minPresentDays = 3, minHealthDays = 5 } = {}) {
  const presentDays = new Map(); // 'tag:gym' -> count of days present
  const healthDays = new Map();
  for (const row of observations) {
    if (!isUnknown(row.tags)) row.tags.forEach((t) => bump(presentDays, `tag:${t}`));
    if (!isUnknown(row.entities)) row.entities.forEach((e) => bump(presentDays, `entity:${e}`));
    if (!isUnknown(row.category) && row.category) bump(presentDays, `category:${row.category}`);
    for (const field of HEALTH_EXPOSURE_FIELDS) {
      if (Number.isFinite(row.healthSignals?.[field])) bump(healthDays, field);
    }
  }
  const specs = [];
  for (const [key, count] of presentDays.entries()) {
    if (count < minPresentDays) continue;
    const [kind, ...rest] = key.split(':');
    specs.push({ key, kind, label: rest.join(':'), splitMode: 'binary' });
  }
  for (const [field, count] of healthDays.entries()) {
    if (count < minHealthDays) continue;
    specs.push({
      key: `health:${field}`, kind: 'health', field,
      label: field.replace(/_/g, ' '), splitMode: 'median',
    });
  }
  return specs.sort((a, b) => (a.key < b.key ? -1 : 1));
}

function bump(map, key) { map.set(key, (map.get(key) || 0) + 1); }
```

Note for implementer: verify the exact key names `entryAdapter.js` emits inside `healthSignals` (read `extractHealthSignals` usage in the adapter) and align `HEALTH_EXPOSURE_FIELDS` to the real keys — the test fixture must use the real raw-entry shape (`healthContext.sleep.hoursSlept` style) that the adapter maps. Adjust fixtures if the adapter emits e.g. `sleepHours` instead of `sleep_hours`; the CONTRACT (numeric per-day mean, omit-when-absent) is what matters, not the literal key spelling.

- [ ] **Step 4: Run to verify pass** — `npx vitest run src/services/insights/__tests__/observations.test.js` → PASS. Also `npx vitest run src/services/insights` (no regressions).

- [ ] **Step 5: Commit** — `git add src/services/insights/observations.js src/services/insights/__tests__/observations.test.js && git commit -m "feat(r4p1): daily observation rollup module (pure, tri-state)" -- src/services/insights/observations.js src/services/insights/__tests__/observations.test.js`

---

### Task 2: Estimator `ciLevel` + hypothesis-family testing ledger

**Files:**
- Modify: `src/services/experiments/estimator.js` (thread `plan.ciLevel` into the bootstrap percentile computation)
- Create: `src/services/insights/testingLedger.js`
- Modify: `firestore.rules` (add `testing_ledger` block after the `experiments` block, line ~451)
- Test: `src/services/experiments/__tests__/estimator.ciLevel.test.js`, `src/services/insights/__tests__/testingLedger.test.js`, extend `functions/src/__tests__/firestoreRules.test.js`

**Interfaces:**
- Consumes: `runAnalysisPlan({pairs, plan, seed})` (existing; only reads new optional `plan.ciLevel`).
- Produces: `runAnalysisPlan` honors `plan.ciLevel` ∈ (0,1) (default `CI_LEVEL = 0.95`, invalid values → default); `familyIdForBasic(engineKey, exposureKey)` → `` `basic:${engineKey}:${exposureKey}:mood` ``; `familyIdForExperiment(templateId, tag)` → `` `experiment:${templateId}` `` or `` `experiment:${templateId}:tag:${lowercased tag}` ``; `bonferroniCiLevel(testedCount, alpha = 0.05)` → `testedCount <= 1 ? 1 - alpha : 1 - alpha / testedCount`; `async registerCandidates(db, uid, familyId, candidateIds, {now})` → `{testedCount}` (monotonic, distinct-candidate counting, idempotent per candidateId); `async readLedgerCounts(db, uid, familyIds)` → `Map<familyId, number>`; `ledgerDocIdFor(familyId)` (Firestore-safe doc id: replace `/` with `__` — colons are legal).

- [ ] **Step 1: Failing tests for `ciLevel`**

```js
// src/services/experiments/__tests__/estimator.ciLevel.test.js
import { describe, it, expect } from 'vitest';
import { runAnalysisPlan } from '../estimator';

// 24 paired days, clear 2-group structure, enough for a stable bootstrap.
const pairs = Array.from({ length: 24 }, (_, i) => ({
  dateKey: `2026-06-${String(i + 1).padStart(2, '0')}`,
  outcomeDateKey: `2026-06-${String(i + 1).padStart(2, '0')}`,
  exposure: i % 2 === 0 ? 8 : 5,
  outcome: (i % 2 === 0 ? 70 : 55) + (i % 3), // deterministic jitter
}));

describe('runAnalysisPlan plan.ciLevel', () => {
  it('default (no ciLevel) reproduces the existing 0.95 interval exactly', () => {
    const base = runAnalysisPlan({ pairs, plan: {} });
    const explicit = runAnalysisPlan({ pairs, plan: { ciLevel: 0.95 } });
    expect(base.status).toBe('ok');
    expect(explicit.estimate.ci).toEqual(base.estimate.ci);
  });

  it('a higher ciLevel produces an interval at least as wide', () => {
    const p95 = runAnalysisPlan({ pairs, plan: { ciLevel: 0.95 } });
    const p995 = runAnalysisPlan({ pairs, plan: { ciLevel: 0.995 } });
    const width = (r) => r.estimate.ci[1] - r.estimate.ci[0];
    expect(width(p995)).toBeGreaterThanOrEqual(width(p95));
  });

  it('invalid ciLevel values fall back to the default', () => {
    for (const bad of [0, 1, -1, 2, NaN, 'wide']) {
      const r = runAnalysisPlan({ pairs, plan: { ciLevel: bad } });
      expect(r.estimate.ci).toEqual(runAnalysisPlan({ pairs, plan: {} }).estimate.ci);
    }
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run src/services/experiments/__tests__/estimator.ciLevel.test.js` → FAIL (ciLevel ignored → widths equal on test 2, or ci differs — verify it fails for the RIGHT reason: test 2 must fail because widths are equal).

- [ ] **Step 3: Implement in `estimator.js`** — in `runAnalysisPlan` (L714 area), resolve once near the top where `splitMode`/`minExposureContrast` are resolved:

```js
const ciLevel = Number.isFinite(plan.ciLevel) && plan.ciLevel > 0 && plan.ciLevel < 1
  ? plan.ciLevel
  : CI_LEVEL;
```

Thread `ciLevel` into `bootstrapDeltaCIPerResampleSplit` (add a `ciLevel = CI_LEVEL` parameter; replace the hardcoded percentile bounds with `alphaHalf = (1 - ciLevel) / 2` → percentiles `alphaHalf` and `1 - alphaHalf`). Do NOT change `CI_LEVEL` or any default path. Keep the function signature backward-compatible (new param last, defaulted).

- [ ] **Step 4: Run** — new file PASS, plus `npx vitest run src/services/experiments` → all experiments suites green (byte-identical default behavior is the regression claim; the existing estimator tests enforce it).

- [ ] **Step 5: Failing tests for the ledger**

```js
// src/services/insights/__tests__/testingLedger.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../config/constants', () => ({ APP_COLLECTION_ID: 'echo-vault-v5-fresh' }));
const store = new Map(); // docPath -> data
vi.mock('../../../config/firebase', () => ({}));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn((db, ...segs) => ({ path: segs.join('/') })),
  getDoc: vi.fn(async (ref) => ({ exists: () => store.has(ref.path), data: () => store.get(ref.path) })),
  setDoc: vi.fn(async (ref, data, opts) => {
    store.set(ref.path, opts?.merge ? { ...(store.get(ref.path) || {}), ...data } : data);
  }),
  runTransaction: vi.fn(async (db, fn) => fn({
    get: async (ref) => ({ exists: () => store.has(ref.path), data: () => store.get(ref.path) }),
    set: (ref, data) => store.set(ref.path, data),
  })),
}));

import {
  familyIdForBasic, familyIdForExperiment, bonferroniCiLevel,
  registerCandidates, readLedgerCounts, ledgerDocIdFor,
} from '../testingLedger';

beforeEach(() => store.clear());
const NOW = '2026-07-22T10:00:00.000Z';

describe('family ids and correction', () => {
  it('builds stable family ids', () => {
    expect(familyIdForBasic('activity', 'tag:gym')).toBe('basic:activity:tag:gym:mood');
    expect(familyIdForExperiment('steps-mood')).toBe('experiment:steps-mood');
    expect(familyIdForExperiment('tag-presence-mood', 'Gym')).toBe('experiment:tag-presence-mood:tag:gym');
  });
  it('bonferroniCiLevel: 1 test -> 0.95; m tests -> 1 - 0.05/m', () => {
    expect(bonferroniCiLevel(1)).toBeCloseTo(0.95);
    expect(bonferroniCiLevel(0)).toBeCloseTo(0.95);
    expect(bonferroniCiLevel(10)).toBeCloseTo(0.995);
  });
});

describe('registerCandidates', () => {
  it('counts DISTINCT candidates; re-registering the same candidate never inflates m', async () => {
    const r1 = await registerCandidates({}, 'u1', 'basic:activity:mood', ['tag:gym', 'tag:run'], { now: NOW });
    expect(r1.testedCount).toBe(2);
    const r2 = await registerCandidates({}, 'u1', 'basic:activity:mood', ['tag:gym'], { now: NOW });
    expect(r2.testedCount).toBe(2); // rerun of same candidate: same ledger row
    const r3 = await registerCandidates({}, 'u1', 'basic:activity:mood', ['tag:swim'], { now: NOW });
    expect(r3.testedCount).toBe(3);
  });

  it('inconclusive candidates count: registration happens before analysis, so there is no outcome parameter at all', async () => {
    // API-shape assertion: registerCandidates takes no outcome/status argument.
    expect(registerCandidates.length).toBeLessThanOrEqual(5);
  });
});

describe('readLedgerCounts', () => {
  it('returns 0 for families never tested', async () => {
    await registerCandidates({}, 'u1', 'famA', ['x'], { now: NOW });
    const counts = await readLedgerCounts({}, 'u1', ['famA', 'famB']);
    expect(counts.get('famA')).toBe(1);
    expect(counts.get('famB')).toBe(0);
  });
});

describe('ledgerDocIdFor', () => {
  it('produces a Firestore-legal doc id (no forward slashes)', () => {
    expect(ledgerDocIdFor('experiment:tag-presence-mood:tag:a/b')).not.toContain('/');
  });
});
```

- [ ] **Step 6: Run** → FAIL. **Implement `src/services/insights/testingLedger.js`:**

```js
/**
 * Hypothesis-family testing ledger (R4 Phase 1, DR stat-req 9).
 * Every candidate hypothesis is registered BEFORE analysis, so inconclusive
 * and abstained candidates still count toward the family's multiple-testing
 * burden. m = number of DISTINCT candidates ever tested in the family;
 * reruns of the same candidate (new window, new data) do not inflate m.
 * Storage: artifacts/{APP}/users/{uid}/testing_ledger/{ledgerDocIdFor(familyId)}
 */
import { doc, getDoc, runTransaction } from 'firebase/firestore';
import { APP_COLLECTION_ID } from '../../config/constants';

export const LEDGER_ALPHA = 0.05;

export function familyIdForBasic(engineKey, exposureKey) {
  return `basic:${engineKey}:${exposureKey}:mood`;
}

export function familyIdForExperiment(templateId, tag) {
  return tag == null
    ? `experiment:${templateId}`
    : `experiment:${templateId}:tag:${String(tag).toLowerCase()}`;
}

export function bonferroniCiLevel(testedCount, alpha = LEDGER_ALPHA) {
  const m = Number.isFinite(testedCount) && testedCount > 1 ? testedCount : 1;
  return 1 - alpha / m;
}

export function ledgerDocIdFor(familyId) {
  return String(familyId).replace(/\//g, '__');
}

function ledgerRef(db, uid, familyId) {
  return doc(db, 'artifacts', APP_COLLECTION_ID, 'users', uid,
    'testing_ledger', ledgerDocIdFor(familyId));
}

/**
 * Idempotently add candidateIds to the family ledger. Returns {testedCount}
 * AFTER the merge — callers freeze this count (and the ciLevel derived from
 * it) into the analysis plan BEFORE running the estimator.
 */
export async function registerCandidates(db, uid, familyId, candidateIds, { now } = {}) {
  const at = now || new Date().toISOString();
  const ref = ledgerRef(db, uid, familyId);
  let testedCount = 0;
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const existing = snap.exists() ? snap.data() : null;
    const candidates = { ...(existing?.candidates || {}) };
    for (const id of candidateIds) {
      const prior = candidates[id];
      candidates[id] = prior
        ? { ...prior, lastTestedAt: at, timesTested: (prior.timesTested || 1) + 1 }
        : { firstTestedAt: at, lastTestedAt: at, timesTested: 1 };
    }
    testedCount = Object.keys(candidates).length;
    tx.set(ref, {
      familyId, candidates, testedCount,
      createdAt: existing?.createdAt || at, updatedAt: at,
    });
  });
  return { testedCount };
}

export async function readLedgerCounts(db, uid, familyIds) {
  const out = new Map();
  await Promise.all(familyIds.map(async (familyId) => {
    const snap = await getDoc(ledgerRef(db, uid, familyId));
    out.set(familyId, snap.exists() ? (snap.data().testedCount || 0) : 0);
  }));
  return out;
}
```

(If the mocked `runTransaction` signature in the test doesn't match the implementer's import order, fix the TEST mock, not the contract.)

- [ ] **Step 7: firestore.rules block** — insert after the `experiments` match block (~line 451):

```
      // R4 Phase 1: hypothesis-family testing ledger. Append-only in spirit:
      // testedCount may never decrease (the multiple-testing count must be
      // durable even when candidates are inconclusive or later suppressed).
      match /testing_ledger/{ledgerId} {
        allow read, delete: if isOwner(userId);
        allow create: if isOwner(userId)
          && request.resource.data.keys().hasOnly(['familyId', 'candidates', 'testedCount', 'createdAt', 'updatedAt'])
          && request.resource.data.testedCount is int
          && request.resource.data.testedCount >= 0;
        allow update: if isOwner(userId)
          && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['candidates', 'testedCount', 'updatedAt'])
          && request.resource.data.testedCount is int
          && request.resource.data.testedCount >= resource.data.testedCount;
      }
```

Add emulator tests in `functions/src/__tests__/firestoreRules.test.js` (follow the experiments block's test pattern): owner create OK with exact keys; create with extra key DENIED; update lowering `testedCount` DENIED; update touching `familyId`/`createdAt` DENIED; non-owner read DENIED.

- [ ] **Step 8: Run** — `npx vitest run src/services/insights/__tests__/testingLedger.test.js src/services/experiments` → PASS; `npm run test:rules` → PASS.

- [ ] **Step 9: Commit** — `git add src/services/experiments/estimator.js src/services/experiments/__tests__/estimator.ciLevel.test.js src/services/insights/testingLedger.js src/services/insights/__tests__/testingLedger.test.js firestore.rules functions/src/__tests__/firestoreRules.test.js && git commit -m "feat(r4p1): plan.ciLevel in estimator + hypothesis-family testing ledger (Bonferroni, count-before-analyze)" -- <same paths>`

---

### Task 3: InsightClaim schema, store service, and rules

**Files:**
- Create: `src/services/insights/claims/claimSchema.js`, `src/services/insights/claims/claimsService.js`
- Modify: `firestore.rules` (add `insight_claims` block after `testing_ledger`)
- Test: `src/services/insights/claims/__tests__/claimSchema.test.js`, `src/services/insights/claims/__tests__/claimsService.test.js`, extend `functions/src/__tests__/firestoreRules.test.js`

**Interfaces:**
- Consumes: nothing from other Phase-1 tasks (schema is standalone; T5/T6 build objects that must pass `buildClaim`).
- Produces:
  - `claimSchema.js`: `CLAIM_TYPES = ['observation','pattern_to_watch','experiment_result']`; `CLAIM_STATUSES = ['candidate','verified','suppressed','expired']`; `CLAIM_DIRECTIONS = ['positive','negative']`; `CLAIM_TOP_LEVEL_KEYS` (the exact rules allow-list, exported for the JS↔rules parity test); `buildClaim(input)` → validated claim doc (throws on malformed — the "LLM must not author evidence" seam: `evidence` must be an object of finite numbers/arrays per shape below, `wording` a string); `claimDocId({familyId, candidateId, version})` → `` `claim_${slug}_v${version}` `` (deterministic; `slug` = familyId+candidateId lowercased, non `[a-z0-9]` → `-`, collapsed).
  - `claimsService.js`: `async writeClaim(db, uid, claim)` (setDoc, id from `claimDocId`); `async listActiveClaims(db, uid)` → claims with `supersededByClaimId == null && status in ['verified','candidate']`, sorted `createdAt` desc; `async supersedeClaim(db, uid, oldClaim, newClaim)` (batch: write new + update old `{supersededByClaimId: newClaim.id, updatedAt}`; throws if `newClaim.parentClaimId !== oldClaim.id`); `async setClaimStatus(db, uid, claimId, status)` (only `'suppressed'`/`'verified'` allowed from app code); `evidenceEquivalent(a, b)` → boolean (same direction, same day counts, `effectMoodPoints` within 0.5).
- Collection: `artifacts/{APP}/users/{uid}/insight_claims/{claimId}`.

- [ ] **Step 1: Failing schema tests**

```js
// src/services/insights/claims/__tests__/claimSchema.test.js
import { describe, it, expect } from 'vitest';
import { buildClaim, claimDocId, CLAIM_TYPES, CLAIM_STATUSES, CLAIM_TOP_LEVEL_KEYS } from '../claimSchema';

const NOW = '2026-07-22T10:00:00.000Z';
const validPlan = {
  frozenAt: NOW, hypothesisFamilyId: 'basic:activity:tag:gym:mood', candidateId: 'tag:gym',
  candidateTestsCount: 4, ciLevel: 0.9875, outcomeUnit: 'mood_0_100', timezone: 'America/Los_Angeles',
  datePolicy: 'user_local_calendar_day', exposureDefinition: 'day includes tag "gym"',
  outcomeDefinition: 'daily mean mood (0-100)', lagDays: 0, splitMode: 'binary',
  minExposureContrast: 0, minimumTotalDays: 14, minimumSpanDays: 21,
  practicalEffectFloorMoodPoints: 5, adapterVersion: 1, observationSchemaVersion: 1,
  evidenceBuilderVersion: 1,
  estimatorThresholds: { minPairedObservations: 10, minGroupSize: 5, minGroupFraction: 0.25, bootstrapResamples: 2000 },
};
const validEvidence = {
  sourceEntryIds: ['e1', 'e2'], hiddenSensitiveSourceCount: 1,
  totalCandidateDayCount: 24, exposedDayCount: 9, comparisonDayCount: 15,
  observedSpanDays: 34, exposureContrast: 1, effectMoodPoints: 7.2,
  stabilityInterval: [2.1, 12.3], leaveOneDayOutDirectionStable: true,
  exposureCoverage: 0.8, outcomeCoverage: 0.75, representativeness: 'unknown',
};
const valid = () => ({
  version: 1, parentClaimId: null, claimType: 'pattern_to_watch',
  subject: 'gym', outcome: 'mood', direction: 'positive',
  questionWording: 'How did gym days and mood move together in your recorded days?',
  wording: 'On days you logged gym, recorded mood averaged 7 points higher (9 vs 15 days).',
  limitations: ['Same-day association only.'],
  analysisPlan: validPlan, evidence: validEvidence,
  receipt: { sources: [], scope: null, timeWindow: { start: NOW, end: NOW }, sampleSize: 24, missingness: null, versions: { generator: 'insight_claims', computationVersion: 1, generatedAt: NOW, model: null, promptVersion: null } },
  status: 'verified',
  provenance: { generatorVersion: 2, evidenceBuilderVersion: 1, wordingSource: 'deterministic_template_v1' },
  createdAt: NOW, updatedAt: NOW,
});

describe('buildClaim', () => {
  it('accepts a fully valid claim and stamps id + supersededByClaimId:null', () => {
    const claim = buildClaim(valid());
    expect(claim.id).toBe(claimDocId({ familyId: validPlan.hypothesisFamilyId, candidateId: validPlan.candidateId, version: 1 }));
    expect(claim.supersededByClaimId).toBeNull();
  });
  it('rejects unknown claimType/status/direction', () => {
    expect(() => buildClaim({ ...valid(), claimType: 'insight' })).toThrow();
    expect(() => buildClaim({ ...valid(), status: 'shipped' })).toThrow();
    expect(() => buildClaim({ ...valid(), direction: 'mixed' })).toThrow();
  });
  it('rejects causal verbs in wording/questionWording (communication integrity, DR gate 7)', () => {
    for (const bad of ['gym boosts your mood', 'walking causes better mood', 'sleep improves your mood']) {
      expect(() => buildClaim({ ...valid(), wording: bad })).toThrow(/causal/i);
    }
  });
  it('rejects evidence with non-finite numbers or missing reconciliation fields', () => {
    expect(() => buildClaim({ ...valid(), evidence: { ...validEvidence, effectMoodPoints: NaN } })).toThrow();
    const { hiddenSensitiveSourceCount, ...rest } = validEvidence;
    expect(() => buildClaim({ ...valid(), evidence: rest })).toThrow(/hiddenSensitiveSourceCount/);
  });
  it('rejects a plan whose frozenAt is missing (design validity, DR gate 2)', () => {
    const { frozenAt, ...plan } = validPlan;
    expect(() => buildClaim({ ...valid(), analysisPlan: plan })).toThrow(/frozenAt/);
  });
  it('CLAIM_TOP_LEVEL_KEYS matches exactly the keys buildClaim emits (rules parity source)', () => {
    expect(Object.keys(buildClaim(valid())).sort()).toEqual([...CLAIM_TOP_LEVEL_KEYS].sort());
  });
});
```

- [ ] **Step 2: Run** → FAIL. **Implement `claimSchema.js`:**

```js
/**
 * InsightClaim schema (R4 Phase 1, DR "canonical claim object", adapted to
 * Engram's receipts/plan-freeze primitives). buildClaim is the single
 * construction path: deterministic code authors evidence; an LLM may (in
 * Phase 2) author `wording` ONLY — and even that is validated here for
 * causal language before a claim can exist.
 */
export const CLAIM_TYPES = Object.freeze(['observation', 'pattern_to_watch', 'experiment_result']);
export const CLAIM_STATUSES = Object.freeze(['candidate', 'verified', 'suppressed', 'expired']);
export const CLAIM_DIRECTIONS = Object.freeze(['positive', 'negative']);

// Keep identical to the firestore.rules insight_claims create hasOnly list.
export const CLAIM_TOP_LEVEL_KEYS = Object.freeze([
  'id', 'version', 'parentClaimId', 'supersededByClaimId', 'claimType',
  'subject', 'outcome', 'direction', 'questionWording', 'wording',
  'limitations', 'analysisPlan', 'evidence', 'receipt', 'status',
  'provenance', 'createdAt', 'updatedAt',
]);

// Non-causal copy is an integrity surface (DR gate 7). Deterministic Phase-1
// wording never uses these; the check also protects Phase-2 LLM wording.
const CAUSAL_RE = /\b(boosts?|causes?|caused|improves?|improved|makes? you|leads? to|results? in|because of your)\b/i;

const REQUIRED_PLAN_KEYS = ['frozenAt', 'hypothesisFamilyId', 'candidateId',
  'candidateTestsCount', 'ciLevel', 'outcomeUnit', 'timezone', 'datePolicy',
  'exposureDefinition', 'outcomeDefinition', 'lagDays', 'splitMode',
  'minimumTotalDays', 'minimumSpanDays', 'practicalEffectFloorMoodPoints',
  'adapterVersion', 'observationSchemaVersion', 'evidenceBuilderVersion',
  'estimatorThresholds'];

const EVIDENCE_NUMBER_KEYS = ['hiddenSensitiveSourceCount', 'totalCandidateDayCount',
  'exposedDayCount', 'comparisonDayCount', 'observedSpanDays', 'exposureContrast',
  'effectMoodPoints', 'exposureCoverage', 'outcomeCoverage'];

function req(cond, msg) { if (!cond) throw new Error(`claim: ${msg}`); }
const isStr = (v) => typeof v === 'string' && v.trim() !== '';
const isFin = (v) => typeof v === 'number' && Number.isFinite(v);

export function claimDocId({ familyId, candidateId, version }) {
  const slug = `${familyId}_${candidateId}`.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `claim_${slug}_v${version}`;
}

export function buildClaim(input) {
  req(input && typeof input === 'object', 'input required');
  const {
    version, parentClaimId = null, claimType, subject, outcome, direction,
    questionWording, wording, limitations, analysisPlan, evidence, receipt,
    status, provenance, createdAt, updatedAt,
  } = input;

  req(Number.isInteger(version) && version >= 1, 'version must be an integer >= 1');
  req(parentClaimId === null || isStr(parentClaimId), 'parentClaimId must be string|null');
  req(version === 1 ? parentClaimId === null : isStr(parentClaimId),
    'version 1 has no parent; version > 1 requires parentClaimId');
  req(CLAIM_TYPES.includes(claimType), `unknown claimType "${claimType}"`);
  req(CLAIM_STATUSES.includes(status), `unknown status "${status}"`);
  req(CLAIM_DIRECTIONS.includes(direction), `unknown direction "${direction}"`);
  req(isStr(subject) && isStr(outcome), 'subject/outcome required');
  req(isStr(questionWording) && isStr(wording), 'questionWording/wording required');
  req(!CAUSAL_RE.test(wording) && !CAUSAL_RE.test(questionWording),
    'causal language rejected in claim wording');
  req(Array.isArray(limitations) && limitations.every(isStr), 'limitations must be string[]');

  req(analysisPlan && typeof analysisPlan === 'object', 'analysisPlan required');
  for (const k of REQUIRED_PLAN_KEYS) req(analysisPlan[k] !== undefined && analysisPlan[k] !== null, `analysisPlan.${k} required (frozen before analysis)`);
  req(isFin(analysisPlan.ciLevel) && analysisPlan.ciLevel > 0 && analysisPlan.ciLevel < 1, 'analysisPlan.ciLevel in (0,1)');

  req(evidence && typeof evidence === 'object', 'evidence required');
  req(Array.isArray(evidence.sourceEntryIds) && evidence.sourceEntryIds.every(isStr), 'evidence.sourceEntryIds must be string[]');
  for (const k of EVIDENCE_NUMBER_KEYS) req(isFin(evidence[k]), `evidence.${k} must be a finite number (deterministic code authors evidence)`);
  req(Array.isArray(evidence.stabilityInterval) && evidence.stabilityInterval.length === 2
    && evidence.stabilityInterval.every(isFin), 'evidence.stabilityInterval must be [lo, hi]');
  req(typeof evidence.leaveOneDayOutDirectionStable === 'boolean', 'evidence.leaveOneDayOutDirectionStable must be boolean');
  req(evidence.representativeness === 'unknown' || evidence.representativeness === 'limited', 'evidence.representativeness');

  req(receipt && typeof receipt === 'object' && Array.isArray(receipt.sources), 'receipt required (buildReceipt shape)');
  req(provenance && isFin(provenance.generatorVersion) && isFin(provenance.evidenceBuilderVersion)
    && isStr(provenance.wordingSource), 'provenance required');
  req(isStr(createdAt) && isStr(updatedAt), 'createdAt/updatedAt required');

  return {
    id: claimDocId({ familyId: analysisPlan.hypothesisFamilyId, candidateId: analysisPlan.candidateId, version }),
    version,
    parentClaimId,
    supersededByClaimId: null,
    claimType, subject, outcome, direction, questionWording, wording,
    limitations: [...limitations],
    analysisPlan: { ...analysisPlan },
    evidence: { ...evidence, sourceEntryIds: [...evidence.sourceEntryIds] },
    receipt, status,
    provenance: { ...provenance },
    createdAt, updatedAt,
  };
}
```

- [ ] **Step 3: Run schema tests** → PASS.

- [ ] **Step 4: Failing service tests** — mock `firebase/firestore` (`doc/getDocs/collection/query/where/writeBatch/setDoc/updateDoc` with a Map-backed store, per testingLedger test pattern) and assert: `writeClaim` writes at `insight_claims/{claim.id}`; `listActiveClaims` filters superseded + suppressed/expired; `supersedeClaim` writes the new claim AND stamps the old one's `supersededByClaimId` in one batch, throwing on a lineage mismatch; `setClaimStatus` rejects statuses other than `'suppressed'`/`'verified'`; `evidenceEquivalent` true for identical rounded evidence, false when direction or day counts differ or delta moves > 0.5.

- [ ] **Step 5: Implement `claimsService.js`:**

```js
/**
 * InsightClaim store (R4 Phase 1). Claims are immutable facts: app code may
 * only (a) create, (b) set supersededByClaimId when a newer version replaces
 * one, (c) flip status verified<->suppressed (user feedback). History is
 * never deleted by the app (owner delete stays possible in rules — user
 * data rights — but no code path calls it).
 */
import {
  collection, doc, getDocs, setDoc, updateDoc, writeBatch,
} from 'firebase/firestore';
import { APP_COLLECTION_ID } from '../../../config/constants';
import { buildClaim } from './claimSchema';

const claimsCol = (db, uid) => collection(db, 'artifacts', APP_COLLECTION_ID, 'users', uid, 'insight_claims');
const claimRef = (db, uid, id) => doc(db, 'artifacts', APP_COLLECTION_ID, 'users', uid, 'insight_claims', id);

export async function writeClaim(db, uid, claim) {
  const validated = buildClaim(claim); // construction path is the validator
  await setDoc(claimRef(db, uid, validated.id), validated);
  return validated;
}

export async function listActiveClaims(db, uid) {
  const snap = await getDocs(claimsCol(db, uid));
  return snap.docs.map((d) => d.data())
    .filter((c) => c.supersededByClaimId == null && (c.status === 'verified' || c.status === 'candidate'))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function listAllClaims(db, uid) {
  const snap = await getDocs(claimsCol(db, uid));
  return snap.docs.map((d) => d.data());
}

export async function supersedeClaim(db, uid, oldClaim, newClaim) {
  if (newClaim.parentClaimId !== oldClaim.id) {
    throw new Error('supersedeClaim: newClaim.parentClaimId must link the old claim (lineage is explicit, never implicit)');
  }
  const validated = buildClaim(newClaim);
  const batch = writeBatch(db);
  batch.set(claimRef(db, uid, validated.id), validated);
  batch.update(claimRef(db, uid, oldClaim.id), {
    supersededByClaimId: validated.id, updatedAt: validated.updatedAt,
  });
  await batch.commit();
  return validated;
}

export async function setClaimStatus(db, uid, claimId, status, { now } = {}) {
  if (status !== 'suppressed' && status !== 'verified') {
    throw new Error(`setClaimStatus: app code may only toggle suppressed/verified, got "${status}"`);
  }
  await updateDoc(claimRef(db, uid, claimId), {
    status, updatedAt: now || new Date().toISOString(),
  });
}

/** Same discovery? (used to avoid claim churn when evidence barely moves) */
export function evidenceEquivalent(a, b) {
  return a.direction === b.direction
    && a.evidence.exposedDayCount === b.evidence.exposedDayCount
    && a.evidence.comparisonDayCount === b.evidence.comparisonDayCount
    && Math.abs(a.evidence.effectMoodPoints - b.evidence.effectMoodPoints) <= 0.5;
}
```

- [ ] **Step 6: firestore.rules block** (after `testing_ledger`):

```
      // R4 Phase 1: canonical InsightClaim store. Claims are immutable facts —
      // after create, only supersede-pointer, status, and updatedAt may change.
      // Corrections create a NEW claim version; history is never rewritten.
      match /insight_claims/{claimId} {
        allow read, delete: if isOwner(userId);
        allow create: if isOwner(userId)
          && request.resource.data.keys().hasOnly(['id', 'version', 'parentClaimId', 'supersededByClaimId', 'claimType', 'subject', 'outcome', 'direction', 'questionWording', 'wording', 'limitations', 'analysisPlan', 'evidence', 'receipt', 'status', 'provenance', 'createdAt', 'updatedAt'])
          && request.resource.data.status in ['candidate', 'verified', 'suppressed', 'expired']
          && request.resource.data.version is int
          && request.resource.data.version >= 1;
        allow update: if isOwner(userId)
          && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status', 'supersededByClaimId', 'updatedAt'])
          && request.resource.data.status in ['candidate', 'verified', 'suppressed', 'expired'];
      }
```

Emulator tests: create OK; create with extra key DENIED; update to `wording`/`evidence`/`analysisPlan` DENIED; update status+updatedAt OK; non-owner DENIED.

- [ ] **Step 7: Run all** — `npx vitest run src/services/insights/claims` PASS; `npm run test:rules` PASS.

- [ ] **Step 8: Commit** — `git add src/services/insights/claims firestore.rules functions/src/__tests__/firestoreRules.test.js && git commit -m "feat(r4p1): InsightClaim schema + immutable claim store + rules" -- src/services/insights/claims firestore.rules functions/src/__tests__/firestoreRules.test.js`

---

### Task 4: Typed assertions in intent extraction (DR finding 13)

**Files:**
- Modify: `functions/src/intents/intentSchema.js` (assertion vocab + derivation + buildIntent validation; SCHEMA_VERSION → 2)
- Modify: `functions/src/intents/extractIntents.js` (prompt gains `tense`; `normalizeCandidates` validates it; `buildIntent` call passes derived assertion)
- Test: `functions/src/intents/__tests__/` (extend existing suites in place; add `assertionTyping.test.js`)

**Interfaces:**
- Consumes: existing `INTENT_KINDS`, `INTENT_ATTRIBUTE_KEYS` (`agency, concrete, unfinished, temporalFit, negated, quoted, conditional, goalLanguage, otherOwned, completed`).
- Produces (new exports from `intentSchema.js`):
  - `ASSERTION_ACTORS = ['user','other','unknown']`, `ASSERTION_TYPES = ['task','intention','possibility','event','belief','feeling','observation']`, `ASSERTION_STATUSES = ['considered','committed','started','completed','cancelled','unknown']`, `ASSERTION_TENSES = ['past','current','future','recurring','unknown']`, `ASSERTION_POLARITIES = ['affirmed','negated','uncertain']`.
  - `deriveAssertion(kind, attributes, { tense = 'unknown' } = {})` → `{actor, type, status, tense, polarity}` — DETERMINISTIC mapping (no LLM authority over typing beyond `tense`):
    - actor: `attributes.otherOwned ? 'other' : (attributes.quoted ? 'unknown' : 'user')`
    - polarity: `attributes.negated ? 'negated' : (attributes.conditional || attributes.quoted ? 'uncertain' : 'affirmed')`
    - status: `attributes.completed ? 'completed' : (attributes.agency && attributes.concrete ? 'committed' : 'considered')`
    - type by kind: `task→'task'`, `open_loop→'intention'`, `goal_habit→'intention'`, `conditional→'possibility'`, `event→'event'`, `completed→'event'`, `reflection→'observation'`, `external_action→'event'`
    - tense: validated enum passthrough, default `'unknown'`.
  - `buildIntent` accepts optional `assertion` (validated against the five enums when present; docs built by v2 extraction ALWAYS carry it); `versions.schema` becomes 2 when assertion present, stays 1 otherwise (backward compat: v1 docs and readers unaffected — `assertion` is additive, NOT in `CLIENT_MUTABLE_KEYS`).

- [ ] **Step 1: Failing tests** (`functions/src/intents/__tests__/assertionTyping.test.js`) — full derivation matrix:

```js
import { describe, it, expect } from 'vitest';
import { deriveAssertion, buildIntent, ASSERTION_TYPES } from '../intentSchema.js';

const attrs = (over = {}) => ({
  agency: true, concrete: true, unfinished: true, temporalFit: true,
  negated: false, quoted: false, conditional: false, goalLanguage: false,
  otherOwned: false, completed: false, ...over,
});

describe('deriveAssertion', () => {
  it('"someone asked me to X" (otherOwned) is NOT the user\'s assertion', () => {
    expect(deriveAssertion('task', attrs({ otherOwned: true })).actor).toBe('other');
  });
  it('negation wins polarity; conditional/quoted degrade to uncertain', () => {
    expect(deriveAssertion('task', attrs({ negated: true })).polarity).toBe('negated');
    expect(deriveAssertion('task', attrs({ conditional: true })).polarity).toBe('uncertain');
    expect(deriveAssertion('task', attrs()).polarity).toBe('affirmed');
  });
  it('"I should maybe call" (no concrete commitment) is considered, not committed', () => {
    expect(deriveAssertion('task', attrs({ concrete: false })).status).toBe('considered');
    expect(deriveAssertion('task', attrs()).status).toBe('committed');
    expect(deriveAssertion('task', attrs({ completed: true })).status).toBe('completed');
  });
  it('maps every INTENT_KIND to a valid assertion type', () => {
    for (const [kind, type] of Object.entries({
      task: 'task', open_loop: 'intention', goal_habit: 'intention',
      conditional: 'possibility', event: 'event', completed: 'event',
      reflection: 'observation', external_action: 'event',
    })) {
      const a = deriveAssertion(kind, attrs());
      expect(a.type).toBe(type);
      expect(ASSERTION_TYPES).toContain(a.type);
    }
  });
  it('invalid tense collapses to unknown', () => {
    expect(deriveAssertion('task', attrs(), { tense: 'yesterday-ish' }).tense).toBe('unknown');
    expect(deriveAssertion('task', attrs(), { tense: 'past' }).tense).toBe('past');
  });
});

describe('buildIntent with assertion', () => {
  const base = {
    id: 'i1', ownerId: 'u1', entryId: 'e1', kind: 'task', state: 'abstain',
    sourceSpan: { start: 0, end: 10, text: 'call the bank' },
    attributes: attrs(), confidence: 0.9, activationReason: 'test', model: 'test-model',
  };
  it('stamps versions.schema = 2 when assertion present, 1 when absent', () => {
    const withA = buildIntent({ ...base, assertion: deriveAssertion('task', attrs()) });
    expect(withA.versions.schema).toBe(2);
    expect(withA.assertion.actor).toBe('user');
    expect(buildIntent({ ...base }).versions.schema).toBe(1);
  });
  it('rejects a malformed assertion', () => {
    expect(() => buildIntent({ ...base, assertion: { actor: 'me', type: 'task', status: 'unknown', tense: 'past', polarity: 'affirmed' } })).toThrow();
  });
});
```

- [ ] **Step 2: Run** → FAIL. **Implement** in `intentSchema.js`: add the five frozen enum arrays + `deriveAssertion` + `validateAssertion` (all five keys required, each in its enum, no extra keys) + `buildIntent`: new optional `assertion = null` param; when non-null, validate and set `versions.schema: 2`; include `assertion` in the returned doc (as `assertion: validatedAssertion` or omitted entirely when null — never `assertion: null`, so v1 docs and v2 docs are distinguishable by key presence).

- [ ] **Step 3:** In `extractIntents.js`: (a) prompt — add to the per-candidate JSON contract a `tense` field with the 5 allowed values and one line of instruction ("tense of the assertion relative to writing time; 'recurring' for habitual statements; 'unknown' if unclear"); (b) `parseCandidatesResponse`/`normalizeCandidates` — carry `tense` through, defaulting `'unknown'` when missing/invalid (never reject a candidate for bad tense); (c) at the `buildIntent` call, pass `assertion: deriveAssertion(kind, attributes, { tense: candidate.tense })`. Check `firestore.rules` intents block: extraction writes via Admin SDK (bypasses rules) and `assertion` is NOT client-mutable — confirm the intents update rule uses `affectedKeys` allow-list (it does, line ~327) so no rules change is needed.

- [ ] **Step 4: Run** — `npx vitest run functions/src/intents` → all green (existing suites prove v1 compatibility; extend the extractIntents parse test with a `tense` fixture).

- [ ] **Step 5: Commit** — `git add functions/src/intents && git commit -m "feat(r4p1): typed assertions (actor/type/status/tense/polarity) on intent extraction, schema v2" -- functions/src/intents`

---

### Task 5: Evidence builder (integrity ladder gates 1–6 in code)

**Files:**
- Create: `src/services/insights/claims/evidenceBuilder.js`
- Test: `src/services/insights/claims/__tests__/evidenceBuilder.test.js`

**Interfaces:**
- Consumes: `observationSeriesFor`, `moodSeriesFor` (T1); `pairObservations`, `runAnalysisPlan` from `src/services/experiments/estimator.js`; `bonferroniCiLevel` (T2); `buildReceipt`, `sourceFromEntry` from `src/services/insights/receipts.js`; `ADAPTER_VERSION` from `entryAdapter.js`; `OBSERVATION_SCHEMA_VERSION` (T1); `generatorVersion` from `src/services/insights/generatorVersion.js`.
- Produces:
  - `EVIDENCE_BUILDER_VERSION = 1`; `EMERGING_MIN_TOTAL_DAYS = 14`; `EMERGING_MIN_SPAN_DAYS = 21`; `PRACTICAL_EFFECT_FLOOR_POINTS = 5` (DR "emerging association" floor).
  - `freezeCandidatePlan({ familyId, candidateId, exposureSpec, candidateTestsCount, timeZone, now })` → frozen plan (shared contract). MUST be called (and the ledger registered) BEFORE `buildEvidenceForCandidate`.
  - `buildEvidenceForCandidate({ observations, entriesById, exposureSpec, plan })` → `{ eligible: false, reasons: string[] }` | `{ eligible: true, claimInput }` where `claimInput` is a complete `buildClaim` input (version/lineage fields left for the pipeline). PURE — no Firestore, no clock (times from `plan.frozenAt`).

- [ ] **Step 1: Failing tests** — key behaviors, built on a deterministic fixture generator:

```js
// src/services/insights/claims/__tests__/evidenceBuilder.test.js
import { describe, it, expect } from 'vitest';
import { buildDailyObservations } from '../../observations';
import { freezeCandidatePlan, buildEvidenceForCandidate, PRACTICAL_EFFECT_FLOOR_POINTS } from '../evidenceBuilder';
import { buildClaim } from '../claimSchema';

const NOW = '2026-07-22T10:00:00.000Z';
const SPEC = { key: 'tag:gym', kind: 'tag', label: 'gym', splitMode: 'binary' };

// days: array of {d: 'YYYY-MM-DD', gym: bool, mood: 0-1, sensitive?: bool}
function fixtures(days) {
  return days.map((x, i) => ({
    id: `e${i}`, createdAt: `${x.d}T12:00:00Z`, text: `entry ${i} text`,
    analysis: { mood_score: x.mood }, tags: x.gym ? ['gym'] : [],
    safety_flagged: x.sensitive === true,
  }));
}
// 40 days spanning >3 weeks: 16 gym days mood 0.72, 24 non-gym mood 0.55.
const strongDays = Array.from({ length: 40 }, (_, i) => ({
  d: `2026-06-${String((i % 30) + 1).padStart(2, '0')}`.replace('2026-06-31', '2026-07-01'),
  ...(i < 30 ? {} : {}),
}));
// simpler: use two calendar months explicitly
const mk = (n, startDay, month, gym, mood) => Array.from({ length: n }, (_, i) => ({
  d: `2026-${month}-${String(startDay + i).padStart(2, '0')}`, gym, mood,
}));
const STRONG = [...mk(16, 1, '06', true, 0.72), ...mk(14, 17, '06', false, 0.55), ...mk(10, 1, '07', false, 0.55)];

function planFor(days, testedCount = 1) {
  return freezeCandidatePlan({
    familyId: 'basic:activity:tag:gym:mood', candidateId: 'tag:gym',
    exposureSpec: SPEC, candidateTestsCount: testedCount, timeZone: 'UTC', now: NOW,
  });
}
const run = (days, testedCount = 1) => {
  const entries = fixtures(days);
  const observations = buildDailyObservations(entries, { timeZone: 'UTC' });
  const entriesById = new Map(entries.map((e) => [e.id, e]));
  return buildEvidenceForCandidate({ observations, entriesById, exposureSpec: SPEC, plan: planFor(days, testedCount) });
};

describe('freezeCandidatePlan', () => {
  it('freezes ciLevel from the family tested-count (Bonferroni) and stamps frozenAt', () => {
    const p1 = planFor(STRONG, 1); const p10 = planFor(STRONG, 10);
    expect(p1.ciLevel).toBeCloseTo(0.95);
    expect(p10.ciLevel).toBeCloseTo(0.995);
    expect(p1.frozenAt).toBe(NOW);
    expect(p1.candidateTestsCount).toBe(1);
  });
});

describe('buildEvidenceForCandidate', () => {
  it('a strong, well-supported association is eligible and passes buildClaim', () => {
    const r = run(STRONG);
    expect(r.eligible).toBe(true);
    const claim = buildClaim({ ...r.claimInput, version: 1, parentClaimId: null });
    expect(claim.claimType).toBe('pattern_to_watch');
    expect(claim.direction).toBe('positive');
    expect(claim.evidence.effectMoodPoints).toBeGreaterThan(PRACTICAL_EFFECT_FLOOR_POINTS);
    expect(claim.wording).toMatch(/days/i);
    expect(claim.wording).not.toMatch(/boost|cause|improve/i);
  });

  it('too few total days -> ineligible with below_minimum_total_days (never a claim)', () => {
    const r = run([...mk(5, 1, '06', true, 0.8), ...mk(5, 10, '06', false, 0.4)]);
    expect(r.eligible).toBe(false);
    expect(r.reasons).toContain('insufficient_paired_observations');
  });

  it('a 14-day burst spanning under 3 weeks -> ineligible with below_minimum_span_days', () => {
    const r = run([...mk(8, 1, '06', true, 0.8), ...mk(8, 9, '06', false, 0.4)]);
    expect(r.eligible).toBe(false);
    expect(r.reasons).toContain('below_minimum_span_days');
  });

  it('effect under the 5-point practical floor -> ineligible with below_practical_floor (DR gate 5)', () => {
    const r = run([...mk(16, 1, '06', true, 0.58), ...mk(14, 17, '06', false, 0.55), ...mk(10, 1, '07', false, 0.55)]);
    expect(r.eligible).toBe(false);
    expect(r.reasons).toContain('below_practical_floor');
  });

  it('a wider family (higher m) can turn an eligible claim ineligible: Bonferroni bites', () => {
    // Construct a borderline effect that clears 95% CI but not 99.9%+.
    const borderline = [...mk(16, 1, '06', true, 0.63), ...mk(14, 17, '06', false, 0.55), ...mk(10, 1, '07', false, 0.55)];
    const loose = run(borderline, 1);
    const strict = run(borderline, 200);
    if (loose.eligible) {
      expect(strict.eligible).toBe(false);
      expect(strict.reasons).toContain('interval_includes_zero');
    } else {
      expect(loose.reasons).toContain('interval_includes_zero'); // fixture too weak — still a valid gate proof
    }
  });

  it('sensitive days are counted in stats but excluded from receipt sources, reconciled via hiddenSensitiveSourceCount', () => {
    const days = [...mk(16, 1, '06', true, 0.72), ...mk(14, 17, '06', false, 0.55), ...mk(10, 1, '07', false, 0.55)];
    days[0] = { ...days[0], sensitive: true };
    days[1] = { ...days[1], sensitive: true };
    const r = run(days);
    expect(r.eligible).toBe(true);
    const { evidence, receipt } = r.claimInput;
    expect(evidence.hiddenSensitiveSourceCount).toBe(2);
    const receiptEntryIds = new Set(receipt.sources.map((s) => s.entryId));
    expect(receiptEntryIds.has('e0')).toBe(false);
    expect(receiptEntryIds.has('e1')).toBe(false);
    // Gate 6 reconciliation: every contributing day is a visible source day or hidden-counted.
    expect(evidence.sourceEntryIds.length + evidence.hiddenSensitiveSourceCount)
      .toBe(evidence.totalCandidateDayCount);
  });

  it('is deterministic: same inputs -> deeply equal output', () => {
    expect(run(STRONG)).toEqual(run(STRONG));
  });
});
```

- [ ] **Step 2: Run** → FAIL. **Implement `evidenceBuilder.js`:**

```js
/**
 * Evidence builder (R4 Phase 1). Implements DR integrity-ladder gates 1-6 in
 * deterministic code. Design validity (gate 2) is structural: the caller
 * freezes the plan — including the family's candidateTestsCount and the
 * Bonferroni ciLevel — BEFORE this module analyzes anything.
 */
import { pairObservations, runAnalysisPlan } from '../../experiments/estimator';
import { bonferroniCiLevel } from '../testingLedger';
import { buildReceipt, sourceFromEntry } from '../receipts';
import { ADAPTER_VERSION } from '../entryAdapter';
import { OBSERVATION_SCHEMA_VERSION, observationSeriesFor, moodSeriesFor } from '../observations';
import { generatorVersion } from '../generatorVersion';

export const EVIDENCE_BUILDER_VERSION = 1;
export const EMERGING_MIN_TOTAL_DAYS = 14;   // DR "emerging association" floor
export const EMERGING_MIN_SPAN_DAYS = 21;    // spans at least 3 weeks
export const PRACTICAL_EFFECT_FLOOR_POINTS = 5; // = estimator SMALL_EFFECT_DELTA

export function freezeCandidatePlan({ familyId, candidateId, exposureSpec, candidateTestsCount, timeZone, now }) {
  if (!now) throw new Error('evidenceBuilder: now is required (no ambient clock)');
  return {
    frozenAt: now,
    hypothesisFamilyId: familyId,
    candidateId,
    candidateTestsCount,
    ciLevel: bonferroniCiLevel(candidateTestsCount),
    outcomeUnit: 'mood_0_100',
    timezone: timeZone || 'UTC',
    datePolicy: 'user_local_calendar_day',
    exposureDefinition: exposureSpec.kind === 'health'
      ? `daily mean ${exposureSpec.label} (median split)`
      : `day includes ${exposureSpec.kind} "${exposureSpec.label}" (present vs known-absent; unknown days omitted)`,
    outcomeDefinition: 'daily mean mood (0-100)',
    lagDays: 0,
    splitMode: exposureSpec.splitMode,
    minExposureContrast: 0,
    minimumTotalDays: EMERGING_MIN_TOTAL_DAYS,
    minimumSpanDays: EMERGING_MIN_SPAN_DAYS,
    practicalEffectFloorMoodPoints: PRACTICAL_EFFECT_FLOOR_POINTS,
    adapterVersion: ADAPTER_VERSION,
    observationSchemaVersion: OBSERVATION_SCHEMA_VERSION,
    evidenceBuilderVersion: EVIDENCE_BUILDER_VERSION,
    estimatorThresholds: {
      minPairedObservations: 10, minGroupSize: 5, minGroupFraction: 0.25, bootstrapResamples: 2000,
    },
  };
}

const spanDays = (dateKeys) => {
  if (dateKeys.length < 2) return dateKeys.length;
  const sorted = [...dateKeys].sort();
  const ms = Date.parse(`${sorted[sorted.length - 1]}T00:00:00Z`) - Date.parse(`${sorted[0]}T00:00:00Z`);
  return Math.round(ms / 86400000) + 1;
};

export function buildEvidenceForCandidate({ observations, entriesById, exposureSpec, plan }) {
  // Gate 1 (data validity) is upstream: adapter + observations reject bad units.
  // Gate 2 (design validity): refuse to run without a frozen plan.
  if (!plan?.frozenAt || !Number.isFinite(plan.candidateTestsCount)) {
    return { eligible: false, reasons: ['plan_not_frozen'] };
  }
  const exposureSeries = observationSeriesFor(observations, exposureSpec);
  const outcomeSeries = moodSeriesFor(observations);
  const pairs = pairObservations({ exposureSeries, outcomeSeries, lag: plan.lagDays });

  const reasons = [];
  const pairedDateKeys = pairs.map((p) => p.dateKey);
  if (pairs.length < plan.minimumTotalDays) reasons.push('below_minimum_total_days');
  if (spanDays(pairedDateKeys) < plan.minimumSpanDays) reasons.push('below_minimum_span_days');

  // Gate 3 (estimability) + gate 4 (stability interval): the estimator.
  const result = runAnalysisPlan({
    pairs,
    plan: { lag: plan.lagDays, splitMode: plan.splitMode, minExposureContrast: plan.minExposureContrast, ciLevel: plan.ciLevel },
  });
  if (result.status !== 'ok') {
    return { eligible: false, reasons: [...new Set([...reasons, ...result.reasons])] };
  }
  const { estimate } = result;
  const [lo, hi] = estimate.ci;
  if (lo <= 0 && hi >= 0) reasons.push('interval_includes_zero');
  if (!estimate.stability.signConsistent) reasons.push('leave_one_day_out_unstable');
  // Gate 5 (practical relevance).
  if (Math.abs(estimate.delta) < plan.practicalEffectFloorMoodPoints) reasons.push('below_practical_floor');
  if (reasons.length) return { eligible: false, reasons: [...new Set(reasons)] };

  // Gate 6 (evidence integrity): reconcile every contributing day.
  const pairedKeySet = new Set(pairedDateKeys);
  const contributing = observations.filter((o) => pairedKeySet.has(o.dateKey));
  const visible = contributing.filter((o) => !o.sensitive);
  const hidden = contributing.filter((o) => o.sensitive);
  const sourceEntryIds = visible.flatMap((o) => o.entryIds);
  const sortedKeys = [...pairedDateKeys].sort();

  const direction = estimate.delta > 0 ? 'positive' : 'negative';
  const effectAbs = Math.round(Math.abs(estimate.delta) * 10) / 10;
  const subject = exposureSpec.label;
  const wording = exposureSpec.splitMode === 'binary'
    ? `On days you logged ${subject}, your recorded mood averaged ${effectAbs} points ${direction === 'positive' ? 'higher' : 'lower'} (0–100 scale) than days you didn't — ${estimate.nHigh} vs ${estimate.nLow} days over ${spanDays(pairedDateKeys)} days.`
    : `On days with higher ${subject}, your recorded mood averaged ${effectAbs} points ${direction === 'positive' ? 'higher' : 'lower'} (0–100 scale) than lower-${subject} days — ${estimate.nHigh} vs ${estimate.nLow} days over ${spanDays(pairedDateKeys)} days.`;

  const receipt = buildReceipt({
    sources: visible.flatMap((o) => o.entryIds.map((id) => sourceFromEntry(entriesById.get(id))).filter(Boolean)),
    scope: null,
    timeWindow: { start: `${sortedKeys[0]}T00:00:00.000Z`, end: `${sortedKeys[sortedKeys.length - 1]}T00:00:00.000Z` },
    sampleSize: pairs.length,
    missingness: `${pairs.length} of ${spanDays(pairedDateKeys)} days had both ${subject} status and a mood record`,
    generator: 'insight_claims',
  });
  receipt.computation = {
    nHigh: estimate.nHigh, nLow: estimate.nLow, splitThreshold: estimate.splitThreshold,
    exposureContrast: estimate.exposureContrast, hiddenSensitiveSourceCount: hidden.length,
  };

  return {
    eligible: true,
    claimInput: {
      claimType: 'pattern_to_watch',
      subject, outcome: 'mood', direction,
      questionWording: `How did ${subject} and mood move together in your recorded days?`,
      wording,
      limitations: [
        `Same-day association only — ${subject} and mood were recorded together and something else may explain both.`,
        'Recorded days only; days you didn’t journal are not represented.',
      ],
      analysisPlan: plan,
      evidence: {
        sourceEntryIds,
        hiddenSensitiveSourceCount: hidden.length,
        totalCandidateDayCount: contributing.length,
        exposedDayCount: estimate.nHigh,
        comparisonDayCount: estimate.nLow,
        observedSpanDays: spanDays(pairedDateKeys),
        exposureContrast: estimate.exposureContrast ?? 0,
        effectMoodPoints: estimate.delta,
        stabilityInterval: estimate.ci,
        leaveOneDayOutDirectionStable: estimate.stability.signConsistent,
        exposureCoverage: exposureSeries.length / Math.max(observations.length, 1),
        outcomeCoverage: outcomeSeries.length / Math.max(observations.length, 1),
        representativeness: 'unknown',
      },
      receipt,
      status: 'verified', // deterministic wording: verified by construction (D2)
      provenance: { generatorVersion, evidenceBuilderVersion: EVIDENCE_BUILDER_VERSION, wordingSource: 'deterministic_template_v1' },
      createdAt: plan.frozenAt,
      updatedAt: plan.frozenAt,
    },
  };
}
```

Implementer notes: (a) the gate-6 reconciliation invariant asserted in tests is `sourceEntryIds.length + hiddenSensitiveSourceCount === totalCandidateDayCount` — this holds when each day has one entry; with multi-entry days, count DAYS hidden vs days visible and assert `visibleDays + hiddenDays === totalCandidateDayCount`, and make the test fixture single-entry-per-day so the simpler assertion is exact. Keep the invariant DAY-based in code (`visible.length + hidden.length === contributing.length`) and expose `sourceEntryIds` separately. Adjust the test to the day-based invariant if needed — the CONTRACT is "nothing contributes invisibly". (b) `insufficient_paired_observations` from the estimator covers the n<10 case; `below_minimum_total_days` covers 10-13; the second test's 10-day fixture must assert whichever reason actually fires — prefer asserting `r.eligible === false` plus reason membership in a set of the two.

- [ ] **Step 3: Run** — `npx vitest run src/services/insights/claims/__tests__/evidenceBuilder.test.js` → PASS (iterate the fixtures until the strong case genuinely clears every gate — deterministic estimator makes this repeatable).

- [ ] **Step 4: Commit** — `git add src/services/insights/claims/evidenceBuilder.js src/services/insights/claims/__tests__/evidenceBuilder.test.js && git commit -m "feat(r4p1): evidence builder — integrity ladder gates 1-6, receipt reconciliation" -- src/services/insights/claims`

---

### Task 6: Claims pipeline + `insightClaims` flag

**Files:**
- Create: `src/services/insights/claims/claimsPipeline.js`
- Modify: `src/config/flags.js` (add `insightClaims: false` to `FLAG_DEFAULTS` after `personalExperiments`), `scripts/flip-flag.mjs` (add `'insightClaims'` to `ALLOWED`), `src/services/basicInsights/basicInsightsOrchestrator.js` (post-generation hook)
- Test: `src/services/insights/claims/__tests__/claimsPipeline.test.js`, extend `src/services/basicInsights/__tests__/basicInsightsOrchestrator.receipts.test.js` neighborhood with a hook test

**Interfaces:**
- Consumes: T1 (`buildDailyObservations`, `enumerateExposures`), T2 (`familyIdForBasic`, `registerCandidates`, `readLedgerCounts`), T3 (`writeClaim`, `supersedeClaim`, `listAllClaims`, `evidenceEquivalent`, `claimDocId`), T5 (`freezeCandidatePlan`, `buildEvidenceForCandidate`).
- Produces: `async generateClaims(db, uid, entries, { timeZone, now } = {})` → `{ written: number, superseded: number, candidatesTested: number, eligible: number }`. Engine key for Phase-1 families: `exposureSpec.kind` (`tag`→`activity`, `entity`→`people`, `category`→`category`, `health`→`health`) via exported `engineKeyFor(spec)`.

**Pipeline order (the design-freeze invariant):**
1. `buildDailyObservations` → `enumerateExposures`.
2. Group specs by family; `registerCandidates` for ALL of them FIRST (inconclusive candidates count — DR stat-req 9).
3. Per candidate: `freezeCandidatePlan` with the family count returned by registration → `buildEvidenceForCandidate`.
4. Eligible → version/lineage resolution against existing claims: no prior live claim → write v1; prior live claim with `evidenceEquivalent` → skip (no churn); else supersede with v = prior.version + 1, `parentClaimId` = prior.id.
5. Ineligible → nothing written (the ledger already counted it).

- [ ] **Step 1: Failing tests** — Map-backed firestore mock (reuse the testingLedger test mock pattern; `writeBatch`/`updateDoc`/`getDocs` included). Fixtures from T5's STRONG set. Assert:
  - a strong candidate ends as ONE claim doc, `status:'verified'`, and the ledger shows the candidate;
  - ALL enumerated candidates appear in the ledger even when only one is eligible (`candidatesTested` > `eligible`);
  - re-running with identical entries writes nothing new (`written: 0`, dedup via `evidenceEquivalent`);
  - re-running with meaningfully changed evidence (append 10 contradicting days) supersedes: old doc gains `supersededByClaimId`, new doc has `version: 2`, `parentClaimId` = old id, and BOTH docs still exist (never overwrite);
  - plans were frozen with the POST-registration family count (spy: `freezeCandidatePlan` receives the count that includes this run's newly registered candidates).

- [ ] **Step 2: Run** → FAIL. **Implement `claimsPipeline.js`:**

```js
/**
 * Claims pipeline (R4 Phase 1). Order is the contract:
 * enumerate -> register in ledger (count-before-analyze) -> freeze plan ->
 * analyze -> write/supersede. Ineligible candidates leave only a ledger mark.
 */
import { buildDailyObservations, enumerateExposures } from '../observations';
import { familyIdForBasic, registerCandidates } from '../testingLedger';
import { resolveDeviceTimezone } from '../../experiments/computeResult';
import { freezeCandidatePlan, buildEvidenceForCandidate } from './evidenceBuilder';
import { writeClaim, supersedeClaim, listAllClaims, evidenceEquivalent } from './claimsService';
import { buildClaim } from './claimSchema';

const ENGINE_BY_KIND = { tag: 'activity', entity: 'people', category: 'category', health: 'health' };
export const engineKeyFor = (spec) => ENGINE_BY_KIND[spec.kind] || spec.kind;

export async function generateClaims(db, uid, entries, { timeZone, now } = {}) {
  const at = now || new Date().toISOString();
  const tz = timeZone || resolveDeviceTimezone();
  const observations = buildDailyObservations(entries, { timeZone: tz });
  const entriesById = new Map((entries || []).filter((e) => e && e.id).map((e) => [e.id, e]));
  const specs = enumerateExposures(observations);

  // 1) Register EVERY candidate before any analysis.
  const familyCounts = new Map();
  for (const spec of specs) {
    const familyId = familyIdForBasic(engineKeyFor(spec), spec.key);
    const { testedCount } = await registerCandidates(db, uid, familyId, [spec.key], { now: at });
    familyCounts.set(spec.key, { familyId, testedCount });
  }

  // 2) Analyze under frozen plans; write/supersede eligible claims.
  const existing = await listAllClaims(db, uid);
  const liveByCandidate = new Map(existing
    .filter((c) => c.supersededByClaimId == null)
    .map((c) => [`${c.analysisPlan.hypothesisFamilyId}|${c.analysisPlan.candidateId}`, c]));

  let written = 0; let superseded = 0; let eligible = 0;
  for (const spec of specs) {
    const { familyId, testedCount } = familyCounts.get(spec.key);
    const plan = freezeCandidatePlan({
      familyId, candidateId: spec.key, exposureSpec: spec,
      candidateTestsCount: testedCount, timeZone: tz, now: at,
    });
    const result = buildEvidenceForCandidate({ observations, entriesById, exposureSpec: spec, plan });
    if (!result.eligible) continue;
    eligible += 1;
    const prior = liveByCandidate.get(`${familyId}|${spec.key}`);
    if (!prior) {
      await writeClaim(db, uid, { ...result.claimInput, version: 1, parentClaimId: null });
      written += 1;
    } else {
      const candidate = buildClaim({ ...result.claimInput, version: prior.version + 1, parentClaimId: prior.id });
      if (evidenceEquivalent(prior, candidate)) continue; // no churn
      await supersedeClaim(db, uid, prior, candidate);
      written += 1; superseded += 1;
    }
  }
  return { written, superseded, candidatesTested: specs.length, eligible };
}
```

- [ ] **Step 3: Orchestrator hook** — in `basicInsightsOrchestrator.js` `generateBasicInsights`, after the legacy insights are computed and cached (non-blocking for legacy behavior, error-contained):

```js
import { getFlag } from '../../config/flags';
import { generateClaims } from '../insights/claims/claimsPipeline';
// ... at the end of generateBasicInsights, before return:
if (getFlag('insightClaims')) {
  try {
    await generateClaims(db, userId, entries);
  } catch (error) {
    console.warn('[basicInsights] claim generation failed (legacy insights unaffected):', error?.message);
  }
}
```

Hook test: flag OFF → `generateClaims` never called (spy via `vi.mock` of the pipeline module); flag ON → called once with the same entries; pipeline throw → orchestrator still returns success.

- [ ] **Step 4: Flag + whitelist** — `FLAG_DEFAULTS`: add `insightClaims: false,  // R4 Phase 1: claim-backed Quick Insights (evidence rails)`; `scripts/flip-flag.mjs` `ALLOWED`: append `'insightClaims'`. ASSERT the edit landed: `node -e "import('./scripts/flip-flag.mjs').catch(()=>{})"` is not enough — follow the existing whitelist test if present, else `grep -c "insightClaims" scripts/flip-flag.mjs src/config/flags.js` must print 1 per file and the flags test suite must pass.

- [ ] **Step 5: Run** — `npx vitest run src/services/insights src/services/basicInsights` → PASS.

- [ ] **Step 6: Commit** — `git add src/services/insights/claims/claimsPipeline.js src/services/insights/claims/__tests__/claimsPipeline.test.js src/services/basicInsights/basicInsightsOrchestrator.js src/config/flags.js scripts/flip-flag.mjs <hook test path> && git commit -m "feat(r4p1): claims pipeline (register-before-analyze, supersede-not-overwrite) behind insightClaims flag" -- <same paths>`

---

### Task 7: Experiments retrofit — family + adjusted CI at create

**Files:**
- Modify: `src/services/experiments/experimentsService.js` (`buildAnalysisPlan` + `startExperiment`)
- Test: extend `src/services/experiments/__tests__/experimentsService.test.js`

**Interfaces:**
- Consumes: `familyIdForExperiment`, `registerCandidates`, `readLedgerCounts`, `bonferroniCiLevel` (T2).
- Produces: `buildAnalysisPlan(template, params)` gains TWO frozen fields inside the plan map — `hypothesisFamilyId` (from `familyIdForExperiment(template.id, params.tag)`) and, when `params.priorTestedCount` is a finite number ≥ 1, `ciLevel: bonferroniCiLevel(params.priorTestedCount + 1)`; `startExperiment` registers the candidate (`candidateId = hypothesisFamilyId`) in the ledger at start time. `createExperiment` reads the family's current count first and passes `priorTestedCount`.

**Behavioral guarantees:** existing experiments (no `hypothesisFamilyId`/`ciLevel` in plan) are untouched and compute identically (estimator defaults `ciLevel` → 0.95). `analysisPlan` is a map value — the firestore.rules create allow-list constrains only top-level keys, so NO rules change. Repeated experiments of the same hypothesis (same template+tag) share one ledger candidate (`timesTested` increments, m stays honest per DR: "repeated experiments and time-window reruns belong to the same testing ledger").

- [ ] **Step 1: Failing tests** (in the existing `experimentsService.test.js` mock harness):
  - `buildAnalysisPlan(getTemplateById('steps-mood'), {})` → plan contains `hypothesisFamilyId: 'experiment:steps-mood'` and NO `ciLevel` key when no priorTestedCount given;
  - `buildAnalysisPlan(tagTemplate, { tag: 'Gym', priorTestedCount: 3 })` → `hypothesisFamilyId: 'experiment:tag-presence-mood:tag:gym'`, `ciLevel` ≈ `1 - 0.05/4`;
  - `startExperiment` calls the ledger's `registerCandidates` with the plan's familyId (spy via `vi.mock('../../insights/testingLedger')`);
  - plan-freeze regression: created doc still has NO `result`/`startAt`/`endAt` keys; `computeExperimentResult` on a legacy plan (no ciLevel) equals pre-change output byte-for-byte (reuse an existing computeResult fixture).

- [ ] **Step 2: Run** → FAIL. **Implement:** in `buildAnalysisPlan` (L152), after the existing fields:

```js
import { familyIdForExperiment, registerCandidates, readLedgerCounts, bonferroniCiLevel } from '../insights/testingLedger';
// inside buildAnalysisPlan:
const hypothesisFamilyId = familyIdForExperiment(template.id, params.tag ?? null);
plan.hypothesisFamilyId = hypothesisFamilyId;
if (Number.isFinite(params.priorTestedCount) && params.priorTestedCount >= 1) {
  plan.ciLevel = bonferroniCiLevel(params.priorTestedCount + 1); // this experiment included
}
```

In `createExperiment`, before building the plan: `const counts = await readLedgerCounts(db, uid, [familyIdForExperiment(template.id, params.tag ?? null)]);` → pass `priorTestedCount: counts.values().next().value` into `buildAnalysisPlan` params (tolerate ledger read failure → omit, fail-open to the UNADJUSTED 0.95 default is NOT acceptable — on read failure, throw: the experiment can be created again; silent miscounting cannot be undone. Match the repo's fail-closed posture). In `startExperiment` (L285), after the status transition write succeeds: `await registerCandidates(db, uid, plan.hypothesisFamilyId, [plan.hypothesisFamilyId], { now });` (registration at START, not create — drafts that never run don't count as tests).

- [ ] **Step 3: Run** — `npx vitest run src/services/experiments` → PASS (all pre-existing suites prove legacy plans unaffected).

- [ ] **Step 4: Commit** — `git add src/services/experiments/experimentsService.js src/services/experiments/__tests__/experimentsService.test.js && git commit -m "feat(r4p1): experiments join the testing ledger (family id + Bonferroni ciLevel frozen at create)" -- src/services/experiments`

---

### Task 8: Dead-code sweep (ledger-flagged Phase-1 items)

**Files:**
- Modify: `src/services/nexus/layer3/synthesizer.js` (delete `generateStateComparisonInsight`, line 558 — exported, zero callers, same invention shape DR finding 6 flagged)
- Modify: `src/services/nexus/insightIntegration.js` (delete `generateComprehensiveInsights`, line 42, and its default-export entry, line 445 — orphan exporter; live imports of this module are only `getQuickContextInsights` and `getTodayRecommendations`)
- Modify: `src/services/nexus/__tests__/insightIntegration.test.js` (drop the orphan's tests)
- Modify: `PROJECT_STATUS.md` (decision row)

**Steps:**
- [ ] **Step 1:** `grep -rn "generateStateComparisonInsight\|generateComprehensiveInsights" src/ functions/` — confirm the only hits are the definitions, the default-export list, and tests. If ANY live caller appears, STOP and report instead of deleting.
- [ ] **Step 2:** Delete both functions + the default-export entry + their tests. Run `npx vitest run src/services/nexus && npm run build` → green (build catches any missed import).
- [ ] **Step 3:** PROJECT_STATUS decision row: `| 2026-07-22 | Deleted dead generateStateComparisonInsight + generateComprehensiveInsights (R4 P1) | DR finding-6 invention shape; zero callers; less surface to verify in Phase 2 | A future surface wants comprehensive-summary generation (rebuild on claims, not on this) |`. Also log the D-series decisions table from this plan's header into PROJECT_STATUS "Recent Decisions" (one row: "R4 Phase 1 design defaults D1-D9 ratified by controller; Michael veto-window open").
- [ ] **Step 4: Commit** — `git add -A src/services/nexus PROJECT_STATUS.md && git commit -m "chore(r4p1): remove dead invention-shaped exporters (ledger-flagged)" -- src/services/nexus PROJECT_STATUS.md`

---

### Task 9: Diagnostic feedback taxonomy (DR finding 10)

**Files:**
- Create: `src/services/insights/claims/claimFeedback.js`
- Modify: `src/components/insights/ReceiptSheet.jsx` (feedback options when the insight is a claim)
- Test: `src/services/insights/claims/__tests__/claimFeedback.test.js`, `src/components/insights/__tests__/ReceiptSheet.claimFeedback.test.jsx` (follow the existing ReceiptSheet test file's render/mock pattern if one exists; else jsdom + vi.mock of the services)

**Interfaces:**
- Consumes: `excludeSource` (`sourceExclusions.js`), `recordFeedbackAndLearn` (`feedbackLearning.js`), `recordInsightEngagement` (wherever InsightsPage imports it from today — reuse that import path), `setClaimStatus` (T3).
- Produces:

```js
export const FEEDBACK_OPTIONS = Object.freeze([
  { id: 'accurate',        label: 'Accurate' },
  { id: 'wrong_source',    label: 'Wrong source entries' },      // requires entryId
  { id: 'not_useful',      label: 'Real, but not useful' },
  { id: 'not_causal',      label: 'This doesn’t cause that' },
  { id: 'misunderstood',   label: 'Misunderstood person/activity' },
  { id: 'do_not_analyze',  label: 'Don’t analyze this topic' },
]);
export async function recordClaimFeedback(db, uid, claim, optionId, { entryId = null, entriesCount = 0, now } = {})
```

**Routing contract (each option's consumer — corrections change facts, preferences change ranking):**

| option | effect |
|---|---|
| `accurate` | `recordFeedbackAndLearn(uid, {feedback:'accurate', ...claimFeedbackShape}, citedEntries, entriesCount)` — positive learning signal |
| `wrong_source` | `excludeSource(db, uid, {entryId, appliesTo: claim.analysisPlan.hypothesisFamilyId, reason:'wrong_source'})` → `onSourcesChanged` fans out → next generation re-derives and SUPERSEDES the claim (lineage preserves the original; matches DR corrections rules) |
| `not_useful` | `recordInsightEngagement(uid, claimAsInsight, 'dismissed')` — ranking/suppression only, facts untouched |
| `not_causal` | stored event only (comprehension signal for the Phase-2 gate); wording is already non-causal, no fact change |
| `misunderstood` | `recordFeedbackAndLearn(uid, {feedback:'inaccurate', ...}, citedEntries, entriesCount)` — false-positive pattern learning |
| `do_not_analyze` | `setClaimStatus(db, uid, claim.id, 'suppressed')` + `recordFeedbackAndLearn(uid, {feedback:'inaccurate', suppressTopic: true, ...})` (drives the existing patternType suppression; liftable in InsightControlCenter per D7) |

Every call ALSO appends a raw structured event doc to the existing `insightFeedback` collection (rules line ~279): `{claimId: claim.id, familyId, optionId, entryId, createdAt}` — the durable audit DR requires ("record a structured reason for every correction").

- [ ] **Step 1: Failing service tests** — mock the four consumer modules with `vi.mock`; for each of the 6 options assert exactly the right consumer(s) called with the right shapes; `wrong_source` without `entryId` throws; unknown optionId throws; the raw event is always written.
- [ ] **Step 2: Implement `claimFeedback.js`** per the table (a `switch` on optionId; `claimAsInsight` adapter = `{id: claim.id, type: 'claim', title: claim.wording, category: claim.analysisPlan.hypothesisFamilyId}`; claim feedback shape for feedbackLearning = `{insightId: claim.id, category: engine key from familyId, insightText: claim.wording, moodDelta: claim.evidence.effectMoodPoints, sampleSize: claim.evidence.totalCandidateDayCount, entryIds: claim.evidence.sourceEntryIds, feedback}`).
- [ ] **Step 3: ReceiptSheet** — when `insight.claimType` is present (it's a claim), render the 6 options (radio list + submit, 44px touch targets) in place of the current not-true/not-useful pair; `wrong_source` keeps the existing per-source row affordance (reuse `handleWrongSource`, now routed through `recordClaimFeedback`). Legacy insights (no `claimType`) keep today's UI untouched. Component test: claim → 6 options render, selecting `do_not_analyze` calls `recordClaimFeedback` with the claim; legacy → old two buttons render.
- [ ] **Step 4: Run** — `npx vitest run src/services/insights/claims src/components/insights` → PASS.
- [ ] **Step 5: Commit** — `git add src/services/insights/claims/claimFeedback.js src/services/insights/claims/__tests__/claimFeedback.test.js src/components/insights && git commit -m "feat(r4p1): 6-option diagnostic feedback taxonomy, corrections-vs-preferences routing" -- <same paths>`

---

### Task 10: ClaimCard + InsightsPage integration

**Files:**
- Create: `src/components/insights/ClaimCard.jsx`
- Create: `src/hooks/useClaims.js`
- Modify: `src/pages/InsightsPage.jsx` (Quick Insights section: claims when flag ON)
- Test: `src/components/insights/__tests__/ClaimCard.test.jsx`, extend `src/pages/__tests__/` with `InsightsPage.claims.test.jsx` (follow `InsightsPage.dismissal.test.jsx`'s mock harness)

**Interfaces:**
- Consumes: `listActiveClaims` (T3), `recordClaimFeedback` + `FEEDBACK_OPTIONS` (T9), `getFlag('insightClaims')`, existing `ReceiptSheet` open path, `matchQuestionToTemplate`/`TEMPLATES` from `src/services/experiments/templates.js` (for "Try as an experiment").
- Produces: `useClaims(user)` → `{ claims, loading, refresh }`; `<ClaimCard claim onShowReceipt onFeedback onTryExperiment />`.

**ClaimCard layout (DR "ideal insight-card experience" — five questions, no stats homework):**
1. Badge: `Pattern to watch` (+ direction arrow).
2. `claim.wording` (the one precise, non-causal sentence).
3. Evidence line: `{exposedDayCount} {subject} days vs {comparisonDayCount} comparison days · {observedSpanDays}-day span · {|effectMoodPoints| rounded} mood-point difference` + (when `hiddenSensitiveSourceCount > 0`): `· {n} contributing day(s) hidden from preview (sensitive)`.
4. Limitation line: `claim.limitations[0]`.
5. Actions: `See days` (opens ReceiptSheet), `Feedback` (opens the T9 options), `Try as an experiment` — shown ONLY when the claim's exposure maps to an experiment template: tag claims → `tag-presence-mood`; health claims whose field matches a template exposure (`sleep_hours`→`sleep-hours-mood-same-day`, `steps`→`steps-mood`, `recovery_score`→`recovery-score-mood`); navigates to the experiments create flow prefilled with that template + tag param (reuse however ExperimentsPage/creation is currently opened — read the existing navigation seam before wiring; if experiments UI is reached via a route, `navigate` there with state `{templateId, tag}`).

- [ ] **Step 1: Failing ClaimCard tests** — renders wording/evidence/limitation; hidden-sensitive line appears iff count > 0; no causal words in any rendered copy (regex over container text); `Try as an experiment` present for a `tag:` claim, absent for an `entity:` claim; action handlers fire.
- [ ] **Step 2: Implement ClaimCard + useClaims** (`useClaims`: load once on mount + `refresh`; filter `status === 'verified'`; no budget application — page surface, matching current Quick Insights behavior).
- [ ] **Step 3: InsightsPage** — in the Quick Insights section (render site of `insights={basicInsights}`, ~line 386): `getFlag('insightClaims') ? <ClaimList claims={claims} .../> : <legacy Quick Insights unchanged>`. ReceiptSheet already accepts the claim (its `receipt` prop shape is buildReceipt's). Page test: flag OFF → legacy section renders, `listActiveClaims` never called; flag ON → ClaimCards render from mocked claims.
- [ ] **Step 4: Run** — `npx vitest run src/components/insights src/pages && npm run build` → PASS.
- [ ] **Step 5: Commit** — `git add src/components/insights/ClaimCard.jsx src/hooks/useClaims.js src/pages/InsightsPage.jsx <test paths> && git commit -m "feat(r4p1): claim-backed Quick Insights cards (5-question layout) behind insightClaims" -- <same paths>`

---

### Task 11: QA matrix rows, runbook, docs

**Files:**
- Modify: `src/__tests__/validationMatrix.test.js` (R4-P1 rows), `docs/quality/trustworthy-capture-runbook.md` (R4 Phase 1 section + flag), `PROJECT_STATUS.md` (active work + checklist), `CLAUDE.md` (one-paragraph extension of the R4 note)

**Matrix rows (each a `describe('Matrix row: R4P1-x ...')` over REAL modules, platform mocks only):**
- (a) **ledger-counts-inconclusive** — pipeline run where zero candidates are eligible still registers every candidate (ledger testedCount > 0, claims written = 0).
- (b) **count-before-analyze** — the plan frozen for candidate k has `candidateTestsCount` ≥ the total number of candidates enumerated in that same run (registration preceded analysis).
- (c) **bonferroni-widens** — same fixture, m=1 vs m=50: the m=50 interval is wider or the claim ineligible; never the reverse.
- (d) **claim-immutability** (rules, in `firestoreRules.test.js`, referenced from the matrix row comment) — update to `evidence` denied; supersede path allowed.
- (e) **receipt-reconciliation** — for every eligible claim: visible day count + `hiddenSensitiveSourceCount` = `totalCandidateDayCount`, and `receipt.sources` never contains a sensitive entry.
- (f) **unknown-≠-absent** — a day with UNKNOWN tags appears in NO tag-exposure series (neither group), and removing it changes no counts.
- (g) **supersede-not-overwrite** — after an evidence change, both claim versions exist; the old one carries `supersededByClaimId`; `listActiveClaims` returns only the new one.
- (h) **feedback-routing** — `wrong_source` produces a source_exclusion write and NO claim mutation; `do_not_analyze` produces `status:'suppressed'` and no deletion.
- (i) **flag-off-inert** — with `insightClaims` OFF: no ledger writes, no claim writes, legacy Quick Insights output byte-identical to a pre-Phase-1 snapshot fixture.

**Runbook section (append after the R4 Phase 0 section):** what Phase 1 adds; `insightClaims` flag (default OFF, flip via `node scripts/flip-flag.mjs insightClaims true`, prerequisites: none — additive + client-side; recommended order note: independent of the R2/R3 flags); the two new collections + rules posture; the ledger's meaning (m never decreases; deleting the ledger resets multiple-testing honesty — don't); claim lineage semantics (supersede pointers, suppressed vs expired); Phase-2 pointers (writer/verifier, single feed, comprehension gate).

**PROJECT_STATUS:** Active Work row for R4 Phase 1 (shipped, flag OFF); decisions D1–D9 row (if not already logged in T8); checklist addition under Michael's gate items: "flip `insightClaims` after eyeballing claim cards on your own data (no sign-off doc needed — deterministic wording, no LLM)".

**CLAUDE.md:** extend the R4 paragraph: one sentence that Phase 1 added the claim store/ledger/evidence builder behind `insightClaims` (default OFF) and where the plan lives.

- [ ] **Step 1:** Write matrix rows (a)–(i) → run `npx vitest run src/__tests__/validationMatrix.test.js` → PASS.
- [ ] **Step 2:** Runbook + PROJECT_STATUS + CLAUDE.md edits.
- [ ] **Step 3:** Full gate: `npm test && npm run test:rules && npm run build` → all green.
- [ ] **Step 4: Commit** — `git add src/__tests__/validationMatrix.test.js docs/quality/trustworthy-capture-runbook.md PROJECT_STATUS.md CLAUDE.md && git commit -m "test+docs(r4p1): validation matrix rows, runbook, status" -- <same paths>`

---

## Self-review (performed at plan time)

1. **Spec coverage vs the R4 Phase-1 outline:** daily observation rollup → T1; typed assertion/event extraction → T4; versioned InsightClaim store + rules → T3; hypothesis-family testing ledger + experiments retrofit → T2+T7; evidence builder on buildReceipt/estimator gates → T5; Quick Insights/correlations consume claims → T6+T10; diagnostic feedback taxonomy UI → T9. Ledger-flagged items → T8. DR integrity ladder: gates 1–2 (adapter + freeze) T5, gate 3–4 (estimator + Bonferroni) T2/T5, gate 5 (practical floor) T5, gate 6 (reconciliation) T5+matrix (e), gate 7 (non-causal, deterministic wording + CAUSAL_RE) T3/T5, gate 8 (comprehension) explicitly Phase 2. DR stat-reqs 1–5, 7–10 covered; req 6 (moving-block bootstrap) remains the documented pre-EXTERNAL-release item (unchanged from Phase 0 posture).
2. **Placeholders:** none — every module has real code; the two implementer-notes (health field names in T1, day-based reconciliation in T5) are explicit verify-then-align instructions with the contract stated, not TBDs.
3. **Type consistency:** `ExposureSpec`/Observation/plan/claim shapes defined once in Shared contracts and used identically in T1/T5/T6/T9/T10; `registerCandidates` returns `{testedCount}` (T2) and is consumed that way in T6/T7; `plan.ciLevel` name identical in T2/T5/T7; `claimDocId` inputs match `analysisPlan.hypothesisFamilyId`/`candidateId` as frozen in T5.

## Execution handoff

Subagent-driven (as R1–R4P0): batches P1a → P1b → P1c, adversarial review per task, whole-phase final review on the most capable model, gate + push per batch, ledger after every task.

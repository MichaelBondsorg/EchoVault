/**
 * Report Narrative Generation
 *
 * Two distinct generation paths:
 * - Weekly: template-based (no LLM, free tier)
 * - Monthly/Quarterly/Annual: Gemini-powered (premium)
 */

import { callGemini } from '../shared/gemini.js';
import { getModel } from '../models/registry.js';

/**
 * How many entries buildSectionPrompt()/generatePremiumNarrative() sample
 * per report section for narrative context + entryRefs receipts. Shared
 * here so the excerpt sample fed to the LLM and its entryRefs citation can
 * never drift apart (see selectRepresentativeEntries below).
 */
const NARRATIVE_SAMPLE_SIZE = 8;

/**
 * Deterministic, representative sample of (chronologically pre-sorted)
 * `entries` for narrative context — replaces "first N chronological",
 * which biased every prompt/entryRefs receipt toward the START of the
 * report period regardless of how long the period was (DR finding 8 / R4
 * Task 4).
 *
 * `entries` is assumed pre-sorted ascending by date — generator.js's
 * `readEntries()` guarantees this via Firestore's
 * `.orderBy('createdAt', 'asc')`. Stratifying by INDEX position over an
 * already date-ordered array is equivalent, for "spread across the
 * period" purposes, to stratifying by date directly, without needing to
 * parse/trust each entry's own `date` string (which can be missing or
 * malformed) — pinned as the simple, deterministic choice per the R4 plan.
 * No randomness: the same input always produces the same output.
 *
 * The array is split into up to `windowCount` contiguous, near-equal index
 * windows; the entry at the MIDDLE of each non-empty window is selected
 * (integer division rounds down, so ties break toward the lower index —
 * still fully deterministic). If `entries.length <= windowCount` there's
 * nothing to downsample, so every entry is returned as-is (sparse-period
 * fallback: no fabricated/duplicated entries to pad up to `windowCount`).
 *
 * @param {Array} entries
 * @param {number} [windowCount=NARRATIVE_SAMPLE_SIZE]
 * @returns {Array} the selected entries, in original (chronological) order
 */
export function selectRepresentativeEntries(entries, windowCount = NARRATIVE_SAMPLE_SIZE) {
  if (!Array.isArray(entries) || entries.length === 0) return [];
  const safeWindowCount = Math.max(1, Math.floor(windowCount) || 1);
  if (entries.length <= safeWindowCount) return entries.slice();

  const selected = [];
  for (let w = 0; w < safeWindowCount; w++) {
    const start = Math.floor((w * entries.length) / safeWindowCount);
    const end = Math.floor(((w + 1) * entries.length) / safeWindowCount);
    if (end <= start) continue; // empty window — skip rather than fabricate
    const mid = start + Math.floor((end - start - 1) / 2);
    selected.push(entries[mid]);
  }
  return selected;
}

/**
 * P2-D6: verified claims, not Nexus prose, feed the "What held up this
 * period" section AND the premium narrative's pattern context. A prior
 * `nexusInsightLabel` helper fed both seams from unverified Nexus insight
 * prose (`readNexusData`'s `active` items) straight into either the weekly
 * template or another LLM's prompt — this report was piping unverified LLM
 * prose into another LLM (DR findings 8/11). It has been removed; `claims`
 * (generator.js's `readVerifiedClaims` — ranked, capped at 5, `status ===
 * 'verified'` only) is now the sole source for both.
 */

/** Copy shown when zero verified claims exist for the period. Deliberately
 * NEVER falls back to Nexus prose — an empty claims set means exactly that:
 * nothing has cleared the evidence gates yet. */
const NO_VERIFIED_CLAIMS_NARRATIVE =
  'No verified patterns held up this period — Engram only surfaces associations your recorded days actually support.';

/**
 * Render one verified claim as report prose: its (already causal-language-
 * checked, see claimSchema.js's buildClaim) `wording`, the day-count line,
 * and its first limitation. All three come from the claim doc itself — no
 * paraphrasing, no LLM involvement.
 * @param {object} claim
 * @returns {string}
 */
function formatClaimLine(claim) {
  const exposed = claim.evidence?.exposedDayCount;
  const comparison = claim.evidence?.comparisonDayCount;
  const parts = [claim.wording, `(${exposed} vs ${comparison} days)`];
  const firstLimitation = Array.isArray(claim.limitations) ? claim.limitations[0] : null;
  if (firstLimitation) parts.push(firstLimitation);
  return parts.join(' ');
}

/**
 * Build the "What held up this period" section — the single top-ranked
 * verified claim (claims arrives pre-ranked from
 * generator.js's `readVerifiedClaims`, then split by
 * `generator.js`'s `splitClaimsByPeriodOverlap` — this function only ever
 * receives the PERIOD-OVERLAPPING half, see that split's doc comment for
 * the overlap rule itself), or the explicit no-claims copy. Shared by both
 * `generateWeeklyTemplate` and `generatePremiumNarrative` so the two
 * cadence families render this section identically.
 * @param {Array<object>} claims - pre-ranked, capped, period-overlapping
 *   verified claims
 * @param {string[]} fallbackEntryRefs - used when there's no claim to cite
 *   an entry-level receipt from (zero claims, or a claim missing
 *   evidence.sourceEntryIds). Safe to default to the period's own entry id
 *   list here BECAUSE every claim reaching this function has already been
 *   verified to overlap the report period.
 * @returns {object} section
 */
function buildHeldUpSection(claims, fallbackEntryRefs) {
  const topClaim = Array.isArray(claims) && claims.length > 0 ? claims[0] : null;
  const narrative = topClaim ? formatClaimLine(topClaim) : NO_VERIFIED_CLAIMS_NARRATIVE;
  const claimEntryIds = topClaim && Array.isArray(topClaim.evidence?.sourceEntryIds)
    ? topClaim.evidence.sourceEntryIds.filter(Boolean)
    : null;
  return {
    id: 'held_up',
    title: 'What held up this period',
    narrative,
    chartData: null,
    entities: [],
    entryRefs: (claimEntryIds && claimEntryIds.length > 0) ? claimEntryIds : fallbackEntryRefs,
  };
}

/**
 * REP-01 fix #2 (overlap rule, review's option 3 as fallback): build the
 * "Current verified insights (not period-specific)" section from verified
 * claims whose evidence window did NOT overlap the requested report period
 * (`generator.js`'s `splitClaimsByPeriodOverlap` — the other half of the
 * same split `buildHeldUpSection` consumes). This is how a stale/current
 * claim is allowed to reach a historical report AT ALL: explicitly labeled
 * as current, non-period context, never folded into "What held up this
 * period" — the exact "unlabeled cross-period attribution" REP-01 exists to
 * close.
 *
 * Returns `null` (never an empty-copy section) when there are zero
 * non-overlapping claims — unlike `buildHeldUpSection`, this section only
 * exists to carry content that would otherwise be silently dropped, so an
 * empty state means "omit the section," not "render a placeholder."
 *
 * entryRefs is deliberately NEVER the period's own entry id list (no
 * fallback to a period-scoped default) — these claims are, by construction,
 * NOT period-scoped, so falling back to period entryRefs would itself be
 * the unlabeled cross-period attribution this section exists to prevent.
 * A current claim with no `evidence.sourceEntryIds` cites nothing rather
 * than borrowing the period's entries.
 * @param {Array<object>} currentClaims - pre-ranked, capped, NON-overlapping
 *   verified claims
 * @returns {object|null}
 */
function buildCurrentContextSection(currentClaims) {
  if (!Array.isArray(currentClaims) || currentClaims.length === 0) return null;
  const topClaim = currentClaims[0];
  const claimEntryIds = Array.isArray(topClaim.evidence?.sourceEntryIds)
    ? topClaim.evidence.sourceEntryIds.filter(Boolean)
    : [];
  return {
    id: 'current_context',
    title: 'Current verified insights (not period-specific)',
    narrative: formatClaimLine(topClaim),
    chartData: null,
    entities: [],
    entryRefs: claimEntryIds,
  };
}

/**
 * Generate a weekly digest using templates (no LLM).
 * @param {object} analyticsData - Pre-computed analytics
 * @param {object} nexusData - `{insights, patterns}` read from the Nexus
 *   `nexus/insights` singleton doc (generator.js's readNexusData) — every
 *   item carries a `.receipt` per the R2 100%-receipts invariant, and the
 *   `entries`-derived `moodScore` referenced below is the 0-1 internal
 *   scale (see src/types/entries.d.ts), not a display value.
 * @param {Array<{id: string, moodScore: (number|null)}>} [entries] - Period's
 *   entries (post source-exclusion filtering), used to populate entryRefs
 *   receipts. Optional/defaults to [] for backward compatibility with
 *   callers that only need narrative text.
 * @param {Array<object>} [claims] - Verified claims that OVERLAP the report
 *   period (generator.js's `readVerifiedClaims` result, pre-ranked/capped,
 *   then split by `splitClaimsByPeriodOverlap` — REP-01) — the ONLY source
 *   for the "What held up this period" section (P2-D6). `nexusData` is no
 *   longer read for that purpose; it's kept as a parameter for signature
 *   stability with the call site (generator.js still reads it for other,
 *   non-prompt purposes, e.g. report metadata.topInsights).
 * @param {Array<object>} [currentClaims] - Verified claims that did NOT
 *   overlap the report period (REP-01 fix #2) — rendered, if any, as a
 *   separately-labeled "Current verified insights (not period-specific)"
 *   section so a report is never emptied out just because nothing verified
 *   happens to overlap a short/quiet period.
 * @returns {Array<object>} sections
 */
export function generateWeeklyTemplate(analyticsData, nexusData, entries = [], claims = [], currentClaims = []) {
  const { entryCount = 0, moodAvg, moodTrend, topTheme } = analyticsData;

  // Summary bullets
  const bullets = [];
  bullets.push(`You wrote ${entryCount} journal ${entryCount === 1 ? 'entry' : 'entries'} this week.`);
  if (moodAvg != null) {
    const moodLabel = moodAvg >= 7 ? 'positive' : moodAvg >= 4 ? 'mixed' : 'challenging';
    bullets.push(`Your overall mood was ${moodLabel} (avg ${moodAvg.toFixed(1)}/10).`);
  }
  if (topTheme) {
    bullets.push(`Your most common theme was "${topTheme}".`);
  }

  // Receipts (entryRefs): which entries actually fed each section's builder.
  // - summary: a period-level aggregate (entry count, mood avg, top theme)
  //   computed over the whole period — not attributable to a subset, so it
  //   falls back to the full period id list.
  // - held_up: buildHeldUpSection cites the claim's own
  //   evidence.sourceEntryIds when a claim is present (real attribution,
  //   an improvement over the old nexus-insight "no per-source id" gap),
  //   falling back to the full period id list otherwise.
  // - mood_trend: determinable exactly. It's the same entries
  //   (moodScore != null) that generator.js used to build the sparkline
  //   chartData for this section.
  const periodEntryIds = entries.map(e => e.id).filter(Boolean);
  const moodEntryIds = entries
    .filter(e => e.moodScore !== null && e.moodScore !== undefined)
    .map(e => e.id)
    .filter(Boolean);

  const sections = [
    {
      id: 'summary',
      title: 'This Week',
      narrative: bullets.join(' '),
      chartData: null,
      entities: [],
      entryRefs: periodEntryIds,
    },
    buildHeldUpSection(claims, periodEntryIds),
    {
      id: 'mood_trend',
      title: 'Mood Trend',
      narrative: '',
      chartData: { type: 'sparkline', data: moodTrend || [] },
      entities: [],
      entryRefs: moodEntryIds,
    },
  ];

  // REP-01 fix #2: appended only when there's non-period-overlapping content
  // to show — see buildCurrentContextSection's doc comment.
  const currentContextSection = buildCurrentContextSection(currentClaims);
  if (currentContextSection) sections.push(currentContextSection);

  return sections;
}

const SECTION_CONFIGS = {
  monthly: [
    { id: 'narrative_arc', title: 'Month in Review' },
    { id: 'patterns', title: 'Top Patterns' },
    { id: 'goals', title: 'Goal Progress' },
    { id: 'health', title: 'Health & Wellness' },
    { id: 'entities', title: 'Key People & Places' },
    { id: 'notable', title: 'Notable Entries' },
  ],
  quarterly: [
    { id: 'trajectory', title: 'Life Trajectory' },
    { id: 'growth', title: 'Who You Were vs. Who You\'re Becoming' },
    { id: 'pattern_evolution', title: 'Pattern Evolution' },
    { id: 'goals_long_term', title: 'Long-term Goal Tracking' },
    { id: 'beliefs', title: 'Belief Evolution' },
  ],
  annual: [
    { id: 'year_narrative', title: 'Your Year in Review' },
    { id: 'milestones', title: 'Growth Milestones' },
    { id: 'quotes', title: 'Notable Quotes' },
    { id: 'yoy_comparison', title: 'Year-over-Year Changes' },
    { id: 'health_year', title: 'Health Year in Review' },
    { id: 'relationships', title: 'Relationship Evolution' },
  ],
};

/**
 * Generate narrative sections via Gemini synthesis.
 * @param {'monthly'|'quarterly'|'annual'} cadence
 * @param {object} contextData - All gathered data
 * @param {string} apiKey - Gemini API key
 * @param {object} db - Firestore instance (admin SDK), used to resolve the
 *   'insight' workload model via the registry.
 * @returns {Promise<Array<object>>} sections
 */
export async function generatePremiumNarrative(cadence, contextData, apiKey, db) {
  const sectionConfigs = SECTION_CONFIGS[cadence];
  if (!sectionConfigs) throw new Error(`Unknown cadence: ${cadence}`);

  // Resolve once per report run (registry, workload 'insight') rather than
  // hardcoding the Gemini model — mirrors the analysis orchestrator's
  // pattern of a single resolution shared across every call this function
  // makes (section narratives + month pre-summarization).
  const model = await getModel(db, 'insight');

  // For quarterly/annual, pre-summarize by month first. Only these two
  // cadences ever get `monthSummaries` injected into buildSectionPrompt()
  // (see the `contextData.monthSummaries` check there) — monthly never
  // pre-summarizes, so its entryRefs below stay the plain slice(0,8).
  let synthesisContext = contextData;
  if (cadence === 'quarterly' || cadence === 'annual') {
    synthesisContext = await preSummarizeByMonth(contextData, apiKey, model);
  }

  // Receipts (entryRefs): buildSectionPrompt() feeds every section the same
  // representative excerpt sample (selectRepresentativeEntries(), see its
  // doc above — R4 Task 4 replaces the old first-8-chronological slice)
  // — there's no per-section entry subset in this builder, so entryRefs is
  // that same id list for every section, whether generation succeeded or
  // fell back to the "could not be generated" placeholder (the prompt was
  // still built and sent with these entries either way).
  //
  // For quarterly/annual, buildSectionPrompt ALSO injects `monthSummaries`
  // into every section's prompt — built by preSummarizeByMonth from up to
  // 10 excerpts PER MONTH, sampled from ALL of contextData.entries, not
  // just the representative sample. Citing only the representative-sample
  // ids would under-claim what actually fed the narrative (provenance
  // dishonesty), so for these two cadences entryRefs is the deduped union
  // of the representative-sample ids and every month-sampled entry id.
  // Monthly never gets monthSummaries, so its
  // synthesisContext.monthSampleEntryIds is undefined and this union
  // degrades to the plain representative sample, unchanged from before.
  const sliceIds = selectRepresentativeEntries(synthesisContext.entries || [], NARRATIVE_SAMPLE_SIZE)
    .map(e => e.id)
    .filter(Boolean);
  const monthSampleIds = synthesisContext.monthSampleEntryIds || [];
  const sourceEntryIds = Array.from(new Set([...sliceIds, ...monthSampleIds]));

  const sections = [];
  for (const config of sectionConfigs) {
    try {
      const narrative = await generateSectionNarrative(
        config, cadence, synthesisContext, apiKey, model
      );
      sections.push({
        id: config.id,
        title: config.title,
        narrative,
        chartData: null,
        entities: [],
        entryRefs: sourceEntryIds,
      });
    } catch (e) {
      console.error(`[narrative] Failed to generate section ${config.id}:`, e.message);
      sections.push({
        id: config.id,
        title: config.title,
        narrative: 'This section could not be generated. Please try again later.',
        chartData: null,
        entities: [],
        entryRefs: sourceEntryIds,
      });
    }
  }

  // "What held up this period" (P2-D6): deterministic, rendered directly
  // from verified claims — never LLM-authored, so it can never invent or
  // paraphrase a claim's wording. Appended after the LLM-generated sections
  // above (which separately receive claims wording as prompt CONTEXT via
  // buildSectionPrompt, not as something they're asked to restate).
  // synthesisContext carries `claims` through preSummarizeByMonth's
  // `...contextData` spread unchanged, so this works uniformly across
  // monthly/quarterly/annual.
  sections.push(buildHeldUpSection(synthesisContext.claims || [], sourceEntryIds));

  // REP-01 fix #2: non-period-overlapping verified claims, explicitly
  // labeled, never folded into "held_up" and never LLM-authored/LLM-prompted
  // (buildSectionPrompt above only ever sees `synthesisContext.claims`, the
  // period-overlapping half — see that function's comment). Omitted
  // entirely when there's nothing to show (buildCurrentContextSection
  // returns null on empty input).
  const currentContextSection = buildCurrentContextSection(synthesisContext.currentClaims || []);
  if (currentContextSection) sections.push(currentContextSection);

  return sections;
}

const SYSTEM_PROMPT = `You are a compassionate life reflection assistant helping someone understand their journal data.
Write in second person ("you"). Be warm, non-judgmental, and growth-oriented.
Focus on patterns, progress, and gentle observations. Never diagnose or prescribe.
Output ONLY the narrative text for the requested section. No JSON, no markdown headers.
Keep each section to 150-300 words.`;

async function generateSectionNarrative(config, cadence, contextData, apiKey, model) {
  const userPrompt = buildSectionPrompt(config, cadence, contextData);
  const result = await callGeminiWithRetry(apiKey, SYSTEM_PROMPT, userPrompt, model);
  if (!result) throw new Error('Gemini returned null');
  return result.trim();
}

// Rough token budget: ~28K tokens for prompt (4 chars per token), leaving room for response
const MAX_PROMPT_CHARS = 28000 * 4;

function buildSectionPrompt(config, cadence, contextData) {
  const { entries, analytics, signals, health, claims } = contextData;
  const context = [];

  context.push(`Generate the "${config.title}" section for a ${cadence} life report.`);

  if (analytics?.entryCount) context.push(`Entries this period: ${analytics.entryCount}`);
  if (analytics?.moodAvg) context.push(`Average mood: ${analytics.moodAvg.toFixed(1)}/10`);
  if (analytics?.topThemes?.length) context.push(`Top themes: ${analytics.topThemes.join(', ')}`);
  if (signals?.activeGoals?.length) context.push(`Active goals: ${signals.activeGoals.map(g => g.title || g.description).join(', ')}`);
  if (signals?.achievedGoals?.length) context.push(`Achieved goals: ${signals.achievedGoals.map(g => g.title || g.description).join(', ')}`);
  // P2-D6: verified claims + deterministic stats replace the old Nexus
  // "Detected patterns" injection (nexus.patterns via nexusInsightLabel) —
  // that fed this LLM prose from ANOTHER, unverified LLM's output. `claims`
  // here is `synthesisContext.claims` — generator.js's `readVerifiedClaims`
  // result AFTER `splitClaimsByPeriodOverlap` (REP-01): only the claims
  // whose evidence window overlaps THIS report's period, never the
  // non-overlapping `currentClaims` half (that half never reaches this
  // prompt at all — see `buildCurrentContextSection`, which renders it
  // deterministically instead). Pre-ranked, capped at 5, `status ===
  // 'verified'` only, wording already causal-language-checked by
  // claimSchema's buildClaim. Every line here is grounded in a specific
  // claim's own numbers — nothing paraphrased or invented by this prompt.
  if (claims?.length) {
    const claimLines = claims.map(formatClaimLine);
    context.push(`Verified patterns this period (associations only, never causal — treat as established fact, do not re-derive or contradict): ${claimLines.join('; ')}`);
  }
  if (health?.summary) context.push(`Health summary: ${health.summary}`);

  // Include entry excerpts (truncated) — representative sample, not just
  // the earliest entries in the period (R4 Task 4; see
  // selectRepresentativeEntries's doc above).
  if (entries?.length) {
    const sampled = selectRepresentativeEntries(entries, NARRATIVE_SAMPLE_SIZE);
    const excerpts = sampled.map(e =>
      `[${e.date}] ${(e.text || '').slice(0, 200)}`
    );
    context.push(`Entry excerpts:\n${excerpts.join('\n')}`);
  }

  // For pre-summarized data (quarterly/annual)
  if (contextData.monthSummaries) {
    context.push(`Monthly summaries:\n${contextData.monthSummaries}`);
  }

  // Enforce token budget by truncating if needed
  let prompt = context.join('\n\n');
  if (prompt.length > MAX_PROMPT_CHARS) {
    prompt = prompt.slice(0, MAX_PROMPT_CHARS) + '\n\n[Context truncated for token budget]';
  }
  return prompt;
}

/**
 * @returns {Promise<object>} contextData plus `monthSummaries` (joined text)
 *   and `monthSampleEntryIds` — the ids of every entry whose excerpt was
 *   actually sampled into a month summary (up to 10 per month), so callers
 *   can attribute monthSummaries content in entryRefs receipts.
 */
async function preSummarizeByMonth(contextData, apiKey, model) {
  const { entries = [] } = contextData;

  // Group entries by month
  const byMonth = {};
  for (const entry of entries) {
    const month = entry.date?.slice(0, 7) || 'unknown';
    if (!byMonth[month]) byMonth[month] = [];
    byMonth[month].push(entry);
  }

  const summaries = [];
  const monthSampleEntryIds = [];
  for (const [month, monthEntries] of Object.entries(byMonth).sort()) {
    const sampled = monthEntries.slice(0, 10);
    const excerpts = sampled.map(e =>
      `[${e.date}] ${(e.text || '').slice(0, 150)}`
    ).join('\n');
    for (const e of sampled) {
      if (e.id) monthSampleEntryIds.push(e.id);
    }

    const summary = await callGeminiWithRetry(
      apiKey,
      'Summarize these journal entries for one month in 2-3 sentences. Focus on themes, mood, and notable events.',
      `Month: ${month}\n\nEntries:\n${excerpts}`,
      model
    );
    summaries.push(`${month}: ${summary || 'No summary available.'}`);
  }

  return {
    ...contextData,
    monthSummaries: summaries.join('\n'),
    monthSampleEntryIds,
  };
}

/**
 * Call Gemini with exponential backoff retry.
 * @param {string} apiKey
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @param {string} [model] - Model id (registry-resolved). Falls through to
 *   callGemini's own default when omitted.
 * @param {number} maxRetries
 * @returns {Promise<string|null>}
 */
async function callGeminiWithRetry(apiKey, systemPrompt, userPrompt, model, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const result = await callGemini(apiKey, systemPrompt, userPrompt, model);
    if (result) return result;

    if (attempt < maxRetries - 1) {
      const delay = Math.pow(4, attempt) * 1000; // 1s, 4s, 16s
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  return null;
}

export { callGeminiWithRetry };

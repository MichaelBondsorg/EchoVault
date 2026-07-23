import { useState } from 'react';
import { X } from 'lucide-react';
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
  DrawerDescription,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  SectionLabel,
} from '../cloud';
import SourceList from './SourceList';
import { recordFeedbackAndLearn } from '../../services/basicInsights/feedbackLearning';
import { recordInsightEngagement } from '../../services/analytics/insightEngagement';
import { excludeSource } from '../../services/insights/sourceExclusions';
import { FEEDBACK_OPTIONS, recordClaimFeedback } from '../../services/insights/claims/claimFeedback';
import { db } from '../../config/firebase';
import { extractPatternTypeFromInsight } from '../../hooks/useNexusInsights';

/**
 * ReceiptSheet — "Why am I seeing this?" (Trustworthy Capture / R2, Task 11)
 *
 * Renders the provenance receipt (Task 8's `insight.receipt`) attached to a
 * Nexus or Basic insight, and the four PRD P0 repair actions wired to the
 * exact services named in the R2 plan (Task 10's exclusions layer). Mounted
 * behind `getFlag('insightReceipts')` by the surfaces that show insight
 * cards (`NexusInsightsWidget`, `InsightsPage`) — this component itself
 * does not read the flag; it only renders the sheet's content when handed
 * an `insight` with a receipt and `open=true`.
 *
 * Section order is PRD-mandated and intentionally not reorderable: claim →
 * confidence band → Space → time window → sample size + missingness
 * (BEFORE any narrative/evidence section) → sources → alternatives (from
 * `evidence.narrative`, when there's more than one).
 *
 * Copy constraints (tested): no "model"/"token"/version jargon rendered
 * anywhere — `receipt.versions` is intentionally never displayed. No guilt
 * copy on the repair actions.
 *
 * Claim vs legacy feedback branching (R4 Phase 1 Task 9, DR finding 10):
 * when `insight.claimType` is present (an `InsightClaim` doc, per
 * `claimSchema.js`), the repair-action row at the bottom is replaced by the
 * 6-option diagnostic feedback taxonomy (`FEEDBACK_OPTIONS`/
 * `recordClaimFeedback` from `claimFeedback.js`) — a radio list + submit
 * button, each option routed to the RIGHT consumer (corrections change
 * facts, preferences change ranking; see that module's header comment for
 * the full table). The per-source "Wrong source" button keeps its existing
 * row affordance and immediate (no-submit-needed) behavior, but for a claim
 * it now calls `recordClaimFeedback(..., 'wrong_source', {entryId})`
 * instead of `excludeSource` directly — `wrong_source` is excluded from the
 * radio+submit flow (it requires a specific entryId the radio group doesn't
 * have) and shows a hint pointing at the source rows instead. Legacy
 * insights (no `claimType`) are completely untouched: they keep today's
 * "Not true"/"Not useful" pair and `excludeSource`-direct "Wrong source".
 *
 * v1 scope notes (documented per the task brief, not gaps to silently
 * paper over):
 * - Source row tap-to-expand only ever reads `entriesById` (a synchronous,
 *   already-in-memory lookup the caller provides). It never fetches a
 *   missing entry from Firestore — if the entry isn't in `entriesById`,
 *   the row still shows the receipt's own `date` + `excerpt`, just with no
 *   expand affordance.
 * - `spaces` (for resolving `receipt.scope.spaceId` → a name) is optional
 *   and defaults to `[]`; a scoped receipt with no matching space falls
 *   back to "a Space" (never crashes, never silently claims "All spaces").
 */

// Confidence-band derivation matches the priority chain already established
// at the NexusInsightCard call site in InsightsPage.jsx (insight.confidence
// -> insight.score -> evidence.statistical.confidence ->
// recommendation.confidence), so a given insight bands identically whether
// read from either place.
function confidenceValueOf(insight) {
  const value =
    insight?.confidence ??
    insight?.score ??
    insight?.evidence?.statistical?.confidence ??
    insight?.recommendation?.confidence;
  return typeof value === 'number' && !Number.isNaN(value) ? value : null;
}

/**
 * Plain-language confidence band. No insight ships a value -> defaults to
 * 'moderate' (a documented choice: neither over- nor under-claiming when
 * the generator didn't compute one).
 */
export function confidenceBand(insight) {
  const value = confidenceValueOf(insight);
  if (value === null) return 'moderate';
  if (value >= 0.75) return 'strong';
  if (value >= 0.5) return 'moderate';
  return 'tentative';
}

const CONFIDENCE_COPY = {
  strong: 'Strong pattern',
  moderate: 'Moderate pattern',
  tentative: 'Tentative pattern',
};

/**
 * The pattern-family key a per-insight "Wrong source" exclusion is scoped
 * to.
 *
 * Task-11 re-review fix: the SOURCE OF TRUTH for what "the same pattern
 * family" means is `recordFeedbackAndLearn`'s own derivation
 * (`src/services/basicInsights/feedbackLearning.js:129-132`, the "Not
 * true" path):
 *   activityKey ? `activity_${activityKey}`
 *   : themeKey  ? `theme_${themeKey}`
 *   : peopleKey ? `people_${peopleKey}`
 *   : insightId || category
 * Before this fix, "Wrong source" never read activityKey/themeKey/
 * peopleKey/id/category at all — it only tried `extractPatternTypeFromInsight`
 * (a title/body/summary keyword map) and `insight.type`. Basic insights
 * (`{category, insight, activityKey?, themeKey?, peopleKey?}` — no title/
 * body/summary/type) hit neither, so every basic-card "Wrong source"
 * landed `'unspecified'` while "Not true" correctly scoped per-family.
 * This replicates that exact chain FIRST (reading the same fields
 * `feedbackDataFor` above reads to build `recordFeedbackAndLearn`'s
 * argument: activityKey/themeKey/peopleKey, `insight.id` as its
 * `insightId`, and `category`), so both actions scope any given insight
 * identically. `ReceiptSheet.realFeedback.test.jsx` pins the two
 * derivations equal (via the real `recordFeedbackAndLearn` Firestore
 * write) across a shared fixture set, so they can't silently drift apart.
 *
 * Deliberately replicated rather than imported as a shared helper:
 * several test files that render this component fully `vi.mock()` the
 * `feedbackLearning` module down to just `{ recordFeedbackAndLearn }`
 * (`ReceiptSheet.test.jsx`, `NexusInsightsWidget.portalBubbling.test.jsx`)
 * — a second named export imported from that module here would resolve to
 * `undefined` under those mocks and crash "Wrong source" in all of them.
 *
 * Only when the chain above resolves to nothing (no keys, no id, no
 * category — essentially never for a real insight) does this fall back to
 * `extractPatternTypeFromInsight` (the same title/body/summary/insight
 * keyword→pattern map that already gates feedback-learning suppression in
 * `useNexusInsights`), then the insight's own `type` string, then
 * `category` again (a harmless, likely-unreachable extra floor), then
 * `'unspecified'` as the final floor — never `undefined`, which
 * `excludeSource` would silently default to `'all'`, collapsing this
 * action into "Exclude source"'s scope.
 */
export function patternTypeOf(insight) {
  const { activityKey, themeKey, peopleKey, id: insightId, category } = insight || {};

  const learningPatternType = activityKey
    ? `activity_${activityKey}`
    : themeKey
    ? `theme_${themeKey}`
    : peopleKey
    ? `people_${peopleKey}`
    : insightId || category;

  return (
    learningPatternType ||
    extractPatternTypeFromInsight(insight) ||
    insight?.type ||
    insight?.category ||
    'unspecified'
  );
}

function claimTitle(insight) {
  if (typeof insight?.title === 'string' && insight.title.trim()) return insight.title;
  if (typeof insight?.category === 'string' && insight.category.trim()) {
    return insight.category.replace(/_/g, ' ');
  }
  return 'Insight';
}

function claimSummary(insight) {
  return (
    insight?.summary ||
    insight?.insight ||
    insight?.body ||
    insight?.message ||
    insight?.description ||
    ''
  );
}

function spaceLabel(scope, spaces) {
  if (!scope || !scope.spaceId) return 'All spaces';
  const match = (spaces || []).find((s) => s.id === scope.spaceId);
  return match?.name || 'a Space';
}

// `timeZone: 'UTC'` is deliberate: receipt dates are ISO/UTC instants, and
// formatting in the host's local timezone (the `toLocaleDateString`
// default) can shift the displayed calendar day by ±1 depending on where
// the app/test runner happens to be, which would make an entry dated
// midnight UTC read as "the day before" for anyone west of Greenwich.
// Anchoring to UTC keeps the displayed date stable and matches what's
// actually stored in the receipt, regardless of viewer or CI timezone.
function formatDate(iso) {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/**
 * "Alternatives" line: when `evidence.narrative` has more than one entry,
 * everything past the first is treated as an alternative
 * explanation/observation worth surfacing (the first is already the
 * insight's primary evidence, referenced by the claim/summary itself). A
 * single- or zero-entry narrative array offers nothing beyond the claim,
 * so no alternatives line renders. Documented choice — the brief's own
 * wording ("alternatives line when evidence.narrative offers one") doesn't
 * name a distinct field, and no generator in this codebase emits one.
 */
function narrativeAlternatives(insight) {
  const narrative = insight?.evidence?.narrative;
  if (!Array.isArray(narrative) || narrative.length < 2) return [];
  return narrative
    .slice(1)
    .filter((item) => typeof item === 'string' && item.trim().length > 0);
}

function citedEntriesFromReceipt(receipt, entriesById) {
  const sources = receipt?.sources || [];
  return sources.map((source) => {
    const entry = entriesById?.[source.entryId];
    if (entry) return entry;
    // Synchronous fallback: the receipt's own fields, no Firestore fetch.
    return { id: source.entryId, entryId: source.entryId, date: source.date, excerpt: source.excerpt };
  });
}

const RECOMPUTE_COPY = 'This will recompute affected insights.';
// Minor 4 (R2 final review): pattern-scoped exclusions (appliesTo =
// patternType, written by "Wrong source" below) have ZERO generation
// consumers today — `src/services/insights/sourceExclusions.js`'s own doc
// comment (:5-9) says only `appliesTo === 'all'` exclusions are read back by
// `getExcludedEntryIds`/any generator. `RECOMPUTE_COPY` is only true for the
// "Exclude source" (appliesTo:'all') confirm flow below. This copy sits next
// to BOTH source actions (SourceList's shared footer) but is worded for what
// "Wrong source" actually does — feeds `feedbackLearning`'s confidence
// suppression for that pattern family, not a recompute — so it never
// over-promises. "Exclude source" keeps its own accurate RECOMPUTE_COPY in
// its confirm dialog (below), unchanged.
const WRONG_SOURCE_COPY = "This source won't be used for this kind of insight in the future.";

// Finding 3 (R4 Phase 1 Task 9 review, minor): the id the "use Wrong source
// under a specific entry" hint carries, and that the wrong_source radio
// input + the (then-disabled) Submit button reference via aria-describedby
// — so a screen-reader user selecting that option, or tabbing to the
// disabled Submit, hears WHY it's disabled instead of just "dimmed". Only
// wired while the hint is actually rendered (selectedClaimOption ===
// 'wrong_source') — no dangling id reference when it isn't in the DOM.
const CLAIM_WRONG_SOURCE_HINT_ID = 'claim-wrong-source-hint';

/**
 * Builds the `feedback` object `recordFeedbackAndLearn` actually expects
 * (`src/services/basicInsights/feedbackLearning.js`, which destructures its
 * SECOND argument as `{ insightId, category, moodDelta, activityKey,
 * themeKey, peopleKey, entryIds }` and derives `patternType` from those
 * fields — a bare string there yields `patternType === undefined`, which
 * throws inside Firestore's `doc()` and gets silently swallowed, so nothing
 * is ever recorded). Mirrors the construction already proven correct at
 * `InsightsPage.jsx`'s `handleFeedback` (`feedbackData`), adapted to what
 * a receipt has on hand: `entryIds` comes from the cited entries actually
 * shown in this sheet (the receipt's sources), not `insight.entryIds`,
 * since Nexus insights don't carry that field. Optional keys are omitted
 * entirely rather than sent as `undefined` when the insight doesn't carry
 * them, so `patternType`'s own fallback chain in `recordFeedbackAndLearn`
 * (activityKey -> themeKey -> peopleKey -> insightId -> category) behaves
 * exactly as it does for InsightsPage's own basic-insight feedback.
 */
function feedbackDataFor(insight, citedEntries) {
  const entryIds = citedEntries
    .map((entry) => entry?.id || entry?.entryId)
    .filter(Boolean);

  const data = {
    insightId: insight?.id,
    feedback: 'inaccurate',
    entryIds,
  };
  if (insight?.activityKey) data.activityKey = insight.activityKey;
  if (insight?.themeKey) data.themeKey = insight.themeKey;
  if (insight?.peopleKey) data.peopleKey = insight.peopleKey;
  if (insight?.category) data.category = insight.category;
  if (typeof insight?.moodDelta === 'number') data.moodDelta = insight.moodDelta;
  if (typeof insight?.sampleSize === 'number') data.sampleSize = insight.sampleSize;
  return data;
}

const ReceiptSheet = ({
  insight,
  entriesById = {},
  uid,
  spaces = [],
  open,
  onClose,
  onFeedback,
  onExcludeSource,
}) => {
  const [confirmEntryId, setConfirmEntryId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [selectedClaimOption, setSelectedClaimOption] = useState(null);

  const receipt = insight?.receipt || null;
  const isOpen = Boolean(open && receipt);
  const isClaim = Boolean(insight?.claimType);

  const handleClose = () => {
    setConfirmEntryId(null);
    setSelectedClaimOption(null);
    onClose?.();
  };

  const handleNotTrue = async () => {
    setBusy(true);
    try {
      const citedEntries = citedEntriesFromReceipt(receipt, entriesById);
      const feedbackData = feedbackDataFor(insight, citedEntries);
      // `entriesById` is built by every mount site (NexusInsightsWidget,
      // InsightsPage) from the FULL entries prop, not just cited ones — its
      // size is a valid `currentEntryCount` for the resurfacing-bug fix
      // (R4 Task 5) in `recordFeedbackAndLearn`.
      const result = await recordFeedbackAndLearn(uid, feedbackData, citedEntries, Object.keys(entriesById).length);
      // recordFeedbackAndLearn returns null on any failure (bad patternType,
      // Firestore error, ...) — only report success to the caller when the
      // write actually happened. Reporting success on a silent no-op is
      // exactly the bug this fix closes.
      if (result != null) {
        onFeedback?.('not_true');
      } else {
        console.error('[ReceiptSheet] "Not true" feedback was not recorded (recordFeedbackAndLearn returned null)');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleNotUseful = async () => {
    setBusy(true);
    try {
      await recordInsightEngagement(uid, insight, 'dismissed');
      onFeedback?.('not_useful');
    } finally {
      setBusy(false);
    }
  };

  const handleWrongSource = async (entryId) => {
    setBusy(true);
    try {
      const appliesTo = patternTypeOf(insight);
      await excludeSource(db, uid, { entryId, appliesTo, reason: 'wrong_source' });
      onExcludeSource?.({ entryId, appliesTo, reason: 'wrong_source' });
    } finally {
      setBusy(false);
    }
  };

  // Claim-only counterpart to handleWrongSource above: routes through
  // recordClaimFeedback (which scopes the exclusion to the claim's
  // analysisPlan.hypothesisFamilyId AND writes the raw insightFeedback
  // audit event) instead of calling excludeSource directly.
  const handleClaimWrongSource = async (entryId) => {
    setBusy(true);
    try {
      await recordClaimFeedback(db, uid, insight, 'wrong_source', { entryId });
      onExcludeSource?.({
        entryId,
        appliesTo: insight?.analysisPlan?.hypothesisFamilyId,
        reason: 'wrong_source',
      });
    } finally {
      setBusy(false);
    }
  };

  // Submits one of the 5 radio-selectable claim feedback options (everything
  // except 'wrong_source', which has its own per-source affordance above and
  // is excluded here — the radio group has no entryId to hand it).
  const handleClaimFeedbackSubmit = async () => {
    if (!selectedClaimOption || selectedClaimOption === 'wrong_source' || busy) return;
    setBusy(true);
    try {
      await recordClaimFeedback(db, uid, insight, selectedClaimOption, {
        entriesCount: Object.keys(entriesById).length,
      });
      onFeedback?.(selectedClaimOption);
      setSelectedClaimOption(null);
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmExclude = async () => {
    const entryId = confirmEntryId;
    if (!entryId) return;
    setBusy(true);
    try {
      await excludeSource(db, uid, { entryId, appliesTo: 'all', reason: 'excluded_by_user' });
      onExcludeSource?.({ entryId, appliesTo: 'all', reason: 'excluded_by_user' });
    } finally {
      setBusy(false);
      setConfirmEntryId(null);
    }
  };

  const band = confidenceBand(insight);
  const alternatives = narrativeAlternatives(insight);
  const startLabel = formatDate(receipt?.timeWindow?.start);
  const endLabel = formatDate(receipt?.timeWindow?.end);
  const sampleSize = receipt?.sampleSize ?? 0;

  return (
    <>
      <Drawer open={isOpen} onOpenChange={(next) => { if (!next) handleClose(); }}>
        <DrawerContent aria-labelledby="receipt-sheet-title" className="sm:mx-auto sm:max-w-xl">
          <DrawerDescription className="sr-only">
            Why you're seeing this insight, and what evidence produced it.
          </DrawerDescription>

          <div className="mb-3 flex items-center justify-between gap-2">
            <DrawerTitle id="receipt-sheet-title">Why am I seeing this?</DrawerTitle>
            <button
              type="button"
              onClick={handleClose}
              aria-label="Close"
              className="cloud-icon-button"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>

          {receipt && (
            <>
              <div className="max-h-[70vh] space-y-4 overflow-y-auto pb-2">
                {/* 1. Claim */}
                <div>
                  <p className="font-medium text-foreground break-words">{claimTitle(insight)}</p>
                  {claimSummary(insight) && (
                    <p className="mt-1 text-sm leading-relaxed text-secondary-foreground break-words">
                      {claimSummary(insight)}
                    </p>
                  )}
                </div>

                {/* 2. Confidence band — plain language only, never a bare number */}
                <div>
                  <SectionLabel>Confidence</SectionLabel>
                  <p className="mt-1 text-sm text-secondary-foreground">{CONFIDENCE_COPY[band]}</p>
                </div>

                {/* 3. Space */}
                <div>
                  <SectionLabel>Space</SectionLabel>
                  <p className="mt-1 text-sm text-secondary-foreground">
                    {spaceLabel(receipt.scope, spaces)}
                  </p>
                </div>

                {/* 4. Time window */}
                {(startLabel || endLabel) && (
                  <div>
                    <SectionLabel>Time window</SectionLabel>
                    <p className="mt-1 text-sm text-secondary-foreground">
                      {startLabel || 'Unknown'} – {endLabel || 'Unknown'}
                    </p>
                  </div>
                )}

                {/* 5. Sample size + missingness — BEFORE sources/alternatives (PRD order) */}
                <div>
                  <SectionLabel>Sample</SectionLabel>
                  <p className="mt-1 text-sm text-secondary-foreground">
                    Based on {sampleSize} {sampleSize === 1 ? 'entry' : 'entries'}
                    {receipt.missingness ? ` · ${receipt.missingness}` : ''}
                  </p>
                </div>

                {/* 6. Sources */}
                <div>
                  <SectionLabel>Sources</SectionLabel>
                  <SourceList
                    sources={receipt.sources || []}
                    entriesById={entriesById}
                    renderActions={(source) => (
                      <>
                        <button
                          type="button"
                          onClick={() => (isClaim ? handleClaimWrongSource(source.entryId) : handleWrongSource(source.entryId))}
                          disabled={busy}
                          className="relative inline-flex min-h-[28px] items-center text-xs font-medium text-accent-deep before:absolute before:-inset-2 before:content-[''] disabled:opacity-50"
                        >
                          Wrong source
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmEntryId(source.entryId)}
                          disabled={busy}
                          className="relative inline-flex min-h-[28px] items-center text-xs font-medium text-muted-foreground before:absolute before:-inset-2 before:content-[''] disabled:opacity-50"
                        >
                          Exclude source
                        </button>
                      </>
                    )}
                    footer={<p className="text-xs text-muted-foreground">{WRONG_SOURCE_COPY}</p>}
                  />
                </div>

                {/* 7. Alternatives — from evidence.narrative[1:], when present */}
                {alternatives.length > 0 && (
                  <div>
                    <SectionLabel>Other explanations</SectionLabel>
                    <div className="mt-1 space-y-1">
                      {alternatives.map((item, idx) => (
                        <p key={idx} className="text-sm italic text-secondary-foreground">
                          {item}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Distinct repair actions: claims get the 6-option diagnostic
                  feedback taxonomy; legacy insights keep the original pair
                  untouched (see the doc comment above). */}
              {isClaim ? (
                <div className="mt-4 border-t border-border pt-4">
                  <SectionLabel>Feedback</SectionLabel>
                  <div
                    role="radiogroup"
                    aria-label="Feedback on this claim"
                    className="mt-2 space-y-1"
                  >
                    {FEEDBACK_OPTIONS.map((option) => (
                      <label
                        key={option.id}
                        className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg px-2 text-sm text-secondary-foreground transition-colors hover:bg-divider"
                      >
                        <input
                          type="radio"
                          name="claim-feedback-option"
                          value={option.id}
                          checked={selectedClaimOption === option.id}
                          onChange={() => setSelectedClaimOption(option.id)}
                          disabled={busy}
                          aria-describedby={
                            option.id === 'wrong_source' && selectedClaimOption === 'wrong_source'
                              ? CLAIM_WRONG_SOURCE_HINT_ID
                              : undefined
                          }
                          className="h-4 w-4 shrink-0"
                        />
                        {option.label}
                      </label>
                    ))}
                  </div>
                  {selectedClaimOption === 'wrong_source' && (
                    <p id={CLAIM_WRONG_SOURCE_HINT_ID} className="mt-1 text-xs text-muted-foreground">
                      Use “Wrong source” under a specific entry in Sources above instead.
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={handleClaimFeedbackSubmit}
                    disabled={busy || !selectedClaimOption || selectedClaimOption === 'wrong_source'}
                    aria-describedby={selectedClaimOption === 'wrong_source' ? CLAIM_WRONG_SOURCE_HINT_ID : undefined}
                    className="mt-3 min-h-[44px] w-full rounded-full bg-accent-deep text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    Submit feedback
                  </button>
                </div>
              ) : (
                <div className="mt-4 flex gap-2 border-t border-border pt-4">
                  <button
                    type="button"
                    onClick={handleNotTrue}
                    disabled={busy}
                    className="min-h-[44px] flex-1 rounded-full border border-border text-sm font-medium text-secondary-foreground transition-colors hover:bg-divider disabled:opacity-50"
                  >
                    Not true
                  </button>
                  <button
                    type="button"
                    onClick={handleNotUseful}
                    disabled={busy}
                    className="min-h-[44px] flex-1 rounded-full border border-border text-sm font-medium text-secondary-foreground transition-colors hover:bg-divider disabled:opacity-50"
                  >
                    Not useful
                  </button>
                </div>
              )}
            </>
          )}
        </DrawerContent>
      </Drawer>

      <Dialog
        open={Boolean(confirmEntryId)}
        onOpenChange={(next) => { if (!next) setConfirmEntryId(null); }}
      >
        <DialogContent aria-labelledby="exclude-confirm-title">
          <DialogTitle id="exclude-confirm-title">Exclude this entry?</DialogTitle>
          <DialogDescription>{RECOMPUTE_COPY}</DialogDescription>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => setConfirmEntryId(null)}
              className="min-h-[44px] flex-1 rounded-full border border-border text-sm font-medium text-secondary-foreground transition-colors hover:bg-divider"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmExclude}
              disabled={busy}
              className="min-h-[44px] flex-1 rounded-full bg-accent-deep text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              Exclude
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ReceiptSheet;

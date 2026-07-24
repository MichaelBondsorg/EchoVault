import { motion, AnimatePresence } from 'framer-motion';
import {
  Brain, Sparkles, TrendingUp, AlertTriangle, Lightbulb, X,
  ChevronDown, ChevronUp, RefreshCw, Loader2, CheckCircle2,
  Activity, FileText, Target, Sun, Moon, Heart, Thermometer,
  CloudRain, Footprints, Zap, Download, ThumbsUp, ThumbsDown, Flag, Info,
  HelpCircle
} from 'lucide-react';
import { reportInsight } from '../services/moderation/reportInsight';
import { recordInsightEngagement } from '../services/analytics/insightEngagement';
import { recordInsightDismissal } from '../services/nexus/insightDismissal';
import { useNexusInsights } from '../hooks/useNexusInsights';
import { useBasicInsights } from '../hooks/useBasicInsights';
import { useClaims } from '../hooks/useClaims';
import { useState, useEffect, useMemo, useCallback, useId } from 'react';
import { recordFeedbackAndLearn } from '../services/basicInsights/feedbackLearning';
import { rebuildInsights, describeRebuildResult } from '../services/insights/rebuildInsights';
import { db } from '../config/firebase';
import { getFlag } from '../config/flags';
import ReceiptSheet from '../components/insights/ReceiptSheet';
import ClaimFeed from '../components/insights/ClaimFeed';
import { ownerStorageKey } from '../services/storage/ownerScopedStorage';
import {
  computeHealthMoodCorrelations,
  getTopHealthInsights,
  checkHealthDataSufficiency
} from '../services/health/healthCorrelations';
import {
  computeEnvironmentMoodCorrelations,
  getTopEnvironmentInsights,
  checkEnvironmentDataSufficiency
} from '../services/environment/environmentCorrelations';
import { getTodayRecommendations } from '../services/nexus/insightIntegration';
import { Tabs, TabsList, TabsTrigger, RisingTide, SectionLabel, MoodTrendBars } from '../components/cloud';
import { calculateStreak } from '../services/dashboard';
import { getMoodTrendDays, getMoodMomentum, getEntryFillMetric } from '../utils/moodTrend';

/**
 * InsightsPage - Nexus 2.0 AI Insights View
 *
 * Displays AI-generated insights from the 4-layer Nexus engine:
 * - Causal synthesis (deep pattern analysis)
 * - Recommendations (personalized actions)
 * - Belief dissonance (growth opportunities)
 * - Narrative arcs (life story patterns)
 * - Counterfactuals (what-if analysis)
 */

// First-use tip: "Why am I seeing this?" (R2 Task 11 follow-up). InsightsPage
// is the one place both the Nexus and basic-insight receipt triggers render
// (see InsightsPage.receiptTrigger.test.jsx), so this is the single home for
// the tip — Gentle Revisit and Experiments already have their own onboarding
// explainers elsewhere; this just points at an existing affordance, once.
// Owner-scoped (not the plain `featureName.tipsDismissed` key CLAUDE.md's
// page-tips example uses) because `userId` is always available here — same
// reasoning as WhatsNewModal's per-feature seen-keys and RevisitControls'
// onboarding marker, following the "local caches are owner-scoped" invariant
// wherever a uid is on hand at the mount site.
const RECEIPTS_TIP_AREA = 'insights/receiptsTipDismissed';

function hasSeenReceiptsTip(uid) {
  if (!uid) return false;
  try {
    return localStorage.getItem(ownerStorageKey(uid, RECEIPTS_TIP_AREA)) === 'true';
  } catch {
    return false;
  }
}

function markReceiptsTipSeen(uid) {
  if (!uid) return;
  try {
    localStorage.setItem(ownerStorageKey(uid, RECEIPTS_TIP_AREA), 'true');
  } catch {
    // localStorage unavailable — the tip will simply reappear next time,
    // which is safe (never blocks the receipts feature itself).
  }
}
const InsightsPage = ({
  entries,
  category,
  userId,
  user,
  todayHealth = null,
  todayEnvironment = null,
  onTryExperiment,
}) => {
  const [dismissedInsights, setDismissedInsights] = useState(new Set());
  const [expandedInsight, setExpandedInsight] = useState(null);
  const [showCorrelations, setShowCorrelations] = useState(true);
  const [recommendations, setRecommendations] = useState(null);
  const [loadingRecommendations, setLoadingRecommendations] = useState(false);
  // R2 Task 11: "Why am I seeing this?" — one ReceiptSheet instance for the
  // whole page, mounted at the top level (not nested inside a card's
  // clickable area — see the mount site below for why).
  const [receiptInsight, setReceiptInsight] = useState(null);

  // First-use tip dismissal state — see RECEIPTS_TIP_AREA doc comment above.
  // Flag-first, storage-second — mirrors getUnseenAnnouncements' discipline:
  // with insightReceipts off, no localStorage read ever fires (review fix).
  const [showReceiptsTip, setShowReceiptsTip] = useState(
    () => getFlag('insightReceipts') && !hasSeenReceiptsTip(userId)
  );

  const dismissReceiptsTip = () => {
    setShowReceiptsTip(false);
    markReceiptsTipSeen(userId);
  };

  // Synchronous entryId -> entry lookup for ReceiptSheet's source rows (v1:
  // never fetches a missing entry from Firestore — see ReceiptSheet's own
  // doc comment).
  const entriesById = useMemo(() => {
    const map = {};
    for (const entry of entries || []) {
      const id = entry?.id || entry?.entryId;
      if (id) map[id] = entry;
    }
    return map;
  }, [entries]);

  // Load recommendations when health/environment data is available
  useEffect(() => {
    // Review finding (important, cheap, R4 Phase 2 Task 6): RecommendationsSection
    // is hidden flag-ON (superseded by the unified ClaimFeed — see the
    // render-site guard below) — avoid a dark Firestore read for a section
    // nobody sees.
    if (getFlag('insightClaims')) return;

    const loadRecommendations = async () => {
      if (!userId || !entries?.length) return;
      if (!todayHealth && !todayEnvironment) return;

      setLoadingRecommendations(true);
      try {
        const result = await getTodayRecommendations(userId, entries, todayHealth, todayEnvironment);
        setRecommendations(result);
      } catch (e) {
        console.warn('Failed to load recommendations:', e);
      }
      setLoadingRecommendations(false);
    };

    loadRecommendations();
  }, [userId, entries?.length, todayHealth, todayEnvironment]);

  // Compute correlations from entries
  const correlations = useMemo(() => {
    if (!entries || entries.length < 5) return null;

    const healthSufficiency = checkHealthDataSufficiency(entries);
    const envSufficiency = checkEnvironmentDataSufficiency(entries);

    const result = { health: null, environment: null };

    if (healthSufficiency.hasEnoughData) {
      const healthCorr = computeHealthMoodCorrelations(entries);
      if (healthCorr) {
        result.health = {
          ...healthCorr,
          topInsights: getTopHealthInsights(entries, 3)
        };
      }
    } else {
      result.healthMessage = healthSufficiency.message;
    }

    if (envSufficiency.hasEnoughData) {
      const envCorr = computeEnvironmentMoodCorrelations(entries);
      if (envCorr) {
        result.environment = {
          ...envCorr,
          topInsights: getTopEnvironmentInsights(entries, 3)
        };
      }
    } else {
      result.envMessage = envSufficiency.message;
    }

    return result;
  }, [entries]);

  // Nexus 2.0 insights (active only — Fix B, 2026-07-24 brief: `history` is
  // a separate audit/lineage record and is never blended into this live
  // feed, see useNexusInsights.js's own "allInsights" doc comment).
  // R4 Phase 2 Task 6: the unified ClaimFeed (below) replaces this hook's
  // whole output when insightClaims is ON, so it's disabled in that case —
  // called unconditionally (rules of hooks) but `enabled: false` short-
  // circuits every internal fetch/generation effect, avoiding dark
  // Firestore reads + Insight Budget work for a section that never renders.
  const {
    insights: allInsights,
    insightCount: totalInsightCount,
    isCalibrating,
    calibrationProgress,
    loading,
    refreshing,
    error,
    dataStatus,
    refreshFromCache: refreshNexusFromCache,
    lastGenerated
  } = useNexusInsights(user, { autoRefresh: true, enabled: !getFlag('insightClaims') });

  // Basic Insights (statistical correlations - fast, no LLM)
  const {
    insights: basicInsights,
    loading: basicLoading,
    generating: basicGenerating,
    hasEnoughData: hasEnoughBasicData,
    entriesNeeded: basicEntriesNeeded,
    refreshFromCache: refreshBasicFromCache,
    lastGeneratedFormatted: basicLastGenerated
  } = useBasicInsights(user, entries, { autoRefresh: true });

  // Claim-backed Quick Insights (R4 Phase 1, Task 10) — always called (Rules
  // of Hooks), but the hook itself never reads Firestore unless
  // getFlag('insightClaims') is on (see useClaims.js), so mounting this
  // hook flag-OFF is a no-op for `listActiveClaims` call counts.
  const {
    claims,
    loading: claimsLoading,
    refresh: refreshClaims,
  } = useClaims(user);

  // Fix C (2026-07-24 brief) — ONE authoritative "Rebuild insights" action.
  // Every refresh/recompute entry point on this page (header button,
  // ClaimFeed's refresh, Quick Insights' refresh) routes through this same
  // callback, which itself routes through the single `rebuildInsights`
  // orchestration contract — never a per-surface subset of it again.
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildResult, setRebuildResult] = useState(null);

  const handleRebuild = useCallback(async () => {
    setRebuildResult(null);
    setRebuilding(true);
    try {
      const result = await rebuildInsights(db, userId, entries);
      setRebuildResult(result);
      // Generate-then-replace: pull the freshly computed caches into every
      // hook's displayed state via a read-only reload — never a second
      // generation (rebuildInsights already ran the pipeline once). Only
      // the active engine's surface needs reloading; the inactive one's
      // hook is already disabled/inert (useNexusInsights `enabled:false`,
      // useClaims's own internal flag gate).
      if (getFlag('insightClaims')) {
        await refreshClaims();
      } else {
        await Promise.all([refreshBasicFromCache(), refreshNexusFromCache()]);
      }
    } catch (error) {
      console.warn('[InsightsPage] rebuild failed:', error?.name || typeof error);
      // A sentinel all-engines-failed shape (not null) so the failure copy
      // below still renders — "a failed run leaves prior artifacts
      // visible" AND explains what happened, per the brief's acceptance
      // criteria, even when rebuildInsights itself threw outside its own
      // per-engine try/catch.
      setRebuildResult({
        ok: false,
        engines: { basic: { ok: false, error: 'unexpected_error' } },
        dayCount: 0,
        verifiedClaimCount: 0,
        insightCount: 0,
      });
    } finally {
      setRebuilding(false);
    }
  }, [userId, entries, refreshClaims, refreshBasicFromCache, refreshNexusFromCache]);

  // "Try as an experiment" (ClaimCard): the prefill seam is wired — AppLayout
  // owns `experimentPrefill` state and passes it to ExperimentsScreen's
  // `prefill` prop; `onTryExperiment` below is InsightsPage's own hop of
  // that chain (R4 Phase 3 Task 2).
  //
  // F4 (closure-wave final review): previously this always resolved to a
  // callable stub — even with no real `onTryExperiment` from the parent, a
  // dev-only `console.info` fallback made ClaimCard's button always fire
  // *something*, so ClaimCard always rendered it (any mapped claim ->
  // button visible) even in production, where AppLayout wires no
  // `onTryExperiment` at all: a guaranteed no-op button. Fixed at both ends
  // — ClaimCard now hides the button unless a real handler prop is present
  // (see ClaimCard.jsx), and this page only ever passes one through when
  // the PARENT actually supplied one; no dev stub, no fallback logging.
  // `undefined` here means ClaimFeed/ClaimCard render no button at all.
  const handleTryExperiment = typeof onTryExperiment === 'function'
    ? (templateId, tag) => onTryExperiment(templateId, tag)
    : undefined;

  // F1 (closure-wave final review): ReceiptSheet's `onFeedback` fires after
  // ANY feedback is recorded through it (legacy "Not true"/"Not useful", or
  // — for a claim — one of the 6-option diagnostic taxonomy submissions,
  // see ReceiptSheet.jsx). For a claim (`receiptInsight.claimType` is set),
  // that write can change the claim's status (e.g. `do_not_analyze` ->
  // suppressed) — `useClaims` only ever surfaces `status === 'verified'`
  // claims, so re-running its `refresh` is what actually drops the
  // suppressed card from the list, with no page remount required. Legacy
  // (non-claim) insight feedback doesn't touch the claims collection at
  // all, so `refreshClaims` is a harmless no-op call for that path — guarded
  // anyway so a legacy feedback event never fires an unnecessary refetch.
  const handleReceiptFeedback = () => {
    if (receiptInsight?.claimType) {
      refreshClaims();
    }
  };

  // Helper to check if an insight has meaningful content
  const hasQualityContent = (insight) => {
    // Generic body templates to filter out
    const genericBodyPatterns = [
      'appears frequently in your entries with an average mood',
      'detected from',
      'this pattern'
    ];

    const bodyLower = (insight.body || '').toLowerCase();
    const hasGenericBody = genericBodyPatterns.some(p => bodyLower.includes(p));

    // Filter out generic pattern titles like "health Pattern", "career Pattern"
    const titleLower = (insight.title || '').toLowerCase();
    const isGenericPatternTitle = titleLower.endsWith('pattern') &&
                                  titleLower.split(' ').length <= 2;

    // If it's a generic pattern title with generic body, filter it out
    if (isGenericPatternTitle) {
      return false;
    }

    // Must have either a meaningful body, summary, or recommendation
    const hasBody = insight.body && insight.body.length > 30 && !hasGenericBody;
    const hasSummary = insight.summary && insight.summary.length > 20 &&
                       !insight.summary.toLowerCase().includes('detected from');
    const hasRecommendation = insight.recommendation?.intervention ||
                              insight.recommendation?.reasoning;

    return hasBody || hasSummary || hasRecommendation;
  };

  // Filter out dismissed insights and low-quality insights
  const filteredInsights = allInsights
    .filter(i => !dismissedInsights.has(i.id || i.message))
    .filter(hasQualityContent);

  // Eligible only once a receipt-bearing insight (Nexus or basic) is
  // actually visible on the page AND the flag that gates the trigger
  // itself is on — mirrors NexusInsightCard/QuickInsightsSection's own
  // `onWhyThis && getFlag('insightReceipts')` gate, so the tip never
  // claims to point at something that isn't rendered. Flag off => always
  // false, so the tip and its HelpCircle re-show button render nothing.
  const receiptsTipEligible =
    getFlag('insightReceipts') && (filteredInsights.length > 0 || basicInsights.length > 0);

  const handleDismissInsight = (insight, e) => {
    e.stopPropagation();
    setDismissedInsights(prev => new Set([...prev, insight.id || insight.message]));
    if (expandedInsight === insight.id) {
      setExpandedInsight(null);
    }
    // Fire-and-forget engagement instrumentation (best-effort, never blocks UI).
    recordInsightEngagement(userId, insight, 'dismissed');
    // R4 Task 5 (+ T5b fix, DR finding 10): write-through so this dismissal
    // survives reload AND regeneration — best-effort, same as the
    // engagement call above. `recordInsightDismissal` takes the full
    // insight (not just `.id`) because it derives a content-stable
    // dismissal key internally (see insightDismissal.js); it already no-ops
    // when no key can be derived, so no `insight.id` guard is needed here.
    // Basic-insight dismissal isn't part of this fix — QuickInsightsSection
    // has no dismiss action.
    recordInsightDismissal(userId, insight);
  };

  const handleReportInsight = async (insight, e) => {
    e?.stopPropagation?.();
    // Record the report, then dismiss it from view. Best-effort — never blocks UI.
    await reportInsight(userId, insight);
    setDismissedInsights(prev => new Set([...prev, insight.id || insight.message]));
    if (expandedInsight === insight.id) {
      setExpandedInsight(null);
    }
    // R4 Task 5: a reported insight is dismissed too — persist it the same
    // way, so it doesn't resurface after reload either.
    recordInsightDismissal(userId, insight);
  };

  const handleToggleExpand = (insightId) => {
    setExpandedInsight(expandedInsight === insightId ? null : insightId);
  };

  const handleShowReceipt = (insight, e) => {
    e?.stopPropagation?.();
    setReceiptInsight(insight);
  };

  return (
    <motion.div
      className="px-4 pb-8 space-y-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      {/* Page Header */}
      <div className="pt-2 flex items-start justify-between">
        <div>
          <h2 className="font-display font-bold text-xl text-foreground">
            Insights
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            AI-powered pattern analysis
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Re-show the "Why am I seeing this?" tip once dismissed */}
          {receiptsTipEligible && !showReceiptsTip && (
            <button
              type="button"
              onClick={() => setShowReceiptsTip(true)}
              className="cloud-icon-button bg-card"
              aria-label="Show tip: why am I seeing this?"
              title="Show tip"
            >
              <HelpCircle size={18} className="text-muted-foreground" />
            </button>
          )}

          {/* Rebuild insights — Fix C (2026-07-24 brief). The ONE
              authoritative refresh/rebuild action on this page: every other
              refresh surface (ClaimFeed, Quick Insights, Insight Control
              Center) routes through the same `handleRebuild` /
              `rebuildInsights` contract. Label is "Rebuild insights"
              deliberately, not "reset" — non-destructive, so it needs no
              destructive-confirm dialog; the supporting copy (brief's exact
              text) lives in `title` as the accessible/native tooltip. */}
          <button
            type="button"
            onClick={handleRebuild}
            disabled={rebuilding}
            aria-label="Rebuild insights"
            title="Reanalyze your current journal data. Your entries, feedback, dismissed insights, exclusions, experiments, and insight history won't be deleted."
            className="cloud-icon-button bg-card disabled:opacity-50 w-auto px-3 flex items-center gap-1.5"
          >
            <RefreshCw
              size={18}
              className={`text-muted-foreground shrink-0 ${rebuilding ? 'animate-spin' : ''}`}
            />
            <span className="text-sm font-medium text-secondary-foreground">
              {rebuilding ? 'Rebuilding…' : 'Rebuild insights'}
            </span>
          </button>
        </div>
      </div>

      {/* Rebuild result (Fix C, 2026-07-24 brief) — one of the brief's four
          result-state copies, rendered from the SAME `describeRebuildResult`
          formatter Insight Control Center uses, so the two surfaces never
          drift. `role="status"` (not `alert`): even the failure copy is
          calm, informational text ("your previous insights are still
          available"), not an urgent interruption. */}
      {rebuildResult && !rebuilding && (() => {
        const { tone, message } = describeRebuildResult(rebuildResult);
        // Cloud palette only (no off-palette amber/warning token exists) —
        // failure and partial-failure both read as `text-destructive`; the
        // message copy itself is what distinguishes "nothing rebuilt" from
        // "one engine didn't finish".
        const toneClass = (tone === 'failure' || tone === 'partial')
          ? 'text-destructive'
          : 'text-accent-deep';
        return (
          <div role="status" className="bg-accent-wash border border-border rounded-2xl px-4 py-3">
            <p className={`text-sm font-medium ${toneClass}`}>{message}</p>
          </div>
        );
      })()}

      {/* First-use tip: "Why am I seeing this?" (see RECEIPTS_TIP_AREA doc
          comment above) — one dismissible pointer, shown once per owner. */}
      {receiptsTipEligible && showReceiptsTip && (
        <div className="bg-accent-wash border border-border rounded-2xl p-3.5 flex items-start gap-3">
          <Info size={18} className="text-accent-deep flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-accent-deep font-medium">See what's behind an insight</p>
            <p className="text-xs text-accent-deep/80 mt-0.5">
              Tap "Why am I seeing this?" on any insight to see the entries, time window, and sample size it's based on.
            </p>
          </div>
          <button
            type="button"
            onClick={dismissReceiptsTip}
            aria-label="Dismiss tip"
            className="relative shrink-0 text-accent-deep before:absolute before:-inset-3.5 before:content-['']"
          >
            {/* 16px icon + before:-inset-3.5 (14px/side) = 44px tap target */}
            <X size={16} />
          </button>
        </div>
      )}

      {/* Mood trend — Week/Month tabs, accent bars, tide+streak (C5b) */}
      <InsightsMoodTrendSection entries={entries} />

      {/* Disclaimer Note */}
      <div className="bg-card border border-border rounded-xl px-4 py-3">
        <p className="text-xs text-muted-foreground leading-relaxed">
          <span className="font-medium">Note:</span> Insights are only as good as your data. The more consistently you journal, the more accurate and personalized these patterns become.
        </p>
      </div>

      {/* Generation Status */}
      <GenerationStatus
        loading={loading}
        refreshing={refreshing}
        isCalibrating={isCalibrating}
        calibrationProgress={calibrationProgress}
        dataStatus={dataStatus}
        lastGenerated={lastGenerated}
        insightCount={filteredInsights.length}
        error={error}
      />

      {/* Correlations Section */}
      {correlations && (correlations.health || correlations.environment) && (
        <CorrelationsSection
          correlations={correlations}
          isExpanded={showCorrelations}
          onToggle={() => setShowCorrelations(!showCorrelations)}
        />
      )}

      {/* Unified ranked feed (R4 Phase 2, Task 6) replaces BOTH the Quick
          Insights block AND the AI Insights (Nexus) block when
          insightClaims is ON — one engine, one feed (plan decision P2-D5).
          Flag OFF renders the exact legacy tree byte-identical — no claims
          data is read (see useClaims.js's own internal flag gate), and the
          legacy Nexus list + empty state below render exactly as before. */}
      {getFlag('insightClaims') ? (
        // Fix C (2026-07-24 brief): ClaimFeed's own refresh button now
        // routes through the SAME `handleRebuild` orchestration as the page
        // header — it reruns the pipeline, not merely `useClaims`' re-read.
        <ClaimFeed
          claims={claims}
          loading={claimsLoading || rebuilding}
          onRefresh={handleRebuild}
          onShowReceipt={handleShowReceipt}
          onFeedback={handleShowReceipt}
          onTryExperiment={handleTryExperiment}
        />
      ) : (
        // Fix C: Quick Insights' own refresh button routes through the same
        // `handleRebuild` orchestration too (was `regenerateBasic`, which
        // only ever rebuilt Basic Insights and never Nexus).
        <QuickInsightsSection
          insights={basicInsights}
          entries={entries}
          loading={basicLoading}
          generating={basicGenerating || rebuilding}
          hasEnoughData={hasEnoughBasicData}
          entriesNeeded={basicEntriesNeeded}
          lastGenerated={basicLastGenerated}
          onRefresh={handleRebuild}
          userId={userId}
          onWhyThis={handleShowReceipt}
        />
      )}

      {/* Today's Recommendations — hidden when insightClaims is ON (P2-D5):
          superseded by the unified feed's experiment_result/pattern claims
          over the same families. */}
      {!getFlag('insightClaims') && recommendations?.recommendations?.length > 0 && (
        <RecommendationsSection recommendations={recommendations} onTryExperiment={handleTryExperiment} />
      )}

      {/* AI Insights (Nexus) list + its empty state — hidden when
          insightClaims is ON (P2-D5): the unified ClaimFeed above is the
          single feed in that mode. useNexusInsights is disabled in that
          case too (see the hook call above), so `filteredInsights` is
          already empty and `loading`/`isCalibrating` are already false —
          this guard just keeps the legacy chrome (headers, empty-state
          copy) from rendering at all. */}
      {!getFlag('insightClaims') && (
        <>
          {/* Insights List */}
          {filteredInsights.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles size={16} className="text-accent-deep" />
                  <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    AI Insights
                  </h3>
                </div>
                <span className="text-xs text-muted-foreground">
                  {filteredInsights.length} insight{filteredInsights.length !== 1 ? 's' : ''}
                </span>
              </div>

              <AnimatePresence mode="popLayout">
                {filteredInsights.map((insight, index) => (
                  <NexusInsightCard
                    key={insight.id || index}
                    insight={insight}
                    isExpanded={expandedInsight === (insight.id || index)}
                    onToggleExpand={() => {
                      const wasExpanded = expandedInsight === (insight.id || index);
                      handleToggleExpand(insight.id || index);
                      // Record 'explored' only on the collapse→expand transition.
                      if (!wasExpanded) {
                        recordInsightEngagement(userId, insight, 'explored');
                      }
                    }}
                    onDismiss={(e) => handleDismissInsight(insight, e)}
                    onReport={(e) => handleReportInsight(insight, e)}
                    onWhyThis={(e) => handleShowReceipt(insight, e)}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}

          {/* Empty state */}
          {!loading && filteredInsights.length === 0 && !isCalibrating && (
            <motion.div
              className="
                p-8 text-center
                bg-card
                border border-border
                rounded-3xl
              "
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <Brain size={40} className="mx-auto text-decorative mb-3" />
              <p className="text-secondary-foreground font-medium">
                No insights yet
              </p>
              <p className="text-muted-foreground text-sm mt-2">
                {entries.length < 5
                  ? `Add ${5 - entries.length} more entries to start generating insights`
                  : 'Tap refresh to generate new insights'
                }
              </p>
            </motion.div>
          )}
        </>
      )}

      {/* F1 (closure-wave final review): must mount whenever EITHER
          insightReceipts OR insightClaims is on — gating solely on
          insightReceipts left ClaimCard's "See days"/"Feedback" actions
          (which only ever setReceiptInsight) as silent no-ops with
          insightClaims ON and insightReceipts OFF, making the whole T9
          claim-feedback taxonomy unreachable. The runbook promises flag
          independence between R4 Phase 1 (insightClaims) and R2
          (insightReceipts). */}
      {(getFlag('insightReceipts') || getFlag('insightClaims')) && (
        <ReceiptSheet
          insight={receiptInsight}
          entriesById={entriesById}
          uid={userId}
          open={Boolean(receiptInsight)}
          onClose={() => setReceiptInsight(null)}
          onFeedback={handleReceiptFeedback}
        />
      )}
    </motion.div>
  );
};

/**
 * InsightsMoodTrendSection - Week/Month mood-trend bars + tide/streak
 * stat cells (task C5b, CLOUD-DESIGN-SPEC.md §7 Insights / mockup "5b").
 *
 * FEATURE ADDITION (user-approved 2026-07-18): the spec's Insights trend
 * composition had no counterpart in the real page before this — C5 only
 * restyled the existing Nexus/correlations/recommendations feature set.
 * Everything here is derived from the `entries` prop InsightsPage
 * already receives (useMemo only) — no new Firestore reads, services,
 * or props.
 *
 * Reuse, not reinvention:
 *  - Mood bucketing + day aggregation: `getMoodTrendDays`/`getMoodMomentum`/
 *    `getEntryFillMetric` (src/utils/moodTrend.js) — the same
 *    accentForMood bucket->token mapping EntryCard.getMoodDotColor and
 *    Home's MoodHeatmapWidget use (C4-aligned), not a third mapping.
 *  - Bar rendering: shared `MoodTrendBars` (cloud kit) — the same
 *    component Home's mood-trend card renders through, not a second
 *    copy of the bar JSX.
 *  - Streak: `calculateStreak()` from services/dashboard — the single
 *    streak source D4b consolidated onto (StreakCelebration/MiniStats
 *    both already read from it too).
 *  - Week/Month segment: cloud `Tabs` primitive — first real (non-test)
 *    consumer, so the shared `TabsTrigger` picked up a 44px-tall hit-box
 *    (`::before`, vertical-only inset — the pill's text+padding already
 *    exceeds 44px wide, so no horizontal inset is needed and adjacent
 *    triggers' hit-boxes can't overlap).
 *  - Tide stat cell: `RisingTide` (cloud kit) — first real consumer of
 *    this component *on this page* (Home's MiniStatsWidget already uses
 *    it). Fed with the entries-per-period "fill" metric (days logged /
 *    days in window) per the task brief — a distinct metric from the
 *    trend card's own mood-momentum caption above it, so the two don't
 *    just repeat each other.
 *
 * Flagged interpretation (mockup only shows the 7-bar Week state): for
 * Month (~30 bars), MoodTrendBars omits per-bar weekday labels (a label
 * under every one of 30 bars would be illegible on a phone width) and
 * tightens the bar gap/radius — see MoodTrendBars' own doc comment.
 */
const InsightsMoodTrendSection = ({ entries }) => {
  const [period, setPeriod] = useState('week');
  const windowDays = period === 'week' ? 7 : 30;

  const { days, todayDateStr, momentumPercent } = useMemo(() => {
    const result = getMoodTrendDays(entries, { windowDays });
    return { ...result, momentumPercent: getMoodMomentum(result.days) };
  }, [entries, windowDays]);

  const fill = useMemo(() => getEntryFillMetric(days), [days]);
  const streak = useMemo(() => calculateStreak(entries), [entries]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <SectionLabel>Trends</SectionLabel>
        <Tabs value={period} onValueChange={setPeriod}>
          <TabsList>
            <TabsTrigger value="week">Week</TabsTrigger>
            <TabsTrigger value="month">Month</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="bg-card border border-border rounded-2xl p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[13px] font-semibold text-foreground">Mood trend</span>
          {momentumPercent !== null && (
            <span className="text-xs text-accent">
              {momentumPercent > 0 ? `+${momentumPercent}% ↗` : momentumPercent < 0 ? `${momentumPercent}%` : 'Steady'}
            </span>
          )}
        </div>
        <MoodTrendBars days={days} todayDateStr={todayDateStr} animate={false} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <RisingTide className="p-3.5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Momentum
          </div>
          <div className="mt-1.5 text-2xl font-semibold tracking-[-0.02em] text-foreground">
            {fill.fillPercent}%
          </div>
          <div className="mt-0.5 text-[11px] text-accent-deep">
            {fill.filledDays}/{fill.totalDays} days logged
          </div>
        </RisingTide>

        <div className="bg-card border border-border rounded-2xl p-3.5 shadow-sm">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Streak
          </div>
          <div className="mt-1.5 text-2xl font-semibold tracking-[-0.02em] text-foreground">
            {streak.currentStreak}
            <span className="text-xs font-normal text-muted-foreground"> days</span>
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            best: {streak.longestStreak}
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * GenerationStatus - Shows insight generation progress
 */
const GenerationStatus = ({
  loading,
  refreshing,
  isCalibrating,
  calibrationProgress,
  dataStatus,
  lastGenerated,
  insightCount,
  error
}) => {
  // Format last generated time
  const formatLastGenerated = () => {
    if (!lastGenerated) return null;
    const date = lastGenerated.toDate ? lastGenerated.toDate() : new Date(lastGenerated);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
  };

  // Loading state
  if (loading && !refreshing) {
    return (
      <motion.div
        className="bg-card border border-border rounded-2xl p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        <div className="flex items-center gap-3">
          <Loader2 size={20} className="text-accent-deep animate-spin" />
          <div>
            <p className="font-medium text-secondary-foreground">Loading insights...</p>
            <p className="text-xs text-muted-foreground">Fetching your personalized analysis</p>
          </div>
        </div>
      </motion.div>
    );
  }

  // Calibrating state
  if (isCalibrating) {
    return (
      <motion.div
        className="bg-card border border-border rounded-2xl p-4"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-center gap-3">
          <div className="p-2 bg-accent-wash rounded-xl animate-pulse">
            <Brain size={20} className="text-accent-deep" />
          </div>
          <div className="flex-1">
            <p className="font-medium text-secondary-foreground">Nexus is learning your patterns</p>
            <div className="mt-2 h-2 bg-divider rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-accent"
                initial={{ width: 0 }}
                animate={{ width: `${calibrationProgress}%` }}
                transition={{ duration: 0.5 }}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {calibrationProgress < 30 && 'Gathering initial data...'}
              {calibrationProgress >= 30 && calibrationProgress < 70 && 'Detecting behavioral patterns...'}
              {calibrationProgress >= 70 && 'Building your psychological profile...'}
            </p>
          </div>
        </div>
      </motion.div>
    );
  }

  // Error state
  if (error) {
    return (
      <motion.div
        className="bg-red-50 dark:bg-red-950/30 border border-red-200/50 dark:border-red-900/50 rounded-2xl p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        <div className="flex items-center gap-3">
          <AlertTriangle size={20} className="text-red-500 dark:text-red-400" />
          <div>
            <p className="font-medium text-red-700 dark:text-red-300">Generation failed</p>
            <p className="text-xs text-red-500 dark:text-red-400">{error}</p>
          </div>
        </div>
      </motion.div>
    );
  }

  // Success/Status state
  return (
    <motion.div
      className="bg-card border border-border rounded-2xl p-3"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <CheckCircle2 size={14} className="text-accent-deep" />
            <span>{insightCount} insights</span>
          </div>
          {dataStatus?.entries && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <FileText size={14} />
              <span>{dataStatus.entries} entries analyzed</span>
            </div>
          )}
          {dataStatus?.whoopConnected && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Activity size={14} className="text-accent-deep" />
              <span>Whoop linked</span>
            </div>
          )}
        </div>
        {formatLastGenerated() && (
          <span className="text-muted-foreground">
            Updated {formatLastGenerated()}
          </span>
        )}
      </div>
      {refreshing && (
        <div className="mt-2 flex items-center gap-2 text-xs text-accent-deep">
          <Loader2 size={12} className="animate-spin" />
          <span>Refreshing insights...</span>
        </div>
      )}
    </motion.div>
  );
};

/**
 * CorrelationsSection - Shows health and environment correlations with mood
 */
const CorrelationsSection = ({ correlations, isExpanded, onToggle }) => {
  const [expandedMethodology, setExpandedMethodology] = useState(null);
  const hasHealth = correlations.health?.topInsights?.length > 0;
  const hasEnv = correlations.environment?.topInsights?.length > 0;

  // Get icon for correlation type
  const getCorrelationIcon = (type) => {
    switch (type) {
      case 'sleep': return Moon;
      case 'hrv': return Heart;
      case 'recovery': return Zap;
      case 'strain': return Activity;
      case 'exercise': return Activity;
      case 'steps': return Footprints;
      case 'sunshine': return Sun;
      case 'temperature': return Thermometer;
      case 'weather': return CloudRain;
      case 'daylight': return Sun;
      default: return Activity;
    }
  };

  // Format correlation strength as percentage
  const formatCorrelation = (value) => {
    if (!value && value !== 0) return null;
    const pct = Math.round(Math.abs(value) * 100);
    return `${pct}%`;
  };

  // Generate methodology explanation based on insight type
  const getMethodologyExplanation = (insight) => {
    const type = insight.type;
    const n = insight.sampleSize || 'N/A';

    switch (type) {
      case 'sleep_mood':
        return {
          method: 'Threshold comparison',
          description: `Compared mood on days with 7+ hours of sleep vs days with less than 6 hours.`,
          details: [
            `Sample size: ${n} entries with sleep data`,
            insight.goodSleepAvgMood != null ? `7+ hours sleep: ${Math.round(insight.goodSleepAvgMood * 100)}% avg mood` : null,
            insight.poorSleepAvgMood != null ? `<6 hours sleep: ${Math.round(insight.poorSleepAvgMood * 100)}% avg mood` : null,
            insight.correlation != null ? `Pearson correlation: ${(insight.correlation * 100).toFixed(0)}%` : null
          ].filter(Boolean)
        };
      case 'hrv_mood':
        return {
          method: 'Median split comparison',
          description: `Split entries at your median HRV (${insight.medianHRV?.toFixed(0) || '?'}ms) and compared mood above vs below.`,
          details: [
            `Sample size: ${n} entries with HRV data`,
            insight.highHRVAvgMood != null ? `Above median: ${Math.round(insight.highHRVAvgMood * 100)}% avg mood` : null,
            insight.lowHRVAvgMood != null ? `Below median: ${Math.round(insight.lowHRVAvgMood * 100)}% avg mood` : null,
            insight.correlation != null ? `Pearson correlation: ${(insight.correlation * 100).toFixed(0)}%` : null
          ].filter(Boolean)
        };
      case 'rhr_mood':
        return {
          method: 'Median split comparison',
          description: `Split entries at your median resting heart rate (${insight.medianRHR?.toFixed(0) || '?'}bpm) and compared mood.`,
          details: [
            `Sample size: ${n} entries with RHR data`,
            insight.lowRHRMood != null ? `Lower RHR (≤${insight.medianRHR?.toFixed(0)}): ${Math.round(insight.lowRHRMood * 100)}% avg mood` : null,
            insight.highRHRMood != null ? `Higher RHR: ${Math.round(insight.highRHRMood * 100)}% avg mood` : null
          ].filter(Boolean)
        };
      case 'exercise_mood':
        return {
          method: 'Binary comparison',
          description: 'Compared mood on days with recorded workouts vs rest days.',
          details: [
            `Sample size: ${n} entries with workout data`,
            insight.workoutDays != null ? `Workout days: ${insight.workoutDays} (${Math.round((insight.workoutDayMood || 0) * 100)}% avg mood)` : null,
            insight.restDays != null ? `Rest days: ${insight.restDays} (${Math.round((insight.restDayMood || 0) * 100)}% avg mood)` : null
          ].filter(Boolean)
        };
      case 'steps_mood':
        return {
          method: 'Threshold comparison',
          description: 'Compared mood on active days (8k+ steps) vs sedentary days (<4k steps).',
          details: [
            `Sample size: ${n} entries with step data`,
            `Your median steps: ${insight.medianSteps?.toLocaleString() || '?'}`,
            insight.activeDayMood != null ? `8k+ steps: ${Math.round(insight.activeDayMood * 100)}% avg mood` : null,
            insight.sedentaryDayMood != null ? `<4k steps: ${Math.round(insight.sedentaryDayMood * 100)}% avg mood` : null
          ].filter(Boolean)
        };
      case 'recovery_mood':
        return {
          method: 'Zone comparison (Whoop)',
          description: 'Compared mood across Whoop recovery zones (green ≥67%, yellow 34-66%, red <34%).',
          details: [
            `Sample size: ${n} entries with recovery data`,
            insight.greenZoneMood != null ? `Green zone: ${Math.round(insight.greenZoneMood * 100)}% avg mood` : null,
            insight.yellowZoneMood != null ? `Yellow zone: ${Math.round(insight.yellowZoneMood * 100)}% avg mood` : null,
            insight.redZoneMood != null ? `Red zone: ${Math.round(insight.redZoneMood * 100)}% avg mood` : null
          ].filter(Boolean)
        };
      default:
        return {
          method: 'Statistical analysis',
          description: 'Correlation computed from your journal entries with health data.',
          details: [`Sample size: ${n} entries`]
        };
    }
  };

  // Generate methodology explanation for environment insights
  const getEnvironmentMethodologyExplanation = (insight) => {
    const type = insight.type;
    const n = insight.sampleSize || 'N/A';

    switch (type) {
      case 'sunshine_mood':
        return {
          method: 'Threshold comparison',
          description: 'Compared mood on sunny days (60%+ sunshine) vs overcast days (<30% sunshine).',
          details: [
            `Sample size: ${n} entries with sunshine data`,
            insight.highSunshineMood != null ? `Sunny (60%+): ${Math.round(insight.highSunshineMood * 100)}% avg mood` : null,
            insight.lowSunshineMood != null ? `Overcast (<30%): ${Math.round(insight.lowSunshineMood * 100)}% avg mood` : null,
            insight.correlation != null ? `Pearson correlation: ${(insight.correlation * 100).toFixed(0)}%` : null
          ].filter(Boolean)
        };
      case 'weather_mood':
        return {
          method: 'Category comparison',
          description: 'Grouped entries by weather condition (sunny, cloudy, rainy) and compared average mood.',
          details: [
            `Sample size: ${n} entries with weather data`,
            insight.breakdown?.sunny ? `Sunny: ${insight.breakdown.sunny.count} entries, ${Math.round(insight.breakdown.sunny.avgMood * 100)}% avg mood` : null,
            insight.breakdown?.cloudy ? `Cloudy: ${insight.breakdown.cloudy.count} entries, ${Math.round(insight.breakdown.cloudy.avgMood * 100)}% avg mood` : null,
            insight.breakdown?.rainy ? `Rainy: ${insight.breakdown.rainy.count} entries, ${Math.round(insight.breakdown.rainy.avgMood * 100)}% avg mood` : null
          ].filter(Boolean)
        };
      case 'daylight_mood':
        return {
          method: 'Seasonal daylight comparison',
          description: 'Compared mood during longer daylight periods (12h+) vs shorter days (<10h).',
          details: [
            `Sample size: ${n} entries with daylight data`,
            insight.longDayMood != null ? `Long days (12h+): ${Math.round(insight.longDayMood * 100)}% avg mood` : null,
            insight.shortDayMood != null ? `Short days (<10h): ${Math.round(insight.shortDayMood * 100)}% avg mood` : null,
            insight.correlation != null ? `Pearson correlation: ${(insight.correlation * 100).toFixed(0)}%` : null
          ].filter(Boolean)
        };
      case 'light_context_mood':
        return {
          method: 'Time-of-day comparison',
          description: 'Compared mood of entries made during daylight vs after dark.',
          details: [
            `Sample size: ${n} entries with light context`,
            insight.daylightMood != null ? `Daylight entries: ${Math.round(insight.daylightMood * 100)}% avg mood` : null,
            insight.darkMood != null ? `After-dark entries: ${Math.round(insight.darkMood * 100)}% avg mood` : null,
            insight.peakTime ? `Your peak time: ${insight.peakTime}` : null
          ].filter(Boolean)
        };
      case 'temperature_mood':
        return {
          method: 'Temperature range comparison',
          description: 'Compared mood across different temperature ranges.',
          details: [
            `Sample size: ${n} entries with temperature data`,
            insight.warmMood != null ? `Warm days: ${Math.round(insight.warmMood * 100)}% avg mood` : null,
            insight.coldMood != null ? `Cold days: ${Math.round(insight.coldMood * 100)}% avg mood` : null
          ].filter(Boolean)
        };
      default:
        return {
          method: 'Statistical analysis',
          description: 'Correlation computed from your journal entries with environment data.',
          details: [`Sample size: ${n} entries`]
        };
    }
  };

  return (
    <motion.div
      className="bg-card border border-border rounded-2xl overflow-hidden"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {/* Header */}
      <div
        className="p-4 flex items-center justify-between cursor-pointer hover:bg-divider transition-colors"
        onClick={onToggle}
      >
        <div className="flex items-center gap-3">
          <div className="p-2 bg-accent-wash rounded-xl">
            <TrendingUp size={18} className="text-accent-deep" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Your Patterns</h3>
            <p className="text-xs text-muted-foreground">
              How health &amp; environment affect your mood
            </p>
          </div>
        </div>
        {isExpanded ? (
          <ChevronUp size={18} className="text-muted-foreground" />
        ) : (
          <ChevronDown size={18} className="text-muted-foreground" />
        )}
      </div>

      {/* Expanded Content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-4">
              {/* Health Correlations */}
              {hasHealth && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Heart size={14} className="text-red-500" />
                    <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                      Health &amp; Mood
                    </span>
                  </div>
                  <div className="space-y-2">
                    {correlations.health.topInsights.map((insight, i) => {
                      const Icon = getCorrelationIcon(insight.metric);
                      const strengthColor =
                        insight.strength === 'strong' ? 'text-accent-deep bg-accent-wash' :
                        insight.strength === 'moderate' ? 'text-secondary-foreground bg-divider' :
                        'text-muted-foreground bg-divider';
                      const insightKey = `health-${i}`;
                      const isMethodExpanded = expandedMethodology === insightKey;
                      const methodology = getMethodologyExplanation(insight);

                      return (
                        <motion.div
                          key={i}
                          className="bg-background rounded-xl overflow-hidden"
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.1 }}
                        >
                          <div className="p-3 flex items-start gap-3">
                            <div className={`p-1.5 rounded-lg ${strengthColor.split(' ')[1]}`}>
                              <Icon size={14} className={strengthColor.split(' ')[0]} />
                            </div>
                            <div className="flex-1">
                              <p className="text-sm text-secondary-foreground">{insight.insight}</p>
                              <div className="flex items-center gap-2 mt-1 flex-wrap">
                                <span className={`text-xs px-2 py-0.5 rounded-full ${strengthColor}`}>
                                  {insight.strength}
                                </span>
                                {insight.correlation && (
                                  <span className="text-xs text-muted-foreground">
                                    {formatCorrelation(insight.correlation)} correlation
                                  </span>
                                )}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setExpandedMethodology(isMethodExpanded ? null : insightKey);
                                  }}
                                  className="relative text-xs text-accent-deep flex items-center gap-1 before:absolute before:-inset-3.5 before:content-['']"
                                >
                                  How?
                                  {isMethodExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                                </button>
                              </div>
                            </div>
                          </div>

                          {/* Methodology Explanation */}
                          <AnimatePresence>
                            {isMethodExpanded && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.15 }}
                                className="border-t border-border bg-accent-wash"
                              >
                                <div className="p-3 space-y-2">
                                  <div className="flex items-center gap-2">
                                    <Brain size={12} className="text-accent-deep" />
                                    <span className="text-xs font-semibold text-accent-deep">
                                      {methodology.method}
                                    </span>
                                  </div>
                                  <p className="text-xs text-secondary-foreground">
                                    {methodology.description}
                                  </p>
                                  <ul className="text-xs text-muted-foreground space-y-1">
                                    {methodology.details.map((detail, j) => (
                                      <li key={j} className="flex items-center gap-1.5">
                                        <span className="w-1 h-1 bg-accent rounded-full" />
                                        {detail}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </motion.div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Environment Correlations */}
              {hasEnv && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Sun size={14} className="text-accent-deep" />
                    <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                      Environment &amp; Mood
                    </span>
                  </div>
                  <div className="space-y-2">
                    {correlations.environment.topInsights.map((insight, i) => {
                      const Icon = getCorrelationIcon(insight.metric);
                      const strengthColor =
                        insight.strength === 'strong' ? 'text-accent-deep bg-accent-wash' :
                        insight.strength === 'moderate' ? 'text-secondary-foreground bg-divider' :
                        'text-muted-foreground bg-divider';
                      const envInsightKey = `env-${i}`;
                      const isEnvMethodExpanded = expandedMethodology === envInsightKey;
                      const envMethodology = getEnvironmentMethodologyExplanation(insight);

                      return (
                        <motion.div
                          key={i}
                          className="bg-background rounded-xl overflow-hidden"
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.1 }}
                        >
                          <div className="p-3 flex items-start gap-3">
                            <div className={`p-1.5 rounded-lg ${strengthColor.split(' ')[1]}`}>
                              <Icon size={14} className={strengthColor.split(' ')[0]} />
                            </div>
                            <div className="flex-1">
                              <p className="text-sm text-secondary-foreground">{insight.insight}</p>
                              <div className="flex items-center gap-2 mt-1 flex-wrap">
                                <span className={`text-xs px-2 py-0.5 rounded-full ${strengthColor}`}>
                                  {insight.strength}
                                </span>
                                {insight.correlation && (
                                  <span className="text-xs text-muted-foreground">
                                    {formatCorrelation(insight.correlation)} correlation
                                  </span>
                                )}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setExpandedMethodology(isEnvMethodExpanded ? null : envInsightKey);
                                  }}
                                  className="relative text-xs text-accent-deep flex items-center gap-1 before:absolute before:-inset-3.5 before:content-['']"
                                >
                                  How?
                                  {isEnvMethodExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                                </button>
                              </div>
                            </div>
                          </div>

                          {/* Environment Methodology Explanation */}
                          <AnimatePresence>
                            {isEnvMethodExpanded && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.15 }}
                                className="border-t border-border bg-accent-wash"
                              >
                                <div className="p-3 space-y-2">
                                  <div className="flex items-center gap-2">
                                    <Brain size={12} className="text-accent-deep" />
                                    <span className="text-xs font-semibold text-accent-deep">
                                      {envMethodology.method}
                                    </span>
                                  </div>
                                  <p className="text-xs text-secondary-foreground">
                                    {envMethodology.description}
                                  </p>
                                  <ul className="text-xs text-muted-foreground space-y-1">
                                    {envMethodology.details.map((detail, j) => (
                                      <li key={j} className="flex items-center gap-1.5">
                                        <span className="w-1 h-1 bg-accent rounded-full" />
                                        {detail}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </motion.div>
                      );
                    })}
                  </div>

                  {/* SAD Warning */}
                  {correlations.environment.lowSunshineWarning && (
                    <motion.div
                      className="bg-accent-wash border border-border rounded-xl p-3"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                    >
                      <div className="flex items-start gap-2">
                        <AlertTriangle size={16} className="text-accent-deep flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-sm text-accent-deep font-medium">
                            {correlations.environment.lowSunshineWarning.insight}
                          </p>
                          {correlations.environment.lowSunshineWarning.recommendation && (
                            <p className="text-xs text-accent-deep mt-1">
                              {correlations.environment.lowSunshineWarning.recommendation}
                            </p>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </div>
              )}

              {/* No data messages */}
              {!hasHealth && correlations.healthMessage && (
                <div className="text-xs text-muted-foreground italic">
                  {correlations.healthMessage}
                </div>
              )}
              {!hasEnv && correlations.envMessage && (
                <div className="text-xs text-muted-foreground italic">
                  {correlations.envMessage}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

// Idea type -> v1 experiment template id (Shared contracts, R4 Phase 3 Task
// 2 plan). Only these three idea types have a v1 template; self_care/other
// (and anything unrecognized) map to no button rather than a guess — same
// "never guess, hide instead" convention ClaimCard's own
// `experimentTemplateFor` uses for claim exposures.
const IDEA_TEMPLATE_BY_TYPE = Object.freeze({
  recovery: 'recovery-score-mood',
  activity: 'exercise-minutes-mood',
  environment: 'sunshine-percent-mood',
});

/**
 * RecommendationsSection - Shows today's personalized recommendations
 */
const RecommendationsSection = ({ recommendations, onTryExperiment }) => {
  const getPriorityStyle = (priority) => {
    switch (priority) {
      case 'high':
        return {
          bg: 'bg-red-50 dark:bg-red-950/30', /* @color-safe: urgent priority */
          border: 'border-red-200/50 dark:border-red-900/50',
          icon: 'text-red-500 dark:text-red-400',
          text: 'text-red-800 dark:text-red-300'
        };
      case 'medium':
        return {
          bg: 'bg-accent-wash',
          border: 'border-border',
          icon: 'text-accent-deep',
          text: 'text-accent-deep'
        };
      default:
        return {
          bg: 'bg-card',
          border: 'border-border',
          icon: 'text-muted-foreground',
          text: 'text-secondary-foreground'
        };
    }
  };

  const getTypeIcon = (type) => {
    switch (type) {
      case 'recovery': return Moon;
      case 'activity': return Activity;
      case 'environment': return Sun;
      case 'self_care': return Heart;
      default: return Lightbulb;
    }
  };

  return (
    <motion.div
      className="bg-card border border-border rounded-2xl p-4"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="flex items-center gap-2 mb-3">
        <Lightbulb size={16} className="text-accent-deep" />
        <h3 className="font-semibold text-foreground">Today's Recommendations</h3>
      </div>

      <div className="space-y-2">
        {recommendations.recommendations.map((rec, i) => {
          const style = getPriorityStyle(rec.priority);
          const Icon = getTypeIcon(rec.type);
          const experimentTemplateId = IDEA_TEMPLATE_BY_TYPE[rec.type];

          return (
            <motion.div
              key={i}
              className={`${style.bg} ${style.border} border rounded-xl p-3`}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.1 }}
            >
              <div className="flex items-start gap-3">
                <Icon size={16} className={`${style.icon} flex-shrink-0 mt-0.5`} />
                <div className="flex-1">
                  <p className={`text-sm font-medium ${style.text}`}>
                    {rec.action}
                  </p>
                  {rec.reasoning && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {rec.reasoning}
                    </p>
                  )}
                  {/* "Try as an experiment" (R4 Phase 3 Task 2) — only for a
                      mapped idea type, only when personalExperiments is on,
                      and only when the parent actually wired a handler.
                      Mirrors ClaimCard's own "mapped && handler present"
                      gate (F4) so this can never be a guaranteed no-op
                      button either. */}
                  {experimentTemplateId && getFlag('personalExperiments') && typeof onTryExperiment === 'function' && (
                    <button
                      type="button"
                      onClick={() => onTryExperiment(experimentTemplateId)}
                      className="relative mt-1.5 inline-flex min-h-[28px] items-center text-xs font-medium text-accent-deep before:absolute before:-inset-2 before:content-['']"
                    >
                      Try as an experiment
                    </button>
                  )}
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${style.bg} ${style.text} font-medium`}>
                  {rec.priority}
                </span>
              </div>
            </motion.div>
          );
        })}
      </div>

      {recommendations.basedOn && (
        <p className="text-xs text-muted-foreground mt-3">
          Based on {recommendations.basedOn.entriesAnalyzed} entries
          {recommendations.basedOn.interventionsTracked > 0 && (
            <> &amp; {recommendations.basedOn.interventionsTracked} tracked activities</>
          )}
        </p>
      )}
    </motion.div>
  );
};

/**
 * QuickInsightsSection - Shows basic statistical insights
 */
const QuickInsightsSection = ({
  insights,
  entries,
  loading,
  generating,
  hasEnoughData,
  entriesNeeded,
  lastGenerated,
  onRefresh,
  userId,
  onWhyThis
}) => {
  const [expandedInsight, setExpandedInsight] = useState(null);
  const [showAllEntries, setShowAllEntries] = useState(new Set());
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(new Set());

  // Helper to get entries by IDs
  const getEntriesByIds = (entryIds, showAll = false) => {
    if (!entries || !entryIds || entryIds.length === 0) return [];
    const matched = entries.filter(e => entryIds.includes(e.id || e.entryId));
    return showAll ? matched : matched.slice(0, 5);
  };

  // Get full entries with all data for export
  const getFullEntriesForExport = (entryIds) => {
    if (!entries || !entryIds || entryIds.length === 0) return [];
    return entries.filter(e => entryIds.includes(e.id || e.entryId));
  };

  // Export insight data for debugging
  const handleExportInsight = useCallback((insight) => {
    const citedEntries = getFullEntriesForExport(insight.entryIds);

    const exportData = {
      exportedAt: new Date().toISOString(),
      insight: {
        id: insight.id,
        category: insight.category,
        insightText: insight.insight,
        moodDelta: insight.moodDelta,
        direction: insight.direction,
        strength: insight.strength,
        sampleSize: insight.sampleSize,
        recommendation: insight.recommendation,
        // Include any activity/theme/pattern specific fields
        activityKey: insight.activityKey,
        activityLabel: insight.activityLabel,
        peopleKey: insight.peopleKey,
        themeKey: insight.themeKey,
        emotionKey: insight.emotionKey,
        cognitivePattern: insight.cognitivePattern,
        entryType: insight.entryType
      },
      citedEntries: citedEntries.map(entry => ({
        id: entry.id || entry.entryId,
        createdAt: entry.createdAt?.toDate ? entry.createdAt.toDate().toISOString() : entry.createdAt,
        content: entry.content || entry.text,
        moodScore: entry.analysis?.mood_score,
        tags: entry.analysis?.tags,
        themes: entry.analysis?.themes,
        emotions: entry.analysis?.emotions,
        entry_type: entry.analysis?.entry_type,
        category: entry.category || entry.classification?.primary_category,
        healthContext: entry.healthContext ? {
          activity: entry.healthContext.activity,
          hadWorkout: entry.healthContext.hadWorkout,
          strain: entry.healthContext.strain,
          sleep: entry.healthContext.sleep,
          recovery: entry.healthContext.recovery
        } : null,
        environmentContext: entry.environmentContext
      }))
    };

    // Create and download the JSON file
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `insight-debug-${insight.id || 'unknown'}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [entries]);

  // Submit feedback for an insight and update learning
  const handleFeedback = useCallback(async (insight, isPositive) => {
    if (!userId) return;

    try {
      // Get the cited entries for learning analysis
      const citedEntries = getFullEntriesForExport(insight.entryIds);

      // Record feedback and update learning model
      const feedbackData = {
        insightId: insight.id,
        category: insight.category,
        insightText: insight.insight,
        moodDelta: insight.moodDelta,
        activityKey: insight.activityKey || null,
        themeKey: insight.themeKey || null,
        peopleKey: insight.peopleKey || null,
        sampleSize: insight.sampleSize,
        entryIds: insight.entryIds || [],
        feedback: isPositive ? 'accurate' : 'inaccurate'
      };

      // `entries` here is the full corpus prop (R4 Task 5) — valid
      // `currentEntryCount` for the resurfacing-bug fix.
      const learningResult = await recordFeedbackAndLearn(userId, feedbackData, citedEntries, entries?.length ?? null);

      setFeedbackSubmitted(prev => new Set([...prev, insight.id]));

      // Log learning outcome
      if (learningResult) {
        console.log('[QuickInsights] Feedback recorded with learning:', {
          feedback: isPositive ? 'accurate' : 'inaccurate',
          accuracyRate: `${(learningResult.accuracyRate * 100).toFixed(0)}%`,
          confidenceMultiplier: learningResult.confidenceMultiplier.toFixed(2),
          suppressed: learningResult.suppressed
        });
      }
    } catch (error) {
      console.error('[QuickInsights] Failed to submit feedback:', error);
    }
  }, [userId, entries]);

  // Toggle showing all entries for an insight
  const toggleShowAll = (insightId) => {
    setShowAllEntries(prev => {
      const next = new Set(prev);
      if (next.has(insightId)) {
        next.delete(insightId);
      } else {
        next.add(insightId);
      }
      return next;
    });
  };

  // Don't render if still loading
  if (loading) {
    return null;
  }

  // If we haven't determined data sufficiency yet, show loading
  // (this happens when dataSufficiency is null, causing hasEnoughData=false and entriesNeeded=0)
  if (!hasEnoughData && entriesNeeded === 0 && (!insights || insights.length === 0)) {
    return (
      <motion.div
        className="bg-card border border-border rounded-2xl p-4"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-center gap-3">
          <div className="p-2 bg-divider rounded-xl">
            <Loader2 size={18} className="text-muted-foreground animate-spin" />
          </div>
          <div>
            <h3 className="font-medium text-secondary-foreground">Quick Insights</h3>
            <p className="text-xs text-muted-foreground">
              Checking your data...
            </p>
          </div>
        </div>
      </motion.div>
    );
  }

  // Insufficient data message
  if (!hasEnoughData && entriesNeeded > 0) {
    return (
      <motion.div
        className="bg-card border border-border rounded-2xl p-4"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-center gap-3">
          <div className="p-2 bg-divider rounded-xl">
            <Zap size={18} className="text-muted-foreground" />
          </div>
          <div>
            <h3 className="font-medium text-secondary-foreground">Quick Insights</h3>
            <p className="text-xs text-muted-foreground">
              Add {entriesNeeded} more entries to unlock pattern insights
            </p>
          </div>
        </div>
      </motion.div>
    );
  }

  // No insights generated yet - show generating state if we have enough data
  if (!insights || insights.length === 0) {
    // If generating, show loading state
    if (generating) {
      return (
        <motion.div
          className="bg-card border border-border rounded-2xl p-4"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="flex items-center gap-3">
            <div className="p-2 bg-accent-wash rounded-xl">
              <Loader2 size={18} className="text-accent-deep animate-spin" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground">Quick Insights</h3>
              <p className="text-xs text-muted-foreground">
                Analyzing your patterns...
              </p>
            </div>
          </div>
        </motion.div>
      );
    }
    // If has enough data but no insights, show prompt to generate
    if (hasEnoughData) {
      return (
        <motion.div
          className="bg-card border border-border rounded-2xl p-4"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-accent-wash rounded-xl">
                <Zap size={18} className="text-accent-deep" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">Quick Insights</h3>
                <p className="text-xs text-muted-foreground">
                  Tap refresh to generate pattern insights
                </p>
              </div>
            </div>
            {onRefresh && (
              <button
                onClick={onRefresh}
                className="min-h-11 px-4 flex items-center justify-center bg-accent-deep text-background text-sm font-medium rounded-lg hover:opacity-90 transition-colors"
              >
                Generate
              </button>
            )}
          </div>
        </motion.div>
      );
    }
    return null;
  }

  // Get category icon and colors
  const getCategoryStyle = (category) => {
    switch (category) {
      case 'activity':
        return { icon: Activity, color: 'text-accent-deep', bg: 'bg-accent-wash' };
      case 'people':
        return { icon: Heart, color: 'text-accent-deep', bg: 'bg-accent-wash' };
      case 'health':
        return { icon: Heart, color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-950/30' }; /* @color-safe: health warning */
      case 'environment':
        return { icon: Sun, color: 'text-accent-deep', bg: 'bg-accent-wash' };
      case 'time':
        return { icon: Moon, color: 'text-accent-deep', bg: 'bg-accent-wash' };
      default:
        return { icon: Zap, color: 'text-accent-deep', bg: 'bg-accent-wash' };
    }
  };

  return (
    <motion.div
      className="bg-card border border-border rounded-2xl overflow-hidden"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {/* Header */}
      <div className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-accent-wash rounded-xl">
            <Zap size={18} className="text-accent-deep" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Quick Insights</h3>
            <p className="text-xs text-muted-foreground">
              Based on your patterns
              {lastGenerated && ` • ${lastGenerated}`}
            </p>
          </div>
        </div>
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={generating}
            className="cloud-icon-button disabled:opacity-50"
          >
            <RefreshCw
              size={14}
              className={`text-muted-foreground ${generating ? 'animate-spin' : ''}`}
            />
          </button>
        )}
      </div>

      {/* Insights Grid */}
      <div className="px-4 pb-4 grid gap-2">
        {insights.map((insight, index) => {
          const style = getCategoryStyle(insight.category);
          const Icon = style.icon;
          const isPositive = insight.direction === 'positive';
          const insightKey = insight.id || index;
          const isExpanded = expandedInsight === insightKey;
          const hasEntryIds = insight.entryIds && insight.entryIds.length > 0;
          const isShowingAll = showAllEntries.has(insightKey);
          const citedEntries = isExpanded ? getEntriesByIds(insight.entryIds, isShowingAll) : [];
          const hiddenCount = hasEntryIds ? insight.entryIds.length - 5 : 0;

          return (
            <motion.div
              key={insight.id || index}
              className="bg-background rounded-xl overflow-hidden"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05 }}
            >
              <div className="p-3 flex items-start gap-3">
                <div className="flex flex-col items-center gap-1">
                  <div className={`p-1.5 rounded-lg ${style.bg}`}>
                    <Icon size={14} className={style.color} />
                  </div>
                  {/* R2 Task 11: "Why am I seeing this?" — every basic
                      insight carries a `.receipt` (verified in
                      basicInsightsOrchestrator.receipts.test.js), so the
                      trigger lives in the card header/icon region here
                      rather than the hand-tuned feedback/export row below
                      (its geometry is load-bearing and stays untouched).
                      20px visual box + before:-inset-3 (12px/side) = 44px,
                      same painted+inset formula as Chip.jsx. */}
                  {onWhyThis && getFlag('insightReceipts') && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onWhyThis(insight, e); }}
                      aria-label="Why am I seeing this?"
                      title="Why am I seeing this?"
                      className="relative flex min-h-[20px] min-w-[20px] items-center justify-center rounded-full text-muted-foreground hover:text-secondary-foreground transition-colors before:absolute before:-inset-3 before:content-['']"
                    >
                      <Info size={12} aria-hidden="true" />
                    </button>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-secondary-foreground leading-relaxed">
                    {insight.insight}
                  </p>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      insight.strength === 'strong'
                        ? 'bg-accent-wash text-accent-deep'
                        : 'bg-divider text-secondary-foreground'
                    }`}>
                      {insight.strength}
                    </span>
                    <span className={`text-xs ${isPositive ? 'text-accent-deep' : 'text-muted-foreground'}`}>
                      {isPositive ? '+' : ''}{insight.moodDelta}% mood
                    </span>
                    {insight.sampleSize && hasEntryIds && (
                      <button
                        onClick={() => setExpandedInsight(isExpanded ? null : insightKey)}
                        className="relative text-xs text-muted-foreground hover:text-secondary-foreground flex items-center gap-1 transition-colors before:absolute before:-inset-3.5 before:content-['']"
                      >
                        {insight.sampleSize} entries
                        {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      </button>
                    )}
                    {insight.sampleSize && !hasEntryIds && (
                      <span className="text-xs text-muted-foreground">
                        {insight.sampleSize} entries
                      </span>
                    )}
                  </div>
                  {insight.recommendation && (
                    <p className="text-xs text-muted-foreground mt-1.5 italic">
                      {insight.recommendation}
                    </p>
                  )}
                </div>
              </div>

              {/* Expanded entries section */}
              <AnimatePresence>
                {isExpanded && citedEntries.length > 0 && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="border-t border-border bg-card"
                  >
                    <div className="p-3 space-y-2">
                      {/* Feedback & Export Row */}
                      {/*
                        Hit-area geometry (44px min-target, non-overlapping):
                        thumbs buttons are p-1.5 (6px) around a 14px icon =
                        26px visual box; before:-inset-2.5 (10px/side) inflates
                        each to 46px (>=44 [OK]). Two 46px hitboxes centered on
                        boxes `gap` apart overlap by (2*10 - gap). At gap-1
                        (4px) that's a 16px overlap (the bug). gap-6 (24px)
                        between the two thumbs buttons yields 20-24 = -4px,
                        i.e. a 4px *gap* between hitboxes, not an overlap.
                        The outer row's justify-between gap between the
                        thumbs group and Export (also a 44px-ish overlay
                        target) is content-driven and normally much larger
                        than 24px, but a `gap-6` floor is added here too so a
                        narrow card can never shrink it below the same
                        20px-required / 24px-actual safe margin.
                      */}
                      <div className="flex items-center justify-between gap-6 pb-2 border-b border-border">
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-muted-foreground mr-2">Is this accurate?</span>
                          {feedbackSubmitted.has(insight.id) ? (
                            <span className="text-xs text-accent-deep flex items-center gap-1">
                              <CheckCircle2 size={12} /> Thanks!
                            </span>
                          ) : (
                            <div className="flex items-center gap-6">
                              <button
                                onClick={(e) => { e.stopPropagation(); handleFeedback(insight, true); }}
                                className="relative p-1.5 hover:bg-divider rounded-lg transition-colors before:absolute before:-inset-2.5 before:content-['']"
                                title="Yes, accurate"
                              >
                                <ThumbsUp size={14} className="text-accent-deep" />
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleFeedback(insight, false); }}
                                className="relative p-1.5 hover:bg-red-100 dark:hover:bg-red-950/30 rounded-lg transition-colors before:absolute before:-inset-2.5 before:content-['']"
                                title="No, inaccurate"
                              >
                                <ThumbsDown size={14} className="text-red-500 dark:text-red-400" /> {/* @color-safe: negative feedback */}
                              </button>
                            </div>
                          )}
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleExportInsight(insight); }}
                          className="relative flex items-center gap-1 text-xs text-muted-foreground hover:text-secondary-foreground px-2 py-1 hover:bg-divider rounded-lg transition-colors before:absolute before:-inset-2.5 before:content-['']"
                          title="Export for debugging"
                        >
                          <Download size={12} />
                          Export
                        </button>
                      </div>

                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Related Entries
                      </p>
                      {citedEntries.map((entry, i) => (
                        <button
                          key={entry.id || i}
                          onClick={() => setSelectedEntry(entry)}
                          className="w-full text-left bg-background hover:bg-divider rounded-lg p-2 text-xs transition-colors cursor-pointer"
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-muted-foreground">
                              {entry.createdAt?.toDate
                                ? entry.createdAt.toDate().toLocaleDateString()
                                : new Date(entry.createdAt).toLocaleDateString()}
                            </span>
                            <div className="flex items-center gap-2">
                              {typeof entry.analysis?.mood_score === 'number' && (
                                <span className={`font-medium ${
                                  entry.analysis.mood_score >= 0.6 ? 'text-accent-deep' :
                                  entry.analysis.mood_score >= 0.4 ? 'text-secondary-foreground' :
                                  'text-red-600 dark:text-red-400' /* @color-safe: low mood */
                                }`}>
                                  {Math.round(entry.analysis.mood_score * 100)}%
                                </span>
                              )}
                              <ChevronDown size={12} className="text-muted-foreground -rotate-90" />
                            </div>
                          </div>
                          <p className="text-secondary-foreground line-clamp-2">
                            {(entry.content || entry.text || '').slice(0, 150)}
                            {(entry.content || entry.text || '').length > 150 ? '...' : ''}
                          </p>
                        </button>
                      ))}
                      {hiddenCount > 0 && !isShowingAll && (
                        <button
                          onClick={() => toggleShowAll(insightKey)}
                          className="min-h-11 w-full text-xs text-accent-deep text-center hover:bg-divider rounded-lg transition-colors"
                        >
                          +{hiddenCount} more entries — tap to show all
                        </button>
                      )}
                      {isShowingAll && hiddenCount > 0 && (
                        <button
                          onClick={() => toggleShowAll(insightKey)}
                          className="min-h-11 w-full text-xs text-muted-foreground hover:text-secondary-foreground text-center hover:bg-divider rounded-lg transition-colors"
                        >
                          Show fewer entries
                        </button>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>

      {/* Entry Detail Modal */}
      <AnimatePresence>
        {selectedEntry && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
            onClick={() => setSelectedEntry(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="bg-card rounded-2xl max-w-lg w-full max-h-[80vh] overflow-hidden shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="p-4 border-b border-border flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">
                    {selectedEntry.createdAt?.toDate
                      ? selectedEntry.createdAt.toDate().toLocaleDateString('en-US', {
                          weekday: 'long',
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric'
                        })
                      : new Date(selectedEntry.createdAt).toLocaleDateString('en-US', {
                          weekday: 'long',
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric'
                        })}
                  </p>
                  {typeof selectedEntry.analysis?.mood_score === 'number' && (
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-muted-foreground">Mood:</span>
                      <span className={`text-sm font-semibold ${
                        selectedEntry.analysis.mood_score >= 0.6 ? 'text-accent-deep' :
                        selectedEntry.analysis.mood_score >= 0.4 ? 'text-secondary-foreground' :
                        'text-red-600 dark:text-red-400' /* @color-safe: low mood */
                      }`}>
                        {Math.round(selectedEntry.analysis.mood_score * 100)}%
                      </span>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setSelectedEntry(null)}
                  className="cloud-icon-button"
                >
                  <X size={20} className="text-muted-foreground" />
                </button>
              </div>

              {/* Modal Content */}
              <div className="p-4 overflow-y-auto max-h-[60vh]">
                <p className="text-secondary-foreground whitespace-pre-wrap leading-relaxed">
                  {selectedEntry.content || selectedEntry.text || 'No content available'}
                </p>

                {/* Tags if available */}
                {selectedEntry.analysis?.tags && selectedEntry.analysis.tags.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-border">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                      Tags
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {selectedEntry.analysis.tags.map((tag, i) => (
                        <span
                          key={i}
                          className="text-xs px-2 py-1 bg-divider text-secondary-foreground rounded-full"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Summary if available */}
                {selectedEntry.analysis?.summary && (
                  <div className="mt-4 pt-4 border-t border-border">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                      Summary
                    </p>
                    <p className="text-sm text-secondary-foreground italic">
                      {selectedEntry.analysis.summary}
                    </p>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

// Helper to safely get string content (some fields might be objects)
const getStringContent = (...fields) => {
  for (const field of fields) {
    if (typeof field === 'string' && field.length > 0) {
      return field;
    }
  }
  return null;
};

/**
 * NexusInsightCard - Expandable insight display
 */
const NexusInsightCard = ({ insight, isExpanded, onToggleExpand, onDismiss, onReport, onWhyThis }) => {
  // Determine insight type styling
  const getInsightStyle = () => {
    const type = insight.type || insight.source || 'pattern';

    // Cloud restyle note: the legacy Hearthside styling gave each Nexus
    // insight type its own hue (terra/sage/honey/lavender). The Cloud system
    // is single-accent by design (CLOUD-DESIGN-SPEC.md §3), so every type
    // now renders on the same accent-wash/accent-deep treatment; the icon +
    // label already carry the type distinction.
    switch (type) {
      case 'belief_dissonance':
      case 'contradiction':
        return {
          icon: AlertTriangle,
          border: 'border-border',
          iconBg: 'bg-accent-wash',
          iconColor: 'text-accent-deep',
          label: 'Belief Pattern'
        };
      case 'narrative_arc':
      case 'growth':
        return {
          icon: TrendingUp,
          border: 'border-border',
          iconBg: 'bg-accent-wash',
          iconColor: 'text-accent-deep',
          label: 'Growth Pattern'
        };
      case 'recommendation':
      case 'intervention':
        return {
          icon: Lightbulb,
          border: 'border-border',
          iconBg: 'bg-accent-wash',
          iconColor: 'text-accent-deep',
          label: 'Recommendation'
        };
      case 'counterfactual':
        return {
          icon: Sparkles,
          border: 'border-border',
          iconBg: 'bg-accent-wash',
          iconColor: 'text-accent-deep',
          label: 'What If'
        };
      case 'causal_synthesis':
        return {
          icon: Brain,
          border: 'border-border',
          iconBg: 'bg-accent-wash',
          iconColor: 'text-accent-deep',
          label: 'Deep Insight'
        };
      default:
        return {
          icon: Brain,
          border: 'border-border',
          iconBg: 'bg-accent-wash',
          iconColor: 'text-accent-deep',
          label: 'Pattern'
        };
    }
  };

  const style = getInsightStyle();
  const Icon = style.icon;
  // A11Y-02: stable id for the expandable region so the clickable header can
  // reference it via aria-controls.
  const panelId = useId();

  // Check if this insight has expandable content
  const hasExpandableContent = Boolean(
    insight.body ||
    insight.mechanism ||
    insight.evidence?.narrative?.length ||
    insight.evidence?.biometric?.length ||
    insight.recommendation?.reasoning
  );

  const confidenceValue = insight.confidence ||
    insight.score ||
    insight.evidence?.statistical?.confidence ||
    insight.recommendation?.confidence;

  // A11Y-02: accessible name for the card's own disclosure control (kept
  // short and non-redundant with the nested action buttons' own labels,
  // which name-from-content would otherwise pull in).
  const cardTitle = getStringContent(insight.title, insight.intervention) || style.label;

  // A11Y-02: the header row toggles expansion, but also hosts real <button>
  // action controls (Why/Report/Dismiss) — each must stop the click from
  // bubbling to the toggle, and Enter/Space on the toggle itself must not
  // fire while focus is actually on one of those nested buttons (handled by
  // e.target === e.currentTarget below).
  const handleHeaderKeyDown = (e) => {
    if (!hasExpandableContent || e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onToggleExpand?.();
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -100 }}
      className={`bg-card border ${style.border} rounded-2xl overflow-hidden`}
    >
      {/* Main Card header - Clickable disclosure when expandable */}
      <div
        className={`p-4 ${hasExpandableContent ? 'cursor-pointer' : ''}`}
        onClick={hasExpandableContent ? onToggleExpand : undefined}
        onKeyDown={handleHeaderKeyDown}
        role={hasExpandableContent ? 'button' : undefined}
        tabIndex={hasExpandableContent ? 0 : undefined}
        aria-expanded={hasExpandableContent ? isExpanded : undefined}
        // Panel is conditionally rendered — aria-controls must only
        // reference an id present in the DOM, so it drops while collapsed.
        aria-controls={hasExpandableContent && isExpanded ? panelId : undefined}
        aria-label={hasExpandableContent ? cardTitle : undefined}
      >
        <div className="flex items-start gap-3">
          <div className={`p-2 ${style.iconBg} rounded-xl flex-shrink-0`}>
            <Icon size={18} className={style.iconColor} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <span className={`text-xs font-medium ${style.iconColor} uppercase tracking-wider`}>
                {style.label}
              </span>
              <div className="flex items-center gap-1">
                {hasExpandableContent && (
                  <div className="p-1">
                    {isExpanded ? (
                      <ChevronUp size={14} className="text-muted-foreground" />
                    ) : (
                      <ChevronDown size={14} className="text-muted-foreground" />
                    )}
                  </div>
                )}
                {/* R2 Task 11: "Why am I seeing this?" — flag-gated provenance trigger */}
                {onWhyThis && getFlag('insightReceipts') && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onWhyThis(e); }}
                    className="p-2 hover:bg-divider rounded-full transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                    aria-label="Why am I seeing this?"
                    title="Why am I seeing this?"
                  >
                    <Info size={16} className="text-muted-foreground" />
                  </button>
                )}
                {/* Report AI-generated content (Play AI-content policy) */}
                {onReport && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onReport(e); }}
                    className="p-2 hover:bg-divider rounded-full transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                    aria-label="Report this insight as inappropriate"
                    title="Report this insight"
                  >
                    <Flag size={16} className="text-muted-foreground" />
                  </button>
                )}
                {/* INT-003: Increased tap target size for accessibility (44x44px minimum) */}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onDismiss(e); }}
                  className="p-2 hover:bg-divider rounded-full transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                  aria-label="Dismiss insight"
                >
                  <X size={18} className="text-muted-foreground" />
                </button>
              </div>
            </div>

            {/* Title - RES-002: Added break-words for text reflow */}
            {getStringContent(insight.title, insight.intervention) && (
              <p className="font-medium text-foreground mt-1 break-words">
                {getStringContent(insight.title) || `Try: ${insight.intervention}`}
              </p>
            )}

            {/* Summary - RES-002: Added break-words for text reflow */}
            <p className="text-sm text-secondary-foreground mt-1 leading-relaxed break-words">
              {getStringContent(
                insight.summary,
                insight.reasoning,
                insight.message,
                insight.description,
                insight.expectedOutcome
              ) || 'New pattern detected'}
            </p>

            {/* Timing */}
            {getStringContent(insight.timing) && (
              <p className="text-xs text-muted-foreground mt-1">
                ⏰ Best time: {insight.timing}
              </p>
            )}

            {/* Quick Action */}
            {!isExpanded && getStringContent(insight.recommendation?.action, insight.suggestion) && (
              <p className="text-xs text-muted-foreground mt-2 italic">
                💡 {getStringContent(insight.recommendation?.action, insight.suggestion)}
              </p>
            )}

            {/* Confidence Bar */}
            {confidenceValue && (
              <div className="flex items-center gap-2 mt-2">
                <div className="h-1 flex-1 bg-divider rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent"
                    style={{ width: `${Math.round(confidenceValue * 100)}%` }}
                  />
                </div>
                <span className="text-xs text-muted-foreground">
                  {Math.round(confidenceValue * 100)}% confidence
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Expanded Content */}
      <AnimatePresence>
        {isExpanded && hasExpandableContent && (
          <motion.div
            id={panelId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-0 border-t border-border mt-0">
              <div className="pt-4 space-y-4">

                {/* Full Body Text */}
                {getStringContent(insight.body) && (
                  <div>
                    <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">
                      Analysis
                    </h4>
                    <p className="text-sm text-secondary-foreground leading-relaxed whitespace-pre-line">
                      {insight.body}
                    </p>
                  </div>
                )}

                {/* Mechanism */}
                {getStringContent(insight.mechanism) && (
                  <div className="bg-background rounded-xl p-3">
                    <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">
                      Why This Happens
                    </h4>
                    <p className="text-sm text-secondary-foreground">
                      {insight.mechanism}
                    </p>
                  </div>
                )}

                {/* Evidence */}
                {(insight.evidence?.narrative?.length > 0 || insight.evidence?.biometric?.length > 0) && (
                  <div>
                    <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">
                      Evidence
                    </h4>
                    <div className="space-y-2">
                      {insight.evidence?.narrative?.map((item, i) => (
                        <div key={i} className="bg-background rounded-lg p-2 text-sm text-secondary-foreground italic">
                          "{typeof item === 'string' ? item : JSON.stringify(item)}"
                        </div>
                      ))}
                      {insight.evidence?.biometric?.map((item, i) => (
                        <div key={i} className="bg-accent-wash rounded-lg p-2 text-sm text-accent-deep flex items-center gap-2">
                          <Activity size={14} />
                          {typeof item === 'string' ? item : JSON.stringify(item)}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recommendation Details */}
                {(insight.recommendation?.action || insight.recommendation?.reasoning) && (
                  <div className="bg-accent-wash rounded-xl p-3">
                    <h4 className="text-xs font-bold text-accent-deep uppercase tracking-wider mb-2 flex items-center gap-1">
                      <Target size={12} />
                      Recommended Action
                    </h4>
                    {getStringContent(insight.recommendation.action) && (
                      <p className="text-sm text-foreground font-medium">
                        {insight.recommendation.action}
                      </p>
                    )}
                    {getStringContent(insight.recommendation.reasoning) && (
                      <p className="text-sm text-secondary-foreground mt-1">
                        {insight.recommendation.reasoning}
                      </p>
                    )}
                    {getStringContent(insight.recommendation.expectedOutcome) && (
                      <p className="text-xs text-accent-deep mt-2">
                        Expected outcome: {insight.recommendation.expectedOutcome}
                      </p>
                    )}
                  </div>
                )}

                {/* Statistical Info */}
                {insight.evidence?.statistical && (
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    {insight.evidence.statistical.sampleSize && (
                      <span>Based on {insight.evidence.statistical.sampleSize} data points</span>
                    )}
                    {insight.evidence.statistical.correlation && (
                      <span>Correlation: {(insight.evidence.statistical.correlation * 100).toFixed(0)}%</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default InsightsPage;

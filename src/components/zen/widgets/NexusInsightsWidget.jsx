import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, ChevronRight, Loader2, Brain, AlertCircle, TrendingUp, Target, Lightbulb } from 'lucide-react';
import GlassCard from '../GlassCard';
import { useNexusInsights } from '../../../hooks/useNexusInsights';
import { useClaims } from '../../../hooks/useClaims';
import { rankClaims } from '../../../services/insights/claims/rankClaims';
import { badgeLabelFor } from '../../insights/ClaimCard';
import { getFlag } from '../../../config/flags';
import ReceiptSheet from '../../insights/ReceiptSheet';

// Type-specific styling for insight cards
const INSIGHT_STYLES = {
  pattern: {
    icon: TrendingUp,
    gradient: 'from-lavender-400/20 to-lavender-500/20',
    iconColor: 'text-lavender-600',
  },
  causal: {
    icon: Brain,
    gradient: 'from-terra-400/20 to-terra-500/20',
    iconColor: 'text-terra-600',
  },
  recommendation: {
    icon: Target,
    gradient: 'from-sage-400/20 to-sage-500/20',
    iconColor: 'text-sage-600',
  },
  default: {
    icon: Lightbulb,
    gradient: 'from-honey-400/20 to-honey-500/20',
    iconColor: 'text-honey-600',
  },
};

/**
 * Get safe string content from potentially complex insight fields
 */
const getStringContent = (value) => {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') {
    // Check common field patterns
    if (value.summary) return getStringContent(value.summary);
    if (value.description) return getStringContent(value.description);
    if (value.text) return getStringContent(value.text);
    if (value.message) return getStringContent(value.message);
    if (value.intervention) return getStringContent(value.intervention);
    return null;
  }
  return String(value);
};

/**
 * Get the display content for an insight
 */
const getInsightContent = (insight) => {
  // Try various field names in order of preference
  const fields = ['summary', 'reasoning', 'body', 'description', 'intervention', 'expectedOutcome'];

  for (const field of fields) {
    const content = getStringContent(insight[field]);
    if (content && content.length > 0) {
      return content;
    }
  }

  // Check nested recommendation
  if (insight.recommendation) {
    const recContent = getStringContent(insight.recommendation.intervention) ||
                       getStringContent(insight.recommendation.reasoning);
    if (recContent) return recContent;
  }

  return null;
};

/**
 * Mini insight card for the widget
 */
const MiniInsightCard = ({ insight, index, onWhyThis }) => {
  const type = insight.type || 'default';
  const style = INSIGHT_STYLES[type] || INSIGHT_STYLES.default;
  const Icon = style.icon;

  const title = getStringContent(insight.title) ||
                (type === 'pattern' ? 'Pattern Detected' :
                 type === 'causal' ? 'Insight' :
                 type === 'recommendation' ? 'Suggestion' : 'Insight');

  const content = getInsightContent(insight);

  if (!content) return null;

  return (
    <motion.div
      className={`
        p-3 rounded-xl
        bg-gradient-to-br ${style.gradient}
        border border-white/30
      `}
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.1 }}
    >
      <div className="flex items-start gap-2">
        <div className={`mt-0.5 ${style.iconColor}`}>
          <Icon size={14} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-warm-700 truncate">
            {title}
          </p>
          <p className="text-xs text-warm-500 line-clamp-2 mt-0.5">
            {content}
          </p>
          {onWhyThis && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onWhyThis(insight);
              }}
              className="relative mt-1 inline-flex min-h-[28px] items-center text-[11px] font-medium text-warm-600 underline decoration-warm-300 underline-offset-2 before:absolute before:-inset-2 before:content-['']"
            >
              Why am I seeing this?
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
};

// claimType -> icon/gradient styling for the compact Home widget card,
// paralleling INSIGHT_STYLES above. Keys mirror ClaimCard.jsx's own
// CLAIM_TYPE_BADGE map (claimSchema.js's CLAIM_TYPES) so every claimType the
// backend can produce has a deliberate style, not a silent fallback.
const CLAIM_STYLES = {
  experiment_result: {
    icon: Target,
    gradient: 'from-sage-400/20 to-sage-500/20',
    iconColor: 'text-sage-600',
  },
  pattern_to_watch: {
    icon: TrendingUp,
    gradient: 'from-lavender-400/20 to-lavender-500/20',
    iconColor: 'text-lavender-600',
  },
  observation: {
    icon: Lightbulb,
    gradient: 'from-honey-400/20 to-honey-500/20',
    iconColor: 'text-honey-600',
  },
};

/**
 * MiniClaimCard — the compact Home widget's claims-mode content (INS-01,
 * 2026-07-24 review brief). Renders the SAME `claim.wording` and the SAME
 * `badgeLabelFor(claim)` label `ClaimCard.jsx` renders on the Insights page
 * (imported, not re-derived) — the acceptance gate is "same claim, same
 * title/state/language" on Home vs Insights, so the two surfaces share the
 * exact badge-label function and read the claim's own wording field
 * directly rather than reformatting it.
 *
 * Deliberately reuses the legacy MiniInsightCard's own established trigger
 * language ("Why am I seeing this?") rather than ClaimCard's two-button
 * "See days"/"Feedback" row — this compact tile has room for one action,
 * and it opens the exact same `ReceiptSheet` (claimType branch) that both
 * of ClaimCard's buttons open on the Insights page, so the receipt content
 * itself — not just the trigger label — is what's held identical between
 * the two surfaces. `e.stopPropagation()` matches MiniInsightCard's own
 * button (see that component above): without it, a tap on this trigger
 * would bubble into GlassCard's onClick and navigate to /insights before
 * the sheet ever opened.
 */
const MiniClaimCard = ({ claim, onWhyThis }) => {
  const style = CLAIM_STYLES[claim.claimType] || CLAIM_STYLES.observation;
  const Icon = style.icon;

  return (
    <motion.div
      className={`
        p-3 rounded-xl
        bg-gradient-to-br ${style.gradient}
        border border-white/30
      `}
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
    >
      <div className="flex items-start gap-2">
        <div className={`mt-0.5 ${style.iconColor}`}>
          <Icon size={14} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-warm-700">
            {badgeLabelFor(claim)}
          </p>
          <p className="text-xs text-warm-500 line-clamp-2 mt-0.5">
            {claim.wording}
          </p>
          {onWhyThis && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onWhyThis(claim);
              }}
              className="relative mt-1 inline-flex min-h-[28px] items-center text-[11px] font-medium text-warm-600 underline decoration-warm-300 underline-offset-2 before:absolute before:-inset-2 before:content-['']"
            >
              Why am I seeing this?
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
};

/**
 * NexusInsightsWidget - Displays Nexus insights on the dashboard
 *
 * Shows top 2 insights with tap to see more.
 *
 * INS-01 (2026-07-24 review brief, P0): when `insightClaims` is ON, this
 * widget stops invoking `useNexusInsights` for display and instead renders
 * the single top-ranked VERIFIED claim (`useClaims` + the shared
 * `rankClaims` feed ordering — same function ClaimFeed/InsightsPage use),
 * in the compact `MiniClaimCard` above. This closes the gap the review
 * named: Home used to keep showing legacy Nexus insights (including
 * whatever the old engine's stale cache held) while the Insights page had
 * already cut over to the verified-claim feed — same claim, same badge
 * label, same wording, same receipt sheet on both surfaces now. When the
 * flag is OFF, every line below the flag check renders byte-identically to
 * the pre-INS-01 widget — no claims data is ever read in that case (see
 * `useClaims.js`'s own internal flag gate).
 */
const NexusInsightsWidget = ({
  user,
  isEditing = false,
  onDelete,
  size = '2x1',
  entries = [],
}) => {
  const navigate = useNavigate();
  const insightClaimsOn = getFlag('insightClaims');

  // Called unconditionally (rules of hooks), but `enabled: false` short-
  // circuits every internal fetch/generation effect when claims mode is on
  // — mirrors InsightsPage.jsx's own `useNexusInsights(user, { ...,
  // enabled: !getFlag('insightClaims') })` call exactly, so this widget
  // never queries or generates Nexus for display once the cutover is on
  // (acceptance gate: "zero current UI queries or generates Nexus for
  // proactive display").
  const {
    insights,
    isCalibrating,
    calibrationProgress,
    loading,
    error,
  } = useNexusInsights(user, { autoRefresh: false, enabled: !insightClaimsOn });

  // Take top 2 insights for the widget
  const displayInsights = (insights || []).slice(0, 2);

  // Claim-backed Home widget content (INS-01). Always called (rules of
  // hooks) — the hook itself never reads Firestore unless
  // getFlag('insightClaims') is on (useClaims.js), so mounting it flag-OFF
  // is a no-op for `listActiveClaims` call counts, matching InsightsPage's
  // own `useClaims(user)` call site.
  const { claims, loading: claimsLoading, refresh: refreshClaims } = useClaims(user);

  // Same ranking the unified ClaimFeed uses (claimType weight > |effect
  // size| > recency) — "top-ranked" means the same #1 claim a user would
  // see first on the Insights page's ClaimFeed, not a separately-ordered
  // pick. One card (compact single-card presentation per the plan
  // decision), not the top 2 the legacy branch below shows — a single
  // verified claim is a stronger, more legible Home signal than a partial
  // list of them in this tile's footprint.
  const topClaim = useMemo(() => {
    if (!insightClaimsOn) return null;
    return rankClaims(claims, { now: Date.now() })[0] || null;
  }, [insightClaimsOn, claims]);

  const receiptsOn = getFlag('insightReceipts');
  const [receiptInsight, setReceiptInsight] = useState(null);

  // Mirrors InsightsPage.jsx's own `handleReceiptFeedback`: a claim
  // feedback submission (e.g. `do_not_analyze`) can change the claim's
  // status, and `useClaims` only ever surfaces `status === 'verified'`
  // claims — re-running `refresh` is what actually drops a
  // now-suppressed claim from this widget without a remount. Legacy
  // (non-claim) insight feedback never sets `.claimType`, so this is a
  // harmless no-op on that path.
  const handleReceiptFeedback = () => {
    if (receiptInsight?.claimType) {
      refreshClaims();
    }
  };

  // Synchronous entryId -> entry lookup for ReceiptSheet's source rows
  // (v1: never fetches a missing entry from Firestore — see ReceiptSheet's
  // own doc comment). `entries` already flows to every widget via
  // HomePage's `widgetProps` spread (BentoGrid), so no new data plumbing
  // is needed here.
  const entriesById = useMemo(() => {
    const map = {};
    for (const entry of entries || []) {
      const id = entry?.id || entry?.entryId;
      if (id) map[id] = entry;
    }
    return map;
  }, [entries]);

  const handleClick = () => {
    if (!isEditing) {
      navigate('/insights');
    }
  };

  return (
    // ReceiptSheet is a *sibling* of GlassCard, not a child — GlassCard's
    // onClick (navigate to /insights) is spread onto its root motion.div,
    // and React bubbles synthetic events from a portal through the REACT
    // tree, not the DOM tree. If ReceiptSheet's Drawer/Dialog (both
    // portaled to document.body) were nested inside GlassCard's children,
    // every click inside the open sheet (Not true, Wrong source, closing
    // the confirm dialog, ...) would bubble up to GlassCard's onClick and
    // fire an unwanted navigation. Keeping it outside GlassCard's React
    // subtree avoids that entirely, no per-button stopPropagation needed.
    <>
      <GlassCard
        size={size}
        isEditing={isEditing}
        onDelete={onDelete}
        interactive={!isEditing}
        onClick={handleClick}
      >
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-warm-500">
            <Sparkles size={16} className="text-honey-500" />
            <span className="text-xs font-medium">AI Insights</span>
          </div>
          {!isEditing && (insightClaimsOn ? Boolean(topClaim) : displayInsights.length > 0) && (
            <ChevronRight size={16} className="text-warm-400" />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col">
          {insightClaimsOn ? (
            // INS-01 claims-mode content — see the widget's own doc comment
            // above. `claimsLoading`/empty/present mirror the legacy
            // branch's own loading/empty/populated shapes below, just
            // sourced from `useClaims` instead of `useNexusInsights`.
            claimsLoading ? (
              <div className="flex-1 flex items-center justify-center">
                <Loader2 size={20} className="animate-spin text-warm-400" />
              </div>
            ) : topClaim ? (
              <div className="space-y-2">
                <AnimatePresence>
                  <MiniClaimCard
                    key={topClaim.id}
                    claim={topClaim}
                    onWhyThis={setReceiptInsight}
                  />
                </AnimatePresence>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center px-2">
                <div className="w-10 h-10 rounded-full bg-warm-100 flex items-center justify-center mb-2">
                  <Sparkles size={18} className="text-warm-400" />
                </div>
                <p className="text-xs text-warm-500">
                  Keep journaling — a verified pattern will show up here once your data supports one.
                </p>
              </div>
            )
          ) : loading ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 size={20} className="animate-spin text-warm-400" />
            </div>
          ) : isCalibrating ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-2">
              <div className="w-8 h-8 rounded-full bg-honey-100 flex items-center justify-center mb-2">
                <Brain size={16} className="text-honey-600" />
              </div>
              <p className="text-xs text-hearth-600 font-medium">Learning your patterns</p>
              <div className="w-full mt-2 h-1.5 bg-hearth-100 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-honey-400 rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${calibrationProgress}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
              <p className="text-xs text-warm-400 mt-1">
                {calibrationProgress}% complete
              </p>
            </div>
          ) : error ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-2">
              <AlertCircle size={20} className="text-warm-400 mb-2" />
              <p className="text-xs text-warm-500">Unable to load insights</p>
            </div>
          ) : displayInsights.length > 0 ? (
            <div className="space-y-2">
              <AnimatePresence>
                {displayInsights.map((insight, idx) => (
                  <MiniInsightCard
                    key={insight.id || idx}
                    insight={insight}
                    index={idx}
                    onWhyThis={receiptsOn ? setReceiptInsight : undefined}
                  />
                ))}
              </AnimatePresence>
              {insights.length > 2 && (
                <motion.p
                  className="text-xs text-honey-600 text-center pt-1"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.3 }}
                >
                  +{insights.length - 2} more insights
                </motion.p>
              )}
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-2">
              <div className="w-10 h-10 rounded-full bg-warm-100 flex items-center justify-center mb-2">
                <Sparkles size={18} className="text-warm-400" />
              </div>
              <p className="text-xs text-warm-500">
                Keep journaling to unlock personalized insights
              </p>
            </div>
          )}
        </div>
      </div>
      </GlassCard>

      {/* Mounted whenever EITHER insightReceipts OR insightClaims is on —
          same rationale as InsightsPage.jsx's ReceiptSheet mount guard
          (F1, closure-wave final review): gating solely on insightReceipts
          would leave MiniClaimCard's "Why am I seeing this?" trigger as a
          silent no-op with insightClaims ON and insightReceipts OFF. */}
      {(receiptsOn || insightClaimsOn) && (
        <ReceiptSheet
          insight={receiptInsight}
          entriesById={entriesById}
          uid={user?.uid}
          open={Boolean(receiptInsight)}
          onClose={() => setReceiptInsight(null)}
          onFeedback={handleReceiptFeedback}
        />
      )}
    </>
  );
};

export default NexusInsightsWidget;

/**
 * ClaimFeed — the unified ranked insights feed (R4 Phase 2, Task 6).
 *
 * Replaces BOTH the legacy Quick Insights section AND the "AI Insights"
 * Nexus card list when `insightClaims` is ON (see InsightsPage.jsx's
 * render-site comment for the full flag-swap contract). One list, ordered
 * by `rankClaims` (claimType weight > |effect size| > recency, deterministic
 * ties), rendered as `ClaimCard`s under a single type-count group header
 * (e.g. "2 experiment results · 3 patterns to watch").
 *
 * Empty state is deliberately non-apologetic: Engram doesn't manufacture a
 * pattern to fill the space when the data doesn't support one yet.
 */
import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Loader2, RefreshCw, Layers } from 'lucide-react';
import ClaimCard from './ClaimCard';
import { rankClaims } from '../../services/insights/claims/rankClaims';

// Ordered highest-priority claimType first — matches rankClaims' TYPE_WEIGHT
// ordering, so the header reads in the same priority the cards below it do.
const TYPE_ORDER = ['experiment_result', 'pattern_to_watch', 'observation'];

const TYPE_LABEL = Object.freeze({
  experiment_result: ['experiment result', 'experiment results'],
  pattern_to_watch: ['pattern to watch', 'patterns to watch'],
  observation: ['observation', 'observations'],
});

/**
 * @param {object[]} claims
 * @returns {string} e.g. "2 experiment results · 3 patterns to watch", or
 *   '' when there's nothing to summarize (empty list, or every claim has an
 *   unrecognized type — never throws either way).
 */
export function groupSummary(claims) {
  const counts = (claims || []).reduce((acc, claimItem) => {
    const type = claimItem?.claimType;
    if (type) acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {});

  return TYPE_ORDER
    .filter((type) => counts[type] > 0)
    .map((type) => {
      const count = counts[type];
      const [singular, plural] = TYPE_LABEL[type];
      return `${count} ${count === 1 ? singular : plural}`;
    })
    .join(' · ');
}

const ClaimFeed = ({
  claims,
  loading,
  onRefresh,
  onShowReceipt,
  onFeedback,
  onTryExperiment,
}) => {
  const hasClaims = Array.isArray(claims) && claims.length > 0;

  // Review finding (minor, R4 Phase 2 Task 6): ranking was recomputed on
  // every render (a fresh `rankClaims` call, closing over a fresh
  // `Date.now()`-derived `now`, each time) rather than only when `claims`
  // actually changes. Memoized on `[claims]` — `now` is captured once per
  // claims-change, not per render. Hoisted above the early returns below
  // (rules of hooks: this must run unconditionally, same order every
  // render) — `rankClaims` already tolerates a non-array `claims` safely.
  const ranked = useMemo(() => rankClaims(claims, { now: Date.now() }), [claims]);

  if (loading && !hasClaims) {
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
            <h3 className="font-medium text-secondary-foreground">Insights</h3>
            <p className="text-xs text-muted-foreground">Checking your patterns...</p>
          </div>
        </div>
      </motion.div>
    );
  }

  if (!hasClaims) {
    return (
      <motion.div
        className="bg-card border border-border rounded-3xl p-8 text-center"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <Layers size={40} className="mx-auto text-decorative mb-3" />
        <p className="text-secondary-foreground font-medium">Nothing verified yet</p>
        <p className="text-muted-foreground text-sm mt-2">
          Engram only surfaces what your recorded days actually support. Keep journaling — a
          pattern will show up here the moment the evidence clears the bar.
        </p>
      </motion.div>
    );
  }

  const summary = groupSummary(ranked);

  return (
    <motion.div
      className="bg-card border border-border rounded-2xl overflow-hidden"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {/* Header */}
      <div className="p-4 flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-foreground">Insights</h3>
          {summary && (
            <p className="text-xs text-muted-foreground mt-0.5">{summary}</p>
          )}
        </div>
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={loading}
            aria-label="Refresh insights"
            className="cloud-icon-button disabled:opacity-50"
          >
            <RefreshCw
              size={14}
              className={`text-muted-foreground ${loading ? 'animate-spin' : ''}`}
            />
          </button>
        )}
      </div>

      {/* Claim cards, ranked */}
      <div className="px-4 pb-4 grid gap-2">
        {ranked.map((claim) => (
          <ClaimCard
            key={claim.id}
            claim={claim}
            onShowReceipt={onShowReceipt}
            onFeedback={onFeedback}
            onTryExperiment={onTryExperiment}
          />
        ))}
      </div>
    </motion.div>
  );
};

export default ClaimFeed;

/**
 * ClaimCard — claim-backed Quick Insights card (R4 Phase 1, Task 10).
 *
 * Renders one verified `InsightClaim` (see `claimSchema.js`'s `buildClaim`)
 * per the DR "ideal insight-card experience" five-question layout — no
 * stats homework, just: what kind of thing is this (badge), what's the
 * claim (wording), what's the evidence (evidence line), what does this NOT
 * prove (first limitation), what can I do about it (actions).
 *
 * 1. Badge: "Pattern to watch" + a direction arrow.
 * 2. `claim.wording` — the one precise, non-causal sentence.
 * 3. Evidence line: exposed vs comparison day counts, observed span,
 *    absolute mood-point difference, and (when the claim's evidence hid any
 *    sensitive-flagged source days from the preview) a trailing disclosure
 *    of how many.
 * 4. Limitation line: `claim.limitations[0]`.
 * 5. Actions: "See days" (opens the ReceiptSheet source list), "Feedback"
 *    (opens the same ReceiptSheet — it already renders the 6-option
 *    diagnostic taxonomy for a claim, T9), and "Try as an experiment" —
 *    shown ONLY when this claim's exposure maps to a v1 experiment
 *    template (`experimentTemplateFor` below); entity/category claims and
 *    unmapped health fields render no third action.
 *
 * Never renders causal language itself: `claim.wording`/`limitations` are
 * already validated non-causal at `buildClaim` construction time
 * (claimSchema.js's `CAUSAL_RE`), and every string this component authors
 * on its own (labels, evidence-line template) is plain, non-causal English
 * by construction — tested in ClaimCard.test.jsx.
 */

// health field (claimSchema evidence/candidateId convention — camelCase,
// matching extractHealthSignals' real output shape) -> v1 experiment
// template id (templates.js). Only these three health fields have a v1
// template; anything else maps to no button rather than a guess.
const HEALTH_TEMPLATE_BY_FIELD = Object.freeze({
  sleepHours: 'sleep-hours-mood-same-day',
  steps: 'steps-mood',
  recoveryScore: 'recovery-score-mood',
});

/**
 * Maps a claim's exposure (`analysisPlan.candidateId`, e.g. `'tag:gym'`,
 * `'entity:sarah'`, `'category:work'`, `'health:sleepHours'`) to an
 * experiment template id + optional tag param, or `null` when no v1
 * template applies. Never guesses: an unrecognized or unmapped candidateId
 * renders no "Try as an experiment" button rather than routing to the
 * wrong template.
 *
 * @param {object} claim
 * @returns {{templateId: string, tag: string|null}|null}
 */
export function experimentTemplateFor(claim) {
  const candidateId = claim?.analysisPlan?.candidateId;
  if (typeof candidateId !== 'string') return null;

  const sep = candidateId.indexOf(':');
  if (sep < 0) return null;
  const kind = candidateId.slice(0, sep);
  const value = candidateId.slice(sep + 1);

  if (kind === 'tag') {
    return { templateId: 'tag-presence-mood', tag: value };
  }
  if (kind === 'health') {
    const templateId = HEALTH_TEMPLATE_BY_FIELD[value];
    return templateId ? { templateId, tag: null } : null;
  }
  // entity / category (and anything else unmapped) — no v1 template.
  return null;
}

/**
 * Evidence line (brief's exact format): "{exposedDayCount} {subject} days
 * vs {comparisonDayCount} comparison days · {observedSpanDays}-day span ·
 * {|effectMoodPoints| rounded} mood-point difference", plus a trailing
 * hidden-sensitive disclosure clause when applicable.
 *
 * @param {object} claim
 * @returns {string}
 */
export function evidenceLineFor(claim) {
  const evidence = claim?.evidence || {};
  const rounded = Math.round(Math.abs(evidence.effectMoodPoints || 0));
  let line = `${evidence.exposedDayCount} ${claim.subject} days vs `
    + `${evidence.comparisonDayCount} comparison days · `
    + `${evidence.observedSpanDays}-day span · ${rounded} mood-point difference`;

  const hidden = evidence.hiddenSensitiveSourceCount;
  if (typeof hidden === 'number' && hidden > 0) {
    line += ` · ${hidden} contributing day${hidden === 1 ? '' : 's'} hidden from preview (sensitive)`;
  }
  return line;
}

const ClaimCard = ({ claim, onShowReceipt, onFeedback, onTryExperiment }) => {
  if (!claim) return null;

  const isPositive = claim.direction === 'positive';
  const experimentMapping = experimentTemplateFor(claim);
  const limitation = Array.isArray(claim.limitations) ? claim.limitations[0] : null;

  return (
    <div className="bg-background rounded-xl p-3 space-y-2">
      {/* 1. Badge + direction arrow */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs px-2 py-0.5 rounded-full bg-accent-wash text-accent-deep font-medium">
          Pattern to watch
        </span>
        <span
          className={isPositive ? 'text-accent-deep text-xs' : 'text-muted-foreground text-xs'}
          aria-label={isPositive ? 'Positive direction' : 'Negative direction'}
        >
          {isPositive ? '↑' : '↓'}
        </span>
      </div>

      {/* 2. Wording — the one precise, non-causal sentence */}
      <p className="text-sm text-secondary-foreground leading-relaxed">{claim.wording}</p>

      {/* 3. Evidence line */}
      <p className="text-xs text-muted-foreground">{evidenceLineFor(claim)}</p>

      {/* 4. Limitation */}
      {limitation && (
        <p className="text-xs text-muted-foreground italic">{limitation}</p>
      )}

      {/* 5. Actions */}
      <div className="flex items-center gap-3 pt-1 flex-wrap">
        <button
          type="button"
          onClick={() => onShowReceipt?.(claim)}
          className="relative inline-flex min-h-[28px] items-center text-xs font-medium text-accent-deep before:absolute before:-inset-2 before:content-['']"
        >
          See days
        </button>
        <button
          type="button"
          onClick={() => onFeedback?.(claim)}
          className="relative inline-flex min-h-[28px] items-center text-xs font-medium text-muted-foreground before:absolute before:-inset-2 before:content-['']"
        >
          Feedback
        </button>
        {experimentMapping && (
          <button
            type="button"
            onClick={() => onTryExperiment?.(experimentMapping.templateId, experimentMapping.tag)}
            className="relative inline-flex min-h-[28px] items-center text-xs font-medium text-accent-deep before:absolute before:-inset-2 before:content-['']"
          >
            Try as an experiment
          </button>
        )}
      </div>
    </div>
  );
};

export default ClaimCard;

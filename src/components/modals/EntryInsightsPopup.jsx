import {
  X, Heart, TrendingUp, Sparkles, AlertTriangle,
  RefreshCw, Target, Calendar, Brain, Wind, Footprints
} from 'lucide-react';
import { safeString, formatMentions } from '../../utils/string';
import { Drawer, DrawerContent, DrawerDescription } from '../cloud';

/**
 * EntryInsightsPopup (CLOUD-DESIGN-SPEC.md §5/§7 "Entry insights" — mockup
 * 7n): cloud `Drawer` bottom sheet. Shows validation and insights after
 * entry submission.
 *
 * PRIORITY ORDER:
 * 1. Validation first (empathetic acknowledgment)
 * 2. Therapeutic tools (perspective, defusion) - only if helpful
 * 3. Pattern insights last (only meaningful ones, skip generic encouragement)
 *
 * The mockup's quoted entry excerpt, mood/tag pill row, and "TOMORROW'S
 * REFLECTION" prompt card have no backing prop on this component
 * (contextualInsight/analysis/entryType only — no raw entry text, no tags,
 * no next-day prompt is ever passed in) and are deliberately NOT invented,
 * per the same "flag, don't invent" precedent as D2/D3 — see task-D4a-report.md.
 */
const EntryInsightsPopup = ({
  isOpen,
  onClose,
  contextualInsight,
  analysis,
  entryType = 'reflection'
}) => {
  const insight = contextualInsight;
  const cbt = analysis?.cbt_breakdown;
  const actAnalysis = analysis?.act_analysis;
  const ventSupport = analysis?.vent_support;
  const celebration = analysis?.celebration;
  const framework = analysis?.framework || 'general';

  // Get validation content based on framework
  const getValidation = () => {
    if (framework === 'support' && ventSupport?.validation) {
      return ventSupport.validation;
    }
    if (framework === 'cbt' && cbt?.validation) {
      return cbt.validation;
    }
    if (framework === 'act' && actAnalysis?.acknowledgment) {
      return actAnalysis.acknowledgment;
    }
    return null;
  };

  const validation = getValidation();

  // Check what therapeutic content is available
  const hasValidation = !!validation;
  const hasCelebration = framework === 'celebration' && celebration?.affirmation;
  const hasTherapeutic = (framework === 'cbt' && cbt?.perspective) ||
                         (framework === 'act' && actAnalysis?.defusion_phrase);
  const hasVentCooldown = framework === 'support' && ventSupport?.cooldown;

  // Determine if pattern insight is worth showing as primary content
  const isMeaningfulInsight = insight?.found && insight?.message &&
    ['progress', 'streak', 'absence', 'warning', 'pattern', 'goal_check', 'cyclical', 'contradiction'].includes(insight.type);

  // "Encouragement" insights shown only as fallback when nothing else exists
  const hasEncouragement = insight?.found && insight?.message && insight.type === 'encouragement';
  const needsFallback = !hasValidation && !hasCelebration && !hasTherapeutic && !hasVentCooldown && !isMeaningfulInsight;
  const showEncouragementAsFallback = needsFallback && hasEncouragement;

  // Determine what to show
  const showPatternInsight = isMeaningfulInsight;
  const hasContent = hasValidation || hasCelebration || hasTherapeutic || hasVentCooldown ||
                     showPatternInsight || showEncouragementAsFallback;

  // Dynamic header based on content type
  const getHeaderTitle = () => {
    if (hasValidation || hasCelebration) return 'Heard';
    if (framework === 'act' && actAnalysis?.defusion_phrase) return 'A thought';
    if (framework === 'cbt' && cbt?.perspective) return 'Perspective';
    if (showPatternInsight) return 'Pattern';
    if (showEncouragementAsFallback) return 'Noted';
    return 'Reflection';
  };

  // Icon + color per insight type (pattern insights only). Cloud tokens
  // only: every type collapses onto the single accent scale (bg-accent-wash
  // / text-accent-deep, differentiated by icon + label), matching the
  // InsightsPage (C5) precedent — except `warning`, which keeps semantic
  // red (@color-safe, same as EntryCard/InsightsPage/DaySummaryModal).
  const getInsightStyle = (type) => {
    const accentStyle = {
      bg: 'bg-accent-wash',
      border: 'border-border',
      iconColor: 'text-accent-deep',
      textColor: 'text-accent-deep',
    };
    const styles = {
      progress: { icon: TrendingUp, ...accentStyle },
      streak: { icon: RefreshCw, ...accentStyle },
      absence: { icon: Target, ...accentStyle },
      cyclical: { icon: Calendar, ...accentStyle },
      warning: {
        icon: AlertTriangle,
        bg: 'bg-red-50 dark:bg-red-900/20',
        border: 'border-red-200 dark:border-red-800',
        iconColor: 'text-red-600 dark:text-red-400',
        textColor: 'text-red-700 dark:text-red-300',
      },
      default: { icon: Brain, ...accentStyle },
    };
    return styles[type] || styles.default;
  };

  return (
    <Drawer open={isOpen && hasContent} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DrawerContent aria-labelledby="entry-insights-title" className="sm:mx-auto sm:max-w-xl">
        <DrawerDescription className="sr-only">
          Insights and reflections about the journal entry you just saved.
        </DrawerDescription>

        {/* Header */}
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-secondary-foreground">
            <Heart size={18} className="text-accent-deep" aria-hidden="true" />
            <span id="entry-insights-title" className="cloud-title text-sm font-semibold text-foreground">
              {getHeaderTitle()}
            </span>
          </div>
          <button
            type="button"
            className="cloud-icon-button"
            aria-label="Close insights"
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {/* Main content - PRIORITY ORDER (scrollable) */}
        <div className="max-h-[60vh] space-y-4 overflow-y-auto">

          {/* 1. VALIDATION FIRST - Empathetic acknowledgment */}
          {validation && (
            <div className="rounded-2xl border border-border bg-accent-wash p-4">
              <p className="font-body text-sm italic leading-relaxed text-secondary-foreground">
                {validation}
              </p>
            </div>
          )}

          {/* 2. CELEBRATION - For positive entries */}
          {hasCelebration && (
            <div className="rounded-2xl border border-border bg-accent-wash p-4">
              <div className="mb-2 flex items-center gap-2 font-display text-xs font-semibold uppercase text-accent-deep">
                <Sparkles size={14} aria-hidden="true" /> Nice!
              </div>
              <p className="font-body text-sm text-accent-deep">{celebration.affirmation}</p>
              {celebration.amplify && (
                <p className="mt-2 font-body text-xs italic text-secondary-foreground">{celebration.amplify}</p>
              )}
            </div>
          )}

          {/* 3. THERAPEUTIC TOOLS - Only if mood warrants it */}

          {/* CBT Perspective - cognitive reframe */}
          {framework === 'cbt' && cbt?.perspective && (
            <div className="rounded-2xl border-l-4 border-accent bg-accent-wash p-4">
              <div className="mb-2 flex items-center gap-2 font-display text-xs font-semibold uppercase text-accent-deep">
                <Brain size={14} aria-hidden="true" /> Another way to see it
              </div>
              <p className="font-body text-sm text-secondary-foreground">{cbt.perspective}</p>
            </div>
          )}

          {/* ACT Defusion - unhooking from thoughts */}
          {framework === 'act' && actAnalysis?.defusion_phrase && (
            <div className="rounded-2xl border border-border bg-accent-wash p-4">
              {actAnalysis.fusion_thought && (
                <div className="mb-3 text-sm text-accent-deep">
                  <span className="opacity-75">The thought: </span>
                  <span className="italic">"{actAnalysis.fusion_thought}"</span>
                </div>
              )}

              <div className="rounded-lg bg-card p-3 text-sm font-medium text-accent-deep">
                <span className="mb-1 block text-xs font-semibold uppercase text-muted-foreground">Try saying:</span>
                "{actAnalysis.defusion_phrase}"
              </div>
            </div>
          )}

          {/* Behavioral activation - only for low mood */}
          {framework === 'cbt' && cbt?.behavioral_activation && (
            <div className="rounded-2xl border border-border bg-accent-wash p-4">
              <div className="mb-2 flex items-center gap-2 font-display text-xs font-semibold uppercase text-accent-deep">
                <Footprints size={14} aria-hidden="true" /> Something small you could try
              </div>
              <p className="font-body text-sm font-medium text-accent-deep">{cbt.behavioral_activation.activity}</p>
              {cbt.behavioral_activation.rationale && (
                <p className="mt-1 text-xs text-secondary-foreground">{cbt.behavioral_activation.rationale}</p>
              )}
            </div>
          )}

          {/* ACT Committed Action */}
          {framework === 'act' && actAnalysis?.committed_action && (
            <div className="rounded-xl border border-border bg-accent-wash p-3">
              <div className="mb-2 flex items-center gap-2 font-display text-xs font-semibold uppercase text-accent-deep">
                <Footprints size={14} aria-hidden="true" /> A values-aligned step
              </div>
              <p className="font-body text-sm font-medium text-accent-deep">{actAnalysis.committed_action}</p>
            </div>
          )}

          {/* Vent cooldown technique */}
          {framework === 'support' && ventSupport?.cooldown && (
            <div className="rounded-2xl border border-border bg-accent-wash p-4">
              <div className="mb-2 flex items-center gap-2 font-display text-xs font-semibold uppercase text-accent-deep">
                <Wind size={14} aria-hidden="true" /> {ventSupport.cooldown.technique || 'Grounding'}
              </div>
              <p className="font-body text-sm text-accent-deep">{ventSupport.cooldown.instruction}</p>
            </div>
          )}

          {/* 4. PATTERN INSIGHT - Only if genuinely useful */}
          {showPatternInsight && (() => {
            const style = getInsightStyle(insight.type);
            const InsightIcon = style.icon;
            return (
              <div className={`rounded-2xl border p-4 ${style.bg} ${style.border}`}>
                <div className="flex gap-3">
                  <InsightIcon size={18} className={`mt-0.5 shrink-0 ${style.iconColor}`} aria-hidden="true" />
                  <div className="flex-1">
                    <div className={`mb-1 font-display text-[10px] font-bold uppercase tracking-wider ${style.iconColor}`}>
                      {safeString(insight.type).replace('_', ' ')}
                    </div>
                    <p className={`font-body text-sm leading-relaxed ${style.textColor}`}>
                      {formatMentions(safeString(insight.message))}
                    </p>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* 5. FALLBACK - Encouragement when nothing else is available */}
          {/* Styled more subtly since it's not primary content */}
          {showEncouragementAsFallback && (
            <div className="rounded-2xl border border-border bg-card p-4">
              <p className="font-body text-sm leading-relaxed text-secondary-foreground">
                {formatMentions(safeString(insight.message))}
              </p>
            </div>
          )}
        </div>

        {/* Dismiss button (fixed at bottom). Mockup 7n's "Done" CTA is an
            accent-deep filled pill (vs. the original's neutral legacy
            treatment) — adopted here for consistency with the other
            migrated modals' primary dismiss/submit pill (QuickLogModal's
            "Save Check-in", the mockup's "Log it"/"Done"). */}
        <div className="pt-4">
          <button
            type="button"
            onClick={onClose}
            className="w-full min-h-[44px] rounded-full bg-accent-deep py-3 text-sm font-semibold text-background transition-opacity hover:opacity-90"
          >
            Got it
          </button>
        </div>
      </DrawerContent>
    </Drawer>
  );
};

export default EntryInsightsPopup;

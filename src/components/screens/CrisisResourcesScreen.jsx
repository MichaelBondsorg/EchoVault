import React from 'react';
import { motion } from 'framer-motion';
import { Phone, MessageCircle, AlertTriangle } from 'lucide-react';
import { Pebble, Button } from '../cloud';

/**
 * CrisisResourcesScreen — restyle only (Task D3, CLOUD-DESIGN-SPEC.md §7
 * "Crisis resources": empathy Pebble, serif "You're not alone right now.",
 * 988 call card accent-deep with flip-polarity `text-background`, Crisis
 * Text Line, never red/alarming).
 *
 * Behavior is unchanged: props (level, onClose, onContinue) are the full
 * surface; `isCrisis` is computed identically; all three resource links
 * keep their exact original targets (`tel:988`, `sms:741741&body=HOME`,
 * `tel:911`); the `!isCrisis` gate around the "Continue with my entry"
 * button and the `onContinue`/`onClose` wiring are unchanged.
 *
 * Two decisions worth flagging (not invented, per the D2 "flag, don't
 * invent" precedent):
 *  1. Spec §7 also calls out a "grounding link" and "safety-plan link" on
 *     this screen. This component's props are level/onClose/onContinue
 *     only — there is no onOpenGrounding/onOpenSafetyPlan prop wired to it
 *     from App.jsx, so those two links are NOT added here; adding a
 *     navigation target with no backing handler would be inventing
 *     behavior on the crisis path. See task-D3-report.md.
 *  2. The mockup (7g) renders Crisis resources as a full-bleed "phone
 *     screen" with LinenWaveBackground. This component is mounted as an
 *     ephemeral overlay on top of the current screen (App.jsx renders it
 *     conditionally alongside CrisisSoftBlockModal), the same presentation
 *     model as that modal, so it keeps its original centered-card-over-
 *     scrim structure rather than switching to a full-page takeover — a
 *     structural change beyond "restyle in place" for the highest-stakes
 *     file in this task. Visual content (Pebble, serif headline, accent-
 *     deep 988 card) still matches the spec.
 *
 * Copy: the ONLY string changed from the original is the isCrisis headline,
 * replaced with CLOUD-DESIGN-SPEC.md §7's literal quoted copy. Every other
 * string (subheads, resource labels, button labels) is unchanged character-
 * for-character, per "spec-silent copy stays as-is."
 */
const CrisisResourcesScreen = ({ level, onClose, onContinue }) => {
  const isCrisis = level === 'crisis';

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] p-4"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', duration: 0.3 }}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-3xl bg-card p-6 shadow-soft-lg"
      >
        <div className="mb-6 text-center">
          <Pebble state="empathy" size={64} className="mx-auto" />
          <h2 className="mt-4 font-display text-xl font-medium text-foreground">
            {isCrisis ? "You're not alone right now." : 'Support resources'}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {isCrisis
              ? "You don't have to face this alone. Please reach out."
              : 'Here are some resources that might help.'}
          </p>
        </div>

        {/* Resource links. Each row is min-h-[44px] and stacked with a real
            gap-3 (12px) — the only interactive element per row, so there's
            no hit-target overlap to reason about (unlike the swatch-row
            geometry in SettingsPage/C6). */}
        <div className="mb-6 flex flex-col gap-3">
          <a
            href="tel:988"
            className="flex min-h-[44px] items-center gap-4 rounded-2xl bg-accent-deep p-4 shadow-soft-lg transition-opacity hover:opacity-90"
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent-wash">
              <Phone className="text-accent-deep" size={20} aria-hidden="true" />
            </div>
            <div>
              <div className="font-display font-semibold text-background">988 Suicide &amp; Crisis Lifeline</div>
              <div className="text-sm text-background">Call or text 988 - Available 24/7</div>
            </div>
          </a>

          <a
            href="sms:741741&body=HOME"
            className="flex min-h-[44px] items-center gap-4 rounded-2xl border border-border bg-card p-4 shadow-sm transition-colors hover:bg-divider"
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent-wash">
              <MessageCircle className="text-accent-deep" size={20} aria-hidden="true" />
            </div>
            <div>
              <div className="font-display font-semibold text-foreground">Crisis Text Line</div>
              <div className="text-sm text-muted-foreground">Text HOME to 741741</div>
            </div>
          </a>

          <a
            href="tel:911"
            className="flex min-h-[44px] items-center gap-4 rounded-2xl border border-border bg-card p-4 shadow-sm transition-colors hover:bg-divider"
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent-wash">
              <AlertTriangle className="text-accent-deep" size={20} aria-hidden="true" />
            </div>
            <div>
              <div className="font-display font-semibold text-foreground">Emergency Services</div>
              <div className="text-sm text-muted-foreground">Call 911 for immediate help</div>
            </div>
          </a>
        </div>

        {!isCrisis && (
          <Button onClick={onContinue} className="mb-3 w-full">
            Continue with my entry
          </Button>
        )}

        <button
          type="button"
          onClick={onClose}
          className="flex min-h-[44px] w-full items-center justify-center text-sm text-muted-foreground hover:text-foreground"
        >
          {isCrisis ? "I'll reach out for help" : 'Close'}
        </button>
      </motion.div>
    </motion.div>
  );
};

export default CrisisResourcesScreen;

import React from 'react';
import { motion } from 'framer-motion';
import { Heart } from 'lucide-react';

/**
 * CrisisSoftBlockModal — restyle only (Task D3). Per the brief, this modal
 * is NOT moved onto the cloud `Dialog` primitive (its overlay opacity bug —
 * `bg-foreground/40` no-ops on a CSS-var color — is a D4 fix, not this
 * task); it keeps its own existing structure, restyled with Cloud tokens,
 * scrim via `bg-[var(--overlay)]` (not the banned `/NN` modifier).
 *
 * Behavior is unchanged: props (onResponse, onClose) are the full surface;
 * the three `onClick={() => onResponse('okay'|'support'|'crisis')}` calls
 * and the `onClick={onClose}` Cancel handler are unchanged. No copy was
 * changed — every string is character-for-character identical to the
 * original (spec is silent on this screen's copy).
 *
 * "I'm in crisis" previously used red/warning styling (border-red-200 /
 * text-red-700). Per the safety-critical "never red/alarming" rule, it's
 * now the accent-deep FILLED option — visually the most prominent of the
 * three (appropriate for the most urgent path) without using an alarming
 * color. The other two options keep the same neutral-outline treatment,
 * just retokened (their legacy honey/lavender hover hues collapse onto the
 * single Cloud accent, same precedent as InsightsPage/C5 and D1's bubble
 * colors).
 */
const CrisisSoftBlockModal = ({ onResponse, onClose }) => {
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
        className="w-full max-w-md rounded-3xl bg-card p-6 shadow-soft-lg"
      >
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent-wash">
            <Heart className="text-accent-deep" size={24} aria-hidden="true" />
          </div>
          <div>
            <h2 className="font-display text-lg font-bold text-foreground">Just checking in</h2>
            <p className="text-sm text-muted-foreground">I noticed some heavy words</p>
          </div>
        </div>

        <p className="mb-6 text-secondary-foreground">Are you okay? Your wellbeing matters most.</p>

        <div className="space-y-3">
          <button
            type="button"
            onClick={() => onResponse('okay')}
            className="w-full min-h-[44px] rounded-2xl border-2 border-border p-4 text-left transition-colors hover:border-accent hover:bg-accent-wash"
          >
            <div className="font-display font-semibold text-foreground">I'm okay, just venting</div>
            <div className="text-sm text-muted-foreground">Continue saving my entry</div>
          </button>

          <button
            type="button"
            onClick={() => onResponse('support')}
            className="w-full min-h-[44px] rounded-2xl border-2 border-border p-4 text-left transition-colors hover:border-accent hover:bg-accent-wash"
          >
            <div className="font-display font-semibold text-foreground">I could use some support</div>
            <div className="text-sm text-muted-foreground">Show me helpful resources</div>
          </button>

          <button
            type="button"
            onClick={() => onResponse('crisis')}
            className="w-full min-h-[44px] rounded-2xl border-2 border-accent-deep bg-accent-deep p-4 text-left transition-opacity hover:opacity-90"
          >
            <div className="font-display font-semibold text-background">I'm in crisis</div>
            <div className="text-sm text-background">Connect me with help now</div>
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-4 flex min-h-[44px] w-full items-center justify-center text-center text-sm text-faint hover:text-muted-foreground"
        >
          Cancel
        </button>
      </motion.div>
    </motion.div>
  );
};

export default CrisisSoftBlockModal;

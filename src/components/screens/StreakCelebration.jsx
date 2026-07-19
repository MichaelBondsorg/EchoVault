import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { Pebble, Button, LinenWaveBackground } from '../cloud';
import { cn } from '../../lib/cn';

/**
 * StreakCelebration — full-screen post-save celebration (Task D4b,
 * CLOUD-DESIGN-SPEC.md §7 "Streak celebration" / mockup 10a): celebrating
 * Pebble (confetti pips are built into that state — §6.3), serif "N days.
 * A new personal best." headline, a dot tracker (one dot per streak day,
 * the record-setting dot ringed), a "Keep it going" primary CTA, and a
 * "Share with my therapist" text link.
 *
 * New file — this is a screen-level surface (mounted full-page, closable),
 * matching the CrisisResourcesScreen/SafetyPlanScreen/DecompressionScreen
 * convention of living in `src/components/screens/` rather than the
 * `src/components/cloud/` primitive kit.
 *
 * Data contract (deliberately minimal — no invented state): the two numbers
 * this screen needs, `currentStreak` and `previousBest`, both come straight
 * out of `calculateStreak()` (services/dashboard/index.js), computed by the
 * caller (App.jsx's post-save success path) — no second streak calculator.
 *
 * Copy note: the spec's literal secondary line ("You've shown up for
 * yourself every day this week — even the heavy ones.") is a worked example
 * for an 8-day streak; since this screen is dynamically parameterized by
 * whatever streak length just became the record (could be far more or less
 * than "this week"), the "this week" framing was dropped so the copy stays
 * accurate at any streak length. Nothing else in the mockup's copy changed.
 */
const StreakCelebration = ({ currentStreak, previousBest = 0, onClose, onShareWithTherapist }) => {
  const dots = Math.max(currentStreak, 1);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-50 flex flex-col bg-background pt-[env(safe-area-inset-top)]"
    >
      <LinenWaveBackground />

      <div className="flex justify-end p-4">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-11 w-11 items-center justify-center rounded-full text-faint transition-colors hover:text-muted-foreground"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
        <Pebble state="celebrating" size={88} />

        <h1 className="mt-7 text-[30px] font-display font-medium leading-[1.2] tracking-[-0.01em] text-foreground">
          {currentStreak} days.
          <br />
          A new personal best.
        </h1>
        <p className="mt-2.5 max-w-[270px] text-[13.5px] leading-[1.6] text-muted-foreground">
          You've shown up for yourself, even on the heavy days.
        </p>

        <div className="mt-[22px] flex max-w-[260px] flex-wrap justify-center gap-[5px]">
          {Array.from({ length: dots }).map((_, i) => {
            const isRecordDot = i === dots - 1;
            return (
              <span
                key={i}
                className={cn('h-2 w-2 rounded-full', isRecordDot ? 'bg-accent-deep' : 'bg-accent')}
                style={isRecordDot ? { boxShadow: '0 0 0 3px var(--accent-wave)' } : undefined}
              />
            );
          })}
        </div>

        {previousBest > 0 && (
          <div className="mt-2 text-[11px] text-faint">previous best: {previousBest}</div>
        )}
      </div>

      <div className="px-[30px] pb-[30px] pt-[10px]">
        <Button onClick={onClose} className="w-full">
          Keep it going
        </Button>
        <button
          type="button"
          onClick={onShareWithTherapist}
          className="mt-3 flex min-h-[44px] w-full items-center justify-center text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          Share with my therapist
        </button>
      </div>
    </motion.div>
  );
};

export default StreakCelebration;

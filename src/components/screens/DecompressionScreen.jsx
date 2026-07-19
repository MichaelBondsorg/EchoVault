import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Pebble, LinenWaveBackground } from '../cloud';

/**
 * DecompressionScreen — restyle only (Task D4b, CLOUD-DESIGN-SPEC.md §7
 * "Decompression"/§6.3 Pebble "resting" state). This is the short,
 * auto-advancing (12s, unskippable) breathing beat shown right after a
 * heavy entry is captured — reachable from safety flows, so per the task
 * brief it gets extra care: the step timeline (100ms/3000/6000/9000/12000ms
 * timeouts), the `onClose()` completion callback, and every phase's copy
 * are all byte-identical to the pre-Cloud version. Only the visual
 * treatment changed: the dark warm-800/900 gradient + Brain icon became the
 * Cloud canvas + resting Pebble (§6.3: resting = "breathe 10s + drifting
 * z's" — used for "decompression, night"), and the sage/white palette
 * became Cloud tokens. The Pebble's own scale/opacity animation is still
 * driven by the same phase-indexed `step` state (not the Pebble's built-in
 * CSS breathe keyframe) so the visual is still tied 1:1 to the timeline —
 * swapping to the CSS-only breathe animation would decouple the pulse from
 * the actual phase timing.
 *
 * No manual close affordance was added: the original has none (it always
 * runs to completion and calls onClose itself), and this screen can be
 * reached from the crisis/safety path, so no new interactive surface was
 * introduced beyond what already existed.
 */
const DecompressionScreen = ({ onClose }) => {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const t1 = setTimeout(() => setStep(1), 100);
    const t2 = setTimeout(() => setStep(2), 3000); // Breathe In
    const t3 = setTimeout(() => setStep(3), 6000); // Hold
    const t4 = setTimeout(() => setStep(4), 9000); // Breathe Out
    const t5 = setTimeout(() => onClose(), 12000); // Finish
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
      clearTimeout(t5);
    };
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background"
    >
      <LinenWaveBackground />

      <div className="relative z-10 mb-8">
        <motion.div
          animate={{
            scale: step === 2 ? 1.5 : step === 4 ? 0.5 : 1,
            opacity: 0.3
          }}
          transition={{ duration: 3, ease: 'easeInOut' }}
          className="absolute inset-0 rounded-full blur-xl"
          style={{ background: 'var(--accent-wave)' }}
        />
        <motion.div
          animate={{
            scale: step === 2 ? 1.1 : 0.9
          }}
          transition={{ duration: 3, ease: 'easeInOut' }}
        >
          <Pebble state="resting" size={88} className="relative" />
        </motion.div>
      </div>

      <motion.h2
        key={step}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative z-10 mb-2 text-2xl font-display font-medium text-foreground"
      >
        {step <= 1 && 'Heavy thoughts captured.'}
        {step === 2 && 'Breathe in...'}
        {step === 3 && 'Hold...'}
        {step === 4 && 'Let it go...'}
      </motion.h2>
      <p className="relative z-10 text-sm text-muted-foreground">Processing your feelings...</p>

      {/* Breathing indicator */}
      <div className="relative z-10 mt-8 flex gap-2">
        {[1, 2, 3, 4].map((dot) => (
          <motion.div
            key={dot}
            animate={{
              scale: step >= dot ? 1.2 : 0.8,
              opacity: step >= dot ? 1 : 0.3
            }}
            transition={{ duration: 0.3 }}
            className="h-2 w-2 rounded-full bg-accent"
          />
        ))}
      </div>
    </motion.div>
  );
};

export default DecompressionScreen;

import { forwardRef } from 'react';
import { cn } from '../../lib/cn';

// Two eq durations already defined in cloud-motion.css — alternate them per
// bar so a row doesn't pulse in lockstep, then stagger further with
// animation-delay.
const DURATION_CLASS = ['animate-cloud-eq-1100ms', 'animate-cloud-eq-1200ms'];

/**
 * Staggered n-bar voice/audio equalizer (CLOUD-DESIGN-SPEC.md §6.4 `eq`
 * keyframe). Used standalone (voice session transcript) and reused
 * conceptually by Pebble's listening-state dots.
 */
export const Equalizer = forwardRef(({ bars = 12, height = 24, className, ...props }, ref) => (
  <div
    ref={ref}
    aria-hidden="true"
    className={cn('flex items-end gap-1', className)}
    style={{ height }}
    {...props}
  >
    {Array.from({ length: bars }, (_, i) => (
      <span
        key={i}
        className={cn('w-1 rounded-sm bg-accent', DURATION_CLASS[i % DURATION_CLASS.length])}
        style={{ height: '100%', transformOrigin: 'bottom', animationDelay: `${(i % 6) * 0.08}s` }}
      />
    ))}
  </div>
));
Equalizer.displayName = 'Equalizer';

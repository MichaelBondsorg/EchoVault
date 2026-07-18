import { forwardRef } from 'react';
import { cn } from '../../lib/cn';

// Scattered pip positions (relative to whatever positioned box this is
// dropped into — e.g. Pebble's celebrating state, or a full-screen
// StreakCelebration burst later). Alternates accent / accent-3 per spec
// B3 ("accent + accent-3 colors"), all animated with the shared `rise`
// keyframe at staggered delays.
const PIPS = [
  { left: 6, top: 6, size: 6, radius: 2, color: 'var(--accent)', delay: '0s' },
  { right: 4, top: 12, size: 5, radius: 999, color: 'var(--accent-3)', delay: '.5s' },
  { left: 14, top: 24, size: 4, radius: 999, color: 'var(--accent-3)', delay: '1s' },
  { right: 16, top: 2, size: 5, radius: 2, color: 'var(--accent)', delay: '1.4s' },
  { left: -4, top: 16, size: 4, radius: 999, color: 'var(--accent-3)', delay: '.8s' },
];

/**
 * 4-5 confetti pips using the shared `cloud-rise` keyframe (rise + fade)
 * (CLOUD-DESIGN-SPEC.md §6.3/§6.4). Standalone export for later screens
 * (StreakCelebration) as well as Pebble's celebrating state.
 */
export const ConfettiPips = forwardRef(({ count = 4, className, ...props }, ref) => {
  const pips = PIPS.slice(0, Math.min(Math.max(count, 4), 5));
  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={cn('pointer-events-none absolute inset-0', className)}
      {...props}
    >
      {pips.map((pip, i) => (
        <span
          key={i}
          className="absolute animate-cloud-rise-2200ms"
          style={{
            left: pip.left,
            right: pip.right,
            top: pip.top,
            width: pip.size,
            height: pip.size,
            borderRadius: pip.radius,
            background: pip.color,
            animationDelay: pip.delay,
          }}
        />
      ))}
    </div>
  );
});
ConfettiPips.displayName = 'ConfettiPips';

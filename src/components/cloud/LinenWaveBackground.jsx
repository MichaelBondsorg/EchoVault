import { forwardRef } from 'react';
import { cn } from '../../lib/cn';
import { useUiStore } from '../../stores/uiStore';

// Grain tile: 256x256 feTurbulence SVG (fractalNoise, baseFrequency .9, 4
// octaves, stitchTiles='stitch') per CLOUD-DESIGN-SPEC.md §6.1. Encoded
// inline so it ships with zero extra network requests.
const GRAIN_SVG =
  "data:image/svg+xml,%3Csvg width='256' height='256' viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n' x='0' y='0' width='100%25' height='100%25'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='256' height='256' filter='url(%23n)'/%3E%3C/svg%3E";

// Three drifting rings inside a 2400x2400 layer offset -1600px top/left —
// on screen this reads as long curved bands drifting top-left <-> bottom-
// right (spec §6.1). Reuses the `cloud-wave` keyframes/utilities already
// defined in cloud-motion.css (A2) — do not redefine them here.
const RINGS = [
  {
    animationClass: 'animate-cloud-wave-11s',
    gradient: 'radial-gradient(circle closest-side, transparent 56%, var(--accent-wave), transparent 74%)',
  },
  {
    animationClass: 'animate-cloud-wave-15s',
    gradient: 'radial-gradient(circle closest-side, transparent 70%, var(--accent-wave), transparent 88%)',
    animationDelay: '-5s',
  },
  {
    animationClass: 'animate-cloud-wave-19s',
    gradient: 'radial-gradient(circle closest-side, transparent 83%, var(--accent-wave), transparent 99%)',
    animationDelay: '-11s',
  },
];

/**
 * Fixed full-viewport ambient layer mounted once behind page content
 * (CLOUD-DESIGN-SPEC.md §6.1): accent-wash -> background gradient canvas,
 * a tiled grain texture, and (when enabled) drifting wave rings.
 *
 * The gradient + grain always render — they're static. The wave rings only
 * render when the "Background motion" preference (uiStore.backgroundMotion)
 * is on; `prefers-reduced-motion` is handled separately by the CSS guard in
 * cloud-motion.css, which forces every `animate-cloud-*` utility to
 * `animation: none` regardless of this component's state.
 */
export const LinenWaveBackground = forwardRef(({ className, ...props }, ref) => {
  const backgroundMotion = useUiStore((state) => state.backgroundMotion);

  return (
    <div
      ref={ref}
      aria-hidden="true"
      data-testid="linen-wave-background"
      className={cn('pointer-events-none fixed inset-0 -z-10 overflow-hidden', className)}
      style={{ background: 'linear-gradient(180deg, var(--accent-wash) 0%, var(--background) 240px)' }}
      {...props}
    >
      <div data-testid="linen-wave-gradient" className="absolute inset-0" />

      {backgroundMotion && (
        <div
          data-testid="linen-wave-rings"
          className="absolute"
          style={{ left: '-1600px', top: '-1600px', width: '2400px', height: '2400px' }}
        >
          {RINGS.map((ring) => (
            <span
              key={ring.animationClass}
              className={cn('absolute inset-0', ring.animationClass)}
              style={{ background: ring.gradient, animationDelay: ring.animationDelay }}
            />
          ))}
        </div>
      )}

      <div
        data-testid="linen-wave-grain"
        className="absolute inset-0 opacity-[0.045] dark:opacity-[0.035]"
        style={{
          backgroundImage: `url("${GRAIN_SVG}")`,
          backgroundSize: '256px 256px',
          backgroundRepeat: 'repeat',
        }}
      />
    </div>
  );
});
LinenWaveBackground.displayName = 'LinenWaveBackground';

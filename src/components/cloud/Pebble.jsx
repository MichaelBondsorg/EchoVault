import { forwardRef } from 'react';
import { cn } from '../../lib/cn';
import { ConfettiPips } from './ConfettiPips';

// Outer decoration canvas (accommodates equalizer dots / confetti / z's /
// thought dots that extend past the blob itself) and the blob's own box,
// both at a fixed base pixel size — `size` scales the whole thing via a
// CSS transform so every position below stays exact regardless of prop
// value (CLOUD-DESIGN-SPEC.md §6.3).
const BASE_W = 104;
const BASE_H = 88;
const BLOB_W = 88;
const BLOB_H = 81;
const BLOB_LEFT = 8;
const BLOB_BOTTOM = 0;

// The one blob recipe (§6.3) — every state shares this shape and gradient.
// Dark mode swaps the gradient's first stop to --accent-d4 (spec: "gradient
// accent-d4 -> accent") via the arbitrary-property + dark: variant below, no
// raw hex, no per-state re-definition.
const BLOB_RECIPE_CLASS =
  '[--pebble-grad-a:var(--accent-3)] dark:[--pebble-grad-a:var(--accent-d4)]';
const BLOB_STYLE = {
  background: 'linear-gradient(160deg, var(--pebble-grad-a), var(--accent))',
  borderRadius: '48% 52% 55% 45% / 58% 54% 46% 42%',
};

// Ink facial features: light mode = var(--foreground) (#1E1D19-equivalent);
// dark mode = var(--background) per spec's explicit "#151618" callout,
// which is the *dark-mode background* value, not the dark-mode foreground.
const INK_FILL = 'bg-foreground dark:bg-background';
const INK_BORDER = 'border-foreground dark:border-background';

// Per-state animation class applied to the blob's inner (scale/rotate)
// layer. All reuse the existing cloud-motion.css keyframes/utilities.
const MOTION_CLASS = {
  calm: 'animate-cloud-breathe-8s',
  listening: 'animate-cloud-tilt-4s',
  celebrating: 'animate-cloud-bounce-1600ms',
  empathy: 'animate-cloud-breathe-9s',
  resting: 'animate-cloud-breathe-10s',
  thinking: 'animate-cloud-breathe-8s',
};

function CalmFace() {
  return (
    <>
      <span className={cn('absolute rounded-[4px] animate-cloud-blink-5s', INK_FILL)}
        style={{ left: 27, top: 34, width: 6, height: 9 }} />
      <span className={cn('absolute rounded-[4px] animate-cloud-blink-5s', INK_FILL)}
        style={{ right: 27, top: 34, width: 6, height: 9 }} />
      <span className={cn('absolute border-2 border-t-0 border-l-0 border-r-0 rounded-b-[8px]', INK_BORDER)}
        style={{ left: '50%', marginLeft: -6, top: 48, width: 12, height: 6 }} />
    </>
  );
}

function ListeningFace() {
  return (
    <>
      <span className={cn('absolute rounded-[5px]', INK_FILL)} style={{ left: 26, top: 32, width: 8, height: 11 }} />
      <span className={cn('absolute rounded-[5px]', INK_FILL)} style={{ right: 28, top: 32, width: 8, height: 11 }} />
      <span className={cn('absolute rounded-full border-2 box-border', INK_BORDER)}
        style={{ left: '50%', marginLeft: -4, top: 50, width: 8, height: 8 }} />
    </>
  );
}

function CelebratingFace() {
  return (
    <>
      <span className={cn('absolute border-2 border-b-0 border-l-0 border-r-0 rounded-t-[8px]', INK_BORDER)}
        style={{ left: 25, top: 36, width: 10, height: 6 }} />
      <span className={cn('absolute border-2 border-b-0 border-l-0 border-r-0 rounded-t-[8px]', INK_BORDER)}
        style={{ right: 25, top: 36, width: 10, height: 6 }} />
      <span className={cn('absolute border-2 border-t-0 border-l-0 border-r-0 rounded-b-[12px]', INK_BORDER)}
        style={{ left: '50%', marginLeft: -8, top: 47, width: 16, height: 9 }} />
    </>
  );
}

// CRITICAL (spec §6.3): empathy brows are inner-ends-UP — left rotate(-12deg),
// right rotate(12deg). The mirrored orientation (left +12, right -12) reads
// as an angry V-brow, which the spec explicitly warns against. Do not "fix"
// these signs without re-reading §6.3.
function EmpathyFace() {
  return (
    <>
      <span
        data-testid="pebble-brow-left"
        className={cn('absolute rounded-[2px]', INK_FILL)}
        style={{ left: 24, top: 28, width: 10, height: 2.5, transform: 'rotate(-12deg)' }}
      />
      <span
        data-testid="pebble-brow-right"
        className={cn('absolute rounded-[2px]', INK_FILL)}
        style={{ right: 24, top: 28, width: 10, height: 2.5, transform: 'rotate(12deg)' }}
      />
      <span className={cn('absolute rounded-[4px]', INK_FILL)} style={{ left: 27, top: 36, width: 6, height: 8 }} />
      <span className={cn('absolute rounded-[4px]', INK_FILL)} style={{ right: 27, top: 36, width: 6, height: 8 }} />
      <span className={cn('absolute border-2 border-t-0 border-l-0 border-r-0 rounded-b-[8px]', INK_BORDER)}
        style={{ left: '50%', marginLeft: -5, top: 51, width: 10, height: 5 }} />
    </>
  );
}

function RestingFace() {
  return (
    <>
      <span className={cn('absolute border-2 border-t-0 border-l-0 border-r-0 rounded-b-[8px]', INK_BORDER)}
        style={{ left: 26, top: 38, width: 9, height: 4 }} />
      <span className={cn('absolute border-2 border-t-0 border-l-0 border-r-0 rounded-b-[8px]', INK_BORDER)}
        style={{ right: 26, top: 38, width: 9, height: 4 }} />
      <span className={cn('absolute border-2 border-t-0 border-l-0 border-r-0 rounded-b-[6px]', INK_BORDER)}
        style={{ left: '50%', marginLeft: -4, top: 50, width: 8, height: 4 }} />
    </>
  );
}

function ThinkingFace() {
  return (
    <>
      <span className={cn('absolute rounded-[4px]', INK_FILL)} style={{ left: 29, top: 30, width: 6, height: 9 }} />
      <span className={cn('absolute rounded-[4px]', INK_FILL)} style={{ right: 25, top: 28, width: 6, height: 9 }} />
      <span className={cn('absolute rounded-[2px]', INK_FILL)}
        style={{ left: '50%', marginLeft: -4, top: 50, width: 9, height: 3, transform: 'rotate(-6deg)' }} />
    </>
  );
}

const FACE = {
  calm: CalmFace,
  listening: ListeningFace,
  celebrating: CelebratingFace,
  empathy: EmpathyFace,
  resting: RestingFace,
  thinking: ThinkingFace,
};

function ListeningDecorations() {
  return (
    <>
      <span className="absolute rounded-[2px] bg-accent animate-cloud-eq-1100ms"
        style={{ right: 0, top: 14, width: 4, height: 10 }} />
      <span className="absolute rounded-[2px] bg-accent animate-cloud-eq-1100ms"
        style={{ right: 7, top: 10, width: 4, height: 16, animationDelay: '.2s' }} />
      <span className="absolute rounded-[2px] bg-accent animate-cloud-eq-1100ms"
        style={{ right: 14, top: 13, width: 4, height: 12, animationDelay: '.4s' }} />
    </>
  );
}

function RestingDecorations() {
  return (
    <>
      <span className="absolute font-semibold text-accent animate-cloud-rise-2200ms"
        style={{ right: 10, top: 8, fontSize: 13 }}>z</span>
      <span className="absolute font-semibold animate-cloud-rise-2800ms"
        style={{ right: 2, top: 14, fontSize: 10, color: 'var(--accent-4)', animationDelay: '1.5s' }}>z</span>
    </>
  );
}

function ThinkingDecorations() {
  return (
    <>
      <span className="absolute rounded-full animate-cloud-eq-1200ms"
        style={{ right: 14, top: 16, width: 5, height: 5, background: 'var(--accent-3)' }} />
      <span className="absolute rounded-full animate-cloud-eq-1200ms"
        style={{ right: 5, top: 8, width: 7, height: 7, background: 'var(--accent-4)', animationDelay: '.25s' }} />
      <span className="absolute rounded-full bg-accent animate-cloud-eq-1200ms"
        style={{ right: -3, top: -2, width: 9, height: 9, animationDelay: '.5s' }} />
    </>
  );
}

/**
 * CSS-only Pebble mascot (CLOUD-DESIGN-SPEC.md §6.3). `size` is the blob's
 * rendered width in px (height follows the 88:81 base ratio); everything
 * else is expressed at a fixed base scale and stretched via `transform`, so
 * proportions stay exact at any size.
 */
export const Pebble = forwardRef(({ state = 'calm', size = 88, className, ...props }, ref) => {
  const scale = size / BLOB_W;
  const Face = FACE[state] || FACE.calm;
  const motionClass = MOTION_CLASS[state] || MOTION_CLASS.calm;

  return (
    <div
      ref={ref}
      data-pebble-state={state}
      role="img"
      aria-label={`Pebble — ${state}`}
      className={cn('relative inline-block', className)}
      style={{ width: BASE_W * scale, height: BASE_H * scale }}
      {...props}
    >
      <div
        className="absolute origin-top-left"
        style={{ width: BASE_W, height: BASE_H, transform: `scale(${scale})` }}
      >
        {state === 'listening' && <ListeningDecorations />}
        {state === 'celebrating' && <ConfettiPips count={4} />}
        {state === 'resting' && <RestingDecorations />}
        {state === 'thinking' && <ThinkingDecorations />}

        <div
          className="absolute"
          style={{
            left: BLOB_LEFT,
            bottom: BLOB_BOTTOM,
            width: BLOB_W,
            height: BLOB_H,
            // Empathy's static -5deg lean lives on this outer wrapper so it
            // doesn't fight with the inner element's animated `transform`
            // (breathe's scale()) — see spec §6.3.
            transform: state === 'empathy' ? 'rotate(-5deg)' : undefined,
          }}
        >
          <div
            className={cn('relative h-full w-full shadow-soft', BLOB_RECIPE_CLASS, motionClass)}
            style={BLOB_STYLE}
          >
            <Face />
          </div>
        </div>
      </div>
    </div>
  );
});
Pebble.displayName = 'Pebble';

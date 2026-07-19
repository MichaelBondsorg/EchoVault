import { forwardRef } from 'react';
import { cn } from '../../lib/cn';

/**
 * Pill chip — accent-colored text on `bg-accent-wash` (CLOUD-DESIGN-SPEC.md
 * §5). `selected` toggles a filled accent-deep treatment for filter/segment
 * use (e.g. Journal filter chips, selectable tag lists).
 *
 * Visual size stays the compact §5 pill (~28px tall), but the painted box
 * is smaller than the 44px minimum hit target the spec requires for
 * interactive controls. A transparent `::before` overlay (inset -8px on
 * every side) pads the actual tap/click area out to ~44px without
 * inflating the pill's appearance — fixes the sub-44px tap area for any
 * consumer that wires Chip up interactively (e.g. Journal filter chips).
 */
export const Chip = forwardRef(
  ({ className, selected = false, as: Comp = 'span', children, ...props }, ref) => (
    <Comp
      ref={ref}
      className={cn(
        'relative inline-flex min-h-[28px] items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11.5px] font-medium transition-colors',
        'before:absolute before:-inset-2 before:content-[\'\']',
        selected
          ? 'border-accent-deep bg-accent-deep text-background'
          : 'border-border bg-accent-wash text-accent-deep',
        className
      )}
      {...props}
    >
      {children}
    </Comp>
  )
);
Chip.displayName = 'Chip';

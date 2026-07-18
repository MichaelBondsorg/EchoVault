import { forwardRef } from 'react';
import { cn } from '../../lib/cn';

/**
 * Pill chip — accent-colored text on `bg-accent-wash` (CLOUD-DESIGN-SPEC.md
 * §5). `selected` toggles a filled accent-deep treatment for filter/segment
 * use (e.g. Journal filter chips, selectable tag lists).
 */
export const Chip = forwardRef(
  ({ className, selected = false, as: Comp = 'span', children, ...props }, ref) => (
    <Comp
      ref={ref}
      className={cn(
        'inline-flex min-h-[28px] items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11.5px] font-medium transition-colors',
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

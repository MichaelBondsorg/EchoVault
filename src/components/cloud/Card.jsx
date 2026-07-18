import { forwardRef } from 'react';
import { cn } from '../../lib/cn';

/**
 * Cloud primitive: grouped-list surface. Radius 16 (rounded-2xl), 1px
 * border, shadow-sm — see CLOUD-DESIGN-SPEC.md §5.
 */
export const Card = forwardRef(({ className, children, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('rounded-2xl border border-border bg-card shadow-sm', className)}
    {...props}
  >
    {children}
  </div>
));
Card.displayName = 'Card';

/**
 * A single row inside a Card, separated from the next row by a hairline
 * (`border-divider`). Use `last:border-b-0` behavior is built in so the
 * final row in a group doesn't render a trailing divider.
 */
export const CardRow = forwardRef(({ className, children, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'flex items-center justify-between gap-3 border-b border-divider px-4 py-3 last:border-b-0',
      className
    )}
    {...props}
  >
    {children}
  </div>
));
CardRow.displayName = 'CardRow';

import { forwardRef } from 'react';
import { cn } from '../../lib/cn';

/**
 * §4 "Section label" type role: Geist 600, 11px, uppercase, +0.1em tracking,
 * `--muted-foreground`. Used above grouped Card lists (Settings sections,
 * etc).
 */
export const SectionLabel = forwardRef(({ className, children, ...props }, ref) => (
  <p
    ref={ref}
    className={cn(
      'text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground',
      className
    )}
    {...props}
  >
    {children}
  </p>
));
SectionLabel.displayName = 'SectionLabel';

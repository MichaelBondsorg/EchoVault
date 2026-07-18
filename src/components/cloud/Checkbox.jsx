import { forwardRef } from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';
import { cn } from '../../lib/cn';

/**
 * CLOUD-DESIGN-SPEC.md §5: radius 6, checked = `--accent`. Rendered inside
 * a 44px hit area so the visually small box still meets the min tap target.
 */
export const Checkbox = forwardRef(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      'group flex h-11 w-11 shrink-0 items-center justify-center',
      'disabled:opacity-50 disabled:pointer-events-none',
      className
    )}
    {...props}
  >
    <span className="pointer-events-none flex h-5 w-5 items-center justify-center rounded-md border border-border bg-card transition-colors group-data-[state=checked]:border-accent group-data-[state=checked]:bg-accent">
      <CheckboxPrimitive.Indicator className="text-background">
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </span>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = 'Checkbox';

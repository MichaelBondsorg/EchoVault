import { forwardRef } from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cn } from '../../lib/cn';

/**
 * Cloud toggle. Root provides a full 44px hit area (min hit target); the
 * visible track (24px tall) sits centered inside it. Checked track =
 * `bg-accent` per CLOUD-DESIGN-SPEC.md §5.
 */
export const Switch = forwardRef(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      'group inline-flex h-11 w-11 shrink-0 items-center justify-center',
      'disabled:opacity-50 disabled:pointer-events-none',
      className
    )}
    {...props}
  >
    <span className="pointer-events-none relative inline-flex h-6 w-11 items-center rounded-full bg-border transition-colors group-data-[state=checked]:bg-accent">
      <SwitchPrimitive.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-card dark:bg-foreground shadow-sm transition-transform data-[state=checked]:translate-x-[22px]" />
    </span>
  </SwitchPrimitive.Root>
));
Switch.displayName = 'Switch';

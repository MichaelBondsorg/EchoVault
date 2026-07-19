import { forwardRef } from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '../../lib/cn';

// CLOUD-DESIGN-SPEC.md §5 + mockups (Insights Week/Month segment): pill
// list container (`bg-card border border-border rounded-full p-1`),
// active trigger = `bg-accent-deep text-background rounded-full`.
export const Tabs = TabsPrimitive.Root;

export const TabsList = forwardRef(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      'inline-flex items-center gap-0.5 rounded-full border border-border bg-card p-1',
      className
    )}
    {...props}
  />
));
TabsList.displayName = 'TabsList';

// 44px hit target (spec §7/§5 minimum): the visual pill stays the
// compact 32px-tall segment shown in the mockup, padded to a 44px-tall
// tap area via a `::before` overlay — vertical-only (`inset-x-0`, no
// horizontal inset). The pill's own px-3.5 padding + label text already
// puts its *width* comfortably over 44px, so only height needs padding;
// keeping the inset vertical-only means adjacent triggers' hit-boxes
// never encroach on each other sideways, however tight TabsList's own
// gap is (no overlapping-target risk to manage there).
export const TabsTrigger = forwardRef(({ className, children, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'relative min-h-[32px] rounded-full px-3.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors',
      "before:absolute before:inset-x-0 before:-top-1.5 before:-bottom-1.5 before:content-['']",
      'data-[state=active]:bg-accent-deep data-[state=active]:text-background',
      className
    )}
    {...props}
  >
    {children}
  </TabsPrimitive.Trigger>
));
TabsTrigger.displayName = 'TabsTrigger';

export const TabsContent = forwardRef(({ className, ...props }, ref) => (
  <TabsPrimitive.Content ref={ref} className={cn(className)} {...props} />
));
TabsContent.displayName = 'TabsContent';

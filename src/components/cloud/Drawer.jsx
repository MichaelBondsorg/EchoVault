import { forwardRef } from 'react';
import { Drawer as VaulDrawer } from 'vaul';
import { cn } from '../../lib/cn';

// CLOUD-DESIGN-SPEC.md §5/§6: bottom sheet, radius 24 top, 36x4 grab
// handle, `bg-card`, safe-area bottom padding. Built on vaul (Radix Dialog
// underneath), matching the New entry / Day summary / Entry insights sheets.
export const Drawer = VaulDrawer.Root;
export const DrawerTrigger = VaulDrawer.Trigger;
export const DrawerClose = VaulDrawer.Close;
export const DrawerPortal = VaulDrawer.Portal;

// D4a fix: same `bg-[var(--overlay)]` scrim-token swap as Dialog.jsx (see
// its comment for why a Tailwind opacity-modifier suffix on a CSS-var color
// no-ops under this project's Tailwind config) — the previous flat-black
// scrim hardcoded a single color for both themes instead of using the
// per-theme --overlay value.
export const DrawerOverlay = forwardRef(({ className, ...props }, ref) => (
  <VaulDrawer.Overlay ref={ref} className={cn('fixed inset-0 z-50 bg-[var(--overlay)]', className)} {...props} />
));
DrawerOverlay.displayName = 'DrawerOverlay';

export const DrawerContent = forwardRef(({ className, children, ...props }, ref) => (
  <VaulDrawer.Portal>
    <DrawerOverlay data-testid="drawer-overlay" />
    <VaulDrawer.Content
      ref={ref}
      className={cn(
        'fixed inset-x-0 bottom-0 z-50 flex max-h-[92vh] flex-col rounded-t-[24px]',
        'border border-b-0 border-border bg-card px-5 pb-[max(env(safe-area-inset-bottom),20px)] pt-2.5 shadow-soft-lg',
        className
      )}
      {...props}
    >
      <div className="mx-auto mb-3 h-1 w-9 shrink-0 rounded-full bg-border" aria-hidden="true" />
      {children}
    </VaulDrawer.Content>
  </VaulDrawer.Portal>
));
DrawerContent.displayName = 'DrawerContent';

export const DrawerTitle = forwardRef(({ className, ...props }, ref) => (
  <VaulDrawer.Title ref={ref} className={cn('text-sm font-semibold text-foreground', className)} {...props} />
));
DrawerTitle.displayName = 'DrawerTitle';

export const DrawerDescription = forwardRef(({ className, ...props }, ref) => (
  <VaulDrawer.Description ref={ref} className={cn('text-xs text-muted-foreground', className)} {...props} />
));
DrawerDescription.displayName = 'DrawerDescription';

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

// 2026-07-24 capture-sheet fix (Fix A) — DrawerContent primitive contract:
// bounded + overflow-hidden, with the grab handle as fixed chrome
// (`shrink-0`); the body a caller renders as `children` is a *caller-owned*
// viewport — this primitive does not force-wrap it in a scroll container,
// since not every Drawer body needs to scroll (see ReceiptSheet/
// EntryInsightsPopup/DaySummaryModal, which already add their own
// `overflow-y-auto` region at a fixed max-height for their scrollable
// section). Before this fix, DrawerContent had no `overflow` set at all, so
// content taller than `max-h-[92vh]` spilled past the sheet's rounded edge
// instead of clipping/scrolling — this is UI-1's "no reliable internal
// overflow behavior" root cause.
//
// dvh fallback mechanism: `92dvh` tracks iOS's dynamic visual viewport more
// reliably than static `vh` (the address bar/keyboard resize `dvh`, not
// `vh`), but needs a fallback for WebViews that don't support the `dvh`
// unit. `supports-[height:100dvh]:max-h-[92dvh]` compiles (verified against
// this repo's Tailwind 3.4.18 build output) to a real
// `@supports (height:100dvh) { .supports-\[height\:100dvh\]\:max-h-\[92dvh\] { max-height: 92dvh } }`
// block placed after the unconditional `.max-h-\[92vh\]` rule — a browser
// without `dvh` support never evaluates the dvh declaration at all (its
// `@supports` guard is false), so `92vh` remains in effect; a browser that
// does support it gets `92dvh` via ordinary cascade (later rule of equal
// specificity wins). This deliberately avoids the "just put `max-h-[92vh]`
// before `max-h-[92dvh]` in the className string" idiom some Tailwind docs
// suggest — verified empirically that this project's Tailwind JIT does NOT
// preserve className-string order for two plain arbitrary-value utilities
// of the same property (it emits `92dvh`'s rule before `92vh`'s regardless
// of source order), which would make `92vh` win even in browsers that
// support `dvh` — the opposite of the intended fallback. The
// `supports-[...]:` variant sidesteps that because it's a real feature
// query, not a same-specificity ordering bet.
export const DrawerContent = forwardRef(({ className, children, ...props }, ref) => (
  <VaulDrawer.Portal>
    <DrawerOverlay data-testid="drawer-overlay" />
    <VaulDrawer.Content
      ref={ref}
      className={cn(
        'fixed inset-x-0 bottom-0 z-50 flex max-h-[92vh] supports-[height:100dvh]:max-h-[92dvh] flex-col overflow-hidden rounded-t-[24px]',
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

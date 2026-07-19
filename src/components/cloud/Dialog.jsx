import { forwardRef } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';

// CLOUD-DESIGN-SPEC.md §5: Quick mood + similar centered modals. Radius
// 22, overlay `bg-[var(--overlay)]` (40% foreground scrim, dark-safe per
// cloud-tokens.css's per-theme --overlay value). D4a fix: the A4-era
// opacity-modifier overlay class and the interim flat-black scrim workaround
// from commit 3565183 both no-op or hardcode a single-theme color — Tailwind
// 3.4 can't compute an alpha channel for a color declared as a plain
// `var(--x)` string (no `rgb(var(...) / <alpha-value>)` wrapper) in
// tailwind.config.js, so any Tailwind opacity-modifier suffix on a
// CSS-var-backed color silently compiles to no color output at all. The
// real token — already used by C6's delete-confirm and D3's crisis
// soft-block — is the fix.
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogPortal = DialogPrimitive.Portal;

export const DialogOverlay = forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay ref={ref} className={cn('fixed inset-0 z-50 bg-[var(--overlay)]', className)} {...props} />
));
DialogOverlay.displayName = 'DialogOverlay';

export const DialogContent = forwardRef(({ className, children, showClose = true, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogOverlay data-testid="dialog-overlay" />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed left-1/2 top-1/2 z-50 w-[calc(100%-2.5rem)] max-w-sm -translate-x-1/2 -translate-y-1/2',
        'rounded-[22px] border border-border bg-card p-5 shadow-soft-lg',
        className
      )}
      {...props}
    >
      {children}
      {showClose && (
        <DialogPrimitive.Close
          className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-divider"
          aria-label="Close"
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DialogContent.displayName = 'DialogContent';

export const DialogTitle = forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn('font-display text-lg text-foreground', className)} {...props} />
));
DialogTitle.displayName = 'DialogTitle';

export const DialogDescription = forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn('text-sm text-secondary-foreground', className)} {...props} />
));
DialogDescription.displayName = 'DialogDescription';

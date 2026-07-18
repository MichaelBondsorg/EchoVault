import { forwardRef } from 'react';
import { cn } from '../../lib/cn';

// CLOUD-DESIGN-SPEC.md §5: primary CTA = pill, 44-52px tall, --primary bg,
// soft shadow. Secondary CTA = outline variant (white/card bg, --border).
const VARIANTS = {
  primary: 'bg-primary text-primary-foreground shadow-soft hover:opacity-90',
  outline: 'bg-card border border-border text-foreground hover:bg-divider',
  ghost: 'bg-transparent text-foreground hover:bg-divider',
};

const SIZES = {
  default: 'min-h-[44px] px-6 text-sm',
  lg: 'min-h-[52px] px-8 text-base',
};

export const Button = forwardRef(
  ({ className, variant = 'primary', size = 'default', type = 'button', children, ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-colors',
        'disabled:opacity-50 disabled:pointer-events-none',
        VARIANTS[variant] || VARIANTS.primary,
        SIZES[size] || SIZES.default,
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
);
Button.displayName = 'Button';

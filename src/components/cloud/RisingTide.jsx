import { forwardRef } from 'react';
import { cn } from '../../lib/cn';
import { Card } from './Card';

/**
 * "Rising tide" momentum stat widget (CLOUD-DESIGN-SPEC.md §6.2): two
 * absolutely-positioned rounded squares in accent at low opacity, rotating
 * at different speeds (one reversed) behind the content slot. Reuses the
 * existing `cloud-spin` keyframes/utilities from cloud-motion.css.
 */
export const RisingTide = forwardRef(({ className, children, ...props }, ref) => (
  <Card ref={ref} className={cn('relative overflow-hidden', className)} {...props}>
    <span
      aria-hidden="true"
      data-testid="rising-tide-ring-outer"
      className="absolute animate-cloud-spin-12s"
      style={{
        left: '-90%',
        top: '54%',
        width: '280%',
        aspectRatio: '1',
        borderRadius: '44%',
        background: 'var(--accent)',
        opacity: 0.22,
      }}
    />
    <span
      aria-hidden="true"
      data-testid="rising-tide-ring-inner"
      className="absolute animate-cloud-spin-17s-reverse"
      style={{
        left: '-100%',
        top: '62%',
        width: '300%',
        aspectRatio: '1',
        borderRadius: '40%',
        background: 'var(--accent)',
        opacity: 0.14,
      }}
    />
    <div className="relative z-10">{children}</div>
  </Card>
));
RisingTide.displayName = 'RisingTide';

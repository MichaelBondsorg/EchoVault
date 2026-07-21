import { useEffect, useRef } from 'react';

/**
 * useDismissablePopover — shared outside-tap + Escape dismissal for small
 * inline popovers (e.g. EntryBar's SpacePill / EntryCard's SpaceChip Space
 * pickers, plan R1 Task 9 review fix). Returns a ref to attach to the
 * popover's outermost container (trigger + panel together) — a pointerdown
 * anywhere outside that element, or an Escape keypress anywhere, calls
 * `onDismiss`. Listeners are only attached while `open` is true, so closed
 * popovers cost nothing.
 *
 * Deliberately does NOT toggle — a click on the trigger itself is "inside"
 * the container, so the trigger's own onClick handler stays the single
 * source of truth for opening/toggling; this hook only ever closes.
 *
 * @param {boolean} open
 * @param {() => void} onDismiss
 * @returns {import('react').RefObject<HTMLElement>}
 */
export function useDismissablePopover(open, onDismiss) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        onDismiss();
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onDismiss();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onDismiss]);

  return containerRef;
}

export default useDismissablePopover;

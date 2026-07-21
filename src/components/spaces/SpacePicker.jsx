import React from 'react';

/**
 * SpacePicker — shared Context Space picker popover (PRD R2 Task 4).
 * Extracted from the three near-identical `role="listbox"` popovers that
 * shipped in R1 (EntryBar's `SpacePill`, EntryCard's `SpaceChip`,
 * UnifiedConversation's inline Ask Journal scope selector — all Context
 * Spaces, plan task 9/11) so there's one place that owns the option-list
 * markup instead of three copies.
 *
 * Deliberately presentational-only: renders ONLY the popover's option
 * list, not the trigger button and not the open/close or outside-tap/
 * Escape dismissal wiring. Each call site keeps its own trigger button
 * and its own `useDismissablePopover` call on the `relative` wrapper that
 * contains BOTH the trigger and this component. That wrapper is what
 * makes "click the trigger again to close" register as an inside click
 * rather than an outside dismiss (see useDismissablePopover.js's doc
 * comment: the ref must contain the trigger). If this component owned
 * that hook itself, its own DOM node would only ever contain the option
 * list — never the caller's external trigger — and clicking the trigger
 * to close an already-open popover would race an "outside" pointerdown
 * against the trigger's own onClick toggle. So: the caller owns
 * open/close state, the wrapping ref, and dismissal; this component only
 * ever renders the option list, conditionally, when the caller decides
 * it's open.
 *
 * Visual classes are byte-identical to the R1 markup (all three sites
 * agreed on everything except default-label text, selection-prop shape,
 * and popover alignment) — this is a refactor, not a redesign.
 *
 * Selection contract: `onSelect(spaceIdOrNull)` — the default option
 * always calls `onSelect(null)`, never `undefined` and never omitted.
 */
const SpacePicker = ({
  spaces,
  selectedSpaceId,
  onSelect,
  defaultLabel,
  align = 'left',
  ariaLabel = 'Choose a space',
}) => {
  return (
    <div
      role="listbox"
      aria-label={ariaLabel}
      className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} z-40 mt-1 min-w-[140px] rounded-xl border border-border bg-card p-1 shadow-soft-lg`}
    >
      <button
        type="button"
        role="option"
        aria-selected={selectedSpaceId == null}
        onClick={() => onSelect(null)}
        className={`block w-full rounded-lg px-2 py-1.5 text-left text-xs ${selectedSpaceId == null ? 'bg-accent-wash text-accent-deep' : 'text-secondary-foreground hover:bg-divider'}`}
      >
        {defaultLabel}
      </button>
      {spaces.map((space) => (
        <button
          key={space.id}
          type="button"
          role="option"
          aria-selected={space.id === selectedSpaceId}
          onClick={() => onSelect(space.id)}
          className={`block w-full rounded-lg px-2 py-1.5 text-left text-xs ${space.id === selectedSpaceId ? 'bg-accent-wash text-accent-deep' : 'text-secondary-foreground hover:bg-divider'}`}
        >
          {space.name}
        </button>
      ))}
    </div>
  );
};

export default SpacePicker;

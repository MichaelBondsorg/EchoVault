import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SpacePicker from '../SpacePicker';

/**
 * SpacePicker — shared Context Space picker popover (R2 Task 4). Extracted
 * from the three near-identical `role="listbox"` popovers in EntryBar's
 * SpacePill, EntryCard's SpaceChip, and UnifiedConversation's inline Ask
 * Journal scope selector (R1 Context Spaces). This suite locks the
 * presentational contract: exact option set, exact selection payloads,
 * exact visual classes (byte-parity with the R1 markup), and the
 * per-site knobs (default label text, alignment, accessible name) that
 * differed across the three call sites.
 */
const spaces = [
  { id: 'space-1', name: 'Work' },
  { id: 'space-2', name: 'Personal' },
];

describe('SpacePicker — option list', () => {
  it('renders the default-label option plus every space as listbox options', () => {
    render(<SpacePicker spaces={spaces} selectedSpaceId={null} onSelect={vi.fn()} defaultLabel="No space" />);
    expect(screen.getByRole('option', { name: 'No space' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Work' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Personal' })).toBeTruthy();
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });

  it('uses the caller-supplied default label text (e.g. "All spaces")', () => {
    render(<SpacePicker spaces={spaces} selectedSpaceId={null} onSelect={vi.fn()} defaultLabel="All spaces" />);
    expect(screen.getByRole('option', { name: 'All spaces' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'No space' })).toBeNull();
  });

  it('renders only the default option when spaces is empty', () => {
    render(<SpacePicker spaces={[]} selectedSpaceId={null} onSelect={vi.fn()} defaultLabel="No space" />);
    expect(screen.getAllByRole('option')).toHaveLength(1);
  });
});

describe('SpacePicker — selection state (aria-selected)', () => {
  it('marks the default option selected when selectedSpaceId is null', () => {
    render(<SpacePicker spaces={spaces} selectedSpaceId={null} onSelect={vi.fn()} defaultLabel="No space" />);
    expect(screen.getByRole('option', { name: 'No space' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: 'Work' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('option', { name: 'Personal' })).toHaveAttribute('aria-selected', 'false');
  });

  it('marks the matching space option selected when selectedSpaceId matches its id', () => {
    render(<SpacePicker spaces={spaces} selectedSpaceId="space-2" onSelect={vi.fn()} defaultLabel="No space" />);
    expect(screen.getByRole('option', { name: 'Personal' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: 'No space' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('option', { name: 'Work' })).toHaveAttribute('aria-selected', 'false');
  });
});

describe('SpacePicker — selection payloads (contract: (spaceIdOrNull) => void)', () => {
  it('calls onSelect(null) — not undefined — when the default option is chosen', () => {
    const onSelect = vi.fn();
    render(<SpacePicker spaces={spaces} selectedSpaceId="space-1" onSelect={onSelect} defaultLabel="No space" />);
    screen.getByRole('option', { name: 'No space' }).click();
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('calls onSelect(spaceId) with the exact id string when a space option is chosen', () => {
    const onSelect = vi.fn();
    render(<SpacePicker spaces={spaces} selectedSpaceId={null} onSelect={onSelect} defaultLabel="No space" />);
    screen.getByRole('option', { name: 'Work' }).click();
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('space-1');
  });
});

describe('SpacePicker — alignment', () => {
  it('defaults to left alignment (left-0) when align is not supplied', () => {
    render(<SpacePicker spaces={spaces} selectedSpaceId={null} onSelect={vi.fn()} defaultLabel="No space" />);
    const listbox = screen.getByRole('listbox');
    expect(listbox.className).toContain('left-0');
    expect(listbox.className).not.toContain('right-0');
  });

  it('renders right-aligned (right-0) when align="right"', () => {
    render(<SpacePicker spaces={spaces} selectedSpaceId={null} onSelect={vi.fn()} defaultLabel="No space" align="right" />);
    const listbox = screen.getByRole('listbox');
    expect(listbox.className).toContain('right-0');
    expect(listbox.className).not.toContain('left-0');
  });
});

describe('SpacePicker — visual class parity with R1 markup', () => {
  it('the listbox container carries the exact R1 classes (left-aligned)', () => {
    render(<SpacePicker spaces={spaces} selectedSpaceId={null} onSelect={vi.fn()} defaultLabel="No space" />);
    expect(screen.getByRole('listbox').className).toBe(
      'absolute left-0 z-40 mt-1 min-w-[140px] rounded-xl border border-border bg-card p-1 shadow-soft-lg'
    );
  });

  it('the listbox container carries the exact R1 classes (right-aligned)', () => {
    render(<SpacePicker spaces={spaces} selectedSpaceId={null} onSelect={vi.fn()} defaultLabel="No space" align="right" />);
    expect(screen.getByRole('listbox').className).toBe(
      'absolute right-0 z-40 mt-1 min-w-[140px] rounded-xl border border-border bg-card p-1 shadow-soft-lg'
    );
  });

  it('selected vs unselected options carry the exact R1 classes', () => {
    render(<SpacePicker spaces={spaces} selectedSpaceId="space-1" onSelect={vi.fn()} defaultLabel="No space" />);
    expect(screen.getByRole('option', { name: 'Work' }).className).toBe(
      'block w-full rounded-lg px-2 py-1.5 text-left text-xs bg-accent-wash text-accent-deep'
    );
    expect(screen.getByRole('option', { name: 'Personal' }).className).toBe(
      'block w-full rounded-lg px-2 py-1.5 text-left text-xs text-secondary-foreground hover:bg-divider'
    );
  });
});

describe('SpacePicker — accessible name', () => {
  it('defaults the accessible name to "Choose a space" when ariaLabel is not supplied', () => {
    render(<SpacePicker spaces={spaces} selectedSpaceId={null} onSelect={vi.fn()} defaultLabel="No space" />);
    expect(screen.getByRole('listbox', { name: 'Choose a space' })).toBeTruthy();
  });

  it('uses a caller-supplied ariaLabel (e.g. Ask Journal scope wording)', () => {
    render(
      <SpacePicker
        spaces={spaces}
        selectedSpaceId={null}
        onSelect={vi.fn()}
        defaultLabel="All spaces"
        ariaLabel="Choose Ask Journal scope"
      />
    );
    expect(screen.getByRole('listbox', { name: 'Choose Ask Journal scope' })).toBeTruthy();
  });
});

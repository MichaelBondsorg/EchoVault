import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import GlassCard from '../GlassCard';

/**
 * A11Y-02: GlassCard is the shared Bento-widget wrapper. Several Home
 * widgets (NexusInsightsWidget's tap-to-navigate card, post-INS-01) pass it
 * `interactive` + `onClick` and relied on it being a plain clickable div —
 * no keyboard equivalent, no announced role. These tests pin the fix at the
 * shared-component level so every current and future `interactive`+`onClick`
 * consumer gets it for free.
 */
describe('GlassCard - A11Y-02: keyboard/role semantics for interactive+onClick cards', () => {
  it('renders role="button" and tabIndex=0 when interactive and onClick are both supplied', () => {
    render(
      <GlassCard interactive onClick={() => {}}>
        content
      </GlassCard>
    );
    const card = screen.getByRole('button');
    expect(card.getAttribute('tabindex')).toBe('0');
  });

  it('Enter activates the card exactly like a click', () => {
    const onClick = vi.fn();
    render(
      <GlassCard interactive onClick={onClick}>
        content
      </GlassCard>
    );
    const card = screen.getByRole('button');
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('Space activates the card exactly like a click', () => {
    const onClick = vi.fn();
    render(
      <GlassCard interactive onClick={onClick}>
        content
      </GlassCard>
    );
    const card = screen.getByRole('button');
    fireEvent.keyDown(card, { key: ' ' });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('a real click still works unchanged', () => {
    const onClick = vi.fn();
    render(
      <GlassCard interactive onClick={onClick}>
        content
      </GlassCard>
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not get role="button"/tabIndex when there is no onClick (most GlassCard usages)', () => {
    const { container } = render(<GlassCard interactive>content</GlassCard>);
    expect(container.querySelector('[role="button"]')).toBeNull();
    expect(container.firstChild.getAttribute('tabindex')).toBeNull();
  });

  it('does not get role="button"/tabIndex when not interactive, even with onClick present', () => {
    const { container } = render(<GlassCard onClick={() => {}}>content</GlassCard>);
    expect(container.querySelector('[role="button"]')).toBeNull();
  });

  it('is inert (no role/tabIndex, no key activation) while isEditing', () => {
    const onClick = vi.fn();
    const { container } = render(
      <GlassCard interactive isEditing onClick={onClick}>
        content
      </GlassCard>
    );
    expect(container.querySelector('[role="button"]')).toBeNull();
  });
});

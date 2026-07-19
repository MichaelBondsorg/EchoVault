/**
 * Render coverage for StreakCelebration (Task D4b, CLOUD-DESIGN-SPEC.md §7
 * "Streak celebration" / mockup 10a).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import StreakCelebration from '../StreakCelebration';

afterEach(() => cleanup());

describe('StreakCelebration', () => {
  it('renders the templated headline with the current streak length', () => {
    render(<StreakCelebration currentStreak={8} previousBest={7} onClose={vi.fn()} onShareWithTherapist={vi.fn()} />);
    expect(screen.getByText(/8 days\./)).toBeTruthy();
    expect(screen.getByText(/A new personal best\./)).toBeTruthy();
  });

  it('renders a celebrating Pebble', () => {
    const { container } = render(
      <StreakCelebration currentStreak={8} previousBest={7} onClose={vi.fn()} onShareWithTherapist={vi.fn()} />
    );
    expect(container.querySelector('[data-pebble-state="celebrating"]')).toBeTruthy();
  });

  it('renders one dot per streak day, with only the last (record) dot ringed', () => {
    const { container } = render(
      <StreakCelebration currentStreak={5} previousBest={4} onClose={vi.fn()} onShareWithTherapist={vi.fn()} />
    );
    const dots = container.querySelectorAll('.rounded-full.bg-accent, .rounded-full.bg-accent-deep');
    expect(dots.length).toBe(5);
    const ringed = Array.from(dots).filter((d) => d.style.boxShadow);
    expect(ringed.length).toBe(1);
    expect(ringed[0]).toBe(dots[dots.length - 1]);
  });

  it('shows "previous best" only when there is a nonzero prior record', () => {
    const { rerender } = render(
      <StreakCelebration currentStreak={3} previousBest={0} onClose={vi.fn()} onShareWithTherapist={vi.fn()} />
    );
    expect(screen.queryByText(/previous best/)).toBeNull();

    rerender(<StreakCelebration currentStreak={3} previousBest={2} onClose={vi.fn()} onShareWithTherapist={vi.fn()} />);
    expect(screen.getByText(/previous best: 2/)).toBeTruthy();
  });

  it('the "Keep it going" CTA and close button both call onClose', () => {
    const onClose = vi.fn();
    render(<StreakCelebration currentStreak={4} previousBest={2} onClose={onClose} onShareWithTherapist={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /keep it going/i }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('the "Share with my therapist" link calls onShareWithTherapist', () => {
    const onShareWithTherapist = vi.fn();
    render(
      <StreakCelebration
        currentStreak={4}
        previousBest={2}
        onClose={vi.fn()}
        onShareWithTherapist={onShareWithTherapist}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /share with my therapist/i }));
    expect(onShareWithTherapist).toHaveBeenCalledTimes(1);
  });
});

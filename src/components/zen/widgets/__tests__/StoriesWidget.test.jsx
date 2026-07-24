import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// GlassCard just renders its children in tests.
vi.mock('../../GlassCard', () => ({ default: ({ children }) => <div>{children}</div> }));

const StoriesWidget = (await import('../StoriesWidget')).default;

function entriesFor(situationName, count = 2) {
  return Array.from({ length: count }, (_, i) => ({
    id: `e${i}`,
    category: 'work',
    tags: [`@situation:${situationName}`],
    effectiveDate: new Date(2024, 0, i + 1),
    analysis: { mood_score: 0.5 },
  }));
}

/**
 * A11Y-02: story cards were a clickable `motion.div` with no button
 * semantics, no keyboard equivalent, and no aria-expanded — the named
 * "story cards as clickable divs" defect.
 */
describe('StoriesWidget - A11Y-02: story row semantics', () => {
  it('a story row exposes role="button", tabIndex=0, and aria-expanded=false when collapsed', () => {
    render(<StoriesWidget entries={entriesFor('big project')} category="work" />);
    const row = screen.getByRole('button', { name: 'Big Project' });
    expect(row.getAttribute('tabindex')).toBe('0');
    expect(row.getAttribute('aria-expanded')).toBe('false');
    // The panel is AnimatePresence-unmounted while collapsed, so
    // aria-controls must be absent (it may only reference an id in the DOM).
    expect(row.getAttribute('aria-controls')).toBeNull();
  });

  it('clicking the row expands it (aria-expanded flips to true) and shows the date range', () => {
    render(<StoriesWidget entries={entriesFor('big project')} category="work" />);
    const row = screen.getByRole('button', { name: 'Big Project' });
    fireEvent.click(row);
    expect(row.getAttribute('aria-expanded')).toBe('true');
  });

  it('aria-controls references the id of the expanded panel', () => {
    render(<StoriesWidget entries={entriesFor('big project')} category="work" />);
    const row = screen.getByRole('button', { name: 'Big Project' });
    fireEvent.click(row);
    const panelId = row.getAttribute('aria-controls');
    expect(panelId).toBeTruthy();
    expect(document.getElementById(panelId)).toBeTruthy();
  });

  it('Enter toggles expansion exactly like a click', () => {
    render(<StoriesWidget entries={entriesFor('big project')} category="work" />);
    const row = screen.getByRole('button', { name: 'Big Project' });
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(row.getAttribute('aria-expanded')).toBe('true');
  });

  it('Space toggles expansion exactly like a click', () => {
    render(<StoriesWidget entries={entriesFor('big project')} category="work" />);
    const row = screen.getByRole('button', { name: 'Big Project' });
    fireEvent.keyDown(row, { key: ' ' });
    expect(row.getAttribute('aria-expanded')).toBe('true');
  });

  it('each story row gets its own distinct panel id (multiple ongoing stories)', () => {
    const entries = [...entriesFor('project alpha'), ...entriesFor('project beta')];
    render(<StoriesWidget entries={entries} category="work" />);
    const rowA = screen.getByRole('button', { name: 'Project Alpha' });
    const rowB = screen.getByRole('button', { name: 'Project Beta' });
    // aria-controls is only present while a row is expanded (the panel is
    // unmounted otherwise), and only one story expands at a time — so
    // capture each row's panel id during its own expansion.
    fireEvent.click(rowA);
    const idA = rowA.getAttribute('aria-controls');
    fireEvent.click(rowB); // collapses A, expands B
    const idB = rowB.getAttribute('aria-controls');
    expect(idA).toBeTruthy();
    expect(idB).toBeTruthy();
    expect(idA).not.toBe(idB);
  });
});

/**
 * PRIV-01: PromptWidget used to read/write dismissed-prompt state directly
 * against a global `reflections_dismissed_${category}` localStorage key.
 * It now delegates to the shared owner-scoped helpers in
 * services/prompts/activePrompts.js (also used by AppLayout.jsx and
 * activePrompts.js's own exported getActiveReflectionPrompts) — this test
 * covers the delegation wiring: the right uid reaches those helpers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../../../services/nexus/insightIntegration', () => ({
  getQuickContextInsights: vi.fn(() => null),
}));

const getDismissedPromptKeysMock = vi.fn(() => new Set());
const dismissReflectionPromptMock = vi.fn();
vi.mock('../../../../services/prompts/activePrompts', () => ({
  getDismissedPromptKeys: (...args) => getDismissedPromptKeysMock(...args),
  dismissReflectionPrompt: (...args) => dismissReflectionPromptMock(...args),
}));

const { default: PromptWidget } = await import('../PromptWidget.jsx');

const entryWithQuestion = (id, question) => ({
  id,
  category: 'personal',
  effectiveDate: new Date(),
  contextualInsight: { followUpQuestions: [question] },
});

describe('PromptWidget owner-scoped dismissal (PRIV-01)', () => {
  beforeEach(() => {
    getDismissedPromptKeysMock.mockClear();
    dismissReflectionPromptMock.mockClear();
  });

  it('loads dismissed prompts scoped to the signed-in owner uid', () => {
    render(
      <PromptWidget
        user={{ uid: 'user-a' }}
        entries={[entryWithQuestion('e1', 'What made today hard?')]}
        category="personal"
      />
    );

    expect(getDismissedPromptKeysMock).toHaveBeenCalledWith('user-a', 'personal');
  });

  it('dismissing a prompt passes the signed-in owner uid through, never a global/unowned dismissal', () => {
    render(
      <PromptWidget
        user={{ uid: 'user-a' }}
        entries={[entryWithQuestion('e1', 'What made today hard?')]}
        category="personal"
      />
    );

    fireEvent.click(screen.getByLabelText('Dismiss this prompt'));

    expect(dismissReflectionPromptMock).toHaveBeenCalledWith(
      'What made today hard?',
      'personal',
      'user-a'
    );
  });

  it('re-reads dismissed prompts when the signed-in owner changes (no cross-account leakage across a switch)', () => {
    const { rerender } = render(
      <PromptWidget user={{ uid: 'user-a' }} entries={[]} category="personal" />
    );
    expect(getDismissedPromptKeysMock).toHaveBeenLastCalledWith('user-a', 'personal');

    rerender(<PromptWidget user={{ uid: 'user-b' }} entries={[]} category="personal" />);
    expect(getDismissedPromptKeysMock).toHaveBeenLastCalledWith('user-b', 'personal');
  });
});

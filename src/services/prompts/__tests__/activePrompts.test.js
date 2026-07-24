import { describe, it, expect, beforeEach } from 'vitest';

// setup.js replaces window.localStorage with plain vi.fn() no-op stubs;
// drive it with an in-memory Map (established convention).
let store;
function wireLocalStorage() {
  store = new Map();
  localStorage.getItem.mockImplementation((key) => (store.has(key) ? store.get(key) : null));
  localStorage.setItem.mockImplementation((key, value) => { store.set(key, String(value)); });
  localStorage.removeItem.mockImplementation((key) => { store.delete(key); });
}

const { getActiveReflectionPrompts, dismissReflectionPrompt, getDismissedPromptKeys } = await import('../activePrompts.js');

const LEGACY_KEY = (category) => `reflections_dismissed_${category}`;

const entryWithQuestion = (id, question, daysAgo = 1) => ({
  id,
  category: 'personal',
  createdAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
  contextualInsight: { followUpQuestions: [question] },
});

describe('activePrompts.js owner-scoped dismissed-prompt state (PRIV-01)', () => {
  beforeEach(() => {
    wireLocalStorage();
  });

  it('dismissReflectionPrompt writes under an owner-scoped key, never the legacy global one', () => {
    dismissReflectionPrompt('What made today hard?', 'personal', 'user-a');

    expect(store.has(LEGACY_KEY('personal'))).toBe(false);
    const keys = [...store.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0]).toContain('user-a');
  });

  it('no-ops (fails closed) without an owner uid — never writes to an unowned key', () => {
    dismissReflectionPrompt('What made today hard?', 'personal', undefined);

    expect(store.size).toBe(0);
  });

  it('owner As dismissal is invisible to owner B', () => {
    const entries = [entryWithQuestion('e1', 'What made today hard?')];

    dismissReflectionPrompt('What made today hard?', 'personal', 'user-a');

    const promptsA = getActiveReflectionPrompts(entries, 'personal', 'user-a');
    const promptsB = getActiveReflectionPrompts(entries, 'personal', 'user-b');

    expect(promptsA).not.toContain('What made today hard?');
    expect(promptsB).toContain('What made today hard?');
  });

  it('quarantines a pre-migration legacy global value on a scoped miss — never adopted by any owner', () => {
    store.set(LEGACY_KEY('personal'), JSON.stringify(['what made today hard?']));

    const keys = getDismissedPromptKeys('user-a', 'personal');

    expect(keys.size).toBe(0);
    expect(store.has(LEGACY_KEY('personal'))).toBe(false);
  });

  it('getActiveReflectionPrompts treats every question as active when no uid is available (fails open on read, never fails closed by hiding content)', () => {
    const entries = [entryWithQuestion('e1', 'What made today hard?')];
    const prompts = getActiveReflectionPrompts(entries, 'personal', undefined);

    expect(prompts).toContain('What made today hard?');
  });
});

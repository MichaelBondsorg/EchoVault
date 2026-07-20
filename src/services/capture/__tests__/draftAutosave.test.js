import { describe, it, expect, beforeEach } from 'vitest';
import { restoreDraft, writeDraft, clearDraft } from '../draftAutosave';

beforeEach(() => {
  const store = new Map();
  localStorage.getItem.mockImplementation((k) => (store.has(k) ? store.get(k) : null));
  localStorage.setItem.mockImplementation((k, v) => { store.set(k, String(v)); });
  localStorage.removeItem.mockImplementation((k) => { store.delete(k); });
});

describe('draftAutosave', () => {
  it('writes and restores an owner-scoped draft', () => {
    writeDraft('entry_draft', 'user-a', 'hello world');
    expect(restoreDraft('entry_draft', 'user-a')).toBe('hello world');
  });

  it('scopes keys per owner — writing for one owner does not leak to another', () => {
    writeDraft('entry_draft', 'user-a', 'a-draft');
    expect(restoreDraft('entry_draft', 'user-b')).toBe('');
  });

  it('scopes keys per prefix — entry and quicklog drafts do not collide', () => {
    writeDraft('entry_draft', 'user-a', 'entry text');
    writeDraft('quicklog_draft', 'user-a', 'quicklog text');
    expect(restoreDraft('entry_draft', 'user-a')).toBe('entry text');
    expect(restoreDraft('quicklog_draft', 'user-a')).toBe('quicklog text');
  });

  it('writing an empty value clears the key', () => {
    writeDraft('entry_draft', 'user-a', 'something');
    writeDraft('entry_draft', 'user-a', '');
    expect(restoreDraft('entry_draft', 'user-a')).toBe('');
  });

  it('clearDraft removes the key', () => {
    writeDraft('entry_draft', 'user-a', 'something');
    clearDraft('entry_draft', 'user-a');
    expect(restoreDraft('entry_draft', 'user-a')).toBe('');
  });

  it('is a no-op without a uid', () => {
    expect(() => writeDraft('entry_draft', undefined, 'x')).not.toThrow();
    expect(restoreDraft('entry_draft', undefined)).toBe('');
  });
});

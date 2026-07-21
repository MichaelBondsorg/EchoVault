/**
 * R2 Task 16: additive `{returnIds}` / `{returnSources}` options on
 * getSmartChatContext / askJournalAI.
 *
 * These options exist so `runRecipe.js` (the recipe engine) can get real
 * source entry ids back per question without duplicating askJournalAI's
 * context-formatting / callable-invocation logic. The contract under test:
 * omitting the options object (or passing none) MUST preserve the original
 * return shape byte-for-byte — every existing caller (today: only
 * askJournalAI calling getSmartChatContext) is unaffected.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../ai/gemini', () => ({ analyzeJournalEntryCloud: vi.fn() }));
vi.mock('../../../config/firebase', () => ({ askJournalAIFn: vi.fn() }));

const { askJournalAIFn } = await import('../../../config/firebase');
const { getSmartChatContext, askJournalAI } = await import('../index');

function corpus() {
  return [
    { id: 'e1', text: 'First entry', tags: [] },
    { id: 'e2', text: 'Second entry', tags: [] },
  ];
}

describe('getSmartChatContext returnIds option', () => {
  it('default (no options arg) returns the plain entries array, unchanged', async () => {
    const result = await getSmartChatContext(corpus(), 'anything', null, null);
    expect(Array.isArray(result)).toBe(true);
    expect(result.map((e) => e.id).sort()).toEqual(['e1', 'e2']);
  });

  it('{returnIds:false} explicitly also returns the plain array (no wrapper)', async () => {
    const result = await getSmartChatContext(corpus(), 'anything', null, null, { returnIds: false });
    expect(Array.isArray(result)).toBe(true);
  });

  it('{returnIds:true} returns {context, entryIds} where entryIds matches context ids', async () => {
    const result = await getSmartChatContext(corpus(), 'anything', null, null, { returnIds: true });
    expect(result).toHaveProperty('context');
    expect(result).toHaveProperty('entryIds');
    expect(Array.isArray(result.context)).toBe(true);
    expect(result.entryIds.sort()).toEqual(result.context.map((e) => e.id).sort());
    expect(result.entryIds.sort()).toEqual(['e1', 'e2']);
  });
});

describe('askJournalAI returnSources option', () => {
  it('default (no options arg) returns a plain string response, unchanged', async () => {
    askJournalAIFn.mockResolvedValue({ data: { response: 'plain answer' } });
    const result = await askJournalAI(corpus(), 'What happened?', null, null);
    expect(result).toBe('plain answer');
  });

  it('default on callable failure still returns null (not an object)', async () => {
    askJournalAIFn.mockRejectedValue(new Error('boom'));
    const result = await askJournalAI(corpus(), 'What happened?', null, null);
    expect(result).toBeNull();
  });

  it('{returnSources:true} returns {text, entryIds} carrying the real source ids used', async () => {
    askJournalAIFn.mockResolvedValue({ data: { response: 'sourced answer' } });
    const result = await askJournalAI(corpus(), 'What happened?', null, null, { returnSources: true });
    expect(result).toEqual({ text: 'sourced answer', entryIds: expect.arrayContaining(['e1', 'e2']) });
  });

  it('{returnSources:true} on callable failure returns {text:null, entryIds} (ids still surfaced, not swallowed)', async () => {
    askJournalAIFn.mockRejectedValue(new Error('boom'));
    const result = await askJournalAI(corpus(), 'What happened?', null, null, { returnSources: true });
    expect(result.text).toBeNull();
    expect(result.entryIds.sort()).toEqual(['e1', 'e2']);
  });
});

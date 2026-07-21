/**
 * R2 plan task 5: the session's spaceId (from the client's start_session
 * message) must be stored on SessionState and threaded into
 * loadSessionContext's getRecentEntries call (used to build
 * ConversationContext.recentEntries, which promptBuilder.buildSystemPrompt
 * renders). null (the default, "All spaces") must produce the same call
 * shape as before this parameter existed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../auth/firebase.js', () => ({
  getUserUsage: vi.fn(async () => ({
    estimatedCostUSD: 0,
    realtimeMinutes: 0,
    standardMinutes: 0,
  })),
  updateUserUsage: vi.fn(async () => {}),
  getRecentEntries: vi.fn(async () => []),
  getActiveGoals: vi.fn(async () => []),
  getOpenSituations: vi.fn(async () => []),
  getMoodTrajectory: vi.fn(async () => ({ trend: 'stable', description: 'x' })),
}));

const { createSession, loadSessionContext } = await import('../relay/sessionManager.js');
const { getRecentEntries } = await import('../auth/firebase.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('sessionManager — spaceId threading (voice relay scope seam)', () => {
  it('stores the session-init spaceId on the created session', async () => {
    const { session } = await createSession('user-space-a', 'free', 'work');
    expect(session.spaceId).toBe('work');
  });

  it('defaults spaceId to null when the client omits it (legacy identity)', async () => {
    const { session } = await createSession('user-space-b', 'free');
    expect(session.spaceId).toBeNull();
  });

  it('loadSessionContext threads a set spaceId into getRecentEntries', async () => {
    const { session } = await createSession('user-space-c', 'free', 'personal');
    await loadSessionContext(session.sessionId);
    expect(getRecentEntries).toHaveBeenCalledWith('user-space-c', 5, 'personal');
  });

  it('loadSessionContext threads null through for an unscoped session (byte-identical legacy call)', async () => {
    const { session } = await createSession('user-space-d', 'free');
    await loadSessionContext(session.sessionId);
    expect(getRecentEntries).toHaveBeenCalledWith('user-space-d', 5, null);
  });

  it('adversarial: a "work" session never reuses a stale spaceId from a different prior session', async () => {
    const { session: workSession } = await createSession('user-space-e', 'free', 'work');
    await loadSessionContext(workSession.sessionId);
    const { session: personalSession } = await createSession('user-space-f', 'free', 'personal');
    await loadSessionContext(personalSession.sessionId);

    expect(getRecentEntries).toHaveBeenNthCalledWith(1, 'user-space-e', 5, 'work');
    expect(getRecentEntries).toHaveBeenNthCalledWith(2, 'user-space-f', 5, 'personal');
  });
});

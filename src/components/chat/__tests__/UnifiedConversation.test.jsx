import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import UnifiedConversation from '../UnifiedConversation';
import { getFlag } from '../../../config/flags';
import { subscribeSpaces, getLastCaptureSpaceId } from '../../../services/spaces/spacesService';
import { getCompanionContext } from '../../../services/rag/companionContext';

// UnifiedConversation pulls in a lot of heavy, unrelated subsystems (voice
// relay/WebRTC, guided sessions, mindfulness, memory RAG). This test only
// exercises the Ask Journal scope chip/selector (plan R1 task 11), so every
// other subsystem is mocked to a minimal inert stand-in — none of it is
// under test here.
const { mockVoiceConnect } = vi.hoisted(() => ({ mockVoiceConnect: vi.fn() }));
vi.mock('../../../hooks/useVoiceRelay', () => ({
  useVoiceRelay: () => ({
    status: 'disconnected',
    transcript: [],
    error: null,
    connect: mockVoiceConnect,
    disconnect: vi.fn(),
    startRecording: vi.fn(),
    endTurn: vi.fn(),
    endSession: vi.fn(),
    clearError: vi.fn(),
    clearTranscript: vi.fn(),
  }),
}));

vi.mock('../../../services/ai', () => ({
  callOpenAI: vi.fn().mockResolvedValue('A reply.'),
  generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2]),
  transcribeAudio: vi.fn().mockResolvedValue(''),
}));

vi.mock('../../../services/rag/companionContext', () => ({
  getCompanionContext: vi.fn().mockResolvedValue({
    context: {},
    tokenBudget: { used: 0, max: 4500, remaining: 4500 },
    stats: {},
  }),
  formatContextForChat: vi.fn(() => ''),
  buildCompanionSystemPrompt: vi.fn(() => 'system prompt'),
}));

vi.mock('../../../services/memory', () => ({
  getMemoryGraph: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../services/memory/sessionBuffer', () => ({
  getSessionBuffer: vi.fn(() => null),
  setSessionBuffer: vi.fn(),
}));

vi.mock('../../../services/guided/sessions', () => ({
  GUIDED_SESSIONS: [],
  getRecommendedSessions: vi.fn(() => []),
  formatSessionAsEntry: vi.fn(),
  generateDynamicPrompt: vi.fn(),
}));

vi.mock('../../../services/guided/mindfulness', () => ({
  MINDFULNESS_EXERCISES: [],
  getRecommendedExercises: vi.fn(() => []),
  personalizeLovingKindness: vi.fn(),
}));

vi.mock('../../../utils/audio', () => ({
  synthesizeSpeech: vi.fn(),
}));

vi.mock('../../../config/flags', () => ({
  getFlag: vi.fn(),
}));

vi.mock('../../../config/firebase', () => ({ db: { __db: true } }));

vi.mock('../../../services/spaces/spacesService', () => ({
  subscribeSpaces: vi.fn(),
  getLastCaptureSpaceId: vi.fn().mockResolvedValue(null),
}));

// jsdom has no scrollIntoView implementation; UnifiedConversation calls it
// on every messages-array change (unrelated to the scope feature under
// test here), so stub it once for the whole file.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

const USER_ID = 'user-1';

const withSpaces = (spaces) => {
  subscribeSpaces.mockImplementation((_db, _uid, cb) => {
    cb(spaces);
    return () => {};
  });
};

const sendMessage = async (text) => {
  const input = screen.getByPlaceholderText('Message your companion…');
  fireEvent.change(input, { target: { value: text } });
  fireEvent.click(screen.getByLabelText('Send message'));
};

beforeEach(() => {
  vi.clearAllMocks();
  getFlag.mockImplementation((flag) => flag === 'contextSpaces');
  getLastCaptureSpaceId.mockResolvedValue(null);
  withSpaces([]);
});

describe('UnifiedConversation — Ask Journal scope chip gating', () => {
  it('renders no scope chip when the user has no spaces', async () => {
    withSpaces([]);
    render(<UnifiedConversation userId={USER_ID} onClose={vi.fn()} initialMode="chat" />);

    await waitFor(() => expect(subscribeSpaces).toHaveBeenCalled());
    expect(screen.queryByLabelText(/Ask Journal scope/)).toBeNull();
  });

  it('renders no scope chip (and never subscribes) when the contextSpaces flag is off', async () => {
    getFlag.mockImplementation(() => false);
    withSpaces([{ id: 'space-1', name: 'Work' }]);
    render(<UnifiedConversation userId={USER_ID} onClose={vi.fn()} initialMode="chat" />);

    // Let the (unrelated) memory-load effect settle before asserting, so it
    // doesn't resolve mid-way through the next test's render.
    await waitFor(() => expect(screen.queryByText('Loading memories...')).toBeNull());

    expect(subscribeSpaces).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/Ask Journal scope/)).toBeNull();
  });

  it('shows the chip once the user has spaces, defaulting to "All spaces" with no prior capture', async () => {
    withSpaces([{ id: 'space-1', name: 'Work' }, { id: 'space-2', name: 'Personal' }]);
    getLastCaptureSpaceId.mockResolvedValue(null);
    render(<UnifiedConversation userId={USER_ID} onClose={vi.fn()} initialMode="chat" />);

    expect(await screen.findByLabelText('Ask Journal scope: All spaces')).toBeTruthy();
  });

  it('defaults the chip to the last capture Space when one is recorded', async () => {
    withSpaces([{ id: 'space-1', name: 'Work' }]);
    getLastCaptureSpaceId.mockResolvedValue('space-1');
    render(<UnifiedConversation userId={USER_ID} onClose={vi.fn()} initialMode="chat" />);

    expect(await screen.findByLabelText('Ask Journal scope: Work')).toBeTruthy();
  });

  it('the selector always lists an explicit "All spaces" row alongside every space', async () => {
    withSpaces([{ id: 'space-1', name: 'Work' }, { id: 'space-2', name: 'Personal' }]);
    render(<UnifiedConversation userId={USER_ID} onClose={vi.fn()} initialMode="chat" />);

    fireEvent.click(await screen.findByLabelText(/Ask Journal scope/));
    const listbox = screen.getByRole('listbox', { name: 'Choose Ask Journal scope' });
    expect(listbox).toBeTruthy();
    expect(screen.getByRole('option', { name: 'All spaces' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Work' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Personal' })).toBeTruthy();
  });
});

describe('UnifiedConversation — selected scope reaches the context call', () => {
  it('passes the selected space as scope into getCompanionContext', async () => {
    withSpaces([{ id: 'space-1', name: 'Work' }]);
    getLastCaptureSpaceId.mockResolvedValue(null);
    render(<UnifiedConversation userId={USER_ID} onClose={vi.fn()} initialMode="chat" />);

    fireEvent.click(await screen.findByLabelText('Ask Journal scope: All spaces'));
    fireEvent.click(screen.getByRole('option', { name: 'Work' }));
    expect(await screen.findByLabelText('Ask Journal scope: Work')).toBeTruthy();

    await sendMessage('How am I doing at work?');

    await waitFor(() =>
      expect(getCompanionContext).toHaveBeenCalledWith(
        expect.objectContaining({ scope: { spaceId: 'space-1' } })
      )
    );
  });

  it('passes scope: null into getCompanionContext when "All spaces" is selected', async () => {
    withSpaces([{ id: 'space-1', name: 'Work' }]);
    getLastCaptureSpaceId.mockResolvedValue('space-1');
    render(<UnifiedConversation userId={USER_ID} onClose={vi.fn()} initialMode="chat" />);

    fireEvent.click(await screen.findByLabelText('Ask Journal scope: Work'));
    fireEvent.click(screen.getByRole('option', { name: 'All spaces' }));
    expect(await screen.findByLabelText('Ask Journal scope: All spaces')).toBeTruthy();

    await sendMessage('How am I doing overall?');

    await waitFor(() =>
      expect(getCompanionContext).toHaveBeenCalledWith(
        expect.objectContaining({ scope: null })
      )
    );
  });

  it('falls back to a null scope in the context call when the selected space is later removed from the live subscription (e.g. archived elsewhere while Companion stays open)', async () => {
    let spacesCallback;
    subscribeSpaces.mockImplementation((_db, _uid, cb) => {
      spacesCallback = cb;
      cb([{ id: 'space-1', name: 'Work' }, { id: 'space-2', name: 'Personal' }]);
      return () => {};
    });
    getLastCaptureSpaceId.mockResolvedValue(null);
    render(<UnifiedConversation userId={USER_ID} onClose={vi.fn()} initialMode="chat" />);

    fireEvent.click(await screen.findByLabelText('Ask Journal scope: All spaces'));
    fireEvent.click(screen.getByRole('option', { name: 'Work' }));
    expect(await screen.findByLabelText('Ask Journal scope: Work')).toBeTruthy();

    // Simulate "Work" being archived (e.g. via Settings -> SpaceManager)
    // while this conversation stays open: subscribeSpaces' next live
    // snapshot no longer includes it, but at least one other space
    // ("Personal") remains so the chip itself is still shown.
    act(() => {
      spacesCallback([{ id: 'space-2', name: 'Personal' }]);
    });

    // Label falls back to "All spaces"...
    expect(await screen.findByLabelText('Ask Journal scope: All spaces')).toBeTruthy();

    // ...and retrieval must follow the same fallback, never the stale,
    // now-unresolvable spaceId.
    await sendMessage('Anything new?');
    await waitFor(() =>
      expect(getCompanionContext).toHaveBeenCalledWith(
        expect.objectContaining({ scope: null })
      )
    );
  });
});

// R2 plan task 5: the voice relay session-init message must carry the same
// Ask Journal scope used for text-chat's getCompanionContext call, so the
// relay's server-side RAG never leaks cross-space content into a scoped
// voice conversation either. `initialMode` is left at its PICKER default
// here (unlike the describes above) so the "Voice Conversation" entry point
// is on-screen without an extra mode switch; the default-scope-load effect
// that feeds `effectiveScope` runs regardless of mode.
describe('UnifiedConversation — voice relay session-init threads the active scope', () => {
  it('passes the active space id as the third connect() arg when entering Voice mode', async () => {
    withSpaces([{ id: 'space-1', name: 'Work' }]);
    getLastCaptureSpaceId.mockResolvedValue('space-1');
    render(<UnifiedConversation userId={USER_ID} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByText('Voice Conversation'));

    await waitFor(() =>
      expect(mockVoiceConnect).toHaveBeenCalledWith('free', 'realtime', 'space-1')
    );
  });

  it('passes null when "All spaces" is the active scope (legacy identity)', async () => {
    withSpaces([{ id: 'space-1', name: 'Work' }]);
    getLastCaptureSpaceId.mockResolvedValue(null);
    render(<UnifiedConversation userId={USER_ID} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByText('Voice Conversation'));

    await waitFor(() =>
      expect(mockVoiceConnect).toHaveBeenCalledWith('free', 'realtime', null)
    );
  });

  it('passes null when the contextSpaces flag is off entirely', async () => {
    getFlag.mockImplementation(() => false);
    render(<UnifiedConversation userId={USER_ID} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByText('Voice Conversation'));

    await waitFor(() =>
      expect(mockVoiceConnect).toHaveBeenCalledWith('free', 'realtime', null)
    );
  });
});

// Review fix (task 5): the voice-connect effect used to fire as soon as
// `mode` became VOICE, regardless of whether the async spaces subscription
// and default-scope load had resolved yet. An early voice entry could beat
// both, connect unscoped, and — because the effect's deps didn't include
// scope resolution — silently STAY unscoped for the rest of the session
// even after the real default resolved. These tests hold both async
// sources open past the point voice mode is entered, to prove the connect
// call now waits (`scopeReady`) instead of racing.
describe('UnifiedConversation — voice connect waits for scope resolution (no race)', () => {
  const deferredSubscribeSpaces = () => {
    let deliver;
    subscribeSpaces.mockImplementation((_db, _uid, cb) => {
      deliver = cb;
      return () => {};
    });
    return { deliver: (list) => act(() => deliver(list)) };
  };

  const deferredGetLastCaptureSpaceId = () => {
    let resolveFn;
    let rejectFn;
    getLastCaptureSpaceId.mockImplementation(
      () => new Promise((resolve, reject) => { resolveFn = resolve; rejectFn = reject; })
    );
    return {
      resolve: (v) => act(async () => { resolveFn(v); await Promise.resolve(); }),
      reject: (e) => act(async () => { rejectFn(e); await Promise.resolve(); }),
    };
  };

  it('holds the connect until a delayed non-empty spaces snapshot AND the default-scope load resolve, then connects with the resolved spaceId', async () => {
    const spacesCtrl = deferredSubscribeSpaces();
    const defaultScopeCtrl = deferredGetLastCaptureSpaceId();
    render(<UnifiedConversation userId={USER_ID} onClose={vi.fn()} />);

    // Enter Voice mode before either async scope source has resolved.
    fireEvent.click(await screen.findByText('Voice Conversation'));
    expect(mockVoiceConnect).not.toHaveBeenCalled();

    // Spaces snapshot lands (non-empty) — still must wait on the default
    // scope load before connecting.
    spacesCtrl.deliver([{ id: 'space-1', name: 'Work' }]);
    await Promise.resolve();
    expect(mockVoiceConnect).not.toHaveBeenCalled();

    // Default-scope load resolves — now it's safe to connect.
    await defaultScopeCtrl.resolve('space-1');

    await waitFor(() =>
      expect(mockVoiceConnect).toHaveBeenCalledWith('free', 'realtime', 'space-1')
    );
    expect(mockVoiceConnect).toHaveBeenCalledTimes(1);
  });

  it('zero-space user: the first (empty) spaces snapshot alone unlocks connect with a null scope — no hang waiting on a default-scope load that will never run', async () => {
    const spacesCtrl = deferredSubscribeSpaces();
    render(<UnifiedConversation userId={USER_ID} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByText('Voice Conversation'));
    expect(mockVoiceConnect).not.toHaveBeenCalled();

    spacesCtrl.deliver([]);

    await waitFor(() =>
      expect(mockVoiceConnect).toHaveBeenCalledWith('free', 'realtime', null)
    );
    expect(getLastCaptureSpaceId).not.toHaveBeenCalled();
  });

  it('default-scope load failure: connect proceeds with a null scope instead of hanging forever', async () => {
    const spacesCtrl = deferredSubscribeSpaces();
    const defaultScopeCtrl = deferredGetLastCaptureSpaceId();
    render(<UnifiedConversation userId={USER_ID} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByText('Voice Conversation'));
    spacesCtrl.deliver([{ id: 'space-1', name: 'Work' }]);
    await Promise.resolve();
    expect(mockVoiceConnect).not.toHaveBeenCalled();

    await defaultScopeCtrl.reject(new Error('boom'));

    await waitFor(() =>
      expect(mockVoiceConnect).toHaveBeenCalledWith('free', 'realtime', null)
    );
  });

  it('does not reconnect (no second connect call) when the effective scope changes after the session has already connected', async () => {
    let spacesCallback;
    subscribeSpaces.mockImplementation((_db, _uid, cb) => {
      spacesCallback = cb;
      cb([{ id: 'space-1', name: 'Work' }, { id: 'space-2', name: 'Personal' }]);
      return () => {};
    });
    getLastCaptureSpaceId.mockResolvedValue('space-1');

    render(<UnifiedConversation userId={USER_ID} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByText('Voice Conversation'));

    await waitFor(() =>
      expect(mockVoiceConnect).toHaveBeenCalledWith('free', 'realtime', 'space-1')
    );
    expect(mockVoiceConnect).toHaveBeenCalledTimes(1);

    // Scope changes AFTER connect (e.g. "Work" archived elsewhere while the
    // voice session is live) — the already-started session must not pick
    // up the new scope or reconnect.
    act(() => {
      spacesCallback([{ id: 'space-2', name: 'Personal' }]);
    });
    await act(async () => { await Promise.resolve(); });

    expect(mockVoiceConnect).toHaveBeenCalledTimes(1);
    expect(mockVoiceConnect).toHaveBeenCalledWith('free', 'realtime', 'space-1');
  });

  // Re-review finding (task 5): subscribeSpaces' onSnapshot builds a FRESH
  // array per snapshot, and Firestore commonly double-delivers (cache-then-
  // server) on a fresh listener. A re-fire before the in-flight
  // getLastCaptureSpaceId promise settles runs the FIRST invocation's
  // cleanup (cancelled = true); the second invocation early-returns on the
  // one-shot ref guard, so no replacement promise is ever created. When the
  // orphaned first promise finally resolves, `cancelled` is true — if
  // settlement itself were gated on `!cancelled` (as it used to be),
  // `defaultScopeSettled` would NEVER flip true, `scopeReady` would be
  // stuck false forever, and voice would never connect. This test proves
  // settlement survives the re-fire even though the (now-stale) scope
  // application is correctly suppressed.
  it('a spaces snapshot re-fire before the default-scope load settles does not strand scopeReady — voice still connects once the orphaned load resolves', async () => {
    const spacesCtrl = deferredSubscribeSpaces();
    const defaultScopeCtrl = deferredGetLastCaptureSpaceId();
    render(<UnifiedConversation userId={USER_ID} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByText('Voice Conversation'));
    expect(mockVoiceConnect).not.toHaveBeenCalled();

    // First snapshot (non-empty) starts the one-shot default-scope load.
    spacesCtrl.deliver([{ id: 'space-1', name: 'Work' }]);
    await Promise.resolve();
    expect(mockVoiceConnect).not.toHaveBeenCalled();
    expect(getLastCaptureSpaceId).toHaveBeenCalledTimes(1);

    // Firestore double-delivers: a fresh array reference (same content)
    // arrives before the load resolves. This re-fires the effect, running
    // invocation 1's cleanup (cancelled = true); the ref guard blocks a
    // replacement promise, so getLastCaptureSpaceId is NOT called again.
    spacesCtrl.deliver([{ id: 'space-1', name: 'Work' }]);
    await Promise.resolve();
    expect(mockVoiceConnect).not.toHaveBeenCalled();
    expect(getLastCaptureSpaceId).toHaveBeenCalledTimes(1);

    // The orphaned first promise resolves. Its scope application is
    // correctly suppressed by cancellation (never applied), but
    // settlement must still fire unconditionally so scopeReady unblocks.
    // Connect proceeds with the live effectiveScope (still unscoped, since
    // the loaded scope was never applied) rather than hanging forever.
    await defaultScopeCtrl.resolve('space-1');

    await waitFor(() =>
      expect(mockVoiceConnect).toHaveBeenCalledWith('free', 'realtime', null)
    );
    expect(mockVoiceConnect).toHaveBeenCalledTimes(1);
  });
});

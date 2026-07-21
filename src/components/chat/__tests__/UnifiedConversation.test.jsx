import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import UnifiedConversation from '../UnifiedConversation';
import { getFlag } from '../../../config/flags';
import { subscribeSpaces, getLastCaptureSpaceId } from '../../../services/spaces/spacesService';
import { getCompanionContext } from '../../../services/rag/companionContext';

// UnifiedConversation pulls in a lot of heavy, unrelated subsystems (voice
// relay/WebRTC, guided sessions, mindfulness, memory RAG). This test only
// exercises the Ask Journal scope chip/selector (plan R1 task 11), so every
// other subsystem is mocked to a minimal inert stand-in — none of it is
// under test here.
vi.mock('../../../hooks/useVoiceRelay', () => ({
  useVoiceRelay: () => ({
    status: 'disconnected',
    transcript: [],
    error: null,
    connect: vi.fn(),
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
});

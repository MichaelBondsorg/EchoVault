import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import EntryBar from '../EntryBar';
import { appendChunk, deleteDraft, recoverWebDrafts } from '../../../services/capture/webChunkStore';
import { audioVault } from '../../../services/audio/audioVault';
import { getFlag } from '../../../config/flags';

vi.mock('../../../services/capture/webChunkStore', () => ({
  appendChunk: vi.fn().mockResolvedValue(true),
  deleteDraft: vi.fn().mockResolvedValue(true),
  recoverWebDrafts: vi.fn().mockResolvedValue(0),
}));

vi.mock('../../../services/audio/audioVault', () => ({
  audioVault: { saveRecording: vi.fn() },
}));

vi.mock('../../../config/flags', () => ({
  getFlag: vi.fn(),
}));

// Minimal fake MediaRecorder — jsdom has no native implementation. `stop()`
// synchronously fires `onstop`, matching how the real EntryBar tests drive
// the recording lifecycle without waiting on real media timers.
class FakeMediaRecorder {
  constructor(stream, opts) {
    this.stream = stream;
    this.opts = opts;
    this.ondataavailable = null;
    this.onstop = null;
    this.onerror = null;
    FakeMediaRecorder.instances.push(this);
  }
  start() {}
  stop() {
    this.onstop && this.onstop();
  }
}
FakeMediaRecorder.isTypeSupported = () => true;
FakeMediaRecorder.instances = [];

const OWNER = 'user-a';

const localStore = () => {
  const store = new Map();
  localStorage.getItem.mockImplementation((k) => (store.has(k) ? store.get(k) : null));
  localStorage.setItem.mockImplementation((k, v) => { store.set(k, String(v)); });
  localStorage.removeItem.mockImplementation((k) => { store.delete(k); });
  return store;
};

const startFakeRecording = async () => {
  fireEvent.click(screen.getByLabelText('Record voice entry'));
  await waitFor(() => expect(FakeMediaRecorder.instances.length).toBeGreaterThan(0));
  return FakeMediaRecorder.instances[FakeMediaRecorder.instances.length - 1];
};

beforeEach(() => {
  localStore();
  FakeMediaRecorder.instances = [];
  global.MediaRecorder = FakeMediaRecorder;
  navigator.mediaDevices = {
    getUserMedia: vi.fn().mockResolvedValue({
      getTracks: () => [{ stop: vi.fn() }],
    }),
  };
  getFlag.mockReturnValue(true);
  appendChunk.mockClear().mockResolvedValue(true);
  deleteDraft.mockClear().mockResolvedValue(true);
  recoverWebDrafts.mockClear().mockResolvedValue(0);
  audioVault.saveRecording.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('EntryBar — web chunk persistence (flag webChunkPersistence)', () => {
  it('appends a chunk to the store on each dataavailable event', async () => {
    render(<EntryBar ownerUid={OWNER} onVoiceSave={vi.fn().mockResolvedValue(true)} onTextSave={vi.fn()} />);
    const recorder = await startFakeRecording();

    recorder.ondataavailable({ data: new Blob(['chunk-0-'.repeat(20)]), });
    await waitFor(() => expect(appendChunk).toHaveBeenCalledTimes(1));
    expect(appendChunk).toHaveBeenCalledWith(OWNER, expect.any(String), 0, expect.any(Blob), expect.any(String));

    recorder.ondataavailable({ data: new Blob(['chunk-1-'.repeat(20)]) });
    await waitFor(() => expect(appendChunk).toHaveBeenCalledTimes(2));
    expect(appendChunk.mock.calls[1][2]).toBe(1); // seq increments
  });

  it('deletes the chunk draft after a successful hand-off on stop', async () => {
    const onVoiceSave = vi.fn().mockResolvedValue(true);
    render(<EntryBar ownerUid={OWNER} onVoiceSave={onVoiceSave} onTextSave={vi.fn()} />);
    const recorder = await startFakeRecording();
    recorder.ondataavailable({ data: new Blob(['chunk-0-'.repeat(20)]) });
    await waitFor(() => expect(appendChunk).toHaveBeenCalledTimes(1));
    const draftId = appendChunk.mock.calls[0][1];

    fireEvent.click(screen.getByLabelText('Stop recording'));

    await waitFor(() => expect(onVoiceSave).toHaveBeenCalled());
    await waitFor(() => expect(deleteDraft).toHaveBeenCalledWith(OWNER, draftId));
  });

  it('keeps the chunk draft when the hand-off fails (onVoiceSave resolves false)', async () => {
    const onVoiceSave = vi.fn().mockResolvedValue(false);
    render(<EntryBar ownerUid={OWNER} onVoiceSave={onVoiceSave} onTextSave={vi.fn()} />);
    const recorder = await startFakeRecording();
    recorder.ondataavailable({ data: new Blob(['chunk-0-'.repeat(20)]) });
    await waitFor(() => expect(appendChunk).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByLabelText('Stop recording'));

    await waitFor(() => expect(onVoiceSave).toHaveBeenCalled());
    expect(deleteDraft).not.toHaveBeenCalled();
  });

  it('does not write chunks when the flag is off — behavior unchanged', async () => {
    getFlag.mockReturnValue(false);
    const onVoiceSave = vi.fn().mockResolvedValue(true);
    render(<EntryBar ownerUid={OWNER} onVoiceSave={onVoiceSave} onTextSave={vi.fn()} />);
    const recorder = await startFakeRecording();
    recorder.ondataavailable({ data: new Blob(['chunk-0-'.repeat(20)]) });

    fireEvent.click(screen.getByLabelText('Stop recording'));
    await waitFor(() => expect(onVoiceSave).toHaveBeenCalled());

    expect(appendChunk).not.toHaveBeenCalled();
    expect(deleteDraft).not.toHaveBeenCalled();
  });
});

describe('EntryBar — web draft recovery (mount, once per session)', () => {
  it('runs recoverWebDrafts once and wires the adopt callback to audioVault.saveRecording', async () => {
    const owner = 'user-recovery-once';
    audioVault.saveRecording.mockResolvedValue({ id: 'rec_123' });
    const { unmount } = render(<EntryBar ownerUid={owner} onVoiceSave={vi.fn()} onTextSave={vi.fn()} />);
    await waitFor(() => expect(recoverWebDrafts).toHaveBeenCalledWith(owner, expect.any(Function)));

    const adopt = recoverWebDrafts.mock.calls.find((c) => c[0] === owner)[1];
    await expect(adopt('base64data', 'audio/webm')).resolves.toBe('rec_123');
    expect(audioVault.saveRecording).toHaveBeenCalledWith(owner, 'base64data', 'audio/webm');

    unmount();
    render(<EntryBar ownerUid={owner} onVoiceSave={vi.fn()} onTextSave={vi.fn()} />);
    // Still only called once for this owner despite a second mount.
    await waitFor(() => expect(recoverWebDrafts.mock.calls.filter((c) => c[0] === owner)).toHaveLength(1));
  });

  it('adopt callback resolves null when the vault reports an error', async () => {
    const owner = 'user-recovery-fail';
    audioVault.saveRecording.mockResolvedValue({ error: 'quota' });
    render(<EntryBar ownerUid={owner} onVoiceSave={vi.fn()} onTextSave={vi.fn()} />);
    await waitFor(() => expect(recoverWebDrafts).toHaveBeenCalledWith(owner, expect.any(Function)));

    const adopt = recoverWebDrafts.mock.calls.find((c) => c[0] === owner)[1];
    await expect(adopt('base64data', 'audio/webm')).resolves.toBeNull();
  });
});

describe('EntryBar — typed-draft autosave', () => {
  it('restores a saved draft on mount when the text state is empty', async () => {
    localStorage.setItem(`entry_draft::${OWNER}`, 'restored draft text');
    render(
      <EntryBar ownerUid={OWNER} onVoiceSave={vi.fn()} onTextSave={vi.fn()} embedded preferredMode="text" />
    );
    expect(await screen.findByDisplayValue('restored draft text')).toBeTruthy();
  });

  it('debounces writes to localStorage at 500ms', async () => {
    vi.useFakeTimers();
    try {
      render(
        <EntryBar ownerUid={OWNER} onVoiceSave={vi.fn()} onTextSave={vi.fn()} embedded preferredMode="text" />
      );
      const textarea = screen.getByPlaceholderText("What's on your mind?");
      fireEvent.change(textarea, { target: { value: 'hello' } });

      await vi.advanceTimersByTimeAsync(400);
      expect(localStorage.setItem).not.toHaveBeenCalledWith(`entry_draft::${OWNER}`, 'hello');

      await vi.advanceTimersByTimeAsync(150);
      expect(localStorage.setItem).toHaveBeenCalledWith(`entry_draft::${OWNER}`, 'hello');
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears the draft on successful submit', async () => {
    localStorage.setItem(`entry_draft::${OWNER}`, 'draft to submit');
    const onTextSave = vi.fn();
    render(
      <EntryBar ownerUid={OWNER} onVoiceSave={vi.fn()} onTextSave={onTextSave} embedded preferredMode="text" />
    );
    const textarea = await screen.findByDisplayValue('draft to submit');
    fireEvent.click(screen.getByLabelText('Save text entry'));

    expect(onTextSave).toHaveBeenCalledWith('draft to submit');
    await waitFor(() => expect(localStorage.removeItem).toHaveBeenCalledWith(`entry_draft::${OWNER}`));
    void textarea;
  });

  it('clears the draft on explicit user cancel', async () => {
    localStorage.setItem(`entry_draft::${OWNER}`, 'draft to cancel');
    render(
      <EntryBar ownerUid={OWNER} onVoiceSave={vi.fn()} onTextSave={vi.fn()} embedded preferredMode="text" />
    );
    await screen.findByDisplayValue('draft to cancel');
    fireEvent.click(screen.getByLabelText('Cancel text entry'));

    await waitFor(() => expect(localStorage.removeItem).toHaveBeenCalledWith(`entry_draft::${OWNER}`));
  });

  it('scopes the draft key per owner', async () => {
    localStorage.setItem('entry_draft::user-other', 'someone elses draft');
    render(
      <EntryBar ownerUid={OWNER} onVoiceSave={vi.fn()} onTextSave={vi.fn()} embedded preferredMode="text" />
    );
    const textarea = await screen.findByPlaceholderText("What's on your mind?");
    expect(textarea.value).toBe('');
  });
});

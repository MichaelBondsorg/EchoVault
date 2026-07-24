import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import EntryBar from '../EntryBar';
import { appendChunk, appendMarker, deleteDraft, recoverWebDrafts } from '../../../services/capture/webChunkStore';
import { audioVault } from '../../../services/audio/audioVault';
import { getFlag } from '../../../config/flags';
import { subscribeSpaces, setLastCaptureSpaceId } from '../../../services/spaces/spacesService';

vi.mock('../../../services/capture/webChunkStore', () => ({
  appendChunk: vi.fn().mockResolvedValue(true),
  appendMarker: vi.fn().mockResolvedValue(1),
  deleteDraft: vi.fn().mockResolvedValue(true),
  recoverWebDrafts: vi.fn().mockResolvedValue(0),
}));

vi.mock('../../../services/audio/audioVault', () => ({
  audioVault: { saveRecording: vi.fn() },
}));

vi.mock('../../../config/flags', () => ({
  getFlag: vi.fn(),
}));

vi.mock('../../../config/firebase', () => ({ db: { __db: true } }));

vi.mock('../../../services/spaces/spacesService', () => ({
  subscribeSpaces: vi.fn(),
  setLastCaptureSpaceId: vi.fn().mockResolvedValue(undefined),
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
  appendMarker.mockClear().mockResolvedValue(1);
  deleteDraft.mockClear().mockResolvedValue(true);
  recoverWebDrafts.mockClear().mockResolvedValue(0);
  audioVault.saveRecording.mockReset();
  subscribeSpaces.mockReset().mockReturnValue(() => {});
  setLastCaptureSpaceId.mockReset().mockResolvedValue(undefined);
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

  // CRITICAL (task-13 review): recoverWebDrafts's adopt callback used to
  // ignore its 3rd arg (draft.markers) entirely, so a recovered draft's
  // chapter markers were silently dropped on the recovery path even though
  // they survived durably in IDB. This runs the REAL adopt callback wired up
  // by EntryBar (audioVault mocked only at the module boundary) with a
  // recovered draft carrying markers, and asserts they reach
  // audioVault.saveRecording — normalized to the canonical [{tMs}] shape.
  it('adopt callback forwards recovered markers to audioVault.saveRecording, normalized to [{tMs}]', async () => {
    const owner = 'user-recovery-markers';
    audioVault.saveRecording.mockResolvedValue({ id: 'rec_marked' });
    render(<EntryBar ownerUid={owner} onVoiceSave={vi.fn()} onTextSave={vi.fn()} />);
    await waitFor(() => expect(recoverWebDrafts).toHaveBeenCalledWith(owner, expect.any(Function)));

    const adopt = recoverWebDrafts.mock.calls.find((c) => c[0] === owner)[1];
    await expect(adopt('base64data', 'audio/webm', [1200, 3400])).resolves.toBe('rec_marked');
    expect(audioVault.saveRecording).toHaveBeenCalledWith(
      owner, 'base64data', 'audio/webm', { markers: [{ tMs: 1200 }, { tMs: 3400 }] }
    );
  });

  it('adopt callback omits markers from saveRecording when the recovered draft had none (no empty-array stuffing)', async () => {
    const owner = 'user-recovery-no-markers';
    audioVault.saveRecording.mockResolvedValue({ id: 'rec_plain' });
    render(<EntryBar ownerUid={owner} onVoiceSave={vi.fn()} onTextSave={vi.fn()} />);
    await waitFor(() => expect(recoverWebDrafts).toHaveBeenCalledWith(owner, expect.any(Function)));

    const adopt = recoverWebDrafts.mock.calls.find((c) => c[0] === owner)[1];
    await expect(adopt('base64data', 'audio/webm', undefined)).resolves.toBe('rec_plain');
    expect(audioVault.saveRecording).toHaveBeenCalledWith(owner, 'base64data', 'audio/webm');
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

describe('EntryBar — Voice Chapters (flag: voiceChapters)', () => {
  it('shows a "Mark chapter" pill during recording when the flag is on', async () => {
    render(<EntryBar ownerUid={OWNER} onVoiceSave={vi.fn().mockResolvedValue(true)} onTextSave={vi.fn()} />);
    await startFakeRecording();
    expect(screen.getByLabelText('Mark chapter')).toBeTruthy();
  });

  it('renders no pill (and marking is inert) when the flag is off', async () => {
    getFlag.mockImplementation((flag) => flag !== 'voiceChapters');
    const onVoiceSave = vi.fn().mockResolvedValue(true);
    render(<EntryBar ownerUid={OWNER} onVoiceSave={onVoiceSave} onTextSave={vi.fn()} />);
    const recorder = await startFakeRecording();
    expect(screen.queryByLabelText('Mark chapter')).toBeNull();

    recorder.ondataavailable({ data: new Blob(['chunk-0-'.repeat(20)]) });
    fireEvent.click(screen.getByLabelText('Stop recording'));
    await waitFor(() => expect(onVoiceSave).toHaveBeenCalled());
    const [, , options] = onVoiceSave.mock.calls[0];
    expect(options).not.toHaveProperty('markers');
    expect(options).not.toHaveProperty('durationMs');
    expect(appendMarker).not.toHaveBeenCalled();
  });

  it('tapping the pill writes a durable marker (appendMarker) and increments a "Ch N" count badge', async () => {
    render(<EntryBar ownerUid={OWNER} onVoiceSave={vi.fn().mockResolvedValue(true)} onTextSave={vi.fn()} />);
    await startFakeRecording();

    fireEvent.click(screen.getByLabelText('Mark chapter'));
    await waitFor(() => expect(appendMarker).toHaveBeenCalledWith(OWNER, expect.any(String), expect.any(Number)));
    expect(screen.getByText(/Ch 1/)).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Mark chapter'));
    await waitFor(() => expect(appendMarker).toHaveBeenCalledTimes(2));
    expect(screen.getByText(/Ch 2/)).toBeTruthy();
    // seq-ordered, monotonically increasing tMs
    const [t1] = appendMarker.mock.calls[0].slice(2);
    const [t2] = appendMarker.mock.calls[1].slice(2);
    expect(t2).toBeGreaterThanOrEqual(t1);
  });

  it('a marker-persistence failure never interrupts recording — it is kept in-memory as the stop() fallback', async () => {
    appendMarker.mockRejectedValueOnce(new Error('idb down'));
    render(<EntryBar ownerUid={OWNER} onVoiceSave={vi.fn().mockResolvedValue(true)} onTextSave={vi.fn()} />);
    await startFakeRecording();

    fireEvent.click(screen.getByLabelText('Mark chapter'));
    await waitFor(() => expect(appendMarker).toHaveBeenCalled());

    // Badge still incremented and recording still in progress — the IDB
    // rejection was swallowed, not surfaced as a recording failure.
    expect(screen.getByText(/Ch 1/)).toBeTruthy();
    expect(screen.getByLabelText('Stop recording')).toBeTruthy();
  });

  it('stop() passes markers + durationMs to onVoiceSave when chapters were tapped', async () => {
    const onVoiceSave = vi.fn().mockResolvedValue(true);
    render(<EntryBar ownerUid={OWNER} onVoiceSave={onVoiceSave} onTextSave={vi.fn()} />);
    const recorder = await startFakeRecording();
    fireEvent.click(screen.getByLabelText('Mark chapter'));
    await waitFor(() => expect(appendMarker).toHaveBeenCalled());

    recorder.ondataavailable({ data: new Blob(['chunk-0-'.repeat(20)]) });
    fireEvent.click(screen.getByLabelText('Stop recording'));
    await waitFor(() => expect(onVoiceSave).toHaveBeenCalled());

    const [, , options] = onVoiceSave.mock.calls[0];
    // Canonical shape (review fix, IMPORTANT): EntryBar normalizes markers to
    // [{tMs}] before they leave the component, regardless of platform.
    expect(options.markers).toEqual([{ tMs: expect.any(Number) }]);
    expect(typeof options.durationMs).toBe('number');
  });

  it('omits markers/durationMs from onVoiceSave when no chapters were tapped (no empty-array stuffing)', async () => {
    const onVoiceSave = vi.fn().mockResolvedValue(true);
    render(<EntryBar ownerUid={OWNER} onVoiceSave={onVoiceSave} onTextSave={vi.fn()} />);
    const recorder = await startFakeRecording();

    recorder.ondataavailable({ data: new Blob(['chunk-0-'.repeat(20)]) });
    fireEvent.click(screen.getByLabelText('Stop recording'));
    await waitFor(() => expect(onVoiceSave).toHaveBeenCalled());

    const [, , options] = onVoiceSave.mock.calls[0];
    expect(options?.markers).toBeUndefined();
  });

  it('does not write a marker to IDB when webChunkPersistence is off (no draft id) — flag on, ref-only fallback', async () => {
    getFlag.mockImplementation((flag) => flag !== 'webChunkPersistence');
    const onVoiceSave = vi.fn().mockResolvedValue(true);
    render(<EntryBar ownerUid={OWNER} onVoiceSave={onVoiceSave} onTextSave={vi.fn()} />);
    const recorder = await startFakeRecording();

    fireEvent.click(screen.getByLabelText('Mark chapter'));
    expect(screen.getByText(/Ch 1/)).toBeTruthy();
    expect(appendMarker).not.toHaveBeenCalled();

    recorder.ondataavailable({ data: new Blob(['chunk-0-'.repeat(20)]) });
    fireEvent.click(screen.getByLabelText('Stop recording'));
    await waitFor(() => expect(onVoiceSave).toHaveBeenCalled());
    const [, , options] = onVoiceSave.mock.calls[0];
    expect(options.markers).toEqual([{ tMs: expect.any(Number) }]);
  });

  // MINOR (task-13 review): a second recording in the same EntryBar mount
  // must not carry over markers/count from the first — recordingStartedAtRef
  // and markersRef both get reset at the top of startRecording.
  it('a second recording in the same mount resets markers — no carryover from the first', async () => {
    const onVoiceSave = vi.fn().mockResolvedValue(true);
    render(<EntryBar ownerUid={OWNER} onVoiceSave={onVoiceSave} onTextSave={vi.fn()} />);

    // First recording: tap once, stop.
    const recorder1 = await startFakeRecording();
    fireEvent.click(screen.getByLabelText('Mark chapter'));
    await waitFor(() => expect(appendMarker).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/Ch 1/)).toBeTruthy();
    recorder1.ondataavailable({ data: new Blob(['chunk-0-'.repeat(20)]) });
    fireEvent.click(screen.getByLabelText('Stop recording'));
    await waitFor(() => expect(onVoiceSave).toHaveBeenCalledTimes(1));
    expect(onVoiceSave.mock.calls[0][2].markers).toHaveLength(1);

    // Second recording: badge starts fresh at "Ch 1" on the first tap in
    // this recording, not "Ch 2" carried over from the first recording.
    const recorder2 = await startFakeRecording();
    fireEvent.click(screen.getByLabelText('Mark chapter'));
    await waitFor(() => expect(appendMarker).toHaveBeenCalledTimes(2));
    expect(screen.getByText(/Ch 1/)).toBeTruthy();
    expect(screen.queryByText(/Ch 2/)).toBeNull();

    recorder2.ondataavailable({ data: new Blob(['chunk-0-'.repeat(20)]) });
    fireEvent.click(screen.getByLabelText('Stop recording'));
    await waitFor(() => expect(onVoiceSave).toHaveBeenCalledTimes(2));
    // Exactly 1 marker (this recording's tap only) — no carryover from the
    // first recording's marker.
    expect(onVoiceSave.mock.calls[1][2].markers).toHaveLength(1);
  });
});

describe('EntryBar — Space pill (flag: contextSpaces)', () => {
  it('renders nothing (no pill, no subscription) when contextSpaces is off', () => {
    getFlag.mockImplementation((flag) => flag !== 'contextSpaces');
    render(
      <EntryBar ownerUid={OWNER} onVoiceSave={vi.fn()} onTextSave={vi.fn()} embedded preferredMode="text" />
    );
    expect(screen.queryByLabelText('Assign a space')).toBeNull();
    expect(subscribeSpaces).not.toHaveBeenCalled();
  });

  it('subscribes to active spaces and shows the picker on tap, with a "No space" option', async () => {
    subscribeSpaces.mockImplementation((_db, _uid, cb) => {
      cb([{ id: 'space-1', name: 'Work' }, { id: 'space-2', name: 'Personal' }]);
      return () => {};
    });
    render(
      <EntryBar ownerUid={OWNER} onVoiceSave={vi.fn()} onTextSave={vi.fn()} embedded preferredMode="text" captureSpaceId={null} />
    );
    expect(subscribeSpaces).toHaveBeenCalledWith({ __db: true }, OWNER, expect.any(Function));

    const pill = await screen.findByLabelText('Assign a space');
    fireEvent.click(pill);

    expect(screen.getByText('No space')).toBeTruthy();
    expect(screen.getByText('Work')).toBeTruthy();
    expect(screen.getByText('Personal')).toBeTruthy();
  });

  it('shows the selected space name on the pill when captureSpaceId is set', async () => {
    subscribeSpaces.mockImplementation((_db, _uid, cb) => {
      cb([{ id: 'space-1', name: 'Work' }]);
      return () => {};
    });
    render(
      <EntryBar ownerUid={OWNER} onVoiceSave={vi.fn()} onTextSave={vi.fn()} embedded preferredMode="text" captureSpaceId="space-1" />
    );
    expect(await screen.findByLabelText('Space: Work')).toBeTruthy();
  });

  it('an explicit selection calls the setter prop AND persists it via setLastCaptureSpaceId', async () => {
    subscribeSpaces.mockImplementation((_db, _uid, cb) => {
      cb([{ id: 'space-1', name: 'Work' }]);
      return () => {};
    });
    const onCaptureSpaceIdChange = vi.fn();
    render(
      <EntryBar
        ownerUid={OWNER}
        onVoiceSave={vi.fn()}
        onTextSave={vi.fn()}
        embedded
        preferredMode="text"
        captureSpaceId={null}
        onCaptureSpaceIdChange={onCaptureSpaceIdChange}
      />
    );
    fireEvent.click(await screen.findByLabelText('Assign a space'));
    fireEvent.click(screen.getByText('Work'));

    expect(onCaptureSpaceIdChange).toHaveBeenCalledWith('space-1');
    await waitFor(() => expect(setLastCaptureSpaceId).toHaveBeenCalledWith({ __db: true }, OWNER, 'space-1'));
  });

  it('selecting "No space" clears the selection (null) via both the setter and persistence', async () => {
    subscribeSpaces.mockImplementation((_db, _uid, cb) => {
      cb([{ id: 'space-1', name: 'Work' }]);
      return () => {};
    });
    const onCaptureSpaceIdChange = vi.fn();
    render(
      <EntryBar
        ownerUid={OWNER}
        onVoiceSave={vi.fn()}
        onTextSave={vi.fn()}
        embedded
        preferredMode="text"
        captureSpaceId="space-1"
        onCaptureSpaceIdChange={onCaptureSpaceIdChange}
      />
    );
    fireEvent.click(await screen.findByLabelText('Space: Work'));
    fireEvent.click(screen.getByText('No space'));

    expect(onCaptureSpaceIdChange).toHaveBeenCalledWith(null);
    await waitFor(() => expect(setLastCaptureSpaceId).toHaveBeenCalledWith({ __db: true }, OWNER, null));
  });
});

describe('EntryBar — Space picker dismissal (review fix)', () => {
  beforeEach(() => {
    subscribeSpaces.mockImplementation((_db, _uid, cb) => {
      cb([{ id: 'space-1', name: 'Work' }]);
      return () => {};
    });
  });

  it('an outside pointerdown closes the open popover', async () => {
    render(
      <EntryBar ownerUid={OWNER} onVoiceSave={vi.fn()} onTextSave={vi.fn()} embedded preferredMode="text" />
    );
    fireEvent.click(await screen.findByLabelText('Assign a space'));
    expect(screen.getByText('No space')).toBeTruthy();

    fireEvent.pointerDown(document.body);

    expect(screen.queryByText('No space')).toBeNull();
  });

  it('a click inside the popover does not trigger the outside-dismiss path (selection still applies)', async () => {
    const onCaptureSpaceIdChange = vi.fn();
    render(
      <EntryBar
        ownerUid={OWNER}
        onVoiceSave={vi.fn()}
        onTextSave={vi.fn()}
        embedded
        preferredMode="text"
        onCaptureSpaceIdChange={onCaptureSpaceIdChange}
      />
    );
    fireEvent.click(await screen.findByLabelText('Assign a space'));
    fireEvent.pointerDown(screen.getByText('Work'));
    fireEvent.click(screen.getByText('Work'));

    expect(onCaptureSpaceIdChange).toHaveBeenCalledWith('space-1');
  });

  it('Escape closes the open popover', async () => {
    render(
      <EntryBar ownerUid={OWNER} onVoiceSave={vi.fn()} onTextSave={vi.fn()} embedded preferredMode="text" />
    );
    fireEvent.click(await screen.findByLabelText('Assign a space'));
    expect(screen.getByText('No space')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByText('No space')).toBeNull();
  });

  it('does not attach document listeners while the popover is closed', async () => {
    render(
      <EntryBar ownerUid={OWNER} onVoiceSave={vi.fn()} onTextSave={vi.fn()} embedded preferredMode="text" />
    );
    await screen.findByLabelText('Assign a space');
    // Popover never opened — Escape must be a no-op (nothing to assert on
    // visibly, but this guards against a listener wrongly attached on mount).
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('switching modes (typing -> idle) resets the shared picker-open flag, so it never reopens in the other mode', async () => {
    render(
      <EntryBar ownerUid={OWNER} onVoiceSave={vi.fn()} onTextSave={vi.fn()} embedded preferredMode="text" />
    );
    // Open the picker in typing mode.
    fireEvent.click(await screen.findByLabelText('Assign a space'));
    expect(screen.getByRole('listbox')).toBeTruthy();

    // Leave typing mode without selecting anything (abandon the picker).
    fireEvent.click(screen.getByLabelText('Cancel text entry'));

    // Back in idle mode: the idle-mode Space pill renders, but its popover
    // must NOT have carried over as open.
    await screen.findByLabelText('Record voice entry');
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

// 2026-07-24 capture-sheet fix (Fix A, UI-1). `loading` and `mode` used to be
// independent sibling conditions — a loading=true render could mount an
// absolutely-positioned processing overlay on top of the still-mounted
// idle/recording/typing branch underneath it. These tests pin the fixed
// contract: `loading` is now mutually exclusive with every mode branch, the
// processing panel is a normal in-flow element, and it exposes role=status +
// an accessible name.
describe('EntryBar — processing state (Fix A, UI-1)', () => {
  it('loading=true renders the status but not Record, Type, stop-recording, or the text editor', () => {
    render(
      <EntryBar ownerUid={OWNER} onVoiceSave={vi.fn()} onTextSave={vi.fn()} embedded preferredMode="text" loading />
    );
    expect(screen.getByText('Processing your voice...')).toBeTruthy();
    expect(screen.queryByLabelText('Record voice entry')).toBeNull();
    expect(screen.queryByLabelText('Type entry')).toBeNull();
    expect(screen.queryByLabelText('Stop recording')).toBeNull();
    expect(screen.queryByPlaceholderText("What's on your mind?")).toBeNull();
  });

  it('renders the processing panel in normal flow, not absolutely positioned', () => {
    render(<EntryBar ownerUid={OWNER} onVoiceSave={vi.fn()} onTextSave={vi.fn()} embedded loading />);
    const status = screen.getByRole('status');
    expect(status.className).not.toMatch(/\babsolute\b/);
    expect(status.className).not.toMatch(/\binset-0\b/);
  });

  // CAP-02: the durable-custody copy fix. Durability (audioVault/
  // webChunkStore) already secures the recording before this panel ever
  // shows, and CAP-01 (background completion) hasn't landed — so this must
  // never promise the app can finish while backgrounded, only state the
  // save is already safe and processing may pause/resume.
  it('CAP-02: processing copy is honest about custody — no "keep the app open" instruction, no background-completion promise', () => {
    render(<EntryBar ownerUid={OWNER} onVoiceSave={vi.fn()} onTextSave={vi.fn()} embedded loading />);
    expect(screen.getByText('Your recording is saved. Processing may pause and resume if you leave.')).toBeTruthy();
    expect(screen.queryByText(/keep the app open/i)).toBeNull();
  });

  it('gives the processing panel role=status, aria-live=polite, and an accessible name', () => {
    render(<EntryBar ownerUid={OWNER} onVoiceSave={vi.fn()} onTextSave={vi.fn()} embedded loading />);
    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    // getByRole('status') already resolves via the accessible name computation
    // internally, but assert it explicitly too: an aria-label (or equivalent)
    // must be present, not just the role.
    expect(status.getAttribute('aria-label') || status.textContent).toBeTruthy();
  });

  it('does not mount the recording branch underneath processing (no stray recording artifact)', () => {
    // The recording pulse dot and the destructive stop button only exist in
    // the recording branch — assert the whole recording UI is absent, not
    // just its accessible name.
    const { container } = render(
      <EntryBar ownerUid={OWNER} onVoiceSave={vi.fn()} onTextSave={vi.fn()} embedded loading />
    );
    expect(container.querySelector('.bg-destructive')).toBeNull();
  });
});

// CAP-02: web capture must acquire the wake lock at recording START (inside
// the mic-tap gesture) — not after the recording has already stopped — and
// must release it on any of EntryBar's OWN pre-processing failure paths
// (the ones that never reach the caller's processing pipeline, which is the
// only other place that owns a release).
describe('EntryBar — wake lock acquire-at-start (CAP-02)', () => {
  it('acquires the wake lock as part of the mic-tap gesture, before getUserMedia resolves', async () => {
    const requestWakeLock = vi.fn().mockResolvedValue(true);
    const releaseWakeLock = vi.fn().mockResolvedValue(undefined);
    render(
      <EntryBar
        ownerUid={OWNER}
        onVoiceSave={vi.fn().mockResolvedValue(true)}
        onTextSave={vi.fn()}
        requestWakeLock={requestWakeLock}
        releaseWakeLock={releaseWakeLock}
      />
    );

    fireEvent.click(screen.getByLabelText('Record voice entry'));
    await waitFor(() => expect(requestWakeLock).toHaveBeenCalledTimes(1));
    expect(releaseWakeLock).not.toHaveBeenCalled();
  });

  it('releases the wake lock when getUserMedia is denied (never reaches the processing pipeline)', async () => {
    const requestWakeLock = vi.fn().mockResolvedValue(true);
    const releaseWakeLock = vi.fn().mockResolvedValue(undefined);
    navigator.mediaDevices.getUserMedia = vi.fn().mockRejectedValue(new Error('denied'));
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

    render(
      <EntryBar
        ownerUid={OWNER}
        onVoiceSave={vi.fn()}
        onTextSave={vi.fn()}
        requestWakeLock={requestWakeLock}
        releaseWakeLock={releaseWakeLock}
      />
    );

    fireEvent.click(screen.getByLabelText('Record voice entry'));
    await waitFor(() => expect(releaseWakeLock).toHaveBeenCalledTimes(1));
    alertSpy.mockRestore();
  });

  it('releases the wake lock when the stopped recording captured no audio data', async () => {
    const requestWakeLock = vi.fn().mockResolvedValue(true);
    const releaseWakeLock = vi.fn().mockResolvedValue(undefined);
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

    render(
      <EntryBar
        ownerUid={OWNER}
        onVoiceSave={vi.fn()}
        onTextSave={vi.fn()}
        requestWakeLock={requestWakeLock}
        releaseWakeLock={releaseWakeLock}
      />
    );
    const recorder = await startFakeRecording();
    // No ondataavailable events fired — chunks stays empty.
    await act(async () => { recorder.stop(); });

    await waitFor(() => expect(releaseWakeLock).toHaveBeenCalledTimes(1));
    alertSpy.mockRestore();
  });

  it('does NOT release the wake lock on a successful stop — the processing pipeline (onVoiceSave) owns that release', async () => {
    const requestWakeLock = vi.fn().mockResolvedValue(true);
    const releaseWakeLock = vi.fn().mockResolvedValue(undefined);
    const onVoiceSave = vi.fn().mockResolvedValue(true);

    render(
      <EntryBar
        ownerUid={OWNER}
        onVoiceSave={onVoiceSave}
        onTextSave={vi.fn()}
        requestWakeLock={requestWakeLock}
        releaseWakeLock={releaseWakeLock}
      />
    );
    const recorder = await startFakeRecording();
    recorder.ondataavailable({ data: new Blob(['chunk-0-'.repeat(20)]) });
    fireEvent.click(screen.getByLabelText('Stop recording'));

    await waitFor(() => expect(onVoiceSave).toHaveBeenCalled());
    expect(releaseWakeLock).not.toHaveBeenCalled();
  });

  it('renders and records fine with no wake-lock props supplied (defaults to safe no-ops)', async () => {
    render(<EntryBar ownerUid={OWNER} onVoiceSave={vi.fn().mockResolvedValue(true)} onTextSave={vi.fn()} />);
    const recorder = await startFakeRecording();
    expect(recorder).toBeTruthy();
  });
});

describe('EntryBar — A11Y-02: typing-mode textarea has a programmatic label', () => {
  it('the entry textarea is reachable by its accessible name, not just its placeholder', () => {
    render(<EntryBar ownerUid={OWNER} onVoiceSave={vi.fn()} onTextSave={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Type entry'));

    // getByRole with an accessible-name matcher fails if the textarea has no
    // programmatic label (aria-label/aria-labelledby/<label>) — placeholder
    // text alone does not satisfy this query.
    const textarea = screen.getByRole('textbox', { name: 'New journal entry' });
    expect(textarea).toBe(screen.getByPlaceholderText("What's on your mind?"));
  });
});

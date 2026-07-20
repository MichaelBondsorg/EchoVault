import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CaptureReliabilityCenter from '../CaptureReliabilityCenter';
import { audioVault } from '../../../services/audio/audioVault';
import { NativeCapture, deleteNativeDraft } from '../../../services/capture/nativeCaptureAdapter';
import { getQueuedEntries } from '../../../services/offline/offlineManager';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: () => ({}),
}));

vi.mock('../../../services/audio/audioVault', () => ({
  audioVault: {
    listOrphans: vi.fn().mockResolvedValue([]),
    getRecording: vi.fn(),
    saveRecording: vi.fn(),
  },
}));

vi.mock('../../../services/offline/offlineManager', () => ({
  getQueuedEntries: vi.fn().mockResolvedValue([]),
  discardEntry: vi.fn(),
}));

vi.mock('../../../services/sync/syncOrchestrator', () => ({
  forceSync: vi.fn(),
}));

vi.mock('../../../services/capture/nativeCaptureAdapter', () => ({
  NativeCapture: { listDrafts: vi.fn(), readDraft: vi.fn() },
  deleteNativeDraft: vi.fn().mockResolvedValue(undefined),
}));

const OWNER = 'user-a';
const staleDraft = {
  draftId: 'draft-1', status: 'needsReview', durationMilliseconds: 65_000, createdAt: '2026-07-20T10:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  getQueuedEntries.mockResolvedValue([]);
  audioVault.listOrphans.mockResolvedValue([]);
  NativeCapture.listDrafts.mockResolvedValue({ drafts: [staleDraft] });
  window.confirm = vi.fn().mockReturnValue(true);
});

describe('CaptureReliabilityCenter — needs-review native drafts', () => {
  it('lists a needsReview draft with duration and date, without auto-adopting it', async () => {
    render(<CaptureReliabilityCenter ownerUid={OWNER} onClose={vi.fn()} onRetryAudio={vi.fn()} />);

    expect(await screen.findByText(/Recording interrupted — 1:05/)).toBeTruthy();
    expect(audioVault.saveRecording).not.toHaveBeenCalled();
  });

  it('Transcribe adopts the draft into the vault, deletes the native draft, then hands off via onRetryAudio', async () => {
    NativeCapture.readDraft.mockResolvedValue({ base64: 'QUJD', mime: 'audio/mp4' });
    audioVault.saveRecording.mockResolvedValue({ id: 'rec_1' });
    const onRetryAudio = vi.fn();

    render(<CaptureReliabilityCenter ownerUid={OWNER} onClose={vi.fn()} onRetryAudio={onRetryAudio} />);
    await screen.findByText(/Recording interrupted/);
    fireEvent.click(screen.getByText('Transcribe'));

    await waitFor(() => expect(audioVault.saveRecording).toHaveBeenCalledWith(OWNER, 'QUJD', 'audio/mp4'));
    expect(deleteNativeDraft).toHaveBeenCalledWith(OWNER, 'draft-1');
    expect(onRetryAudio).toHaveBeenCalledWith('QUJD', 'audio/mp4', 'rec_1');
  });

  it('Transcribe does not delete the native draft or hand off when the vault adoption fails', async () => {
    NativeCapture.readDraft.mockResolvedValue({ base64: 'QUJD', mime: 'audio/mp4' });
    audioVault.saveRecording.mockResolvedValue({ error: 'quota' });
    const onRetryAudio = vi.fn();

    render(<CaptureReliabilityCenter ownerUid={OWNER} onClose={vi.fn()} onRetryAudio={onRetryAudio} />);
    await screen.findByText(/Recording interrupted/);
    fireEvent.click(screen.getByText('Transcribe'));

    await waitFor(() => expect(audioVault.saveRecording).toHaveBeenCalled());
    expect(deleteNativeDraft).not.toHaveBeenCalled();
    expect(onRetryAudio).not.toHaveBeenCalled();
  });

  it('Discard deletes the native draft after confirmation', async () => {
    render(<CaptureReliabilityCenter ownerUid={OWNER} onClose={vi.fn()} onRetryAudio={vi.fn()} />);
    await screen.findByText(/Recording interrupted/);
    fireEvent.click(screen.getByLabelText('Discard interrupted recording'));

    await waitFor(() => expect(deleteNativeDraft).toHaveBeenCalledWith(OWNER, 'draft-1'));
  });

  it('does not discard when the user cancels the confirmation', async () => {
    window.confirm.mockReturnValue(false);
    render(<CaptureReliabilityCenter ownerUid={OWNER} onClose={vi.fn()} onRetryAudio={vi.fn()} />);
    await screen.findByText(/Recording interrupted/);
    fireEvent.click(screen.getByLabelText('Discard interrupted recording'));

    expect(deleteNativeDraft).not.toHaveBeenCalled();
  });
});

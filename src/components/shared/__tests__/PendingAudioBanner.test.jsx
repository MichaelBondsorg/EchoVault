/**
 * Tests for PendingAudioBanner's retry/recovery semantics.
 *
 * Regression coverage for the review finding where a failed retry was
 * dropped from the recovery list because the banner (not the pipeline)
 * decided when to link a recording as "saved". Linking is now owned by the
 * caller (onRetry); the banner only ever reflects what the vault reports.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import PendingAudioBanner from '../PendingAudioBanner';
import { audioVault } from '../../../services/audio/audioVault';

vi.mock('../../../services/audio/audioVault', () => ({
  audioVault: {
    listOrphans: vi.fn(),
    getRecording: vi.fn(),
    linkEntry: vi.fn(),
  },
}));

const orphan = { id: 'rec_1', createdAt: Date.now() };

describe('PendingAudioBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    audioVault.listOrphans.mockResolvedValue([orphan]);
    audioVault.getRecording.mockResolvedValue({ base64: 'QUJD', mime: 'audio/webm' });
  });

  it('renders nothing when there are no orphans', async () => {
    audioVault.listOrphans.mockResolvedValue([]);
    const { container } = render(<PendingAudioBanner onRetry={vi.fn()} />);
    await waitFor(() => expect(audioVault.listOrphans).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });

  it('shows the orphaned recording count', async () => {
    render(<PendingAudioBanner onRetry={vi.fn()} />);
    expect(await screen.findByText(/1 unsaved recording/)).toBeTruthy();
  });

  it('keeps a recording listed after a failed retry — banner does not self-link', async () => {
    // Simulate the pipeline: retry fails, so the vault still reports the
    // recording as an orphan (nothing calls linkEntry on failure).
    const onRetry = vi.fn().mockResolvedValue(false);
    render(<PendingAudioBanner onRetry={onRetry} />);

    await screen.findByText(/1 unsaved recording/);
    fireEvent.click(screen.getByText('Retry now'));

    await waitFor(() => expect(onRetry).toHaveBeenCalledWith('QUJD', 'audio/webm', 'rec_1'));
    // The banner itself must never call linkEntry — that's the pipeline's job.
    expect(audioVault.linkEntry).not.toHaveBeenCalled();
    // Still shown, because listOrphans (re-fetched post-retry) still
    // reports the recording as unlinked.
    await waitFor(() => expect(screen.getByText(/1 unsaved recording/)).toBeTruthy());
  });

  it('refreshes when the vault emits engram:audio-vault-changed', async () => {
    render(<PendingAudioBanner onRetry={vi.fn()} />);
    await screen.findByText(/1 unsaved recording/);

    audioVault.listOrphans.mockResolvedValue([]);
    window.dispatchEvent(new CustomEvent('engram:audio-vault-changed'));

    await waitFor(() => expect(audioVault.listOrphans).toHaveBeenCalledTimes(2));
  });
});

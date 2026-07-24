import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import EntryComposer from '../EntryComposer';

// 2026-07-24 capture-sheet fix (Fix A, UI-1). EntryComposer renders the real
// EntryBar (not a fake) so these tests exercise the actual composition —
// EntryBar has its own dependency surface, mocked here the same way
// EntryBar.test.jsx mocks it. `getFlag` defaults everything off so
// Context Spaces / Voice Chapters chrome doesn't add noise to these tests.
const getFlag = vi.fn();
vi.mock('../../../config/flags', () => ({ getFlag: (...a) => getFlag(...a) }));
vi.mock('../../../config/firebase', () => ({ db: { __db: true } }));
vi.mock('../../../services/capture/webChunkStore', () => ({
  appendChunk: vi.fn().mockResolvedValue(true),
  appendMarker: vi.fn().mockResolvedValue(1),
  deleteDraft: vi.fn().mockResolvedValue(true),
  recoverWebDrafts: vi.fn().mockResolvedValue(0),
}));
vi.mock('../../../services/audio/audioVault', () => ({
  audioVault: { saveRecording: vi.fn() },
}));
vi.mock('../../../services/spaces/spacesService', () => ({
  subscribeSpaces: vi.fn(() => () => {}),
  setLastCaptureSpaceId: vi.fn().mockResolvedValue(undefined),
}));

const OWNER = 'user-a';

const baseProps = {
  isOpen: true,
  mode: 'text',
  onModeChange: vi.fn(),
  onClose: vi.fn(),
  onVoiceSave: vi.fn(),
  onTextSave: vi.fn(),
  aiProcessingEnabled: true,
  onRequestAiConsent: vi.fn(),
  ownerUid: OWNER,
};

beforeEach(() => {
  getFlag.mockReturnValue(false);
});

afterEach(() => {
  cleanup();
});

describe('EntryComposer — processing state (Fix A, UI-1)', () => {
  it('processing=true renders the status but not Record, Type, stop-recording, or text-editor controls', () => {
    render(
      <EntryComposer
        {...baseProps}
        processing
        reflection={<div>Reflect on your morning walk</div>}
        initialContext="a prior open loop"
      />
    );

    // Processing status is present.
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByText('Processing your voice...')).toBeTruthy();

    // The Reflect prompt and the initial-context chip are hidden.
    expect(screen.queryByText('Reflect on your morning walk')).toBeNull();
    expect(screen.queryByText(/Following up: a prior open loop/)).toBeNull();

    // EntryComposer's own entry-method tabs are hidden.
    expect(screen.queryByRole('tab', { name: 'Type' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Record' })).toBeNull();

    // No recording, idle, or typing control from the embedded EntryBar is
    // mounted underneath the processing panel.
    expect(screen.queryByLabelText('Record voice entry')).toBeNull();
    expect(screen.queryByLabelText('Type entry')).toBeNull();
    expect(screen.queryByLabelText('Stop recording')).toBeNull();
    expect(screen.queryByPlaceholderText("What's on your mind?")).toBeNull();
  });

  it('renders the processing panel in normal flow, not absolutely positioned', () => {
    render(<EntryComposer {...baseProps} processing reflection={<div>Reflect</div>} />);
    const status = screen.getByRole('status');
    expect(status.className).not.toMatch(/\babsolute\b/);
    expect(status.className).not.toMatch(/\binset-0\b/);
  });

  // CAP-02: same honest-custody copy contract as EntryBar.test.jsx, exercised
  // through the real composition (EntryComposer renders the real EntryBar).
  it('CAP-02: processing copy is honest about custody — no "keep the app open" instruction, no background-completion promise', () => {
    render(<EntryComposer {...baseProps} processing reflection={<div>Reflect</div>} />);
    expect(screen.getByText('Your recording is saved. Processing may pause and resume if you leave.')).toBeTruthy();
    expect(screen.queryByText(/keep the app open/i)).toBeNull();
  });

  it('gives the processing status role=status, aria-live=polite, and an accessible name', () => {
    render(<EntryComposer {...baseProps} processing reflection={<div>Reflect</div>} />);
    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.getAttribute('aria-label') || status.textContent).toBeTruthy();
  });

  it('long Reflect content returns once processing ends', () => {
    const longReflect = 'x'.repeat(400);
    const { rerender } = render(
      <EntryComposer {...baseProps} processing reflection={<div>{longReflect}</div>} />
    );
    expect(screen.queryByText(longReflect)).toBeNull();

    rerender(<EntryComposer {...baseProps} processing={false} reflection={<div>{longReflect}</div>} />);
    expect(screen.getByText(longReflect)).toBeTruthy();
    // And the entry-method tabs are back too.
    expect(screen.getByRole('tab', { name: 'Type' })).toBeTruthy();
  });

  it('close stays locked while processing (dismissal-locking policy unchanged)', () => {
    render(<EntryComposer {...baseProps} processing reflection={<div>Reflect</div>} />);
    expect(screen.getByLabelText('Close new entry').hasAttribute('disabled')).toBe(true);
  });

  it("carries the composer's dynamic-viewport body-viewport classes (min-h-0, overflow-y-auto, overscroll-contain)", () => {
    render(<EntryComposer {...baseProps} reflection={<div>Reflect</div>} />);
    // DrawerContent portals into document.body (vaul), not the RTL
    // container, so query the whole document.
    const viewport = document.body.querySelector('.min-h-0.overflow-y-auto.overscroll-contain');
    expect(viewport).toBeTruthy();
  });
});

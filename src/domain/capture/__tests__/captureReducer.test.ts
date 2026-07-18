import { canTransition, initialCaptureState, reduceCapture } from '../captureReducer';

describe('capture reducer', () => {
  it('moves from idle to preparing to recording only after confirmation', () => {
    const preparing = reduceCapture(initialCaptureState, {
      type: 'START_REQUESTED',
      requestId: 'req-1',
    });
    expect(preparing).toEqual({ status: 'preparing', requestId: 'req-1' });

    const recording = reduceCapture(preparing, {
      type: 'START_CONFIRMED',
      requestId: 'req-1',
      draftId: 'draft-1',
      startedAt: '2026-07-18T12:00:00.000Z',
    });
    expect(recording.status).toBe('recording');
  });

  it('ignores stale native start confirmation', () => {
    const preparing = { status: 'preparing', requestId: 'req-new' } as const;
    expect(
      reduceCapture(preparing, {
        type: 'START_CONFIRMED',
        requestId: 'req-old',
        draftId: 'draft-old',
        startedAt: '2026-07-18T12:00:00.000Z',
      })
    ).toBe(preparing);
  });

  it('finalizes and stores a recording without skipping durable storage', () => {
    const recording = {
      status: 'recording',
      draftId: 'draft-1',
      startedAt: '2026-07-18T12:00:00.000Z',
    } as const;
    const finalizing = reduceCapture(recording, { type: 'STOP_REQUESTED' });
    expect(finalizing).toEqual({ status: 'finalizing', draftId: 'draft-1' });
    expect(
      reduceCapture(finalizing, {
        type: 'FILE_STORED',
        draftId: 'draft-1',
        assetId: 'asset-1',
        durationMs: 8_000,
      })
    ).toEqual({
      status: 'stored',
      draftId: 'draft-1',
      assetId: 'asset-1',
      durationMs: 8_000,
    });
  });

  it('rejects illegal transitions and duplicate stop commands', () => {
    expect(canTransition('idle', 'STOP_REQUESTED')).toBe(false);
    expect(reduceCapture(initialCaptureState, { type: 'STOP_REQUESTED' })).toBe(
      initialCaptureState
    );
    const finalizing = { status: 'finalizing', draftId: 'draft-1' } as const;
    expect(reduceCapture(finalizing, { type: 'STOP_REQUESTED' })).toBe(finalizing);
  });

  it('recovers an interrupted partial recording for review', () => {
    const interrupted = {
      status: 'interrupted',
      draftId: 'draft-1',
      reason: 'call',
      recoverable: true,
    } as const;
    expect(
      reduceCapture(interrupted, {
        type: 'PARTIAL_RECOVERED',
        draftId: 'draft-1',
        assetId: 'asset-1',
      })
    ).toEqual({
      status: 'needsReview',
      draftId: 'draft-1',
      assetId: 'asset-1',
      reason: 'Recovered after call',
    });
  });
});

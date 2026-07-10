/**
 * Tests for QuickCaptureWidget — the Bento front door for voice capture.
 *
 * One tap should request voice capture via uiStore; AppLayout (elsewhere)
 * reacts to `captureRequest` by opening the entry modal with voice auto-start.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import QuickCaptureWidget from '../QuickCaptureWidget';
import { useUiStore } from '../../../../stores/uiStore';

describe('QuickCaptureWidget', () => {
  beforeEach(() => {
    useUiStore.getState().clearCaptureRequest();
  });

  it('requests voice capture on tap', () => {
    render(<QuickCaptureWidget />);
    fireEvent.click(screen.getByRole('button', { name: /brain dump/i }));
    expect(useUiStore.getState().captureRequest?.mode).toBe('voice');
  });
});

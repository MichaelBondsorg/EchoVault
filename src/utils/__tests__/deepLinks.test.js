import { describe, it, expect } from 'vitest';
import { parseCaptureLink, isCaptureRequestStale, CAPTURE_REQUEST_MAX_AGE_MS } from '../deepLinks';

describe('parseCaptureLink', () => {
  it('parses voice capture links', () => {
    expect(parseCaptureLink('engram://capture?mode=voice')).toEqual({ mode: 'voice' });
  });
  it('parses text mode', () => {
    expect(parseCaptureLink('engram://capture?mode=text')).toEqual({ mode: 'text' });
  });
  it('defaults missing/unknown mode to voice', () => {
    expect(parseCaptureLink('engram://capture')).toEqual({ mode: 'voice' });
    expect(parseCaptureLink('engram://capture?mode=banana')).toEqual({ mode: 'voice' });
  });
  it('returns null for non-capture links (OAuth callbacks untouched)', () => {
    expect(parseCaptureLink('engram://auth-success?provider=whoop')).toBeNull();
    expect(parseCaptureLink('https://example.com/capture')).toBeNull();
    expect(parseCaptureLink('not a url')).toBeNull();
  });
});

describe('isCaptureRequestStale', () => {
  it('is not stale for a fresh request', () => {
    const now = Date.now();
    expect(isCaptureRequestStale({ mode: 'voice', ts: now }, now)).toBe(false);
  });
  it('is stale for a request older than the max age', () => {
    const now = Date.now();
    const ts = now - (CAPTURE_REQUEST_MAX_AGE_MS + 1000);
    expect(isCaptureRequestStale({ mode: 'voice', ts }, now)).toBe(true);
  });
  it('is stale for null/missing request or missing ts', () => {
    const now = Date.now();
    expect(isCaptureRequestStale(null, now)).toBe(true);
    expect(isCaptureRequestStale({ mode: 'voice' }, now)).toBe(true);
  });
});

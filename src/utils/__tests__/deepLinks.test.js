import { describe, it, expect } from 'vitest';
import { parseCaptureLink } from '../deepLinks';

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

/**
 * R2 plan task 5: ClientMessageSchema's start_session variant must accept an
 * optional, nullable spaceId (the client's active Context Space at session
 * start) without breaking existing messages that omit it entirely.
 */
import { describe, it, expect } from 'vitest';
import { ClientMessageSchema } from '../types/index.js';

describe('ClientMessageSchema — start_session spaceId', () => {
  it('accepts a start_session message with a string spaceId', () => {
    const result = ClientMessageSchema.safeParse({
      type: 'start_session',
      mode: 'realtime',
      sessionType: 'free',
      spaceId: 'work',
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.type === 'start_session') {
      expect(result.data.spaceId).toBe('work');
    }
  });

  it('accepts a start_session message with spaceId: null', () => {
    const result = ClientMessageSchema.safeParse({
      type: 'start_session',
      mode: 'realtime',
      spaceId: null,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a start_session message that omits spaceId entirely (legacy clients)', () => {
    const result = ClientMessageSchema.safeParse({
      type: 'start_session',
      mode: 'realtime',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a non-string, non-null spaceId', () => {
    const result = ClientMessageSchema.safeParse({
      type: 'start_session',
      mode: 'realtime',
      spaceId: 42,
    });
    expect(result.success).toBe(false);
  });
});

import { classifyLegacyRecord, ownerKey, OwnerScopeError, parseOwnerUid } from '../ownerScope';

describe('owner scope', () => {
  it.each(['', '   ', null, undefined])('rejects an absent owner (%s)', (value) => {
    expect(() => parseOwnerUid(value)).toThrowError(OwnerScopeError);
    try {
      parseOwnerUid(value);
    } catch (error) {
      expect((error as OwnerScopeError).code).toBe('owner_required');
    }
  });

  it('creates different physical keys for the same item owned by different users', () => {
    const a = ownerKey(parseOwnerUid('user-A'), 'offline/entries', 'draft-1');
    const b = ownerKey(parseOwnerUid('user-B'), 'offline/entries', 'draft-1');
    expect(a).not.toBe(b);
    expect(a).toContain('user-A');
  });

  it.each(['a/b', '..', '%2F'])('encodes namespace-breaking owner characters in %s', (uid) => {
    const key = ownerKey(parseOwnerUid(uid), 'audio', 'recording-1');
    const ownerSegment = key.split(':')[3];
    expect(ownerSegment).not.toContain('/');
    expect(ownerSegment).not.toBe('..');
  });

  it('quarantines legacy records without verifiable ownership', () => {
    expect(classifyLegacyRecord({ text: 'private' })).toEqual({ kind: 'legacy-unowned' });
    expect(classifyLegacyRecord({ ownerUid: 'user-A' })).toEqual({
      kind: 'owned',
      ownerUid: 'user-A',
    });
  });
});

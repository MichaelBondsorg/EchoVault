export type OwnerUid = string & { readonly __brand: 'OwnerUid' };

export class OwnerScopeError extends Error {
  readonly code: 'owner_required' | 'owner_invalid';

  constructor(code: 'owner_required' | 'owner_invalid') {
    super(code);
    this.name = 'OwnerScopeError';
    this.code = code;
  }
}

export function parseOwnerUid(value: unknown): OwnerUid {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new OwnerScopeError('owner_required');
  }

  const owner = value.trim();
  if (owner.length > 256 || /[\u0000-\u001f\u007f]/u.test(owner)) {
    throw new OwnerScopeError('owner_invalid');
  }
  return owner as OwnerUid;
}

const encodeSegment = (value: string): string => encodeURIComponent(value).replace(/\./g, '%2E');

export function ownerKey(uid: OwnerUid, area: string, id?: string): string {
  if (area.trim().length === 0) throw new OwnerScopeError('owner_invalid');
  const parts = ['engram', 'v2', 'owner', encodeSegment(uid), encodeSegment(area.trim())];
  if (id !== undefined) parts.push(encodeSegment(id));
  return parts.join(':');
}

export type LegacyRecordClassification =
  | { kind: 'owned'; ownerUid: OwnerUid }
  | { kind: 'legacy-unowned' }
  | { kind: 'invalid'; reason: string };

export function classifyLegacyRecord(record: unknown): LegacyRecordClassification {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return { kind: 'invalid', reason: 'record_invalid' };
  }
  if (!('ownerUid' in record)) return { kind: 'legacy-unowned' };

  try {
    return {
      kind: 'owned',
      ownerUid: parseOwnerUid((record as { ownerUid?: unknown }).ownerUid),
    };
  } catch {
    return { kind: 'invalid', reason: 'owner_invalid' };
  }
}

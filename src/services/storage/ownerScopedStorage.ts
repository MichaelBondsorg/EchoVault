import { ownerKey, parseOwnerUid, type OwnerUid } from '../../domain/storage/ownerScope';

export const ownerStorageKey = (ownerUid: unknown, area: string): string =>
  ownerKey(parseOwnerUid(ownerUid), area);

export const encodedOwnerSegment = (ownerUid: unknown): string =>
  encodeURIComponent(parseOwnerUid(ownerUid)).replace(/\./g, '%2E');

export const requireOwner = (ownerUid: unknown): OwnerUid => parseOwnerUid(ownerUid);

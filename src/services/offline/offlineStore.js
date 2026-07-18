/** Owner-scoped persistent queue for offline journal entries. */
import { Preferences } from '@capacitor/preferences';
import { ownerStorageKey, requireOwner } from '../storage/ownerScopedStorage';
import {
  getLegacyQuarantineCount,
  quarantineLegacyPreference,
} from '../storage/legacyQuarantine';

const LEGACY_ENTRIES_KEY = 'offline_entries_queue';
const LEGACY_METADATA_KEY = 'offline_metadata';
const ENTRIES_AREA = 'offline/entries';
const METADATA_AREA = 'offline/metadata';

const entriesKey = (ownerUid) => ownerStorageKey(ownerUid, ENTRIES_AREA);
const metadataKey = (ownerUid) => ownerStorageKey(ownerUid, METADATA_AREA);

const quarantineLegacyData = async () => {
  await quarantineLegacyPreference(LEGACY_ENTRIES_KEY, ENTRIES_AREA);
  await quarantineLegacyPreference(LEGACY_METADATA_KEY, METADATA_AREA);
};

const writeEntries = async (ownerUid, entries) => {
  await Preferences.set({ key: entriesKey(ownerUid), value: JSON.stringify(entries) });
};

export const getOfflineEntries = async (ownerUid) => {
  const owner = requireOwner(ownerUid);
  try {
    await quarantineLegacyData();
    const { value } = await Preferences.get({ key: entriesKey(owner) });
    if (!value) return [];
    const records = JSON.parse(value);
    if (!Array.isArray(records)) return [];
    return records.filter((entry) => entry?.ownerUid === owner);
  } catch (error) {
    console.error('[OfflineStore] Error reading owner queue:', error?.message);
    return [];
  }
};

export const saveOfflineEntry = async (ownerUid, entry) => {
  const owner = requireOwner(ownerUid);
  const entries = await getOfflineEntries(owner);
  const offlineId = entry.offlineId || generateOfflineId();
  const existing = entries.find((candidate) => candidate.offlineId === offlineId);
  if (existing) return existing;

  const offlineEntry = {
    ...entry,
    ownerUid: owner,
    offlineId,
    syncStatus: 'pending',
    retryCount: 0,
    createdOfflineAt: new Date().toISOString(),
    lastAttemptAt: null,
  };
  await writeEntries(owner, [...entries, offlineEntry]);
  await updateMetadata(owner, { lastSaved: new Date().toISOString() });
  console.log('[OfflineStore] Queued owner-scoped operation:', offlineId);
  return offlineEntry;
};

export const updateOfflineEntry = async (ownerUid, offlineId, updates) => {
  const owner = requireOwner(ownerUid);
  const entries = await getOfflineEntries(owner);
  const index = entries.findIndex((entry) => entry.offlineId === offlineId);
  if (index === -1) return null;

  entries[index] = {
    ...entries[index],
    ...updates,
    ownerUid: owner,
    offlineId,
    updatedAt: new Date().toISOString(),
  };
  await writeEntries(owner, entries);
  return entries[index];
};

export const removeOfflineEntry = async (ownerUid, offlineId) => {
  const owner = requireOwner(ownerUid);
  const entries = await getOfflineEntries(owner);
  const filtered = entries.filter((entry) => entry.offlineId !== offlineId);
  if (filtered.length === entries.length) return false;
  await writeEntries(owner, filtered);
  return true;
};

export const getPendingEntries = async (ownerUid, { maxRetries = 3 } = {}) => {
  const entries = await getOfflineEntries(ownerUid);
  return entries.filter(
    (entry) => entry.syncStatus === 'pending' && entry.retryCount < maxRetries
  );
};

export const getFailedEntries = async (ownerUid) =>
  (await getOfflineEntries(ownerUid)).filter((entry) => entry.syncStatus === 'failed');

export const markSyncing = async (ownerUid, offlineId) =>
  updateOfflineEntry(ownerUid, offlineId, {
    syncStatus: 'syncing',
    lastAttemptAt: new Date().toISOString(),
  });

export const markSynced = async (ownerUid, offlineId, serverId, serverAnalysis = null) =>
  updateOfflineEntry(ownerUid, offlineId, {
    syncStatus: 'synced',
    serverId,
    serverAnalysis,
    syncedAt: new Date().toISOString(),
  });

export const markFailed = async (ownerUid, offlineId, error) => {
  const entry = (await getOfflineEntries(ownerUid)).find(
    (candidate) => candidate.offlineId === offlineId
  );
  if (!entry) return null;
  const retryCount = (entry.retryCount || 0) + 1;
  return updateOfflineEntry(ownerUid, offlineId, {
    syncStatus: retryCount >= 3 ? 'failed' : 'pending',
    retryCount,
    lastError: error,
    lastAttemptAt: new Date().toISOString(),
  });
};

export const resetStuckSyncing = async (ownerUid) => {
  const owner = requireOwner(ownerUid);
  const entries = await getOfflineEntries(owner);
  let reset = 0;
  const repaired = entries.map((entry) => {
    if (entry.syncStatus !== 'syncing') return entry;
    reset += 1;
    return { ...entry, syncStatus: 'pending' };
  });
  if (reset > 0) await writeEntries(owner, repaired);
  return reset;
};

export const clearSyncedEntries = async (ownerUid) => {
  const owner = requireOwner(ownerUid);
  const entries = await getOfflineEntries(owner);
  const pending = entries.filter((entry) => entry.syncStatus !== 'synced');
  await writeEntries(owner, pending);
  return entries.length - pending.length;
};

export const getMetadata = async (ownerUid) => {
  const owner = requireOwner(ownerUid);
  await quarantineLegacyData();
  try {
    const { value } = await Preferences.get({ key: metadataKey(owner) });
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
};

export const updateMetadata = async (ownerUid, updates) => {
  const owner = requireOwner(ownerUid);
  const updated = { ...(await getMetadata(owner)), ...updates, ownerUid: owner };
  await Preferences.set({ key: metadataKey(owner), value: JSON.stringify(updated) });
  return updated;
};

export const getStats = async (ownerUid) => {
  const entries = await getOfflineEntries(ownerUid);
  return {
    total: entries.length,
    pending: entries.filter((entry) => entry.syncStatus === 'pending').length,
    syncing: entries.filter((entry) => entry.syncStatus === 'syncing').length,
    synced: entries.filter((entry) => entry.syncStatus === 'synced').length,
    failed: entries.filter((entry) => entry.syncStatus === 'failed').length,
    oldestPending:
      entries
        .filter((entry) => entry.syncStatus === 'pending')
        .sort((a, b) => new Date(a.createdOfflineAt) - new Date(b.createdOfflineAt))[0]
        ?.createdOfflineAt || null,
    quarantinedLegacyRecords: await getLegacyQuarantineCount(ENTRIES_AREA),
  };
};

const generateOfflineId = () =>
  `offline_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

/** Remove only the requested owner's queue and metadata. */
export const clearAll = async (ownerUid) => {
  const owner = requireOwner(ownerUid);
  await Preferences.remove({ key: entriesKey(owner) });
  await Preferences.remove({ key: metadataKey(owner) });
};

export default {
  getOfflineEntries,
  saveOfflineEntry,
  updateOfflineEntry,
  removeOfflineEntry,
  getPendingEntries,
  getFailedEntries,
  markSyncing,
  markSynced,
  markFailed,
  resetStuckSyncing,
  clearSyncedEntries,
  getMetadata,
  updateMetadata,
  getStats,
  clearAll,
};

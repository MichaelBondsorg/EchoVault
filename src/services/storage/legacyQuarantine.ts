import { Preferences } from '@capacitor/preferences';

const QUARANTINE_VERSION = 1;

export const legacyQuarantineKey = (area: string): string =>
  `engram:v2:quarantine:${encodeURIComponent(area)}`;

/**
 * Move an unowned legacy Preferences payload out of all owner-visible paths.
 * The payload is not claimed by the next signed-in account.
 */
export async function quarantineLegacyPreference(
  legacyKey: string,
  area: string
): Promise<boolean> {
  const { value } = await Preferences.get({ key: legacyKey });
  if (value == null) return false;

  const key = legacyQuarantineKey(area);
  const existing = await Preferences.get({ key });
  const records = existing.value ? JSON.parse(existing.value) : [];
  records.push({
    version: QUARANTINE_VERSION,
    legacyKey,
    quarantinedAt: new Date().toISOString(),
    payload: value,
  });
  await Preferences.set({ key, value: JSON.stringify(records) });
  await Preferences.remove({ key: legacyKey });
  return true;
}

export async function getLegacyQuarantineCount(area: string): Promise<number> {
  const { value } = await Preferences.get({ key: legacyQuarantineKey(area) });
  if (!value) return 0;
  try {
    const records = JSON.parse(value);
    return Array.isArray(records) ? records.length : 0;
  } catch {
    return 0;
  }
}

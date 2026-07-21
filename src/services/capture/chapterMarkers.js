/**
 * Voice Chapters (flag: voiceChapters) — canonical marker shape.
 *
 * Web capture stores/passes chapter markers as raw `number[]` tap
 * timestamps (see webChunkStore.js's `meta.markers`, EntryBar's
 * `markersRef`); native capture passes `Array<{ tMs: number }>` (see
 * nativeCaptureAdapter.ts / CaptureService's StoredCapture.markers). Both
 * shapes land unnormalized in EntryBar's `options.markers` before this fix,
 * meaning everything downstream (App.jsx handleAudioWrapper,
 * prepareDurableRecording, audioVault, operationStore) would have to branch
 * on platform to know what shape they hold — instead they're opaque
 * pass-through consumers, so normalizing ONCE at this boundary (EntryBar,
 * before anything leaves the component) is the right place to fix it.
 *
 * Canonical shape: `Array<{ tMs: number }>` (native's shape — already the
 * richer/more-extensible of the two, and requires no change to native code).
 * `undefined` for empty/absent/all-invalid input — no empty-array stuffing,
 * matching this feature's existing "omit, don't stuff" convention elsewhere
 * (see webChunkStore.js, prepareDurableRecording.js, audioVault.js).
 *
 * IDB's own internal storage format (webChunkStore's `meta.markers`) is
 * deliberately left as raw numbers — this normalizer is a boundary function
 * for what leaves EntryBar, not a storage-schema change.
 */
export function normalizeMarkers(input) {
  if (!Array.isArray(input) || input.length === 0) return undefined;

  const normalized = input.reduce((acc, entry) => {
    if (typeof entry === 'number' && Number.isFinite(entry)) {
      acc.push({ tMs: entry });
    } else if (entry && typeof entry.tMs === 'number' && Number.isFinite(entry.tMs)) {
      acc.push({ tMs: entry.tMs });
    }
    return acc;
  }, []);

  return normalized.length ? normalized : undefined;
}

export default normalizeMarkers;

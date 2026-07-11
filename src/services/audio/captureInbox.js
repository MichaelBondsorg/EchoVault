/**
 * Background-captured recordings (iOS Shortcuts "Record Audio" ->
 * SaveBrainDumpIntent, see ios/App/App/CaptureIntents.swift) land in an
 * inbox directory in the app container while Engram is never opened.
 *
 * sweepCaptureInbox() moves each pending recording into the audioVault
 * (durable, indexed storage) and returns items for the caller to run
 * through the normal transcription pipeline. Inbox files are deleted only
 * after the vault copy succeeds — a failed vault copy leaves the file in
 * place so the next sweep (next launch/foreground) retries it.
 *
 * Each recording's audioVault entry is stamped with its *capture* time
 * (from the `<id>.json` sidecar written by the intent), not the time this
 * sweep runs, so the eventual journal entry reflects when the user actually
 * spoke rather than whenever the app next happened to open.
 */
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { audioVault } from './audioVault';

const INBOX_DIR = 'engram-inbox';
const AUDIO_EXT = '.m4a';
const META_EXT = '.json';
const DEFAULT_MIME = 'audio/mp4';

const isNative = () => Capacitor.isNativePlatform();

const inboxPath = (name) => `${INBOX_DIR}/${name}`;

/** Best-effort delete — never throws, callers don't need to know if it worked. */
async function safeDelete(name) {
  try {
    await Filesystem.deleteFile({ path: inboxPath(name), directory: Directory.Data });
  } catch (e) {
    console.warn('[captureInbox] failed to delete', name, e);
  }
}

/**
 * Reads and parses the `<id>.json` sidecar for a captured recording.
 * Never throws — falls back to defaults (now / audio/mp4) on any failure,
 * so a corrupt or unreadable sidecar never blocks the recording itself
 * from being swept.
 */
async function readSidecar(name) {
  const defaults = { capturedAt: new Date().toISOString(), mime: DEFAULT_MIME };
  try {
    const { data } = await Filesystem.readFile({
      path: inboxPath(name),
      directory: Directory.Data,
      encoding: Encoding.UTF8
    });
    const meta = JSON.parse(data);
    return {
      capturedAt: typeof meta?.capturedAt === 'string' ? meta.capturedAt : defaults.capturedAt,
      mime: typeof meta?.mime === 'string' ? meta.mime : defaults.mime
    };
  } catch (e) {
    console.warn('[captureInbox] failed to read sidecar', name, e);
    return defaults;
  }
}

export async function sweepCaptureInbox() {
  if (!isNative()) return [];

  let files;
  try {
    ({ files } = await Filesystem.readdir({ path: INBOX_DIR, directory: Directory.Data }));
  } catch {
    // Directory doesn't exist yet — nothing has ever been captured.
    return [];
  }

  const names = (files || []).map((f) => (typeof f === 'string' ? f : f.name));
  const nameSet = new Set(names);
  const ids = [...new Set(
    names.filter((n) => n.endsWith(AUDIO_EXT)).map((n) => n.slice(0, -AUDIO_EXT.length))
  )];

  const results = [];
  for (const id of ids) {
    const audioName = `${id}${AUDIO_EXT}`;
    const metaName = `${id}${META_EXT}`;
    try {
      const hasSidecar = nameSet.has(metaName);
      const { capturedAt, mime } = hasSidecar
        ? await readSidecar(metaName)
        : { capturedAt: new Date().toISOString(), mime: DEFAULT_MIME };

      const { data: base64 } = await Filesystem.readFile({
        path: inboxPath(audioName),
        directory: Directory.Data
      });

      const recordingId = await audioVault.saveRecording(base64, mime, {
        createdAt: Date.parse(capturedAt) || Date.now()
      });

      if (!recordingId) {
        // Vault write failed — leave both files for the next sweep.
        continue;
      }

      await safeDelete(audioName);
      if (hasSidecar) await safeDelete(metaName);

      results.push({ recordingId, base64, mime, capturedAt });
    } catch (e) {
      // Never let one bad file take down the whole sweep.
      console.warn('[captureInbox] failed to process', id, e);
    }
  }

  return results;
}

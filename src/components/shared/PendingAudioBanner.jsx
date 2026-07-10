import { useEffect, useState } from 'react';
import { audioVault } from '../../services/audio/audioVault';

/**
 * Shows when unsaved recordings exist (transcription failed or app died
 * mid-flight). Retry re-runs the normal transcription+save pipeline.
 */
const PendingAudioBanner = ({ onRetry }) => {
  const [orphans, setOrphans] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    audioVault.listOrphans().then(setOrphans);
  }, []);

  if (orphans.length === 0) return null;

  const retryAll = async () => {
    setBusy(true);
    for (const { id } of orphans) {
      const rec = await audioVault.getRecording(id);
      if (rec) {
        const ok = await onRetry(rec.base64, rec.mime);
        if (ok) await audioVault.linkEntry(id, 'saved');
      }
    }
    setOrphans(await audioVault.listOrphans());
    setBusy(false);
  };

  return (
    <div className="mx-4 my-2 rounded-xl bg-honey-50 dark:bg-honey-900/30 border border-honey-200 dark:border-honey-800 px-4 py-3 flex items-center justify-between gap-3">
      <p className="text-sm text-honey-700 dark:text-honey-300">
        {orphans.length} unsaved recording{orphans.length > 1 ? 's' : ''} — audio is safe on this device.
      </p>
      <button
        onClick={retryAll}
        disabled={busy}
        className="text-sm font-medium text-honey-700 dark:text-honey-300 underline disabled:opacity-50"
      >
        {busy ? 'Retrying…' : 'Retry now'}
      </button>
    </div>
  );
};

export default PendingAudioBanner;

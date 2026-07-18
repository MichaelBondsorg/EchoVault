import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, CloudOff, Mic, RefreshCw, Trash2, X } from 'lucide-react';
import { audioVault } from '../../services/audio/audioVault';
import { discardEntry, getQueuedEntries } from '../../services/offline/offlineManager';
import { forceSync } from '../../services/sync/syncOrchestrator';

const CaptureReliabilityCenter = ({ ownerUid, onClose, onRetryAudio }) => {
  const [entries, setEntries] = useState([]);
  const [recordings, setRecordings] = useState([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!ownerUid) return;
    const [queued, orphaned] = await Promise.all([
      getQueuedEntries(ownerUid),
      audioVault.listOrphans(ownerUid),
    ]);
    setEntries(queued);
    setRecordings(orphaned);
  }, [ownerUid]);

  useEffect(() => { refresh(); }, [refresh]);

  const sync = async () => {
    setBusy(true);
    try {
      await forceSync();
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const retryRecording = async (id) => {
    const recording = await audioVault.getRecording(ownerUid, id);
    if (recording) await onRetryAudio?.(recording.base64, recording.mime, id);
    await refresh();
  };

  return (
    <div className="fixed inset-0 z-[90] overflow-y-auto bg-[var(--background)] p-4 pb-[calc(env(safe-area-inset-bottom)+24px)] pt-[calc(env(safe-area-inset-top)+16px)]" role="dialog" aria-modal="true" aria-labelledby="reliability-title">
      <div className="mx-auto max-w-xl">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <p className="cloud-kicker">RECOVERY</p>
            <h2 id="reliability-title" className="cloud-title text-3xl">Your entries are safe</h2>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">Review anything waiting to sync or finish processing.</p>
          </div>
          <button type="button" className="cloud-icon-button" aria-label="Close reliability center" onClick={onClose}><X size={21} /></button>
        </div>

        {entries.length === 0 && recordings.length === 0 ? (
          <div className="cloud-sheet rounded-2xl border p-6 text-center shadow-sm">
            <CheckCircle2 className="mx-auto mb-3 text-[var(--accent)]" size={34} />
            <p className="font-semibold">Everything is up to date</p>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">No unsynced entries or recoverable recordings.</p>
          </div>
        ) : (
          <div className="space-y-5">
            {entries.length > 0 && (
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="cloud-kicker">WAITING TO SYNC · {entries.length}</h3>
                  <button type="button" onClick={sync} disabled={busy} className="inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-semibold text-[var(--accent-deep)]"><RefreshCw className={busy ? 'animate-spin' : ''} size={16} /> Sync now</button>
                </div>
                <div className="cloud-sheet divide-y divide-[var(--divider)] overflow-hidden rounded-2xl border shadow-sm">
                  {entries.map((entry) => (
                    <div key={entry.offlineId} className="flex min-h-16 items-center gap-3 px-4 py-3">
                      <CloudOff className="text-[var(--accent)]" size={20} />
                      <div className="flex-1">
                        <p className="font-semibold capitalize">{entry.syncStatus === 'failed' ? 'Needs attention' : 'Saved on this device'}</p>
                        <p className="text-xs text-[var(--muted-foreground)]">{new Date(entry.createdOfflineAt).toLocaleString()}</p>
                      </div>
                      {entry.syncStatus === 'failed' && (
                        <button type="button" aria-label="Discard failed entry" className="cloud-icon-button text-[var(--destructive)]" onClick={async () => {
                          if (window.confirm('Discard this failed local copy? This cannot be undone.')) {
                            await discardEntry(ownerUid, entry.offlineId);
                            await refresh();
                          }
                        }}><Trash2 size={18} /></button>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {recordings.length > 0 && (
              <section>
                <h3 className="cloud-kicker mb-2">RECOVERABLE RECORDINGS · {recordings.length}</h3>
                <div className="cloud-sheet divide-y divide-[var(--divider)] overflow-hidden rounded-2xl border shadow-sm">
                  {recordings.map((recording) => (
                    <div key={recording.id} className="flex min-h-16 items-center gap-3 px-4 py-3">
                      <Mic className="text-[var(--accent)]" size={20} />
                      <div className="flex-1">
                        <p className="font-semibold">Audio saved locally</p>
                        <p className="text-xs text-[var(--muted-foreground)]">{new Date(recording.createdAt).toLocaleString()}</p>
                      </div>
                      <button type="button" onClick={() => retryRecording(recording.id)} className="min-h-11 rounded-full px-3 text-sm font-semibold text-[var(--accent-deep)]">Retry</button>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default CaptureReliabilityCenter;

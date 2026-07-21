import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, Square, X, Loader2, Tag } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { CaptureService } from '../../services/capture/captureService';
import { nativeCaptureAdapter } from '../../services/capture/nativeCaptureAdapter';
import { appendChunk, deleteDraft, recoverWebDrafts } from '../../services/capture/webChunkStore';
import { restoreDraft, writeDraft, clearDraft } from '../../services/capture/draftAutosave';
import { audioVault } from '../../services/audio/audioVault';
import { getFlag } from '../../config/flags';
import { db } from '../../config/firebase';
import { subscribeSpaces, setLastCaptureSpaceId } from '../../services/spaces/spacesService';
import { useDismissablePopover } from '../../hooks/useDismissablePopover';
import { Button, Chip } from '../cloud';

/**
 * SpacePill — capture-time Context Space picker (PRD R1 Context Spaces,
 * plan task 9). A small tappable Chip showing the currently selected
 * Space's name (or nothing when unscoped — the icon alone is the tap
 * affordance), with a lightweight absolutely-positioned popover listing
 * active spaces + "No space". Entirely local to EntryBar; only rendered
 * when the `contextSpaces` flag is on.
 *
 * Dismissal (review fix): an outside tap or Escape closes the popover via
 * `useDismissablePopover` — see `onDismiss`. EntryBar also resets
 * `spacePickerOpen` on every mode change so an abandoned popover never
 * reopens over the other mode's controls.
 */
const SpacePill = ({ spaces, selectedId, onSelect, open, onToggle, onDismiss }) => {
  const selected = spaces.find((s) => s.id === selectedId) || null;
  const containerRef = useDismissablePopover(open, onDismiss);
  return (
    <div className="relative inline-block" ref={containerRef}>
      <Chip
        as="button"
        type="button"
        onClick={onToggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={selected ? `Space: ${selected.name}` : 'Assign a space'}
      >
        <Tag size={12} aria-hidden="true" />
        {selected && <span>{selected.name}</span>}
      </Chip>
      {open && (
        <div
          role="listbox"
          aria-label="Choose a space"
          className="absolute right-0 z-40 mt-1 min-w-[140px] rounded-xl border border-border bg-card p-1 shadow-soft-lg"
        >
          <button
            type="button"
            role="option"
            aria-selected={selectedId == null}
            onClick={() => onSelect(null)}
            className={`block w-full rounded-lg px-2 py-1.5 text-left text-xs ${selectedId == null ? 'bg-accent-wash text-accent-deep' : 'text-secondary-foreground hover:bg-divider'}`}
          >
            No space
          </button>
          {spaces.map((space) => (
            <button
              key={space.id}
              type="button"
              role="option"
              aria-selected={space.id === selectedId}
              onClick={() => onSelect(space.id)}
              className={`block w-full rounded-lg px-2 py-1.5 text-left text-xs ${space.id === selectedId ? 'bg-accent-wash text-accent-deep' : 'text-secondary-foreground hover:bg-divider'}`}
            >
              {space.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const ENTRY_DRAFT_PREFIX = 'entry_draft';

// Module-level latch: web chunk-draft recovery must run once per browser
// session (not once per EntryBar mount/remount — the bar can remount across
// navigation). Keyed by owner so switching accounts within the same session
// still gets a recovery pass.
const webChunkRecoveryOwners = new Set();

/**
 * EntryBar - Persistent bottom bar for instant entry creation
 *
 * Features:
 * - One-tap voice recording (mic turns red and starts immediately)
 * - One-tap text input (keyboard opens immediately)
 * - Always visible at bottom of screen
 * - Can show prompt context when responding to a prompt
 */
const EntryBar = ({
  ownerUid, onVoiceSave, onTextSave, onStateChange, loading, disabled, promptContext, onClearPrompt,
  preferredMode = 'text', embedded = false, captureSpaceId = null, onCaptureSpaceIdChange,
}) => {
  const [mode, setMode] = useState('idle'); // idle, recording, typing
  const [recording, setRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [textValue, setTextValue] = useState('');
  const [spaces, setSpaces] = useState([]);
  const [spacePickerOpen, setSpacePickerOpen] = useState(false);
  const contextSpacesOn = getFlag('contextSpaces');
  const timerRef = useRef(null);
  const textInputRef = useRef(null);
  const shouldAutoStartVoice = useRef(false);
  const nativeCaptureRef = useRef(null);
  const webChunkDraftIdRef = useRef(null);
  const webChunkSeqRef = useRef(0);
  const draftRestoredRef = useRef(false);

  // Use refs to always have the latest callbacks
  // This prevents stale closure issues during long recordings
  const onVoiceSaveRef = useRef(onVoiceSave);
  const onTextSaveRef = useRef(onTextSave);
  useEffect(() => {
    onVoiceSaveRef.current = onVoiceSave;
    onTextSaveRef.current = onTextSave;
  }, [onVoiceSave, onTextSave]);

  useEffect(() => {
    onStateChange?.(mode);
  }, [mode, onStateChange]);

  // Review fix: the Space popover is rendered in both the typing and idle
  // branches but shares one `spacePickerOpen` flag — without this reset, a
  // picker left open in one mode would reopen (and wedge) over the other
  // mode's controls after a mode transition.
  useEffect(() => {
    setSpacePickerOpen(false);
  }, [mode]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Restore a typed draft once ownerUid is known — only when the current
  // text state is still empty, so we never clobber something the user is
  // already typing.
  useEffect(() => {
    if (draftRestoredRef.current || !ownerUid || textValue) return;
    const restored = restoreDraft(ENTRY_DRAFT_PREFIX, ownerUid);
    if (restored) setTextValue(restored);
    draftRestoredRef.current = true;
  }, [ownerUid, textValue]);

  // Debounced typed-draft autosave. Small strings — plain localStorage is
  // fine (see draftAutosave.js).
  useEffect(() => {
    if (!ownerUid) return;
    const timeout = setTimeout(() => writeDraft(ENTRY_DRAFT_PREFIX, ownerUid, textValue), 500);
    return () => clearTimeout(timeout);
  }, [ownerUid, textValue]);

  // Context Space picker (flag: contextSpaces): subscribe to the owner's
  // active spaces so the capture pill can list them + resolve the current
  // selection's display name.
  useEffect(() => {
    if (!contextSpacesOn || !ownerUid) {
      setSpaces([]);
      return undefined;
    }
    return subscribeSpaces(db, ownerUid, setSpaces);
  }, [contextSpacesOn, ownerUid]);

  // Explicit selection only: updates the lifted App.jsx state (so the next
  // save picks it up) and persists it as the new "last capture space" so it
  // is remembered on the next capture (Michael's product decision — Space
  // default is unscoped; the pill remembers the last EXPLICIT choice only).
  const handleSelectSpace = (spaceId) => {
    onCaptureSpaceIdChange?.(spaceId);
    if (ownerUid) {
      setLastCaptureSpaceId(db, ownerUid, spaceId).catch((err) => {
        console.warn('[Spaces] failed to persist last capture space:', err?.message);
      });
    }
    setSpacePickerOpen(false);
  };

  // One-time-per-session web recording-chunk recovery: adopt any chunks left
  // over from a tab death mid-recording into the durable audio vault. Native
  // has its own recovery path (recoverNativeDrafts, run from App.jsx) — this
  // is web-only.
  useEffect(() => {
    if (!ownerUid || Capacitor.isNativePlatform()) return;
    if (!getFlag('webChunkPersistence')) return;
    if (webChunkRecoveryOwners.has(ownerUid)) return;
    webChunkRecoveryOwners.add(ownerUid);
    recoverWebDrafts(ownerUid, (base64, mime) =>
      audioVault.saveRecording(ownerUid, base64, mime).then((result) => result?.id ?? null)
    )
      .then((count) => count && console.log(`[Recording] recovered ${count} web draft(s)`))
      .catch((error) => console.warn('[Recording] web draft recovery failed:', error?.message));
  }, [ownerUid]);

  // Auto-open appropriate mode when embedded (from FAB) or prompt context is provided
  // For embedded mode, auto-start based on preferredMode without requiring promptContext
  useEffect(() => {
    if (mode === 'idle') {
      // In embedded mode (FAB), auto-start based on preferredMode
      if (embedded && preferredMode === 'voice') {
        shouldAutoStartVoice.current = true;
      } else if (embedded && preferredMode === 'text') {
        setMode('typing');
      }
      // With promptContext (from Reflect card), also auto-start
      else if (promptContext) {
        if (preferredMode === 'voice') {
          shouldAutoStartVoice.current = true;
        } else {
          setMode('typing');
        }
      }
    }
  }, [promptContext, preferredMode, embedded]);

  // Handle auto-start voice recording (needs separate effect to avoid async issues)
  useEffect(() => {
    if (shouldAutoStartVoice.current && mode === 'idle') {
      shouldAutoStartVoice.current = false;
      // Small delay to ensure UI is ready
      setTimeout(() => startRecording(), 100);
    }
  }, [promptContext, mode, embedded]);

  // Focus text input when switching to typing mode
  useEffect(() => {
    if (mode === 'typing' && textInputRef.current) {
      textInputRef.current.focus();
    }
  }, [mode]);

  const startRecording = async () => {
    if (Capacitor.isNativePlatform()) {
      if (!ownerUid) {
        alert('Please sign in before recording.');
        return;
      }
      setMode('preparing');
      const capture = new CaptureService(ownerUid, nativeCaptureAdapter);
      nativeCaptureRef.current = capture;
      const confirmed = await capture.start();
      if (confirmed.status !== 'recording') {
        setMode('idle');
        alert(confirmed.status === 'error' && confirmed.code === 'microphone_permission_denied'
          ? 'Microphone access is off. Enable it in Settings to record.'
          : 'Recording could not start. Your typed entries are still available.');
        return;
      }
      setMediaRecorder({ native: true, draftId: confirmed.draftId });
      setRecording(true);
      setMode('recording');
      setRecordingSeconds(0);
      timerRef.current = setInterval(() => setRecordingSeconds((seconds) => seconds + 1), 1000);
      return;
    }

    if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("Microphone access not available in this browser");
      return;
    }

    try {
      console.log('[Recording] Starting microphone capture...');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
      console.log('[Recording] Using MIME type:', mime);

      const recorder = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 32000 });
      const chunks = [];

      // Incremental chunk persistence (flag: webChunkPersistence). The
      // in-memory `chunks` array above remains the fast path used to
      // assemble the final blob on stop; IndexedDB persistence here exists
      // purely so a tab death mid-recording doesn't lose the audio — see
      // webChunkStore.js recoverWebDrafts for the recovery side.
      const chunkPersistenceOn = getFlag('webChunkPersistence') && !!ownerUid;
      webChunkDraftIdRef.current = chunkPersistenceOn ? crypto.randomUUID() : null;
      webChunkSeqRef.current = 0;

      recorder.ondataavailable = e => {
        if (e.data && e.data.size > 0) {
          chunks.push(e.data);
          console.log('[Recording] Chunk received:', e.data.size, 'bytes, total chunks:', chunks.length);
          if (webChunkDraftIdRef.current) {
            const seq = webChunkSeqRef.current++;
            appendChunk(ownerUid, webChunkDraftIdRef.current, seq, e.data, mime).catch((err) => {
              console.warn('[Recording] chunk persistence failed:', err?.message);
            });
          }
        }
      };

      recorder.onerror = (e) => {
        console.error('[Recording] MediaRecorder error:', e);
        alert('Recording error occurred. Please try again.');
        setMode('idle');
        setRecording(false);
        clearInterval(timerRef.current);
        stream.getTracks().forEach(t => t.stop());
      };

      recorder.onstop = () => {
        console.log('[Recording] Stopped. Total chunks:', chunks.length);

        // Validate we have data
        if (chunks.length === 0) {
          console.error('[Recording] No audio data captured!');
          alert('No audio was captured. Please try again.');
          setMode('idle');
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        const blob = new Blob(chunks, { type: mime });
        console.log('[Recording] Created blob:', blob.size, 'bytes');

        if (blob.size === 0) {
          console.error('[Recording] Blob is empty!');
          alert('Recording failed - no data. Please try again.');
          setMode('idle');
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        const reader = new FileReader();

        reader.onerror = (e) => {
          console.error('[Recording] FileReader error:', e);
          alert('Failed to process recording. Please try again.');
          setMode('idle');
          stream.getTracks().forEach(t => t.stop());
        };

        reader.onloadend = async () => {
          console.log('[Recording] FileReader complete, result length:', reader.result?.length || 0);

          if (!reader.result || reader.result.length < 100) {
            console.error('[Recording] FileReader result is empty or too small');
            alert('Recording processing failed. Please try again.');
            setMode('idle');
            stream.getTracks().forEach(t => t.stop());
            return;
          }

          const base64 = reader.result.split(',')[1];
          console.log('[Recording] Base64 length:', base64?.length || 0);

          if (!base64 || base64.length < 100) {
            console.error('[Recording] Base64 conversion failed');
            alert('Recording processing failed. Please try again.');
            setMode('idle');
            stream.getTracks().forEach(t => t.stop());
            return;
          }

          // Use ref to get the latest callback, avoiding stale closure
          console.log('[Recording] Sending to transcription...');
          const persistedDraftId = webChunkDraftIdRef.current;
          if (persistedDraftId) {
            // Assembled from the fast in-memory path above (unchanged); the
            // chunk draft is only a fallback for a crash before this point.
            // Hand off, then drop the chunk draft ONLY once the hand-off
            // succeeded — a failure (throw, or an explicit `false` return
            // like handleAudioWrapper uses) keeps the chunks around so the
            // next launch's recovery pass can retry.
            let handedOff = false;
            try {
              const result = await onVoiceSaveRef.current(base64, mime);
              handedOff = result !== false;
            } catch (err) {
              console.warn('[Recording] onVoiceSave failed, keeping chunk draft:', err?.message);
              handedOff = false;
            }
            if (handedOff) {
              await deleteDraft(ownerUid, persistedDraftId).catch(() => {});
            }
            webChunkDraftIdRef.current = null;
          } else {
            onVoiceSaveRef.current(base64, mime);
          }
          setMode('idle');
        };

        reader.readAsDataURL(blob);
        stream.getTracks().forEach(t => t.stop());
      };

      // Start recording with timeslice to capture data in chunks
      // This is crucial for mobile - ensures data is captured incrementally
      // rather than all at once when stopping (which can fail on mobile)
      recorder.start(1000); // Capture chunk every 1 second
      console.log('[Recording] MediaRecorder started with 1s timeslice');

      setMediaRecorder(recorder);
      setRecording(true);
      setMode('recording');
      setRecordingSeconds(0);
      timerRef.current = setInterval(() => setRecordingSeconds(s => s + 1), 1000);
    } catch (e) {
      console.error('[Recording] Setup error:', e);
      alert("Microphone access denied or error occurred: " + e.message);
    }
  };

  const stopRecording = async () => {
    if (mediaRecorder?.native) {
      clearInterval(timerRef.current);
      setRecording(false);
      setMode('preparing');
      const stored = await nativeCaptureRef.current?.stop();
      if (!stored?.base64) {
        setMode('idle');
        alert('The recording is safe on this device but needs review before processing.');
        return;
      }
      await onVoiceSaveRef.current(stored.base64, stored.mime, { nativeDraftId: stored.draftId });
      setMode('idle');
      return;
    }
    if (mediaRecorder) {
      mediaRecorder.stop();
      setRecording(false);
      clearInterval(timerRef.current);
    }
  };

  const handleMicClick = async () => {
    if (mode === 'recording') {
      await stopRecording();
    } else {
      startRecording();
    }
  };

  const handleKeyboardClick = () => {
    setMode('typing');
    setTextValue('');
  };

  const handleTextSubmit = () => {
    if (textValue.trim()) {
      // Use ref to get the latest callback, avoiding stale closure
      onTextSaveRef.current(textValue.trim());
      setTextValue('');
      if (ownerUid) clearDraft(ENTRY_DRAFT_PREFIX, ownerUid);
      setMode('idle');
      if (onClearPrompt) onClearPrompt();
    }
  };

  const handleTextCancel = () => {
    setTextValue('');
    if (ownerUid) clearDraft(ENTRY_DRAFT_PREFIX, ownerUid);
    setMode('idle');
    if (onClearPrompt) onClearPrompt();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleTextSubmit();
    }
    if (e.key === 'Escape') {
      handleTextCancel();
    }
  };

  const formatTime = (secs) => {
    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    return `${mins}:${String(s).padStart(2, '0')}`;
  };

  // Container classes - fixed positioning only when not embedded
  const containerClasses = embedded
    ? "relative"
    : "fixed bottom-0 left-0 right-0 z-20 pb-[max(0.5rem,env(safe-area-inset-bottom))]";

  return (
    <div className={containerClasses}>
      <AnimatePresence mode="wait">
        {/* Loading Overlay */}
        {loading && (
          <motion.div
            className="absolute inset-0 bg-card flex flex-col justify-center items-center z-30 p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="flex items-center gap-2 text-accent-deep font-medium mb-2">
              <Loader2 className="animate-spin" size={20} />
              <span>Processing your voice...</span>
            </div>
            <p className="text-xs text-muted-foreground text-center max-w-xs">
              Please keep the app open until processing is complete.
            </p>
          </motion.div>
        )}

        {/* Text Input Mode */}
        {mode === 'typing' && (
          <motion.div
            className={embedded ? '' : 'border-t border-border bg-card shadow-soft-lg p-4'}
            initial={{ y: 100 }}
            animate={{ y: 0 }}
            exit={{ y: 100 }}
          >
            <div className="max-w-md mx-auto">
              {/* Space pill (flag: contextSpaces) */}
              {contextSpacesOn && (
                <div className="mb-2 flex justify-end">
                  <SpacePill
                    spaces={spaces}
                    selectedId={captureSpaceId}
                    onSelect={handleSelectSpace}
                    open={spacePickerOpen}
                    onToggle={() => setSpacePickerOpen((prev) => !prev)}
                    onDismiss={() => setSpacePickerOpen(false)}
                  />
                </div>
              )}
              {/* Prompt Context Banner */}
              {promptContext && (
                <div className="mb-2 px-3 py-2 bg-accent-wash rounded-xl text-xs text-accent-deep">
                  <span className="font-semibold">Responding to:</span> "{promptContext}"
                </div>
              )}
              <textarea
                ref={textInputRef}
                value={textValue}
                onChange={(e) => setTextValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={promptContext ? "Your response..." : "What's on your mind?"}
                className="w-full resize-none bg-transparent p-0 font-body text-[15px] leading-[1.65] text-foreground placeholder:text-faint focus:outline-none caret-accent-deep min-h-[130px] max-h-[280px]"
                rows={1}
                style={{ height: 'auto' }}
                onInput={(e) => {
                  e.target.style.height = 'auto';
                  e.target.style.height = Math.min(e.target.scrollHeight, 280) + 'px';
                }}
              />
              <div className="mt-2 flex items-center justify-between border-t border-divider pt-3">
                <button
                  type="button"
                  onClick={handleTextCancel}
                  aria-label="Cancel text entry"
                  className="cloud-icon-button"
                >
                  <X size={20} aria-hidden="true" />
                </button>
                <Button
                  type="button"
                  onClick={handleTextSubmit}
                  aria-label="Save text entry"
                  disabled={!textValue.trim()}
                >
                  Save entry
                </Button>
              </div>
            </div>
          </motion.div>
        )}

        {mode === 'preparing' && (
          <motion.div className="flex min-h-32 items-center justify-center gap-3 bg-card p-5 text-secondary-foreground" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <Loader2 className="animate-spin text-accent-deep" size={22} aria-hidden="true" />
            <span className="font-medium">Preparing secure recording…</span>
          </motion.div>
        )}

        {/* Recording Mode */}
        {mode === 'recording' && (
          <motion.div
            className={embedded ? '' : 'border-t border-border bg-card shadow-soft-lg p-4'}
            initial={{ y: 100 }}
            animate={{ y: 0 }}
            exit={{ y: 100 }}
          >
            <div className="max-w-md mx-auto">
              {/* Prompt Context Banner */}
              {promptContext && (
                <div className="mb-3 px-3 py-2 bg-accent-wash rounded-xl text-xs text-accent-deep text-center">
                  <span className="font-semibold">Responding to:</span> "{promptContext}"
                </div>
              )}
              <div className="flex items-center justify-center gap-6">
                <div className="text-muted-foreground text-sm font-mono w-12">
                  {formatTime(recordingSeconds)}
                </div>
                <motion.button
                  onClick={handleMicClick}
                  aria-label="Stop recording"
                  className="h-16 w-16 rounded-full bg-destructive flex items-center justify-center shadow-soft-lg"
                  animate={{ scale: [1, 1.08, 1] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                >
                  <Square className="text-white fill-white" size={24} />
                </motion.button>
                <div className="w-12 flex justify-center">
                  <motion.div
                    className="h-3 w-3 rounded-full bg-destructive"
                    animate={{ opacity: [1, 0.3, 1] }}
                    transition={{ duration: 1, repeat: Infinity }}
                  />
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* Idle Mode - Show both buttons */}
        {mode === 'idle' && (
          <motion.div
            className={embedded ? '' : 'border-t border-border bg-card shadow-soft-lg p-4'}
            initial={{ y: 100 }}
            animate={{ y: 0 }}
            exit={{ y: 100 }}
          >
            {/* Space pill (flag: contextSpaces) */}
            {contextSpacesOn && (
              <div className="mb-2 flex justify-center">
                <SpacePill
                  spaces={spaces}
                  selectedId={captureSpaceId}
                  onSelect={handleSelectSpace}
                  open={spacePickerOpen}
                  onToggle={() => setSpacePickerOpen((prev) => !prev)}
                  onDismiss={() => setSpacePickerOpen(false)}
                />
              </div>
            )}
            <div className="max-w-md mx-auto flex items-center justify-center gap-8">
              {/* Mic Button */}
              <motion.button
                onClick={handleMicClick}
                disabled={disabled || loading}
                aria-label="Record voice entry"
                className="h-14 w-14 rounded-full bg-card border border-border flex items-center justify-center shadow-soft hover:bg-divider transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <Mic className="text-accent-deep" size={24} aria-hidden="true" />
              </motion.button>

              {/* Keyboard ("Aa") Button */}
              <motion.button
                onClick={handleKeyboardClick}
                disabled={disabled || loading}
                aria-label="Type entry"
                className="h-14 w-14 rounded-full bg-card border border-border flex items-center justify-center shadow-soft hover:bg-divider transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <span className="text-sm font-medium text-muted-foreground" aria-hidden="true">Aa</span>
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default EntryBar;

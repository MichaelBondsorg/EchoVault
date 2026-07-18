import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Keyboard, Mic, X } from 'lucide-react';
import EntryBar from '../dashboard/EntryBar';

/** New Entry is capture-only. AI conversation remains a separate product surface. */
const EntryComposer = ({
  isOpen,
  mode,
  onModeChange,
  onClose,
  onVoiceSave,
  onTextSave,
  processing,
  aiProcessingEnabled,
  onRequestAiConsent,
  ownerUid,
  promptContext,
  reflection,
}) => {
  const dialogRef = useRef(null);
  const [captureState, setCaptureState] = useState('idle');
  const captureLocked = captureState === 'preparing' || captureState === 'recording';
  const closeLocked = processing || captureLocked;

  useEffect(() => {
    if (!isOpen) return undefined;
    const previous = document.activeElement;
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !closeLocked) onClose();
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll(
        'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    requestAnimationFrame(() => dialogRef.current?.focus());
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus?.();
    };
  }, [closeLocked, isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[70] flex items-end" role="presentation">
          <motion.button
            type="button"
            aria-label="Close new entry"
            className="absolute inset-0 h-full w-full bg-black/35 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => !closeLocked && onClose()}
          />
          <motion.section
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-entry-title"
            tabIndex={-1}
            className="cloud-sheet relative w-full rounded-t-[28px] border border-b-0 px-4 pb-[calc(env(safe-area-inset-bottom)+20px)] pt-3 shadow-2xl sm:mx-auto sm:max-w-xl"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 280 }}
          >
            <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-[var(--faint)]" />
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="cloud-kicker">CAPTURE</p>
                <h2 id="new-entry-title" className="cloud-title text-2xl">New entry</h2>
              </div>
              <button
                type="button"
                className="cloud-icon-button"
                aria-label="Close new entry"
                disabled={closeLocked}
                onClick={onClose}
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>

            {reflection}

            <div className="mb-3 grid grid-cols-2 gap-1 rounded-full bg-[var(--divider)] p-1" role="tablist" aria-label="Entry method">
              {[
                { value: 'text', label: 'Type', icon: Keyboard },
                { value: 'voice', label: 'Record', icon: Mic },
              ].map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={mode === value}
                  disabled={captureLocked}
                  className={`min-h-11 rounded-full px-4 text-sm font-semibold transition-colors ${
                    mode === value
                      ? 'bg-[var(--card)] text-[var(--foreground)] shadow-sm'
                      : 'text-[var(--muted-foreground)]'
                  }`}
                  onClick={() => {
                    if (value === 'voice' && !aiProcessingEnabled) onRequestAiConsent?.();
                    else onModeChange(value);
                  }}
                >
                  <span className="inline-flex items-center gap-2"><Icon size={17} aria-hidden="true" />{label}</span>
                </button>
              ))}
            </div>

            {!aiProcessingEnabled && (
              <p className="mb-3 rounded-xl bg-[var(--accent-wash)] p-3 text-sm text-[var(--secondary-foreground)]">
                Typed entries stay available without AI. Enable AI processing to transcribe recordings or talk with Engram.
              </p>
            )}

            <EntryBar
              key={mode}
              ownerUid={ownerUid}
              embedded
              onVoiceSave={onVoiceSave}
              onTextSave={onTextSave}
              loading={processing}
              preferredMode={mode}
              promptContext={promptContext}
              onStateChange={setCaptureState}
            />
            <p className="mt-3 text-center text-xs text-[var(--muted-foreground)]">
              Audio is secured on this device before it is processed.
            </p>
          </motion.section>
        </div>
      )}
    </AnimatePresence>
  );
};

export default EntryComposer;

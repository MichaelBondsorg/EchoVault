import { useState } from 'react';
import { Mic, X } from 'lucide-react';
import { Drawer, DrawerContent, DrawerDescription, Chip } from '../cloud';
import EntryBar from '../dashboard/EntryBar';

/**
 * New Entry composer (CLOUD-DESIGN-SPEC.md §7 New entry): cloud `Drawer`
 * bottom sheet with a Reflect context chip (supplied by the caller via
 * `reflection`), a mic/Aa entry-method picker, and the embedded `EntryBar`
 * editor (15px/1.65 text, accent caret, mic + Aa + Save entry pill).
 *
 * New Entry is capture-only. AI conversation remains a separate product surface.
 *
 * `initialContext` (optional): a plain one-line hint from the caller (e.g. an
 * open-loop's display text) rendered as a quiet, non-interactive "Following
 * up: {text}" chip — distinct from the Reflect banner, and never baked into
 * the saved entry's text (unlike `promptContext`/replyContext). When
 * provided alongside `onEntrySaved`, that callback fires with whatever the
 * underlying save resolves to once the entry is saved, so a caller (e.g. an
 * open-loop "Answer" action) can link the new entry back to its source.
 */
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
  initialContext,
  onEntrySaved,
}) => {
  const [captureState, setCaptureState] = useState('idle');
  const captureLocked = captureState === 'preparing' || captureState === 'recording';
  const closeLocked = processing || captureLocked;

  const handleModeSelect = (value) => {
    if (value === 'voice' && !aiProcessingEnabled) onRequestAiConsent?.();
    else onModeChange(value);
  };

  // Wrap the save handlers so a caller can be told what the save resolved
  // to (best-effort — the underlying save chain doesn't guarantee a clean
  // entry id in every path, e.g. the crisis-confirm detour). These closures
  // capture the current `onEntrySaved`/`onVoiceSave`/`onTextSave` at the
  // time EntryBar invokes them, so they still fire correctly even if the
  // composer has since closed and cleared its props.
  const handleVoiceSave = async (...args) => {
    const result = await onVoiceSave?.(...args);
    onEntrySaved?.(result);
    return result;
  };

  const handleTextSave = async (text) => {
    const result = await onTextSave?.(text);
    onEntrySaved?.(result);
    return result;
  };

  return (
    <Drawer
      open={isOpen}
      onOpenChange={(open) => { if (!open) onClose(); }}
      dismissible={!closeLocked}
    >
      <DrawerContent
        aria-labelledby="new-entry-title"
        onEscapeKeyDown={(event) => { if (closeLocked) event.preventDefault(); }}
        className="sm:mx-auto sm:max-w-xl"
      >
        <DrawerDescription className="sr-only">
          Write or record a new journal entry.
        </DrawerDescription>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="cloud-kicker">CAPTURE</p>
            <h2 id="new-entry-title" className="cloud-title text-2xl text-foreground">New entry</h2>
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

        {initialContext && (
          <div className="mb-3">
            <Chip>Following up: {initialContext}</Chip>
          </div>
        )}

        <div className="mb-3 flex items-center gap-2" role="tablist" aria-label="Entry method">
          {[
            { value: 'text', label: 'Type', glyph: 'Aa' },
            { value: 'voice', label: 'Record', icon: Mic },
          ].map(({ value, label, icon: Icon, glyph }) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              aria-label={label}
              disabled={captureLocked}
              className={`flex h-11 w-11 items-center justify-center rounded-full border transition-colors ${
                mode === value
                  ? 'border-accent-deep bg-accent-wash text-accent-deep'
                  : 'border-border bg-card text-muted-foreground hover:bg-divider'
              }`}
              onClick={() => handleModeSelect(value)}
            >
              {Icon ? (
                <Icon size={18} aria-hidden="true" />
              ) : (
                <span className="text-sm font-medium" aria-hidden="true">{glyph}</span>
              )}
            </button>
          ))}
        </div>

        {!aiProcessingEnabled && (
          <p className="mb-3 rounded-xl bg-accent-wash p-3 text-sm text-secondary-foreground">
            Typed entries stay available without AI. Enable AI processing to transcribe recordings or talk with Engram.
          </p>
        )}

        <EntryBar
          key={mode}
          ownerUid={ownerUid}
          embedded
          onVoiceSave={handleVoiceSave}
          onTextSave={handleTextSave}
          loading={processing}
          preferredMode={mode}
          promptContext={promptContext}
          onStateChange={setCaptureState}
        />
        <p className="mt-3 text-center text-xs text-muted-foreground">
          Audio is secured on this device before it is processed.
        </p>
      </DrawerContent>
    </Drawer>
  );
};

export default EntryComposer;

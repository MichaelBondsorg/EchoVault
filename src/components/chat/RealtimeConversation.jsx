import React, { useState, useEffect, useCallback } from 'react';
import { X, Phone, Mic, MicOff, Save, ChevronLeft, Smile, Frown, Meh, Zap, Battery, BatteryLow } from 'lucide-react';
import { useVoiceRelay } from '../../hooks/useVoiceRelay';
import GuidedSessionPicker from './GuidedSessionPicker';
import { Pebble, Equalizer, LinenWaveBackground, Button, SectionLabel, Chip } from '../cloud';

const RealtimeConversation = ({ entries, onClose, category, onSaveEntry }) => {
  const [selectedSessionType, setSelectedSessionType] = useState(null);
  const [showPicker, setShowPicker] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [showSavePrompt, setShowSavePrompt] = useState(false);
  const [editableMood, setEditableMood] = useState(null); // User-adjustable mood score
  const [editableTitle, setEditableTitle] = useState(''); // User-editable title

  const {
    status,
    transcript,
    error,
    sessionId,
    mode,
    guidedState,
    guidedComplete,
    sessionAnalysis,
    connect,
    disconnect,
    startRecording,
    endTurn,
    endSession,
    clearError,
    clearTranscript,
    clearGuidedComplete,
    clearSessionAnalysis,
  } = useVoiceRelay();

  // Initialize editable values from session analysis
  useEffect(() => {
    if (sessionAnalysis) {
      if (sessionAnalysis.voiceTone?.moodScore !== undefined) {
        setEditableMood(Math.round(sessionAnalysis.voiceTone.moodScore * 10));
      }
      if (sessionAnalysis.suggestedTitle) {
        setEditableTitle(sessionAnalysis.suggestedTitle);
      }
    }
  }, [sessionAnalysis]);

  // Start conversation with selected session type
  const startConversation = useCallback(async (sessionType) => {
    setSelectedSessionType(sessionType);
    setShowPicker(false);
    clearError();
    clearTranscript();

    // Use standard mode for guided sessions, realtime for free chat
    const requestedMode = sessionType === 'free' ? 'realtime' : 'standard';
    await connect(sessionType, requestedMode);
  }, [connect, clearError, clearTranscript]);

  // Handle session selection from picker
  const handleSelectSession = useCallback((sessionId) => {
    startConversation(sessionId);
  }, [startConversation]);

  // Handle open chat selection
  const handleOpenChat = useCallback(() => {
    startConversation('free');
  }, [startConversation]);

  // End conversation
  const handleEndConversation = useCallback(() => {
    if (transcript.length > 0 || guidedComplete) {
      setShowSavePrompt(true);
    } else {
      disconnect();
      onClose();
    }
  }, [transcript, guidedComplete, disconnect, onClose]);

  // Handle save decision
  const handleSaveDecision = useCallback(async (save) => {
    const finalTranscript = await endSession(save);

    if (save && onSaveEntry) {
      // Build mood data from user-adjusted values or analysis
      const moodData = editableMood !== null ? {
        moodScore: editableMood / 10, // Convert 0-10 back to 0-1
        energy: sessionAnalysis?.voiceTone?.energy,
        emotions: sessionAnalysis?.voiceTone?.emotions,
        source: 'voice_analysis',
      } : undefined;

      if (guidedComplete) {
        // For guided sessions, use the structured summary
        onSaveEntry({
          text: guidedComplete.summary,
          title: editableTitle || undefined,
          moodScore: moodData?.moodScore,
          source: 'voice',
          voiceMetadata: {
            fullTranscript: finalTranscript,
            sessionType: guidedComplete.sessionType,
            responses: guidedComplete.responses,
            mode: 'guided',
            voiceTone: moodData,
            suggestedTags: sessionAnalysis?.suggestedTags,
          },
        });
      } else if (finalTranscript) {
        // For free chat, extract user messages
        const entryText = transcript
          .filter((msg) => msg.role === 'user')
          .map((msg) => msg.text)
          .join('\n\n');

        onSaveEntry({
          text: entryText,
          title: editableTitle || undefined,
          moodScore: moodData?.moodScore,
          source: 'voice',
          voiceMetadata: {
            fullTranscript: finalTranscript,
            sessionType: selectedSessionType || 'free',
            mode,
            voiceTone: moodData,
            suggestedTags: sessionAnalysis?.suggestedTags,
          },
        });
      }
    }

    setShowSavePrompt(false);
    setEditableMood(null);
    setEditableTitle('');
    clearGuidedComplete();
    clearSessionAnalysis();
    onClose();
  }, [endSession, onSaveEntry, transcript, selectedSessionType, mode, guidedComplete, clearGuidedComplete, clearSessionAnalysis, onClose, editableMood, editableTitle, sessionAnalysis]);

  // Toggle recording
  const toggleRecording = useCallback(() => {
    if (isRecording) {
      setIsRecording(false);
      endTurn();
    } else {
      setIsRecording(true);
      startRecording();
    }
  }, [isRecording, startRecording, endTurn]);

  // Auto-stop recording when status changes to speaking
  useEffect(() => {
    if (status === 'speaking' && isRecording) {
      setIsRecording(false);
    }
  }, [status, isRecording]);

  // Auto-show save prompt when guided session completes
  useEffect(() => {
    if (guidedComplete) {
      setShowSavePrompt(true);
    }
  }, [guidedComplete]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (status !== 'disconnected') {
        disconnect();
      }
    };
  }, []);

  // Cloud tokens (CLOUD-DESIGN-SPEC.md §7 Voice session). Mirrors the exact
  // statusColors mapping already established for the identical
  // useVoiceRelay status set in UnifiedConversation.jsx's renderVoice() (D1).
  const statusColors = {
    disconnected: 'bg-decorative',
    connecting: 'bg-accent animate-pulse',
    connected: 'bg-accent',
    speaking: 'bg-accent-deep animate-pulse',
    listening: 'bg-accent-deep animate-pulse',
  };

  const statusLabels = {
    disconnected: 'Ready to start',
    connecting: 'Connecting...',
    connected: 'Connected',
    speaking: 'AI is speaking...',
    listening: 'Listening...',
  };

  // Session type labels for display
  const sessionLabels = {
    free: 'Open Chat',
    morning_checkin: 'Morning Check-in',
    evening_reflection: 'Evening Reflection',
    gratitude_practice: 'Gratitude Practice',
    goal_setting: 'Goal Setting',
    emotional_processing: 'Emotional Processing',
    stress_release: 'Stress Release',
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background pt-[env(safe-area-inset-top)]">
      {/* Ambient linen + wave canvas (spec §6.1 / §7 "Voice session" mockups
          5d/6d both render this same accent-wash gradient + grain + gated
          wave treatment behind the session). LinenWaveBackground is `fixed
          inset-0 -z-10`; nesting it inside this modal's own `fixed z-50`
          stacking context keeps it painted behind this screen's content
          without touching the app-wide instance mounted by AppLayout.
          Gates Background-motion pref + prefers-reduced-motion internally
          — no duplicate guard needed here. */}
      <LinenWaveBackground />

      {/* Header. Both icon buttons use .cloud-icon-button (44x44, defined in
          cloud-tokens.css) and sit at opposite ends of a justify-between
          row, so their hit targets are naturally non-overlapping. */}
      <div className="relative z-10 flex items-center justify-between p-4">
        <div className="flex items-center gap-3">
          {!showPicker && status === 'disconnected' && (
            <button
              onClick={() => setShowPicker(true)}
              aria-label="Back to session picker"
              className="cloud-icon-button -ml-2"
            >
              <ChevronLeft size={20} aria-hidden="true" />
            </button>
          )}
          <div className={`h-3 w-3 rounded-full ${statusColors[status]}`} />
          <span className="text-sm text-secondary-foreground">{statusLabels[status]}</span>
          {mode && (
            <span className="rounded-full border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground">
              {mode === 'realtime' ? 'Interactive' : 'Guided'}
            </span>
          )}
        </div>
        <button
          onClick={showPicker ? onClose : handleEndConversation}
          aria-label="Close voice session"
          className="cloud-icon-button"
        >
          <X size={24} aria-hidden="true" />
        </button>
      </div>

      {/* Session Picker */}
      {showPicker && status === 'disconnected' && (
        <div className="relative z-10 flex-1 overflow-y-auto">
          <GuidedSessionPicker
            onSelectSession={handleSelectSession}
            onOpenChat={handleOpenChat}
          />
        </div>
      )}

      {/* Guided session progress indicator */}
      {guidedState && !showPicker && (
        <div className="relative z-10 px-6 pb-2">
          <div className="mb-2 flex items-center justify-between text-sm text-muted-foreground">
            <span>{sessionLabels[selectedSessionType] || 'Guided Session'}</span>
            {!guidedState.isOpening && !guidedState.isClosing && (
              <span>
                {guidedState.promptIndex + 1} / {guidedState.totalPrompts}
              </span>
            )}
          </div>
          {!guidedState.isOpening && !guidedState.isClosing && guidedState.totalPrompts > 0 && (
            <div className="h-1 overflow-hidden rounded-full bg-divider">
              <div
                className="h-full rounded-full bg-accent-deep transition-all duration-300"
                style={{
                  width: `${((guidedState.promptIndex + 1) / guidedState.totalPrompts) * 100}%`,
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* Listening Pebble + LISTENING caps label + 12-bar Equalizer (spec §7:
          "listening Pebble -> LISTENING caps -> 12-bar equalizer (staggered
          eq)"). Pebble/Equalizer both consumed as-is (B2/B3) — reduced-motion
          and the Background-motion pref are handled internally by their own
          CSS (cloud-motion.css), not duplicated here. The LISTENING caption
          is the one element that must stay perceivable with motion off, so
          it's a plain always-rendered text node, not tied to any animation. */}
      {!showPicker && (
        <div className="relative z-10 flex flex-col items-center pt-11">
          <Pebble state={status === 'listening' ? 'listening' : 'calm'} size={88} />
          {status === 'listening' && (
            <p className="mt-[18px] text-[13px] font-medium uppercase tracking-[0.08em] text-accent">
              Listening
            </p>
          )}
          {status === 'listening' && <Equalizer bars={12} height={44} className="mt-4" />}
        </div>
      )}

      {/* Conversation display. Per spec §7: "live transcript (user grey /
          companion serif quote)". Unlike the mockup's single static
          exchange, this transcript can grow arbitrarily long across a real
          session, so it stays independently scrollable below the fixed
          Pebble block above (mockup has no scroll affordance to draw from). */}
      {!showPicker && (
        <div className="relative z-10 flex-1 overflow-y-auto px-6 py-4">
          <div className="mx-auto flex max-w-[280px] flex-col gap-4 text-center">
            {transcript.map((msg, i) =>
              msg.role === 'user' ? (
                <p key={i} className="text-[13px] leading-[1.6] text-faint">
                  {msg.text}
                </p>
              ) : (
                <p key={i} className="font-display text-[15px] leading-[1.6] text-foreground">
                  &ldquo;{msg.text}&rdquo;
                </p>
              )
            )}
          </div>
          {status === 'speaking' && (
            <div className="mt-4 flex justify-center">
              <div className="flex gap-1">
                {[...Array(3)].map((_, i) => (
                  <div
                    key={i}
                    className="h-8 w-2 animate-pulse rounded-full bg-accent"
                    style={{ animationDelay: `${i * 150}ms` }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="relative z-10 mx-6 mb-4 rounded-lg border border-destructive bg-[var(--destructive-wash)] p-3">
          <p className="text-sm text-destructive">{error}</p>
          <button
            onClick={clearError}
            className="mt-1 text-xs text-destructive underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Save prompt modal */}
      {showSavePrompt && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-[var(--overlay)] p-6">
          <div className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-soft-lg">
            <h3 className="mb-2 text-lg font-medium text-foreground">
              {guidedComplete ? 'Session Complete!' : 'Save as Entry?'}
            </h3>
            <p className="mb-4 text-sm text-muted-foreground">
              {guidedComplete
                ? 'Would you like to save your responses as a journal entry?'
                : 'Would you like to save this conversation as a journal entry?'}
            </p>

            {/* Title input */}
            {(sessionAnalysis?.suggestedTitle || editableTitle) && (
              <div className="mb-4">
                <SectionLabel className="mb-1">Title</SectionLabel>
                <input
                  type="text"
                  value={editableTitle}
                  onChange={(e) => setEditableTitle(e.target.value)}
                  placeholder="Entry title..."
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-[var(--text-placeholder)] focus:border-accent focus:outline-none"
                />
              </div>
            )}

            {/* Mood analysis display */}
            {sessionAnalysis?.voiceTone && (
              <div className="mb-4 rounded-lg bg-divider p-3">
                <div className="mb-2 flex items-center justify-between">
                  <SectionLabel>Detected Mood</SectionLabel>
                  <div className="flex items-center gap-1">
                    {sessionAnalysis.voiceTone.energy === 'high' && <Zap size={14} className="text-accent-deep" aria-hidden="true" />}
                    {sessionAnalysis.voiceTone.energy === 'medium' && <Battery size={14} className="text-accent-deep" aria-hidden="true" />}
                    {sessionAnalysis.voiceTone.energy === 'low' && <BatteryLow size={14} className="text-accent-deep" aria-hidden="true" />}
                    <span className="text-xs capitalize text-muted-foreground">{sessionAnalysis.voiceTone.energy} energy</span>
                  </div>
                </div>

                {/* Mood slider. Cloud collapses the legacy terra/honey/sage
                    tri-hue gradient to a single accent-scale ramp (same
                    "ONE accent" precedent as InsightsPage/C5). */}
                <div className="mb-2 flex items-center gap-3">
                  <Frown size={18} className="text-faint" aria-hidden="true" />
                  <input
                    type="range"
                    min="0"
                    max="10"
                    value={editableMood ?? 5}
                    onChange={(e) => setEditableMood(parseInt(e.target.value))}
                    aria-label="Mood score"
                    className="h-2 flex-1 cursor-pointer appearance-none rounded-full bg-gradient-to-r from-accent-wash via-accent to-accent-deep"
                    style={{
                      WebkitAppearance: 'none',
                    }}
                  />
                  <Smile size={18} className="text-accent-deep" aria-hidden="true" />
                </div>
                <div className="text-center text-sm font-medium text-secondary-foreground">
                  {editableMood ?? 5}/10
                </div>

                {/* Emotions */}
                {sessionAnalysis.voiceTone.emotions?.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {sessionAnalysis.voiceTone.emotions.slice(0, 4).map((emotion, i) => (
                      <span
                        key={i}
                        className="rounded-full bg-divider px-2 py-0.5 text-xs text-secondary-foreground"
                      >
                        {emotion}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Suggested tags */}
            {sessionAnalysis?.suggestedTags?.length > 0 && (
              <div className="mb-4">
                <SectionLabel className="mb-1">Suggested Tags</SectionLabel>
                <div className="flex flex-wrap gap-1">
                  {sessionAnalysis.suggestedTags.map((tag, i) => (
                    <Chip key={i}>#{tag}</Chip>
                  ))}
                </div>
              </div>
            )}

            {guidedComplete && (
              <div className="mb-4 max-h-32 overflow-y-auto rounded-lg bg-divider p-3">
                <p className="text-sm text-secondary-foreground">{guidedComplete.summary}</p>
              </div>
            )}
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => handleSaveDecision(false)}
                className="flex-1"
              >
                Discard
              </Button>
              <Button
                onClick={() => handleSaveDecision(true)}
                className="flex-1 gap-2"
              >
                <Save size={16} aria-hidden="true" />
                Save
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Main controls. Spec §7 calls for "mute, End session (dark pill),
          switch-to-text" — this hold-to-talk component only has the two
          controls it's always had (End call / push-to-talk Mic), so the End
          call button is restyled onto the spec's literal "dark pill" (the
          standard Button `primary` CTA — ink in light mode, accent-btn in
          dark, per §3) with an "End session" label added. There is no
          separate mute toggle or text-mode affordance backed by state in
          this component (push-to-talk already owns the Mic/MicOff
          iconography, and RealtimeConversation has no text-chat mode to
          switch to) — see task report for this flagged as a concern rather
          than invented. The two controls are laid out with a 24px flex gap
          at 52-96px each, well clear of the 44px minimum and not
          overlapping. */}
      {!showPicker && (
        <div className="relative z-10 flex flex-col items-center p-6 pb-[max(2rem,env(safe-area-inset-bottom))]">
          {status === 'connecting' ? (
            // Connecting indicator
            <div className="flex h-24 w-24 animate-pulse items-center justify-center rounded-full bg-accent-wash shadow-soft">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-border border-t-accent-deep" />
            </div>
          ) : status !== 'disconnected' ? (
            // Recording controls
            <div className="flex items-center gap-6">
              {/* End session pill */}
              <Button
                onClick={handleEndConversation}
                aria-label="End voice session"
                size="lg"
                className="gap-2 shadow-soft-lg"
              >
                <Phone size={20} className="rotate-[135deg]" aria-hidden="true" />
                End session
              </Button>

              {/* Push-to-talk button */}
              <button
                onMouseDown={toggleRecording}
                onMouseUp={() => isRecording && toggleRecording()}
                onTouchStart={(e) => {
                  e.preventDefault();
                  toggleRecording();
                }}
                onTouchEnd={(e) => {
                  e.preventDefault();
                  if (isRecording) toggleRecording();
                }}
                onTouchCancel={(e) => {
                  e.preventDefault();
                  if (isRecording) toggleRecording();
                }}
                onContextMenu={(e) => e.preventDefault()}
                disabled={status === 'speaking'}
                aria-label={isRecording ? 'Release to send' : 'Hold to speak'}
                style={{ touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none' }}
                className={`flex h-24 w-24 select-none items-center justify-center rounded-full shadow-soft-lg transition-all ${
                  isRecording
                    ? 'scale-110 bg-accent-deep'
                    : status === 'speaking'
                    ? 'cursor-not-allowed bg-divider opacity-60'
                    : 'bg-accent-deep hover:scale-105'
                }`}
              >
                {isRecording ? (
                  <MicOff size={36} className="animate-pulse text-background" aria-hidden="true" />
                ) : status === 'speaking' ? (
                  <Mic size={36} className="text-decorative" aria-hidden="true" />
                ) : (
                  <Mic size={36} className="text-background" aria-hidden="true" />
                )}
              </button>
            </div>
          ) : null}

          {!showPicker && (
            <p className="mt-4 text-sm text-muted-foreground">
              {status === 'connecting'
                ? 'Connecting to voice service...'
                : status === 'speaking'
                ? 'Wait for response...'
                : isRecording
                ? 'Release to send'
                : 'Hold to speak'}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default RealtimeConversation;

import React, { useState, useEffect, useCallback } from 'react';
import { X, Phone, Mic, MicOff, Save, ChevronLeft } from 'lucide-react';
import { useVoiceRelay } from '../../hooks/useVoiceRelay';
import GuidedSessionPicker from './GuidedSessionPicker';

const RealtimeConversation = ({ entries, onClose, category, onSaveEntry }) => {
  const [selectedSessionType, setSelectedSessionType] = useState(null);
  const [showPicker, setShowPicker] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [showSavePrompt, setShowSavePrompt] = useState(false);

  const {
    status,
    transcript,
    error,
    sessionId,
    mode,
    guidedState,
    guidedComplete,
    connect,
    disconnect,
    startRecording,
    endTurn,
    endSession,
    clearError,
    clearTranscript,
    clearGuidedComplete,
  } = useVoiceRelay();

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
      if (guidedComplete) {
        // For guided sessions, use the structured summary
        onSaveEntry({
          text: guidedComplete.summary,
          source: 'voice',
          voiceMetadata: {
            fullTranscript: finalTranscript,
            sessionType: guidedComplete.sessionType,
            responses: guidedComplete.responses,
            mode: 'guided',
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
          source: 'voice',
          voiceMetadata: {
            fullTranscript: finalTranscript,
            sessionType: selectedSessionType || 'free',
            mode,
          },
        });
      }
    }

    setShowSavePrompt(false);
    clearGuidedComplete();
    onClose();
  }, [endSession, onSaveEntry, transcript, selectedSessionType, mode, guidedComplete, clearGuidedComplete, onClose]);

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

  const statusColors = {
    disconnected: 'bg-gray-400',
    connecting: 'bg-yellow-400 animate-pulse',
    connected: 'bg-green-400',
    speaking: 'bg-indigo-500 animate-pulse',
    listening: 'bg-green-500 animate-pulse',
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
    <div className="fixed inset-0 bg-gradient-to-b from-indigo-900 to-purple-900 z-50 flex flex-col pt-[env(safe-area-inset-top)]">
      {/* Header */}
      <div className="p-4 flex justify-between items-center">
        <div className="flex items-center gap-3">
          {!showPicker && status === 'disconnected' && (
            <button
              onClick={() => setShowPicker(true)}
              className="text-white/60 hover:text-white p-1"
            >
              <ChevronLeft size={20} />
            </button>
          )}
          <div className={`w-3 h-3 rounded-full ${statusColors[status]}`} />
          <span className="text-white/80 text-sm">{statusLabels[status]}</span>
          {mode && (
            <span className="text-white/40 text-xs px-2 py-0.5 bg-white/10 rounded">
              {mode === 'realtime' ? 'Interactive' : 'Guided'}
            </span>
          )}
        </div>
        <button
          onClick={showPicker ? onClose : handleEndConversation}
          className="text-white/60 hover:text-white p-2"
        >
          <X size={24} />
        </button>
      </div>

      {/* Session Picker */}
      {showPicker && status === 'disconnected' && (
        <div className="flex-1 overflow-y-auto">
          <GuidedSessionPicker
            onSelectSession={handleSelectSession}
            onOpenChat={handleOpenChat}
          />
        </div>
      )}

      {/* Guided session progress indicator */}
      {guidedState && !showPicker && (
        <div className="px-6 pb-2">
          <div className="flex items-center justify-between text-white/60 text-sm mb-2">
            <span>{sessionLabels[selectedSessionType] || 'Guided Session'}</span>
            {!guidedState.isOpening && !guidedState.isClosing && (
              <span>
                {guidedState.promptIndex + 1} / {guidedState.totalPrompts}
              </span>
            )}
          </div>
          {!guidedState.isOpening && !guidedState.isClosing && guidedState.totalPrompts > 0 && (
            <div className="h-1 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-white/40 rounded-full transition-all duration-300"
                style={{
                  width: `${((guidedState.promptIndex + 1) / guidedState.totalPrompts) * 100}%`,
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* Conversation display */}
      {!showPicker && (
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {transcript.map((msg, i) => (
            <div
              key={i}
              className={`mb-4 ${msg.role === 'user' ? 'text-right' : 'text-left'}`}
            >
              <div
                className={`inline-block max-w-[85%] px-4 py-3 rounded-2xl ${
                  msg.role === 'user'
                    ? 'bg-white/20 text-white rounded-br-none'
                    : 'bg-white/10 text-white/90 rounded-bl-none'
                }`}
              >
                <p className="text-sm">{msg.text}</p>
              </div>
            </div>
          ))}
          {status === 'speaking' && (
            <div className="flex justify-center">
              <div className="flex gap-1">
                {[...Array(3)].map((_, i) => (
                  <div
                    key={i}
                    className="w-2 h-8 bg-white/60 rounded-full animate-pulse"
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
        <div className="mx-6 mb-4 p-3 bg-red-500/20 border border-red-400/30 rounded-lg">
          <p className="text-red-200 text-sm">{error}</p>
          <button
            onClick={clearError}
            className="text-red-300 text-xs mt-1 underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Save prompt modal */}
      {showSavePrompt && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center p-6">
          <div className="bg-gray-800 rounded-2xl p-6 max-w-sm w-full">
            <h3 className="text-white text-lg font-medium mb-2">
              {guidedComplete ? 'Session Complete!' : 'Save as Entry?'}
            </h3>
            <p className="text-white/60 text-sm mb-4">
              {guidedComplete
                ? 'Would you like to save your responses as a journal entry?'
                : 'Would you like to save this conversation as a journal entry?'}
            </p>
            {guidedComplete && (
              <div className="bg-white/5 rounded-lg p-3 mb-4 max-h-32 overflow-y-auto">
                <p className="text-white/70 text-sm">{guidedComplete.summary}</p>
              </div>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => handleSaveDecision(false)}
                className="flex-1 py-2 px-4 rounded-lg bg-gray-700 text-white/80 hover:bg-gray-600"
              >
                Discard
              </button>
              <button
                onClick={() => handleSaveDecision(true)}
                className="flex-1 py-2 px-4 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 flex items-center justify-center gap-2"
              >
                <Save size={16} />
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main controls */}
      {!showPicker && (
        <div className="p-6 pb-[max(2rem,env(safe-area-inset-bottom))] flex flex-col items-center">
          {status === 'connecting' ? (
            // Connecting indicator
            <div className="w-24 h-24 rounded-full bg-gradient-to-br from-yellow-500 to-orange-600 shadow-lg flex items-center justify-center animate-pulse">
              <div className="w-8 h-8 border-4 border-white/30 border-t-white rounded-full animate-spin" />
            </div>
          ) : status !== 'disconnected' ? (
            // Recording controls
            <div className="flex items-center gap-6">
              {/* End call button */}
              <button
                onClick={handleEndConversation}
                className="w-16 h-16 rounded-full bg-red-500 shadow-lg shadow-red-500/30 flex items-center justify-center hover:scale-105 transition-transform"
              >
                <Phone size={24} className="text-white rotate-[135deg]" />
              </button>

              {/* Push-to-talk button */}
              <button
                onMouseDown={toggleRecording}
                onMouseUp={() => isRecording && toggleRecording()}
                onTouchStart={toggleRecording}
                onTouchEnd={() => isRecording && toggleRecording()}
                disabled={status === 'speaking'}
                className={`w-24 h-24 rounded-full shadow-lg flex items-center justify-center transition-all ${
                  isRecording
                    ? 'bg-green-500 shadow-green-500/30 scale-110'
                    : status === 'speaking'
                    ? 'bg-gray-500 opacity-50 cursor-not-allowed'
                    : 'bg-gradient-to-br from-indigo-500 to-purple-600 shadow-purple-500/30 hover:scale-105'
                }`}
              >
                {isRecording ? (
                  <MicOff size={36} className="text-white animate-pulse" />
                ) : (
                  <Mic size={36} className="text-white" />
                )}
              </button>
            </div>
          ) : null}

          {!showPicker && (
            <p className="text-white/60 text-sm mt-4">
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

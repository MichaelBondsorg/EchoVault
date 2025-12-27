import React, { useState, useEffect, useCallback } from 'react';
import { X, Phone, MessageCircle, TrendingUp, Heart, Sparkles, Brain, Clipboard, Mic, MicOff, Save } from 'lucide-react';
import { useVoiceRelay } from '../../hooks/useVoiceRelay';

// Map theme IDs to session types for the relay
const themeToSessionType = {
  null: 'free',
  goals: 'goal_setting',
  feelings: 'emotional_processing',
  gratitude: 'gratitude_practice',
  reflection: 'evening_reflection',
  guided: 'morning_checkin',
};

const RealtimeConversation = ({ entries, onClose, category, onSaveEntry }) => {
  const [conversationTheme, setConversationTheme] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [showSavePrompt, setShowSavePrompt] = useState(false);

  const {
    status,
    transcript,
    error,
    sessionId,
    mode,
    connect,
    disconnect,
    startRecording,
    endTurn,
    endSession,
    clearError,
    clearTranscript,
  } = useVoiceRelay();

  // Start conversation
  const startConversation = useCallback(async () => {
    clearError();
    clearTranscript();
    const sessionType = themeToSessionType[conversationTheme] || 'free';
    // Use realtime for free/emotional, standard for structured guided sessions
    const requestedMode = ['free', 'emotional_processing', 'stress_release'].includes(sessionType)
      ? 'realtime'
      : 'standard';
    await connect(sessionType, requestedMode);
  }, [conversationTheme, connect, clearError, clearTranscript]);

  // End conversation
  const handleEndConversation = useCallback(() => {
    if (transcript.length > 0) {
      setShowSavePrompt(true);
    } else {
      disconnect();
      onClose();
    }
  }, [transcript, disconnect, onClose]);

  // Handle save decision
  const handleSaveDecision = useCallback(async (save) => {
    const finalTranscript = await endSession(save);

    if (save && onSaveEntry && finalTranscript) {
      // Format transcript for entry
      const entryText = transcript
        .filter((msg) => msg.role === 'user')
        .map((msg) => msg.text)
        .join('\n\n');

      onSaveEntry({
        text: entryText,
        source: 'voice',
        voiceMetadata: {
          fullTranscript: finalTranscript,
          sessionType: themeToSessionType[conversationTheme] || 'free',
          mode,
        },
      });
    }

    setShowSavePrompt(false);
    onClose();
  }, [endSession, onSaveEntry, transcript, conversationTheme, mode, onClose]);

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

  return (
    <div className="fixed inset-0 bg-gradient-to-b from-indigo-900 to-purple-900 z-50 flex flex-col pt-[env(safe-area-inset-top)]">
      {/* Header */}
      <div className="p-4 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full ${statusColors[status]}`} />
          <span className="text-white/80 text-sm">{statusLabels[status]}</span>
          {mode && (
            <span className="text-white/40 text-xs px-2 py-0.5 bg-white/10 rounded">
              {mode === 'realtime' ? 'Interactive' : 'Guided'}
            </span>
          )}
        </div>
        <button
          onClick={handleEndConversation}
          className="text-white/60 hover:text-white p-2"
        >
          <X size={24} />
        </button>
      </div>

      {/* Theme selector (only when disconnected) */}
      {status === 'disconnected' && (
        <div className="px-6 mb-4">
          <p className="text-white/60 text-sm mb-3">Choose a conversation focus:</p>
          <div className="flex flex-wrap gap-2">
            {[
              { id: null, label: 'Open chat', icon: MessageCircle },
              { id: 'goals', label: 'Goals', icon: TrendingUp },
              { id: 'feelings', label: 'Feelings', icon: Heart },
              { id: 'gratitude', label: 'Gratitude', icon: Sparkles },
              { id: 'reflection', label: 'Reflection', icon: Brain },
              { id: 'guided', label: 'Guided Session', icon: Clipboard },
            ].map((theme) => (
              <button
                key={theme.id || 'open'}
                onClick={() => setConversationTheme(theme.id)}
                className={`px-3 py-2 rounded-full text-sm flex items-center gap-2 transition-all ${
                  conversationTheme === theme.id
                    ? 'bg-white text-indigo-900'
                    : 'bg-white/10 text-white hover:bg-white/20'
                }`}
              >
                <theme.icon size={16} />
                {theme.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Conversation display */}
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
            <h3 className="text-white text-lg font-medium mb-2">Save as Entry?</h3>
            <p className="text-white/60 text-sm mb-4">
              Would you like to save this conversation as a journal entry?
            </p>
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
      <div className="p-6 pb-[max(2rem,env(safe-area-inset-bottom))] flex flex-col items-center">
        {status === 'disconnected' ? (
          // Start button
          <button
            onClick={startConversation}
            className="w-24 h-24 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg shadow-purple-500/30 flex items-center justify-center hover:scale-105 transition-transform"
          >
            <Phone size={36} className="text-white" />
          </button>
        ) : status === 'connecting' ? (
          // Connecting indicator
          <div className="w-24 h-24 rounded-full bg-gradient-to-br from-yellow-500 to-orange-600 shadow-lg flex items-center justify-center animate-pulse">
            <div className="w-8 h-8 border-4 border-white/30 border-t-white rounded-full animate-spin" />
          </div>
        ) : (
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
        )}

        <p className="text-white/60 text-sm mt-4">
          {status === 'disconnected'
            ? 'Tap to start talking'
            : status === 'connecting'
            ? 'Connecting to voice service...'
            : status === 'speaking'
            ? 'Wait for response...'
            : isRecording
            ? 'Release to send'
            : 'Hold to speak'}
        </p>
      </div>
    </div>
  );
};

export default RealtimeConversation;

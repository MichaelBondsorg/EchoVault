/**
 * UnifiedConversation Component
 *
 * A unified interface for all companion interactions:
 * - Text chat with memory-aware context
 * - Voice conversation mode
 * - Guided journaling sessions
 * - Mindfulness exercises
 *
 * Features:
 * - Mode switching (chat/voice/guided/mindfulness)
 * - Persistent memory integration
 * - Session buffer for recent entries
 * - Pattern insights integration
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Send,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  MessageCircle,
  Compass,
  Wind,
  ChevronLeft,
  Sparkles,
  Heart,
  Brain,
  Loader2
} from 'lucide-react';

// Services
import { callOpenAI, generateEmbedding, transcribeAudio } from '../../services/ai';
import {
  getCompanionContext,
  formatContextForChat,
  buildCompanionSystemPrompt
} from '../../services/rag/companionContext';
import { getMemoryGraph } from '../../services/memory';
import { getSessionBuffer, setSessionBuffer } from '../../services/memory/sessionBuffer';
import {
  GUIDED_SESSIONS,
  getRecommendedSessions,
  formatSessionAsEntry,
  generateDynamicPrompt
} from '../../services/guided/sessions';
import {
  MINDFULNESS_EXERCISES,
  getRecommendedExercises,
  personalizeLovingKindness
} from '../../services/guided/mindfulness';

// Components
import MarkdownLite from '../ui/MarkdownLite';
import VoiceRecorder from '../input/VoiceRecorder';
import BreathingExercise from '../shelter/BreathingExercise';

// Audio synthesis
import { synthesizeSpeech } from '../../utils/audio';

/**
 * Mode definitions
 */
const MODES = {
  PICKER: 'picker',
  CHAT: 'chat',
  VOICE: 'voice',
  GUIDED: 'guided',
  MINDFULNESS: 'mindfulness'
};

/**
 * Main UnifiedConversation component
 */
const UnifiedConversation = ({
  entries = [],
  category,
  userId,
  onClose,
  onSaveEntry,
  initialMode = MODES.PICKER
}) => {
  // Core state
  const [mode, setMode] = useState(initialMode);
  const [memory, setMemory] = useState(null);
  const [memoryLoading, setMemoryLoading] = useState(true);

  // Chat state
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [conversationHistory, setConversationHistory] = useState([]);

  // Voice state
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const audioRef = useRef(null);

  // Guided session state
  const [selectedSession, setSelectedSession] = useState(null);
  const [sessionStep, setSessionStep] = useState(0);
  const [sessionResponses, setSessionResponses] = useState({});

  // Mindfulness state
  const [selectedExercise, setSelectedExercise] = useState(null);

  // Refs
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Load memory on mount
  useEffect(() => {
    const loadMemory = async () => {
      if (!userId) {
        setMemoryLoading(false);
        return;
      }

      try {
        const memoryGraph = await getMemoryGraph(userId, { excludeArchived: true });
        setMemory(memoryGraph);
      } catch (e) {
        console.error('Failed to load memory:', e);
      } finally {
        setMemoryLoading(false);
      }
    };

    loadMemory();
  }, [userId]);

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  // Get companion name from memory
  const companionName = memory?.core?.preferences?.preferredName || 'there';

  // Initialize chat with greeting
  useEffect(() => {
    if (mode === MODES.CHAT && messages.length === 0) {
      const greeting = getGreeting(memory);
      setMessages([{ role: 'assistant', content: greeting }]);
    }
  }, [mode, memory]);

  /**
   * Generate greeting based on memory and time
   */
  const getGreeting = (memory) => {
    const hour = new Date().getHours();
    const name = memory?.core?.preferences?.preferredName;
    const pendingFollowUps = memory?.core?.conversationState?.pendingFollowUps?.filter(f => !f.askedAt);

    let timeGreeting = 'Hello';
    if (hour >= 5 && hour < 12) timeGreeting = 'Good morning';
    else if (hour >= 12 && hour < 17) timeGreeting = 'Good afternoon';
    else if (hour >= 17 && hour < 21) timeGreeting = 'Good evening';

    let greeting = name ? `${timeGreeting}, ${name}!` : `${timeGreeting}!`;

    // Add follow-up if available
    if (pendingFollowUps?.length > 0) {
      greeting += ` ${pendingFollowUps[0].question}`;
    } else {
      greeting += " I'm here whenever you want to chat, reflect, or explore your journal.";
    }

    return greeting;
  };

  /**
   * Send a message in chat mode
   */
  const handleSendMessage = async (text = inputText.trim()) => {
    if (!text || isLoading) return;

    // Add user message
    const userMessage = { role: 'user', content: text };
    setMessages(prev => [...prev, userMessage]);
    setInputText('');
    setIsLoading(true);

    try {
      // Generate embedding for semantic search
      const queryEmbedding = await generateEmbedding(text);

      // Get session buffer for recent entry context
      const sessionBuffer = getSessionBuffer();

      // Get companion context with tiered retrieval
      const contextResult = await getCompanionContext({
        userId,
        query: text,
        queryEmbedding,
        entries,
        category,
        sessionBuffer
      });

      // Build system prompt with memory
      const systemPrompt = buildCompanionSystemPrompt(memory);
      const contextPrompt = formatContextForChat(contextResult);

      // Build messages for API
      const apiMessages = [
        { role: 'system', content: systemPrompt },
        { role: 'system', content: `CONTEXT:\n${contextPrompt}` },
        ...conversationHistory.slice(-10), // Last 10 messages
        { role: 'user', content: text }
      ];

      // Call AI
      const response = await callOpenAI(apiMessages);

      if (response) {
        const assistantMessage = { role: 'assistant', content: response };
        setMessages(prev => [...prev, assistantMessage]);

        // Update conversation history
        setConversationHistory(prev => [
          ...prev,
          userMessage,
          assistantMessage
        ]);

        // Speak response if voice enabled
        if (voiceEnabled && mode === MODES.VOICE) {
          await speakText(response);
        }
      } else {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: "I'm sorry, I couldn't process that. Could you try again?"
        }]);
      }
    } catch (e) {
      console.error('Chat error:', e);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: "Something went wrong. Please try again."
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Handle voice input
   */
  const handleVoiceInput = async (base64, mimeType) => {
    setIsRecording(false);
    setIsLoading(true);

    try {
      const transcript = await transcribeAudio(base64, mimeType);

      if (!transcript || transcript.startsWith('API_') || transcript.includes('NO_SPEECH')) {
        setMessages(prev => [...prev, {
          role: 'system',
          content: "I couldn't hear that clearly. Could you try again?"
        }]);
        setIsLoading(false);
        return;
      }

      // Process the transcribed text
      await handleSendMessage(transcript);
    } catch (e) {
      console.error('Voice input error:', e);
      setIsLoading(false);
    }
  };

  /**
   * Speak text using TTS
   */
  const speakText = async (text) => {
    if (isSpeaking) {
      // Stop current speech
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      window.speechSynthesis?.cancel();
      setIsSpeaking(false);
      return;
    }

    setIsSpeaking(true);

    try {
      const audioUrl = await synthesizeSpeech(text, 'nova');

      if (audioUrl) {
        const audio = new Audio(audioUrl);
        audioRef.current = audio;

        audio.onended = () => {
          setIsSpeaking(false);
          audioRef.current = null;
          URL.revokeObjectURL(audioUrl);
        };

        await audio.play();
      } else {
        // Fallback to Web Speech API
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.onend = () => setIsSpeaking(false);
        window.speechSynthesis.speak(utterance);
      }
    } catch (e) {
      console.error('TTS error:', e);
      setIsSpeaking(false);
    }
  };

  /**
   * Handle guided session step
   */
  const handleSessionStep = async (response) => {
    if (!selectedSession) return;

    const currentPrompt = selectedSession.prompts[sessionStep];
    const newResponses = { ...sessionResponses, [currentPrompt.id]: response };
    setSessionResponses(newResponses);

    // Move to next step or complete
    if (sessionStep < selectedSession.prompts.length - 1) {
      setSessionStep(sessionStep + 1);
    } else {
      // Session complete - save as entry if configured
      if (selectedSession.savesAsEntry && onSaveEntry) {
        const entryText = formatSessionAsEntry(selectedSession, newResponses);
        await onSaveEntry(entryText);
      }

      // Show completion message
      setMessages([{
        role: 'assistant',
        content: selectedSession.completionMessage || 'Session complete! Well done.'
      }]);
      setMode(MODES.CHAT);
      setSelectedSession(null);
      setSessionStep(0);
      setSessionResponses({});
    }
  };

  /**
   * Render mode picker
   */
  const renderPicker = () => {
    const hour = new Date().getHours();
    const timeOfDay = hour >= 5 && hour < 12 ? 'morning' :
                      hour >= 12 && hour < 17 ? 'afternoon' :
                      hour >= 17 && hour < 21 ? 'evening' : 'night';

    const recommendedSessions = getRecommendedSessions({
      timeOfDay,
      entryCount: entries.length,
      dayOfWeek: new Date().getDay()
    });

    const recommendedExercises = getRecommendedExercises({
      hasTime: 'available'
    });

    return (
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Chat options */}
        <div className="space-y-3">
          <h3 className="text-white/60 text-sm font-medium px-2">Talk</h3>

          <button
            onClick={() => setMode(MODES.CHAT)}
            className="w-full p-4 bg-gradient-to-br from-blue-500/20 to-purple-500/20 rounded-xl flex items-center gap-4 hover:from-blue-500/30 hover:to-purple-500/30 transition-colors"
          >
            <div className="w-12 h-12 rounded-lg bg-white/10 flex items-center justify-center">
              <MessageCircle size={24} className="text-white" />
            </div>
            <div className="flex-1 text-left">
              <h4 className="text-white font-medium">Chat</h4>
              <p className="text-white/60 text-sm">Type or speak freely</p>
            </div>
          </button>

          <button
            onClick={() => {
              setMode(MODES.VOICE);
              setIsRecording(true);
            }}
            className="w-full p-4 bg-white/5 rounded-xl flex items-center gap-4 hover:bg-white/10 transition-colors"
          >
            <div className="w-12 h-12 rounded-lg bg-white/10 flex items-center justify-center">
              <Mic size={24} className="text-white" />
            </div>
            <div className="flex-1 text-left">
              <h4 className="text-white font-medium">Voice Conversation</h4>
              <p className="text-white/60 text-sm">Speak naturally, I'll respond</p>
            </div>
          </button>
        </div>

        {/* Guided sessions */}
        <div className="space-y-3">
          <h3 className="text-white/60 text-sm font-medium px-2">Guided Sessions</h3>

          {recommendedSessions.slice(0, 4).map(session => {
            const IconMap = {
              sunrise: () => <span className="text-2xl">🌅</span>,
              moon: () => <span className="text-2xl">🌙</span>,
              'pen-tool': () => <span className="text-2xl">✏️</span>,
              compass: () => <Compass size={24} className="text-white" />,
              calendar: () => <span className="text-2xl">📅</span>,
              wind: () => <Wind size={24} className="text-white" />
            };
            const Icon = IconMap[session.icon] || (() => <Sparkles size={24} className="text-white" />);

            return (
              <button
                key={session.id}
                onClick={() => {
                  setSelectedSession(session);
                  setMode(MODES.GUIDED);
                  setSessionStep(0);
                  setSessionResponses({});
                }}
                className="w-full p-4 bg-white/5 rounded-xl flex items-center gap-4 hover:bg-white/10 transition-colors"
              >
                <div className="w-12 h-12 rounded-lg bg-white/10 flex items-center justify-center">
                  <Icon />
                </div>
                <div className="flex-1 text-left">
                  <h4 className="text-white font-medium">{session.name}</h4>
                  <p className="text-white/60 text-sm">{session.description}</p>
                </div>
                <span className="text-white/40 text-xs">{session.duration}</span>
              </button>
            );
          })}
        </div>

        {/* Mindfulness */}
        <div className="space-y-3">
          <h3 className="text-white/60 text-sm font-medium px-2">Mindfulness</h3>

          {recommendedExercises.slice(0, 3).map(exercise => (
            <button
              key={exercise.id}
              onClick={() => {
                const personalized = exercise.memoryAware
                  ? personalizeLovingKindness(exercise, memory?.people || [])
                  : exercise;
                setSelectedExercise(personalized);
                setMode(MODES.MINDFULNESS);
              }}
              className="w-full p-4 bg-white/5 rounded-xl flex items-center gap-4 hover:bg-white/10 transition-colors"
            >
              <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-teal-500/30 to-cyan-500/30 flex items-center justify-center">
                <Wind size={24} className="text-white" />
              </div>
              <div className="flex-1 text-left">
                <h4 className="text-white font-medium">{exercise.name}</h4>
                <p className="text-white/60 text-sm">{exercise.description}</p>
              </div>
              <span className="text-white/40 text-xs">{exercise.duration}</span>
            </button>
          ))}
        </div>
      </div>
    );
  };

  /**
   * Render chat interface
   */
  const renderChat = () => (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, idx) => (
          <motion.div
            key={idx}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] p-3 rounded-2xl ${
                msg.role === 'user'
                  ? 'bg-blue-500 text-white'
                  : msg.role === 'system'
                  ? 'bg-yellow-500/20 text-yellow-200'
                  : 'bg-white/10 text-white'
              }`}
            >
              <MarkdownLite>{msg.content}</MarkdownLite>
            </div>
          </motion.div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-white/10 p-3 rounded-2xl">
              <Loader2 size={20} className="text-white animate-spin" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-white/10">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
            placeholder="Type a message..."
            className="flex-1 bg-white/10 rounded-xl px-4 py-3 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-white/20"
          />

          <button
            onClick={() => setIsRecording(true)}
            className="p-3 bg-white/10 rounded-xl hover:bg-white/20 transition-colors"
          >
            <Mic size={20} className="text-white" />
          </button>

          <button
            onClick={() => handleSendMessage()}
            disabled={!inputText.trim() || isLoading}
            className="p-3 bg-blue-500 rounded-xl hover:bg-blue-600 transition-colors disabled:opacity-50"
          >
            <Send size={20} className="text-white" />
          </button>
        </div>
      </div>

      {/* Voice input overlay */}
      {isRecording && (
        <VoiceInputOverlay
          onComplete={handleVoiceInput}
          onCancel={() => setIsRecording(false)}
        />
      )}
    </div>
  );

  /**
   * Render voice conversation interface
   */
  const renderVoice = () => (
    <div className="flex flex-col items-center justify-center h-full p-8">
      {/* Last message */}
      {messages.length > 0 && (
        <div className="mb-8 text-center max-w-md">
          <p className="text-white/80 text-lg">
            {messages[messages.length - 1].content}
          </p>
        </div>
      )}

      {/* Voice visualization */}
      <div className="relative mb-8">
        <motion.div
          animate={{
            scale: isRecording ? [1, 1.1, 1] : isSpeaking ? [1, 1.05, 1] : 1
          }}
          transition={{ repeat: Infinity, duration: 1.5 }}
          className={`w-32 h-32 rounded-full flex items-center justify-center ${
            isRecording
              ? 'bg-red-500'
              : isSpeaking
              ? 'bg-blue-500'
              : 'bg-white/20'
          }`}
        >
          {isRecording ? (
            <MicOff size={48} className="text-white" />
          ) : isSpeaking ? (
            <Volume2 size={48} className="text-white" />
          ) : (
            <Mic size={48} className="text-white" />
          )}
        </motion.div>
      </div>

      {/* Status */}
      <p className="text-white/60 mb-8">
        {isRecording
          ? 'Listening...'
          : isSpeaking
          ? 'Speaking...'
          : isLoading
          ? 'Thinking...'
          : 'Tap to speak'}
      </p>

      {/* Controls */}
      <div className="flex gap-4">
        {!isRecording && !isSpeaking && !isLoading && (
          <button
            onClick={() => setIsRecording(true)}
            className="px-6 py-3 bg-white rounded-full text-gray-900 font-medium hover:bg-white/90 transition-colors"
          >
            Start Speaking
          </button>
        )}

        {isRecording && (
          <button
            onClick={() => setIsRecording(false)}
            className="px-6 py-3 bg-red-500 rounded-full text-white font-medium hover:bg-red-600 transition-colors"
          >
            Stop
          </button>
        )}

        {isSpeaking && (
          <button
            onClick={() => speakText('')}
            className="px-6 py-3 bg-white/20 rounded-full text-white font-medium hover:bg-white/30 transition-colors"
          >
            Stop Speaking
          </button>
        )}
      </div>

      {/* Voice input handler */}
      {isRecording && (
        <div className="absolute inset-0 pointer-events-none">
          <VoiceRecorder
            onComplete={handleVoiceInput}
            autoStart
            onCancel={() => setIsRecording(false)}
          />
        </div>
      )}
    </div>
  );

  /**
   * Render guided session interface
   */
  const renderGuided = () => {
    if (!selectedSession) return null;

    const currentPrompt = selectedSession.prompts[sessionStep];
    const progress = (sessionStep + 1) / selectedSession.prompts.length;

    return (
      <div className="flex flex-col h-full p-6">
        {/* Progress */}
        <div className="mb-6">
          <div className="flex justify-between text-white/60 text-sm mb-2">
            <span>{selectedSession.name}</span>
            <span>{sessionStep + 1} / {selectedSession.prompts.length}</span>
          </div>
          <div className="h-1 bg-white/10 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-white"
              animate={{ width: `${progress * 100}%` }}
            />
          </div>
        </div>

        {/* Current prompt */}
        <div className="flex-1 flex flex-col items-center justify-center">
          <h2 className="text-2xl text-white font-medium text-center mb-4">
            {currentPrompt.question || currentPrompt.instruction}
          </h2>

          {currentPrompt.subtext && (
            <p className="text-white/60 text-center mb-8">
              {currentPrompt.subtext}
            </p>
          )}

          {/* Response input based on type */}
          {currentPrompt.type === 'scale' ? (
            <ScaleInput
              min={currentPrompt.min}
              max={currentPrompt.max}
              labels={currentPrompt.labels}
              onSubmit={handleSessionStep}
            />
          ) : currentPrompt.type === 'multiple' ? (
            <MultipleChoiceInput
              options={currentPrompt.options}
              multiSelect={currentPrompt.multiSelect}
              onSubmit={handleSessionStep}
            />
          ) : (
            <TextInputForSession
              placeholder={currentPrompt.placeholder}
              onSubmit={handleSessionStep}
              optional={currentPrompt.optional}
            />
          )}
        </div>
      </div>
    );
  };

  /**
   * Render mindfulness interface
   */
  const renderMindfulness = () => {
    if (!selectedExercise) return null;

    // Map exercise types to components
    if (selectedExercise.type === 'breathing') {
      const exerciseMap = {
        box_breathing: 'box',
        breathing_478: 'relaxing',
        quick_calm: 'simple'
      };

      return (
        <div className="flex flex-col h-full">
          <div className="p-4 border-b border-white/10">
            <button
              onClick={() => {
                setSelectedExercise(null);
                setMode(MODES.PICKER);
              }}
              className="flex items-center gap-2 text-white/60 hover:text-white transition-colors"
            >
              <ChevronLeft size={20} />
              Back
            </button>
          </div>

          <div className="flex-1 flex items-center justify-center bg-gradient-to-b from-gray-900 to-gray-950">
            <BreathingExercise
              exerciseType={exerciseMap[selectedExercise.id] || 'box'}
              onComplete={() => {
                setSelectedExercise(null);
                setMode(MODES.PICKER);
              }}
              onSkip={() => {
                setSelectedExercise(null);
                setMode(MODES.PICKER);
              }}
            />
          </div>
        </div>
      );
    }

    // Grounding exercise
    if (selectedExercise.type === 'grounding') {
      return (
        <GroundingExerciseUI
          exercise={selectedExercise}
          onComplete={() => {
            setSelectedExercise(null);
            setMode(MODES.PICKER);
          }}
          onBack={() => {
            setSelectedExercise(null);
            setMode(MODES.PICKER);
          }}
        />
      );
    }

    // Body scan / meditation placeholder
    return (
      <div className="flex flex-col h-full items-center justify-center p-8">
        <h2 className="text-2xl text-white font-medium mb-4">{selectedExercise.name}</h2>
        <p className="text-white/60 text-center mb-8">{selectedExercise.intro}</p>
        <button
          onClick={() => {
            setSelectedExercise(null);
            setMode(MODES.PICKER);
          }}
          className="px-6 py-3 bg-white/20 rounded-full text-white hover:bg-white/30 transition-colors"
        >
          Close
        </button>
      </div>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-gray-900 z-50 flex flex-col"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          {mode !== MODES.PICKER && (
            <button
              onClick={() => {
                if (mode === MODES.GUIDED) {
                  setSelectedSession(null);
                  setSessionStep(0);
                  setSessionResponses({});
                }
                if (mode === MODES.MINDFULNESS) {
                  setSelectedExercise(null);
                }
                setMode(MODES.PICKER);
              }}
              className="p-2 hover:bg-white/10 rounded-lg transition-colors"
            >
              <ChevronLeft size={24} className="text-white" />
            </button>
          )}
          <div>
            <h1 className="text-white font-semibold">
              {mode === MODES.PICKER ? 'Your Companion' :
               mode === MODES.CHAT ? 'Chat' :
               mode === MODES.VOICE ? 'Voice' :
               mode === MODES.GUIDED ? selectedSession?.name :
               selectedExercise?.name}
            </h1>
            {memoryLoading && (
              <p className="text-white/40 text-xs">Loading memories...</p>
            )}
          </div>
        </div>

        <button
          onClick={onClose}
          className="p-2 hover:bg-white/10 rounded-lg transition-colors"
        >
          <X size={24} className="text-white" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {mode === MODES.PICKER && renderPicker()}
        {mode === MODES.CHAT && renderChat()}
        {mode === MODES.VOICE && renderVoice()}
        {mode === MODES.GUIDED && renderGuided()}
        {mode === MODES.MINDFULNESS && renderMindfulness()}
      </div>
    </motion.div>
  );
};

/**
 * Scale input component for guided sessions
 */
const ScaleInput = ({ min, max, labels, onSubmit }) => {
  const [value, setValue] = useState(Math.floor((max + min) / 2));

  return (
    <div className="w-full max-w-sm">
      <div className="flex justify-between text-white/60 text-sm mb-2">
        <span>{labels?.[min] || min}</span>
        <span>{labels?.[max] || max}</span>
      </div>

      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={e => setValue(Number(e.target.value))}
        className="w-full h-2 bg-white/20 rounded-full appearance-none cursor-pointer"
      />

      <div className="text-center mt-4">
        <span className="text-4xl text-white font-bold">{value}</span>
      </div>

      <button
        onClick={() => onSubmit(value)}
        className="w-full mt-6 px-6 py-3 bg-white rounded-xl text-gray-900 font-medium hover:bg-white/90 transition-colors"
      >
        Continue
      </button>
    </div>
  );
};

/**
 * Multiple choice input for guided sessions
 */
const MultipleChoiceInput = ({ options, multiSelect, onSubmit }) => {
  const [selected, setSelected] = useState(multiSelect ? [] : null);

  const handleSelect = (value) => {
    if (multiSelect) {
      setSelected(prev =>
        prev.includes(value)
          ? prev.filter(v => v !== value)
          : [...prev, value]
      );
    } else {
      setSelected(value);
    }
  };

  return (
    <div className="w-full max-w-sm space-y-3">
      {options.map(option => (
        <button
          key={option.value}
          onClick={() => handleSelect(option.value)}
          className={`w-full p-4 rounded-xl text-left transition-colors ${
            (multiSelect ? selected.includes(option.value) : selected === option.value)
              ? 'bg-white text-gray-900'
              : 'bg-white/10 text-white hover:bg-white/20'
          }`}
        >
          {option.label}
        </button>
      ))}

      <button
        onClick={() => onSubmit(selected)}
        disabled={multiSelect ? selected.length === 0 : !selected}
        className="w-full mt-4 px-6 py-3 bg-blue-500 rounded-xl text-white font-medium hover:bg-blue-600 transition-colors disabled:opacity-50"
      >
        Continue
      </button>
    </div>
  );
};

/**
 * Text input for guided sessions
 */
const TextInputForSession = ({ placeholder, onSubmit, optional }) => {
  const [text, setText] = useState('');

  return (
    <div className="w-full max-w-md">
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder={placeholder}
        rows={4}
        className="w-full bg-white/10 rounded-xl px-4 py-3 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-white/20 resize-none"
      />

      <div className="flex gap-3 mt-4">
        {optional && (
          <button
            onClick={() => onSubmit(null)}
            className="flex-1 px-6 py-3 bg-white/10 rounded-xl text-white font-medium hover:bg-white/20 transition-colors"
          >
            Skip
          </button>
        )}
        <button
          onClick={() => onSubmit(text)}
          disabled={!text.trim() && !optional}
          className="flex-1 px-6 py-3 bg-white rounded-xl text-gray-900 font-medium hover:bg-white/90 transition-colors disabled:opacity-50"
        >
          Continue
        </button>
      </div>
    </div>
  );
};

/**
 * Voice input overlay
 */
const VoiceInputOverlay = ({ onComplete, onCancel }) => (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    className="absolute inset-0 bg-black/80 flex items-center justify-center z-10"
  >
    <div className="text-center">
      <VoiceRecorder
        onComplete={onComplete}
        autoStart
        onCancel={onCancel}
      />
      <button
        onClick={onCancel}
        className="mt-4 text-white/60 hover:text-white transition-colors"
      >
        Cancel
      </button>
    </div>
  </motion.div>
);

/**
 * Grounding exercise UI
 */
const GroundingExerciseUI = ({ exercise, onComplete, onBack }) => {
  const [step, setStep] = useState(0);
  const [responses, setResponses] = useState([]);
  const currentStep = exercise.steps[step];

  const handleNext = (response) => {
    setResponses([...responses, response]);

    if (step < exercise.steps.length - 1) {
      setStep(step + 1);
    } else {
      onComplete();
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-white/10">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-white/60 hover:text-white transition-colors"
        >
          <ChevronLeft size={20} />
          Back
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <div className="text-6xl mb-6">{currentStep.count}</div>
        <h2 className="text-2xl text-white font-medium text-center mb-4">
          {currentStep.prompt}
        </h2>
        <p className="text-white/60 text-center mb-8">
          {currentStep.instruction}
        </p>

        <TextInputForSession
          placeholder={`Name ${currentStep.count} things...`}
          onSubmit={handleNext}
        />

        <div className="flex gap-2 mt-8">
          {exercise.steps.map((_, idx) => (
            <div
              key={idx}
              className={`w-2 h-2 rounded-full ${
                idx <= step ? 'bg-white' : 'bg-white/20'
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default UnifiedConversation;

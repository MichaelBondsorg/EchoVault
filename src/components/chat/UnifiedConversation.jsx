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
  Loader2,
  Phone,
  Tag
} from 'lucide-react';

// Hooks
import { useVoiceRelay } from '../../hooks/useVoiceRelay';
import { useDismissablePopover } from '../../hooks/useDismissablePopover';

// Services
import { callOpenAI, generateEmbedding, transcribeAudio } from '../../services/ai';
import {
  getCompanionContext,
  formatContextForChat,
  buildCompanionSystemPrompt
} from '../../services/rag/companionContext';
import { getMemoryGraph } from '../../services/memory';
import { getSessionBuffer, setSessionBuffer } from '../../services/memory/sessionBuffer';
import { getFlag } from '../../config/flags';
import { db } from '../../config/firebase';
import { subscribeSpaces, getLastCaptureSpaceId } from '../../services/spaces/spacesService';
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
import SpacePicker from '../spaces/SpacePicker';
import { SectionLabel, Button, Chip } from '../cloud';

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

  // Voice state (for chat mode voice input overlay)
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const audioRef = useRef(null);

  // Natural voice conversation via useVoiceRelay
  const {
    status: voiceStatus,
    transcript: voiceTranscript,
    error: voiceError,
    connect: voiceConnect,
    disconnect: voiceDisconnect,
    startRecording: voiceStartRecording,
    endTurn: voiceEndTurn,
    endSession: voiceEndSession,
    clearError: voiceClearError,
    clearTranscript: voiceClearTranscript
  } = useVoiceRelay();
  const [voiceIsRecording, setVoiceIsRecording] = useState(false);

  // Guided session state
  const [selectedSession, setSelectedSession] = useState(null);
  const [sessionStep, setSessionStep] = useState(0);
  const [sessionResponses, setSessionResponses] = useState({});

  // Mindfulness state
  const [selectedExercise, setSelectedExercise] = useState(null);

  // Ask Journal scope (PRD R1 Context Spaces, plan task 11): scopes which
  // entries getCompanionContext draws from. `null` means "All spaces"
  // (identity — unscoped, legacy behavior). Michael's decision: no spaces ->
  // default stays All and the chip is hidden entirely (zero UI change for
  // users who haven't adopted spaces); has spaces -> default to the last
  // capture Space, loaded once via getLastCaptureSpaceId. "All spaces" is
  // always an explicit row in the selector regardless of the default.
  const contextSpacesOn = getFlag('contextSpaces');
  const [spaces, setSpaces] = useState([]);
  const [scope, setScope] = useState(null); // {spaceId} | null
  const scopeDefaultLoadedRef = useRef(false);
  // Voice-connect race guard (review fix, task 5): the spaces subscription
  // and the one-shot default-scope load are both async, so `effectiveScope`
  // can still be null-by-default (not yet resolved) at the moment a user
  // jumps straight into Voice mode. `spacesLoaded` flips true on the FIRST
  // subscribeSpaces snapshot (empty counts — zero-space users must not
  // wait further); `defaultScopeSettled` flips true once the default-scope
  // load has settled, success OR failure — a failure must not hang voice
  // forever, it just proceeds unscoped. See `scopeReady` below.
  const [spacesLoaded, setSpacesLoaded] = useState(false);
  const [defaultScopeSettled, setDefaultScopeSettled] = useState(false);
  const [scopePickerOpen, setScopePickerOpen] = useState(false);
  const scopePopoverRef = useDismissablePopover(scopePickerOpen, () => setScopePickerOpen(false));

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

  // Context Space scope (flag: contextSpaces): subscribe to the owner's
  // active spaces so the header chip/selector can list them.
  useEffect(() => {
    if (!contextSpacesOn || !userId) {
      setSpaces([]);
      setSpacesLoaded(true);
      return undefined;
    }
    return subscribeSpaces(db, userId, (list) => {
      setSpaces(list);
      setSpacesLoaded(true);
    });
  }, [contextSpacesOn, userId]);

  // Load the default scope ONCE per userId, after the first spaces
  // subscription callback resolves: no spaces -> stays null/All (chip stays
  // hidden regardless, see the render below); has spaces -> the last
  // capture Space (falls back to All if nothing has ever been captured
  // into a space).
  useEffect(() => {
    if (!contextSpacesOn || !userId || scopeDefaultLoadedRef.current) return;
    if (spaces.length === 0) return;
    let cancelled = false;
    scopeDefaultLoadedRef.current = true;
    getLastCaptureSpaceId(db, userId)
      .then((lastId) => {
        if (!cancelled) setScope(lastId ? { spaceId: lastId } : null);
      })
      .catch((e) => {
        console.warn('[Spaces] failed to load default Ask Journal scope:', e?.message);
        // Explicit failure path: proceed unscoped rather than blocking voice
        // (or anything else gated on scopeReady) forever.
      })
      .finally(() => {
        // Settlement is UNCONDITIONAL (not gated on `cancelled`), unlike the
        // `.then` above which applies the loaded scope. The one-shot
        // `scopeDefaultLoadedRef` guard means this is the only promise ever
        // created for this userId, so it's also the only signal that will
        // ever flip `defaultScopeSettled`. `subscribeSpaces` delivers a
        // fresh array on every snapshot (and Firestore commonly double-
        // delivers cache-then-server on a new listener); a re-fire of this
        // effect before this promise settles runs THIS invocation's cleanup
        // (cancelled = true) while the ref guard blocks any replacement
        // promise from being created. If settlement were also gated on
        // `!cancelled`, that re-fire would permanently strand
        // `defaultScopeSettled` at false — and with it `scopeReady` and
        // voice-connect — even though this promise still resolves. React 18
        // setState-after-unmount is a safe no-op, and settlement is an
        // idempotent boolean, so firing it unconditionally is safe.
        setDefaultScopeSettled(true);
      });
    return () => { cancelled = true; };
  }, [contextSpacesOn, userId, spaces]);

  // scopeReady: gates voice-connect (below) so an early voice entry can
  // never start — and silently stay — unscoped while the default-scope
  // load is still in flight. Zero-space users are never delayed past the
  // first (empty) spaces snapshot; a non-empty snapshot additionally waits
  // for the default-scope load to settle (applied or failed).
  const scopeReady = !contextSpacesOn
    || (spacesLoaded && (spaces.length === 0 || defaultScopeSettled));

  // Explicit scope selection (session-only — unlike EntryBar's capture
  // pill, Ask Journal's scope choice is not persisted as the "last capture
  // space"; it only affects this conversation's context retrieval).
  const handleSelectScope = (spaceId) => {
    setScope(spaceId ? { spaceId } : null);
    setScopePickerOpen(false);
  };

  const selectedScopeSpace = spaces.find((s) => s.id === scope?.spaceId) || null;

  // Effective scope actually passed into getCompanionContext. Derived from
  // `selectedScopeSpace` (the live spaces list), NOT the raw `scope` state
  // directly: if the selected space is archived while this conversation is
  // open, `subscribeSpaces` drops it from `spaces` on its next snapshot,
  // `selectedScopeSpace` resolves to null, and the chip label falls back to
  // "All spaces" — this derivation makes retrieval follow that same fallback
  // instead of silently continuing to scope-to-nothing on a spaceId that no
  // longer resolves to any space. Label and retrieval can never diverge.
  const effectiveScope = selectedScopeSpace ? { spaceId: selectedScopeSpace.id } : null;

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

  // Connect to voice relay when entering VOICE mode. Gated on `scopeReady`
  // (review fix, task 5) so we never connect on a not-yet-resolved default
  // scope and silently stay unscoped for the rest of the session — see
  // `scopeReady` above. `effectiveScope` is deliberately NOT in the deps:
  // scope is captured once at session start by design, so a scope change
  // after connect must never re-trigger this effect (the `voiceStatus`
  // guard also prevents it — once connected, voiceStatus leaves
  // 'disconnected' and stays there for the life of the session).
  useEffect(() => {
    if (mode === MODES.VOICE && voiceStatus === 'disconnected' && scopeReady) {
      console.log('[Voice] Entering voice mode, connecting...');
      voiceClearError();
      voiceClearTranscript();
      // Thread the Ask Journal scope active at session start into the relay
      // (R2 plan task 5) so voice's server-side RAG (get_memory tool, recent
      // entries) never leaks cross-space content into a scoped conversation
      // — same effectiveScope used for the text-chat getCompanionContext
      // call above.
      voiceConnect('free', 'realtime', effectiveScope?.spaceId ?? null);
    }
  }, [mode, voiceStatus, scopeReady]);

  // Cleanup voice relay when leaving VOICE mode or unmounting
  useEffect(() => {
    return () => {
      if (voiceStatus !== 'disconnected') {
        console.log('[Voice] Cleaning up voice connection');
        voiceDisconnect();
      }
    };
  }, []);

  // Auto-stop recording when AI starts speaking
  useEffect(() => {
    if (voiceStatus === 'speaking' && voiceIsRecording) {
      setVoiceIsRecording(false);
    }
  }, [voiceStatus, voiceIsRecording]);

  // Toggle voice recording (push-to-talk style for reliability)
  const toggleVoiceRecording = useCallback(() => {
    if (voiceIsRecording) {
      setVoiceIsRecording(false);
      voiceEndTurn();
    } else {
      setVoiceIsRecording(true);
      voiceStartRecording();
    }
  }, [voiceIsRecording, voiceStartRecording, voiceEndTurn]);

  // End voice conversation
  const handleEndVoice = useCallback(async () => {
    await voiceEndSession(false);
    voiceDisconnect();
    setMode(MODES.PICKER);
  }, [voiceEndSession, voiceDisconnect]);

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
        scope: effectiveScope,
        sessionBuffer
      });

      // Build system prompt with memory and context
      const baseSystemPrompt = buildCompanionSystemPrompt(memory);
      const contextPrompt = formatContextForChat(contextResult);
      const fullSystemPrompt = `${baseSystemPrompt}\n\nCONTEXT:\n${contextPrompt}`;

      // Build user prompt with conversation history
      const historyContext = conversationHistory.slice(-10).map(m =>
        `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`
      ).join('\n');

      const userPrompt = historyContext
        ? `Previous conversation:\n${historyContext}\n\nUser: ${text}`
        : text;

      // Call AI (expects systemPrompt, userPrompt as separate strings)
      const response = await callOpenAI(fullSystemPrompt, userPrompt);

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
          <SectionLabel className="px-2">Talk</SectionLabel>

          {/* Primary entry point: filled accent-wash surface + accent-deep
              icon well distinguishes "Chat" as the highlighted option
              (was a lavender gradient highlight pre-migration). */}
          <button
            onClick={() => setMode(MODES.CHAT)}
            className="w-full p-4 rounded-2xl border border-border bg-accent-wash flex items-center gap-4 transition-colors hover:bg-divider"
          >
            <div className="w-12 h-12 rounded-lg bg-accent-deep flex items-center justify-center flex-none">
              <MessageCircle size={24} className="text-background" aria-hidden="true" />
            </div>
            <div className="flex-1 text-left">
              <h4 className="font-medium text-foreground">Chat</h4>
              <p className="text-sm text-muted-foreground">Type or speak freely</p>
            </div>
          </button>

          <button
            onClick={() => setMode(MODES.VOICE)}
            className="w-full p-4 rounded-2xl border border-border bg-card shadow-sm flex items-center gap-4 transition-colors hover:bg-divider"
          >
            <div className="w-12 h-12 rounded-lg bg-accent-wash flex items-center justify-center flex-none">
              <Mic size={24} className="text-accent-deep" aria-hidden="true" />
            </div>
            <div className="flex-1 text-left">
              <h4 className="font-medium text-foreground">Voice Conversation</h4>
              <p className="text-sm text-muted-foreground">Natural turn-taking, like a real conversation</p>
            </div>
          </button>
        </div>

        {/* Guided sessions */}
        <div className="space-y-3">
          <SectionLabel className="px-2">Guided Sessions</SectionLabel>

          {recommendedSessions.slice(0, 4).map(session => {
            const IconMap = {
              sunrise: () => <span className="text-2xl">🌅</span>,
              moon: () => <span className="text-2xl">🌙</span>,
              'pen-tool': () => <span className="text-2xl">✏️</span>,
              compass: () => <Compass size={24} className="text-accent-deep" aria-hidden="true" />,
              calendar: () => <span className="text-2xl">📅</span>,
              wind: () => <Wind size={24} className="text-accent-deep" aria-hidden="true" />
            };
            const Icon = IconMap[session.icon] || (() => <Sparkles size={24} className="text-accent-deep" aria-hidden="true" />);

            return (
              <button
                key={session.id}
                onClick={() => {
                  setSelectedSession(session);
                  setMode(MODES.GUIDED);
                  setSessionStep(0);
                  setSessionResponses({});
                }}
                className="w-full p-4 rounded-2xl border border-border bg-card shadow-sm flex items-center gap-4 transition-colors hover:bg-divider"
              >
                <div className="w-12 h-12 rounded-lg bg-accent-wash flex items-center justify-center flex-none">
                  <Icon />
                </div>
                <div className="flex-1 text-left">
                  <h4 className="font-medium text-foreground">{session.name}</h4>
                  <p className="text-sm text-muted-foreground">{session.description}</p>
                </div>
                <span className="text-xs text-faint">{session.duration}</span>
              </button>
            );
          })}
        </div>

        {/* Mindfulness */}
        <div className="space-y-3">
          <SectionLabel className="px-2">Mindfulness</SectionLabel>

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
              className="w-full p-4 rounded-2xl border border-border bg-card shadow-sm flex items-center gap-4 transition-colors hover:bg-divider"
            >
              <div className="w-12 h-12 rounded-lg bg-accent-wash flex items-center justify-center flex-none">
                <Wind size={24} className="text-accent-deep" aria-hidden="true" />
              </div>
              <div className="flex-1 text-left">
                <h4 className="font-medium text-foreground">{exercise.name}</h4>
                <p className="text-sm text-muted-foreground">{exercise.description}</p>
              </div>
              <span className="text-xs text-faint">{exercise.duration}</span>
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
      {/* Messages. CLOUD-DESIGN-SPEC.md §7 AI chat: companion bubble = bg-card
          radius 16 with a 6px corner on the speaker (bottom-left) side; user
          bubble = accent-deep with a 6px corner on its speaker (bottom-right)
          side. MarkdownLite (shared, cross-screen, out of D1's target-file
          scope) still injects its own hardcoded legacy text-color utilities
          per line/node — the `[&_*]:!text-*` wrapper below is a local,
          !important override (same pattern as the EntryCard colorMap.js
          precedent) so those runtime-injected classes never render, without
          touching MarkdownLite.jsx itself. */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, idx) => (
          <motion.div
            key={idx}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[82%] p-3 ${
                msg.role === 'user'
                  ? 'rounded-2xl rounded-br-[6px] bg-accent-deep'
                  : msg.role === 'system'
                  ? 'rounded-2xl rounded-bl-[6px] border border-border bg-accent-wash'
                  : 'rounded-2xl rounded-bl-[6px] border border-border bg-card shadow-sm'
              }`}
            >
              <div
                className={
                  msg.role === 'user'
                    ? '[&_*]:!text-background'
                    : msg.role === 'system'
                    ? '[&_*]:!text-accent-deep'
                    : '[&_*]:!text-foreground'
                }
              >
                <MarkdownLite text={msg.content} variant="default" />
              </div>
            </div>
          </motion.div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-[6px] border border-border bg-card shadow-sm p-3">
              <Loader2 size={20} className="text-accent-deep animate-spin" aria-hidden="true" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input. Spec: "pill input + accent mic button". This component keeps
          Mic (open voice overlay) and Send (submit typed text) as two
          always-visible, independently-functioning buttons (unlike the
          mockup's single icon, which morphs mic<->send around one action) —
          collapsing them would be a behavior change, out of scope for a
          restyle. Send carries the accent-deep primary treatment since it is
          this row's actual submit action; Mic stays a secondary bg-card
          control, matching EntryBar's idle mic/keyboard treatment. */}
      <div className="p-4 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-border">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
            onFocus={() => {
              // Keep the latest messages visible once the keyboard finishes
              // resizing the webview (Keyboard resize: 'native').
              setTimeout(() => messagesEndRef.current?.scrollIntoView({ block: 'end' }), 350);
            }}
            placeholder="Message your companion…"
            className="flex-1 min-h-[44px] bg-card border border-border rounded-full px-[18px] py-3 text-[13.5px] text-foreground placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent"
          />

          <button
            onClick={() => setIsRecording(true)}
            aria-label="Record voice message"
            className="w-11 h-11 rounded-full bg-card border border-border flex items-center justify-center hover:bg-divider transition-colors flex-none"
          >
            <Mic size={18} className="text-accent-deep" aria-hidden="true" />
          </button>

          <button
            onClick={() => handleSendMessage()}
            disabled={!inputText.trim() || isLoading}
            aria-label="Send message"
            className="w-11 h-11 rounded-full bg-accent-deep text-background flex items-center justify-center shadow-soft hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex-none"
          >
            <Send size={18} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Voice input overlay */}
      {isRecording && (
        <VoiceInputOverlay
          onSave={handleVoiceInput}
          onCancel={() => setIsRecording(false)}
        />
      )}
    </div>
  );

  /**
   * Render voice conversation interface using natural voice relay
   */
  const renderVoice = () => {
    // Voice session's dedicated Cloud restyle (Pebble mascot, LISTENING caps,
    // Equalizer) is a separate task (D2, `RealtimeConversation.jsx`). This
    // in-modal voice mode is a distinct code path (useVoiceRelay) — tokenized
    // onto the same Cloud palette for consistency, without inventing D2's
    // spec-specific signature elements.
    const statusColors = {
      disconnected: 'bg-faint',
      connecting: 'bg-accent animate-pulse',
      connected: 'bg-accent',
      speaking: 'bg-accent-deep animate-pulse',
      listening: 'bg-accent-deep animate-pulse'
    };

    const statusLabels = {
      disconnected: 'Ready to start',
      connecting: 'Connecting...',
      connected: 'Connected',
      speaking: 'AI is speaking...',
      listening: 'Listening...'
    };

    return (
      <div className="flex flex-col h-full">
        {/* Status bar */}
        <div className="px-6 py-3 flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full ${statusColors[voiceStatus]}`} />
          <span className="text-sm text-secondary-foreground">{statusLabels[voiceStatus]}</span>
        </div>

        {/* Conversation transcript */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {voiceTranscript.map((msg, i) => (
            <div
              key={i}
              className={`mb-4 ${msg.role === 'user' ? 'text-right' : 'text-left'}`}
            >
              <div
                className={`inline-block max-w-[85%] px-4 py-3 ${
                  msg.role === 'user'
                    ? 'rounded-2xl rounded-br-[6px] bg-accent-deep text-background'
                    : 'rounded-2xl rounded-bl-[6px] border border-border bg-card shadow-sm text-foreground'
                }`}
              >
                {/* RES-002: break-words for text reflow on small screens */}
                <p className="text-sm break-words">{msg.text}</p>
              </div>
            </div>
          ))}

          {voiceStatus === 'speaking' && (
            <div className="flex justify-center">
              <div className="flex gap-1">
                {[...Array(3)].map((_, i) => (
                  <div
                    key={i}
                    className="w-2 h-8 bg-accent rounded-full animate-pulse"
                    style={{ animationDelay: `${i * 150}ms` }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Error display */}
        {voiceError && (
          <div className="mx-6 mb-4 p-3 rounded-lg border border-destructive bg-[var(--destructive-wash)]">
            <p className="text-sm text-destructive">{voiceError}</p>
            <button
              onClick={voiceClearError}
              className="mt-1 text-xs text-destructive underline"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Main controls */}
        <div className="p-6 pb-[max(2rem,env(safe-area-inset-bottom))] flex flex-col items-center">
          {voiceStatus === 'connecting' ? (
            <div className="w-24 h-24 rounded-full bg-accent-wash shadow-soft flex items-center justify-center animate-pulse">
              <div className="w-8 h-8 border-4 border-border border-t-accent-deep rounded-full animate-spin" />
            </div>
          ) : voiceStatus !== 'disconnected' ? (
            <div className="flex items-center gap-6">
              {/* End call button. bg-destructive (not literal red-*) — same
                  fixed, non-alarming terracotta token as SettingsPage's
                  "Delete everything" — this is a standard hang-up affordance,
                  not crisis/safety UI. text-white is intentional: --destructive
                  doesn't flip polarity between themes like accent-deep does,
                  so text-background would fail contrast in dark mode. */}
              <button
                onClick={handleEndVoice}
                aria-label="End voice session"
                className="w-16 h-16 rounded-full bg-destructive shadow-soft-lg flex items-center justify-center hover:scale-105 transition-transform"
              >
                <Phone size={24} className="text-white rotate-[135deg]" aria-hidden="true" />
              </button>

              {/* Push-to-talk button */}
              <button
                onMouseDown={toggleVoiceRecording}
                onMouseUp={() => voiceIsRecording && toggleVoiceRecording()}
                onTouchStart={(e) => {
                  e.preventDefault();
                  toggleVoiceRecording();
                }}
                onTouchEnd={(e) => {
                  e.preventDefault();
                  if (voiceIsRecording) toggleVoiceRecording();
                }}
                onTouchCancel={(e) => {
                  e.preventDefault();
                  if (voiceIsRecording) toggleVoiceRecording();
                }}
                onContextMenu={(e) => e.preventDefault()}
                disabled={voiceStatus === 'speaking'}
                aria-label={voiceIsRecording ? 'Release to send' : 'Hold to speak'}
                style={{ touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none' }}
                className={`w-24 h-24 rounded-full shadow-soft-lg flex items-center justify-center transition-all select-none ${
                  voiceIsRecording
                    ? 'bg-accent-deep scale-110'
                    : voiceStatus === 'speaking'
                    ? 'bg-divider opacity-60 cursor-not-allowed'
                    : 'bg-accent-deep hover:scale-105'
                }`}
              >
                {voiceIsRecording ? (
                  <MicOff size={36} className="text-background animate-pulse" aria-hidden="true" />
                ) : voiceStatus === 'speaking' ? (
                  <Mic size={36} className="text-faint" aria-hidden="true" />
                ) : (
                  <Mic size={36} className="text-background" aria-hidden="true" />
                )}
              </button>
            </div>
          ) : null}

          <p className="text-sm text-muted-foreground mt-4">
            {voiceStatus === 'connecting'
              ? 'Connecting to voice service...'
              : voiceStatus === 'speaking'
              ? 'Wait for response...'
              : voiceIsRecording
              ? 'Release to send'
              : voiceStatus === 'disconnected'
              ? 'Starting voice...'
              : 'Hold to speak'}
          </p>

          <button
            onClick={() => {
              if (voiceStatus !== 'disconnected') {
                voiceDisconnect();
              }
              setMode(MODES.CHAT);
            }}
            className="mt-4 text-sm text-faint hover:text-muted-foreground transition-colors"
          >
            Switch to text chat
          </button>
        </div>
      </div>
    );
  };

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
          <div className="flex justify-between text-sm text-muted-foreground mb-2">
            <span>{selectedSession.name}</span>
            <span>{sessionStep + 1} / {selectedSession.prompts.length}</span>
          </div>
          <div className="h-1 bg-divider rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-accent-deep"
              animate={{ width: `${progress * 100}%` }}
            />
          </div>
        </div>

        {/* Current prompt */}
        <div className="flex-1 flex flex-col items-center justify-center">
          <h2 className="text-2xl font-medium text-center text-foreground mb-4">
            {currentPrompt.question || currentPrompt.instruction}
          </h2>

          {currentPrompt.subtext && (
            <p className="text-center text-muted-foreground mb-8">
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
          <div className="p-4 border-b border-border">
            <button
              onClick={() => {
                setSelectedExercise(null);
                setMode(MODES.PICKER);
              }}
              className="flex min-h-[44px] items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronLeft size={20} aria-hidden="true" />
              Back
            </button>
          </div>

          <div className="flex-1 flex items-center justify-center bg-background">
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
        <h2 className="text-2xl font-medium text-foreground mb-4">{selectedExercise.name}</h2>
        <p className="text-center text-muted-foreground mb-8">{selectedExercise.intro}</p>
        <Button
          onClick={() => {
            setSelectedExercise(null);
            setMode(MODES.PICKER);
          }}
          variant="outline"
        >
          Close
        </Button>
      </div>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-background z-50 flex flex-col pt-[env(safe-area-inset-top)]"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
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
              aria-label="Back to companion menu"
              className="cloud-icon-button"
            >
              <ChevronLeft size={22} aria-hidden="true" />
            </button>
          )}
          <div>
            <h1 className="font-semibold text-[15px] text-foreground">
              {mode === MODES.PICKER ? 'Your Companion' :
               mode === MODES.CHAT ? 'Companion' :
               mode === MODES.VOICE ? 'Voice' :
               mode === MODES.GUIDED ? selectedSession?.name :
               selectedExercise?.name}
            </h1>
            {/* CLOUD-DESIGN-SPEC.md §7 AI chat: "here with you" subtitle under
                the Companion header, chat mode only (matches mockup 5c/6c). */}
            {mode === MODES.CHAT && (
              <p className="text-[11px] text-accent-deep">here with you</p>
            )}
            {memoryLoading && (
              <p className="text-[11px] text-faint">Loading memories...</p>
            )}
            {/* Ask Journal scope chip (flag: contextSpaces) — hidden
                entirely when the user has no spaces (Michael's decision:
                zero UI change for non-adopters). "All spaces" is always an
                explicit row so the answer's scope stays visibly stated. */}
            {contextSpacesOn && mode === MODES.CHAT && spaces.length > 0 && (
              <div className="relative mt-1 inline-block" ref={scopePopoverRef}>
                <Chip
                  as="button"
                  type="button"
                  onClick={() => setScopePickerOpen((open) => !open)}
                  aria-haspopup="listbox"
                  aria-expanded={scopePickerOpen}
                  aria-label={selectedScopeSpace ? `Ask Journal scope: ${selectedScopeSpace.name}` : 'Ask Journal scope: All spaces'}
                  className="text-[10px]"
                >
                  <Tag size={10} aria-hidden="true" />
                  <span>{selectedScopeSpace ? selectedScopeSpace.name : 'All spaces'}</span>
                </Chip>
                {scopePickerOpen && (
                  <SpacePicker
                    spaces={spaces}
                    selectedSpaceId={scope?.spaceId ?? null}
                    onSelect={handleSelectScope}
                    defaultLabel="All spaces"
                    align="left"
                    ariaLabel="Choose Ask Journal scope"
                  />
                )}
              </div>
            )}
          </div>
        </div>

        <button
          onClick={onClose}
          aria-label="Close companion"
          className="cloud-icon-button"
        >
          <X size={22} aria-hidden="true" />
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
      <div className="flex justify-between text-sm text-muted-foreground mb-2">
        <span>{labels?.[min] || min}</span>
        <span>{labels?.[max] || max}</span>
      </div>

      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={e => setValue(Number(e.target.value))}
        className="w-full h-2 bg-divider rounded-full appearance-none cursor-pointer"
      />

      <div className="text-center mt-4">
        <span className="text-4xl font-bold text-foreground">{value}</span>
      </div>

      <Button onClick={() => onSubmit(value)} className="w-full mt-6">
        Continue
      </Button>
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
          className={`w-full min-h-[44px] p-4 rounded-xl text-left border transition-colors ${
            (multiSelect ? selected.includes(option.value) : selected === option.value)
              ? 'border-accent-deep bg-accent-deep text-background'
              : 'border-border bg-card text-foreground hover:bg-divider'
          }`}
        >
          {option.label}
        </button>
      ))}

      <Button
        onClick={() => onSubmit(selected)}
        disabled={multiSelect ? selected.length === 0 : !selected}
        className="w-full mt-4"
      >
        Continue
      </Button>
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
        className="w-full bg-card border border-border rounded-xl px-4 py-3 text-foreground placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent resize-none"
      />

      <div className="flex gap-3 mt-4">
        {optional && (
          <Button onClick={() => onSubmit(null)} variant="outline" className="flex-1">
            Skip
          </Button>
        )}
        <Button
          onClick={() => onSubmit(text)}
          disabled={!text.trim() && !optional}
          className="flex-1"
        >
          Continue
        </Button>
      </div>
    </div>
  );
};

/**
 * Voice input overlay for chat mode
 */
const VoiceInputOverlay = ({ onSave, onCancel }) => (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[var(--overlay)] p-4"
  >
    <div className="w-full max-w-xs rounded-2xl border border-border bg-card shadow-soft-lg p-6 flex flex-col items-center">
      <p className="mb-6 text-secondary-foreground">Tap to record your message</p>
      <VoiceRecorder
        onSave={onSave}
        onSwitch={onCancel}
        minimal
      />
      <button
        onClick={onCancel}
        className="mt-6 min-h-[44px] px-2 text-muted-foreground hover:text-foreground transition-colors"
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
      <div className="p-4 border-b border-border">
        <button
          onClick={onBack}
          className="flex min-h-[44px] items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft size={20} aria-hidden="true" />
          Back
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <div className="text-6xl mb-6 text-accent-deep">{currentStep.count}</div>
        <h2 className="text-2xl font-medium text-center text-foreground mb-4">
          {currentStep.prompt}
        </h2>
        <p className="text-center text-muted-foreground mb-8">
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
                idx <= step ? 'bg-accent-deep' : 'bg-divider'
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default UnifiedConversation;

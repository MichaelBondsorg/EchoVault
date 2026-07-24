import { useState, useRef, useCallback, useEffect } from 'react';
import { auth } from '../config/firebase';
import { getRelayWsUrl, getRelayHttpUrl } from '../config/relay';
import { ownerStorageKey } from '../services/storage/ownerScopedStorage';

// PRIV-01 (docs/superpowers/plans/2026-07-24-full-product-review.md,
// src/services/storage/storageRegistry.js's 'voice.transcript' row): the
// in-progress transcript, kept only so a dropped connection can be restored,
// must be owner-scoped, expire, and actually be removed — not persisted
// forever under an unowned, per-session key. One static key per owner
// (rather than the old `voice_transcript_${sessionId}` — at most one voice
// session is ever active at a time) so logout can address and remove it by
// name; the stored payload still carries its own sessionId so a restore
// never applies a stale transcript to the wrong session.
const VOICE_TRANSCRIPT_TTL_MS = 30 * 60 * 1000; // 30 minutes

const voiceTranscriptKey = (uid) => ownerStorageKey(uid, 'voice/transcript');

/** Legacy (pre owner-scoping) per-session key this transcript used to live under. */
const legacyVoiceTranscriptKey = (sessionId) => `voice_transcript_${sessionId}`;

/**
 * Best-effort removal of the CURRENT session's legacy unowned key. Per
 * ADR-0001, an unowned value is never adopted — this only ever deletes, it
 * never migrates content forward. (An older legacy key from a prior session
 * cannot be located this way, since its sessionId no longer matches
 * anything live; it's simply orphaned and never read again — see the
 * registry entry's comment.)
 */
const quarantineLegacyTranscript = (sessionId) => {
  if (!sessionId) return;
  try {
    localStorage.removeItem(legacyVoiceTranscriptKey(sessionId));
  } catch {
    // Best-effort.
  }
};

/**
 * Hook for managing voice relay connection
 */
export const useVoiceRelay = () => {
  const [status, setStatus] = useState('disconnected');
  const [transcript, setTranscript] = useState([]);
  const [error, setError] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [mode, setMode] = useState(null);
  const [guidedState, setGuidedState] = useState(null); // Track guided session progress
  const [guidedComplete, setGuidedComplete] = useState(null); // Completed session data
  const [sessionAnalysis, setSessionAnalysis] = useState(null); // Voice tone and title analysis

  const wsRef = useRef(null);
  const audioContextRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const audioProcessorRef = useRef(null);
  const localTranscriptRef = useRef('');
  const sequenceIdRef = useRef(0);
  const tokenRefreshIntervalRef = useRef(null);
  // `connect` is memoized with an empty dep array, so the `ws.onmessage`
  // closure it installs is permanently bound to the `handleMessage`
  // reference from the render that first called connect() — later
  // re-renders' updated `sessionId` REACT STATE never reaches that frozen
  // closure. Mirrors the existing localTranscriptRef/sequenceIdRef pattern
  // just below (refs are stable across renders) so the persisted transcript
  // always carries the CURRENT session id, not whatever it was at mount.
  const sessionIdRef = useRef(null);

  /**
   * Initialize audio context and microphone
   */
  const initAudio = async () => {
    try {
      // Create audio context with appropriate sample rate
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 24000,
      });

      // Get microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 24000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      mediaStreamRef.current = stream;

      return true;
    } catch (err) {
      console.error('Audio init error:', err);
      setError('Microphone access required for voice conversation');
      return false;
    }
  };

  /**
   * Connect to voice relay server
   *
   * @param {string} sessionType
   * @param {string} requestedMode
   * @param {string|null} [spaceId] - Context Space (R1) active for this
   *   conversation at session start, forwarded to the relay in the
   *   `start_session` message so server-side RAG (get_memory tool, recent
   *   entries) can scope to it. null (default) is identity — legacy,
   *   unscoped behavior; the relay adds no `where('spaceId', ...)` clause.
   */
  const connect = useCallback(async (sessionType = 'free', requestedMode = 'realtime', spaceId = null) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      console.log('Already connected');
      return;
    }

    const relayWsUrl = getRelayWsUrl();
    const relayHttpUrl = getRelayHttpUrl();
    if (!relayWsUrl || !relayHttpUrl) {
      setError('Voice conversations are currently unavailable.');
      setStatus('disconnected');
      return;
    }

    setError(null);
    setStatus('connecting');

    // Initialize audio first
    const audioReady = await initAudio();
    if (!audioReady) {
      setStatus('disconnected');
      return;
    }

    try {
      // Get fresh Firebase token
      const user = auth.currentUser;
      if (!user) {
        setError('Please sign in to use voice conversations');
        setStatus('disconnected');
        return;
      }

      const token = await user.getIdToken(true);

      const ticketResponse = await fetch(`${relayHttpUrl}/voice-ticket`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!ticketResponse.ok) throw new Error('voice_ticket_failed');
      const { ticket } = await ticketResponse.json();
      if (!ticket) throw new Error('voice_ticket_missing');

      // Connect to relay
      const wsUrl = `${relayWsUrl}?ticket=${encodeURIComponent(ticket)}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket connected');

        // Start session
        ws.send(JSON.stringify({
          type: 'start_session',
          mode: requestedMode,
          sessionType,
          spaceId,
        }));

        // Set up token refresh (every 50 minutes)
        tokenRefreshIntervalRef.current = setInterval(async () => {
          try {
            const newToken = await auth.currentUser?.getIdToken(true);
            if (newToken && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: 'token_refresh',
                token: newToken,
              }));
            }
          } catch (err) {
            console.error('Token refresh error:', err);
          }
        }, 50 * 60 * 1000);
      };

      ws.onmessage = (event) => {
        handleMessage(JSON.parse(event.data));
      };

      ws.onerror = (event) => {
        console.error('WebSocket error:', event);
        setError('Connection error. Please try again.');
      };

      ws.onclose = (event) => {
        console.log('WebSocket closed:', event.code, event.reason);
        setStatus('disconnected');
        cleanupTokenRefresh();

        if (event.code === 4001) {
          setError('Authentication required. Please sign in.');
        } else if (event.code === 4002) {
          setError('Session expired. Please try again.');
        }
      };
    } catch (err) {
      console.error('Connection error:', err);
      setError('Failed to connect. Please try again.');
      setStatus('disconnected');
    }
  }, []);

  /**
   * Handle messages from relay server
   */
  const handleMessage = useCallback((message) => {
    switch (message.type) {
      case 'session_ready':
        sessionIdRef.current = message.sessionId;
        setSessionId(message.sessionId);
        setMode(message.mode);
        setStatus('connected');
        break;

      case 'transcript_delta':
        // Update transcript
        setTranscript((prev) => {
          const newEntry = {
            role: message.speaker,
            text: message.delta.replace(/^(User|Assistant): /, '').trim(),
            timestamp: message.timestamp,
          };
          return [...prev, newEntry];
        });

        // Store locally for reconnection
        localTranscriptRef.current += message.delta;
        sequenceIdRef.current = message.sequenceId;

        // Persist to local storage, scoped to the signed-in owner. No-ops
        // (never falls back to an unowned key) when nobody is signed in —
        // in-memory transcript state (used for the rest of this live
        // session) is untouched either way.
        {
          const uid = auth.currentUser?.uid;
          if (uid) {
            try {
              localStorage.setItem(voiceTranscriptKey(uid), JSON.stringify({
                sessionId: sessionIdRef.current,
                content: localTranscriptRef.current,
                sequenceId: sequenceIdRef.current,
                savedAt: Date.now(),
              }));
              quarantineLegacyTranscript(sessionIdRef.current);
            } catch (e) {
              console.warn('Failed to persist transcript locally');
            }
          }
        }
        break;

      case 'audio_response':
        if (message.data) {
          playAudio(message.data);
        }
        setStatus('speaking');
        // Return to listening after a short delay
        setTimeout(() => {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            setStatus('listening');
          }
        }, 500);
        break;

      case 'session_saved':
        console.log('Session saved:', message.entryId, 'success:', message.success);
        if (message.success === false) {
          setError('Your voice entry could not be saved. Please try again.');
        }
        // Unblock endSession() which is awaiting this ack before disconnecting.
        if (pendingSaveRef.current) {
          pendingSaveRef.current({ entryId: message.entryId, success: message.success });
          pendingSaveRef.current = null;
        }
        break;

      case 'usage_limit':
        setError(message.suggestion);
        break;

      case 'guided_prompt':
        // Update guided session state
        setGuidedState({
          promptId: message.promptId,
          prompt: message.prompt,
          isOpening: message.isOpening,
          isClosing: message.isClosing,
          promptIndex: message.promptIndex,
          totalPrompts: message.totalPrompts,
        });
        break;

      case 'guided_session_complete':
        // Mark guided session as complete with data for saving
        setGuidedComplete({
          sessionType: message.sessionType,
          responses: message.responses,
          summary: message.summary,
        });
        break;

      case 'session_analysis':
        // Voice tone and title/tag analysis results
        setSessionAnalysis({
          voiceTone: message.voiceTone,
          suggestedTitle: message.suggestedTitle,
          suggestedTags: message.suggestedTags,
          transcript: message.transcript,
        });
        break;

      case 'error':
        setError(message.message);
        if (!message.recoverable) {
          disconnect();
        }
        break;

      default:
        console.log('Unhandled message type:', message.type);
    }
  }, [sessionId]);

  /**
   * Play audio response (handles raw PCM16 at 24kHz from OpenAI Realtime API)
   */
  const playAudio = async (base64Audio) => {
    if (!audioContextRef.current) return;

    try {
      // Decode base64 to bytes
      const binaryString = atob(base64Audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Convert bytes to Int16Array (PCM16 format)
      const pcm16 = new Int16Array(bytes.buffer);

      // Convert PCM16 to Float32 for Web Audio API
      const float32 = new Float32Array(pcm16.length);
      for (let i = 0; i < pcm16.length; i++) {
        float32[i] = pcm16[i] / 32768.0; // Normalize to [-1, 1]
      }

      // Create AudioBuffer at 24kHz (OpenAI Realtime API sample rate)
      const sampleRate = 24000;
      const audioBuffer = audioContextRef.current.createBuffer(1, float32.length, sampleRate);
      audioBuffer.getChannelData(0).set(float32);

      // Play the audio
      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContextRef.current.destination);
      source.start();
    } catch (err) {
      console.error('Audio playback error:', err);
    }
  };

  /**
   * Start recording and streaming audio
   */
  const startRecording = useCallback(() => {
    if (!mediaStreamRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }

    setStatus('listening');

    // Create audio processor
    const audioContext = audioContextRef.current;
    const source = audioContext.createMediaStreamSource(mediaStreamRef.current);

    // Create script processor for audio capture
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    audioProcessorRef.current = processor;

    processor.onaudioprocess = (event) => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) return;

      const inputData = event.inputBuffer.getChannelData(0);

      // Convert to 16-bit PCM
      const pcmData = new Int16Array(inputData.length);
      for (let i = 0; i < inputData.length; i++) {
        pcmData[i] = Math.max(-32768, Math.min(32767, inputData[i] * 32768));
      }

      // Convert to base64
      const base64 = btoa(String.fromCharCode(...new Uint8Array(pcmData.buffer)));

      // Send to relay
      wsRef.current.send(JSON.stringify({
        type: 'audio_chunk',
        data: base64,
      }));
    };

    source.connect(processor);
    processor.connect(audioContext.destination);
  }, []);

  /**
   * Stop recording and end turn
   */
  const endTurn = useCallback(() => {
    if (audioProcessorRef.current) {
      audioProcessorRef.current.disconnect();
      audioProcessorRef.current = null;
    }

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'end_turn' }));
    }

    setStatus('connected');
  }, []);

  // Resolver for the server's session_saved ack, set while an end_session save
  // is in flight so we can wait for confirmation before tearing down the socket.
  const pendingSaveRef = useRef(null);

  /**
   * End session
   */
  const endSession = useCallback(async (save = false) => {
    // Get transcript before cleanup
    const finalTranscript = localTranscriptRef.current;

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      if (save) {
        // Wait for the server's session_saved ack (and the session_analysis that
        // precedes it) before disconnecting. Previously we disconnected
        // synchronously, dropping both — the entry's save confirmation and its
        // tone/title analysis were lost nearly every time. Bounded so a hung
        // server can't block the UI.
        const savedAck = new Promise((resolve) => {
          pendingSaveRef.current = resolve;
        });
        wsRef.current.send(JSON.stringify({ type: 'end_session', saveOptions: { save } }));
        await Promise.race([
          savedAck,
          new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), 8000)),
        ]);
        pendingSaveRef.current = null;
      } else {
        wsRef.current.send(JSON.stringify({ type: 'end_session', saveOptions: { save } }));
      }
    }

    disconnect();

    return finalTranscript;
  }, []);

  /**
   * Disconnect from relay
   */
  const disconnect = useCallback(() => {
    cleanupTokenRefresh();

    if (audioProcessorRef.current) {
      audioProcessorRef.current.disconnect();
      audioProcessorRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    // Sign-out/end-of-session cleanup for the persisted reconnect transcript
    // (PRIV-01 signOutBehavior: 'remove' — see storageRegistry.js). This is
    // the intentional-teardown path (endSession/unmount), never fired by an
    // unexpected socket drop, so it can't interfere with a real
    // reconnect-after-drop's later tryRestoreSession call.
    {
      const uid = auth.currentUser?.uid;
      if (uid) {
        try {
          localStorage.removeItem(voiceTranscriptKey(uid));
        } catch {
          // Best-effort.
        }
      }
    }

    setStatus('disconnected');
    setSessionId(null);
    setMode(null);
    setGuidedState(null);
    setGuidedComplete(null);
    setSessionAnalysis(null);
    localTranscriptRef.current = '';
    sequenceIdRef.current = 0;
    sessionIdRef.current = null;
  }, []);

  /**
   * Cleanup token refresh interval
   */
  const cleanupTokenRefresh = () => {
    if (tokenRefreshIntervalRef.current) {
      clearInterval(tokenRefreshIntervalRef.current);
      tokenRefreshIntervalRef.current = null;
    }
  };

  /**
   * Try to restore session from local storage. Owner-scoped (reads only the
   * signed-in owner's own persisted transcript — never another account's),
   * and an expired entry is REMOVED here, not merely ignored (PRIV-01
   * acceptance: expired transcript values must actually be deleted on
   * read). The stored sessionId must also match the CURRENT session, so a
   * stale entry from a previous session (already past its natural
   * usefulness even if not yet expired) is never misapplied.
   *
   * NOTE: Currently has no production caller — reconnect-restore path
   * (useVoiceRelay → tryRestoreSession) is inert. Preserved for future
   * reconnection recovery feature.
   */
  const tryRestoreSession = useCallback(() => {
    if (!sessionId || wsRef.current?.readyState !== WebSocket.OPEN) return;

    const uid = auth.currentUser?.uid;
    if (!uid) return;

    const key = voiceTranscriptKey(uid);
    try {
      const stored = localStorage.getItem(key);
      if (!stored) return;

      const { sessionId: storedSessionId, content, sequenceId, savedAt } = JSON.parse(stored);

      if (!savedAt || Date.now() - savedAt > VOICE_TRANSCRIPT_TTL_MS) {
        localStorage.removeItem(key);
        return;
      }

      if (storedSessionId !== sessionId) {
        // Not this session's transcript (e.g. a fresh session started
        // before the old one's entry expired) — remove rather than leave a
        // mismatched entry sitting around indefinitely.
        localStorage.removeItem(key);
        return;
      }

      wsRef.current.send(JSON.stringify({
        type: 'restore_transcript',
        content,
        sequenceId,
      }));
    } catch (e) {
      console.warn('Failed to restore transcript');
    }
  }, [sessionId]);

  // Cleanup on unmount - FIX: Removed disconnect from deps to prevent unnecessary re-runs
  // Cleanup logic is now inline to ensure it only runs on unmount
  useEffect(() => {
    return () => {
      console.log('[useVoiceRelay] Cleanup on unmount, runId:post-fix');

      // Inline cleanup (same as disconnect) to avoid dependency issues
      cleanupTokenRefresh();

      if (audioProcessorRef.current) {
        audioProcessorRef.current.disconnect();
        audioProcessorRef.current = null;
      }

      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      }

      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }

      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []); // Empty deps - only run on unmount

  return {
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
    tryRestoreSession,
    clearError: () => setError(null),
    clearTranscript: () => setTranscript([]),
    clearGuidedComplete: () => setGuidedComplete(null),
    clearSessionAnalysis: () => setSessionAnalysis(null),
  };
};

export default useVoiceRelay;

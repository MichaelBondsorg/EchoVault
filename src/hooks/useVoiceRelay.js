import { useState, useRef, useCallback, useEffect } from 'react';
import { auth } from '../config/firebase';

// Configuration - update this with your Cloud Run URL after deployment
const VOICE_RELAY_URL = import.meta.env.VITE_VOICE_RELAY_URL || 'ws://localhost:8080/voice';

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

  const wsRef = useRef(null);
  const audioContextRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const audioProcessorRef = useRef(null);
  const localTranscriptRef = useRef('');
  const sequenceIdRef = useRef(0);
  const tokenRefreshIntervalRef = useRef(null);

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
   */
  const connect = useCallback(async (sessionType = 'free', requestedMode = 'realtime') => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      console.log('Already connected');
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

      // Connect to relay
      const wsUrl = `${VOICE_RELAY_URL}?token=${encodeURIComponent(token)}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket connected');

        // Start session
        ws.send(JSON.stringify({
          type: 'start_session',
          mode: requestedMode,
          sessionType,
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

        // Persist to local storage
        try {
          localStorage.setItem(`voice_transcript_${sessionId}`, JSON.stringify({
            content: localTranscriptRef.current,
            sequenceId: sequenceIdRef.current,
          }));
        } catch (e) {
          console.warn('Failed to persist transcript locally');
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
        console.log('Session saved:', message.entryId);
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
   * Play audio response
   */
  const playAudio = async (base64Audio) => {
    if (!audioContextRef.current) return;

    try {
      // Decode base64
      const binaryString = atob(base64Audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Try to decode as audio
      const audioBuffer = await audioContextRef.current.decodeAudioData(bytes.buffer.slice(0));
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

  /**
   * End session
   */
  const endSession = useCallback(async (save = false) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'end_session',
        saveOptions: { save },
      }));
    }

    // Get transcript before cleanup
    const finalTranscript = localTranscriptRef.current;

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

    setStatus('disconnected');
    setSessionId(null);
    setMode(null);
    setGuidedState(null);
    setGuidedComplete(null);
    localTranscriptRef.current = '';
    sequenceIdRef.current = 0;
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
   * Try to restore session from local storage
   */
  const tryRestoreSession = useCallback(() => {
    if (!sessionId || wsRef.current?.readyState !== WebSocket.OPEN) return;

    try {
      const stored = localStorage.getItem(`voice_transcript_${sessionId}`);
      if (stored) {
        const { content, sequenceId } = JSON.parse(stored);
        wsRef.current.send(JSON.stringify({
          type: 'restore_transcript',
          content,
          sequenceId,
        }));
      }
    } catch (e) {
      console.warn('Failed to restore transcript');
    }
  }, [sessionId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
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
    clearError: () => setError(null),
    clearTranscript: () => setTranscript([]),
    clearGuidedComplete: () => setGuidedComplete(null),
  };
};

export default useVoiceRelay;

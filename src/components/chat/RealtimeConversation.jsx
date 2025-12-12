import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Phone, MessageCircle, TrendingUp, Heart, Sparkles, Brain, Clipboard } from 'lucide-react';
import { OPENAI_API_KEY } from '../../config/ai';

const RealtimeConversation = ({ entries, onClose, category }) => {
  const [status, setStatus] = useState('disconnected');
  const [transcript, setTranscript] = useState([]);
  const [error, setError] = useState(null);
  const [conversationTheme, setConversationTheme] = useState(null);

  const wsRef = useRef(null);
  const audioContextRef = useRef(null);
  const mediaStreamRef = useRef(null);

  // Build context from journal entries
  const getJournalContext = useCallback(() => {
    const recentEntries = entries.slice(0, 10)
      .map(e => `[${e.createdAt.toLocaleDateString()}] ${e.title || 'Entry'}: ${e.text.substring(0, 200)}`)
      .join('\n');
    return recentEntries;
  }, [entries]);

  // Get theme-specific prompts
  const getThemePrompt = useCallback(() => {
    const themes = {
      goals: "Focus on helping the user explore their goals, aspirations, and what steps they might take. Ask about progress and obstacles.",
      feelings: "Focus on emotional exploration. Help them identify and process their feelings. Be gentle and validating.",
      gratitude: "Guide a gratitude practice. Help them notice positive things in their life, big and small.",
      reflection: "Help them reflect on recent experiences, what they learned, and how they're growing.",
      guided: `Guide a structured journaling session following these steps:
1. Start by asking how they're feeling right now (1-10 scale and why)
2. Ask about the highlight of their day or week
3. Ask about any challenges they faced
4. Ask what they learned or are grateful for
5. End by asking about their intention for tomorrow

Move through each step naturally, spending time on areas they want to explore deeper. Summarize key points at the end.`
    };
    return conversationTheme ? themes[conversationTheme] : "Have an open, supportive conversation about whatever is on their mind.";
  }, [conversationTheme]);

  // Proactive conversation starters based on journal patterns
  const getConversationStarter = useCallback(() => {
    if (conversationTheme === 'guided') {
      return "Welcome to your guided journaling session! Let's take a few minutes to check in with yourself. To start, on a scale of 1 to 10, how are you feeling right now? And what's contributing to that number?";
    }

    if (conversationTheme === 'gratitude') {
      return "Hi! Let's practice some gratitude together. What's something that made you smile recently, even if it was small?";
    }

    if (conversationTheme === 'goals') {
      return "Hey! I'd love to hear about your goals. What's something you're working towards right now?";
    }

    if (conversationTheme === 'feelings') {
      return "Hi there. I'm here to listen. How are you feeling in this moment?";
    }

    if (!entries.length) return "Hi! I'm here to chat with you. What's on your mind today?";

    const recentMoods = entries.slice(0, 5).map(e => e.mood).filter(Boolean);
    const avgMood = recentMoods.length ? recentMoods.reduce((a, b) => a + b, 0) / recentMoods.length : 3;

    if (avgMood < 2.5) {
      return "Hey, I've noticed you've been going through a tough time lately. Would you like to talk about what's been weighing on you?";
    } else if (avgMood > 3.5) {
      return "Hi! It seems like things have been going well for you lately. What's been bringing you joy?";
    }

    const starters = [
      "Hey! How are you feeling right now?",
      "Hi there! What's on your mind today?",
      "Hello! I'd love to hear about your day.",
      "Hey! Anything you'd like to reflect on together?"
    ];
    return starters[Math.floor(Math.random() * starters.length)];
  }, [entries, conversationTheme]);

  // Initialize audio context
  const initAudio = async () => {
    try {
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 24000, channelCount: 1 } });
      mediaStreamRef.current = stream;
      return true;
    } catch (err) {
      console.error('Audio init error:', err);
      setError('Microphone access required for voice conversation');
      return false;
    }
  };

  // Play audio from base64
  const playAudio = async (base64Audio) => {
    if (!audioContextRef.current) return;

    const binaryString = atob(base64Audio);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    try {
      const audioBuffer = await audioContextRef.current.decodeAudioData(bytes.buffer);
      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContextRef.current.destination);
      source.start();
    } catch (err) {
      console.error('Audio playback error:', err);
    }
  };

  // Start realtime conversation
  const startConversation = async () => {
    if (!OPENAI_API_KEY) {
      setError('OpenAI API key required');
      return;
    }

    setStatus('connecting');
    setError(null);

    const audioReady = await initAudio();
    if (!audioReady) return;

    try {
      const ws = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17', [
        'realtime',
        `openai-insecure-api-key.${OPENAI_API_KEY}`,
        'openai-beta.realtime-v1'
      ]);

      ws.onopen = () => {
        console.log('Realtime WebSocket connected');
        setStatus('connected');

        const sessionConfig = {
          type: 'session.update',
          session: {
            modalities: ['text', 'audio'],
            instructions: `You are a warm, empathetic journal companion for ${category} journaling. ${getThemePrompt()}

PERSONALITY:
- Be conversational and natural, like a supportive friend
- Ask thoughtful follow-up questions to deepen reflection
- Notice patterns and gently point them out
- Validate emotions before offering perspective
- Keep responses concise (1-3 sentences for voice)

USER'S RECENT JOURNAL ENTRIES:
${getJournalContext()}

Start with a warm greeting and invitation to share.`,
            voice: 'nova',
            input_audio_format: 'pcm16',
            output_audio_format: 'pcm16',
            input_audio_transcription: { model: 'whisper-1' },
            turn_detection: {
              type: 'server_vad',
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 500
            }
          }
        };
        ws.send(JSON.stringify(sessionConfig));

        setTimeout(() => {
          const responseCreate = {
            type: 'response.create',
            response: {
              modalities: ['text', 'audio'],
              instructions: getConversationStarter()
            }
          };
          ws.send(JSON.stringify(responseCreate));
        }, 500);
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);

        switch (data.type) {
          case 'session.created':
            console.log('Session created:', data.session?.id);
            break;

          case 'response.audio.delta':
            if (data.delta) {
              setStatus('speaking');
              playAudio(data.delta);
            }
            break;

          case 'response.audio_transcript.delta':
            if (data.delta) {
              setTranscript(prev => {
                const last = prev[prev.length - 1];
                if (last?.role === 'assistant' && !last.complete) {
                  return [...prev.slice(0, -1), { ...last, text: last.text + data.delta }];
                }
                return [...prev, { role: 'assistant', text: data.delta, complete: false }];
              });
            }
            break;

          case 'response.audio_transcript.done':
            setTranscript(prev => {
              const last = prev[prev.length - 1];
              if (last?.role === 'assistant') {
                return [...prev.slice(0, -1), { ...last, complete: true }];
              }
              return prev;
            });
            break;

          case 'response.done':
            setStatus('listening');
            break;

          case 'input_audio_buffer.speech_started':
            setStatus('listening');
            break;

          case 'conversation.item.input_audio_transcription.completed':
            if (data.transcript) {
              setTranscript(prev => [...prev, { role: 'user', text: data.transcript, complete: true }]);
            }
            break;

          case 'error':
            console.error('Realtime API error:', data.error);
            setError(data.error?.message || 'Connection error');
            break;
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setError('Connection failed. Please try again.');
        setStatus('disconnected');
      };

      ws.onclose = () => {
        console.log('WebSocket closed');
        setStatus('disconnected');
      };

      wsRef.current = ws;

      // Start capturing and sending audio
      const audioContext = audioContextRef.current;
      const source = audioContext.createMediaStreamSource(mediaStreamRef.current);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);

      processor.onaudioprocess = (e) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          const inputData = e.inputBuffer.getChannelData(0);
          const pcm16 = new Int16Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) {
            pcm16[i] = Math.max(-32768, Math.min(32767, Math.floor(inputData[i] * 32768)));
          }
          const base64 = btoa(String.fromCharCode(...new Uint8Array(pcm16.buffer)));
          wsRef.current.send(JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: base64
          }));
        }
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

    } catch (err) {
      console.error('Connection error:', err);
      setError('Failed to start conversation');
      setStatus('disconnected');
    }
  };

  // End conversation
  const endConversation = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
    }
    setStatus('disconnected');
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => endConversation();
  }, []);

  const statusColors = {
    disconnected: 'bg-gray-400',
    connecting: 'bg-yellow-400 animate-pulse',
    connected: 'bg-green-400',
    speaking: 'bg-indigo-500 animate-pulse',
    listening: 'bg-green-500 animate-pulse'
  };

  const statusLabels = {
    disconnected: 'Ready to start',
    connecting: 'Connecting...',
    connected: 'Connected',
    speaking: 'Speaking...',
    listening: 'Listening...'
  };

  return (
    <div className="fixed inset-0 bg-gradient-to-b from-indigo-900 to-purple-900 z-50 flex flex-col pt-[env(safe-area-inset-top)]">
      {/* Header */}
      <div className="p-4 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full ${statusColors[status]}`} />
          <span className="text-white/80 text-sm">{statusLabels[status]}</span>
        </div>
        <button onClick={() => { endConversation(); onClose(); }} className="text-white/60 hover:text-white p-2">
          <X size={24} />
        </button>
      </div>

      {/* Theme selector */}
      {status === 'disconnected' && (
        <div className="px-6 mb-4">
          <p className="text-white/60 text-sm mb-3">Choose a conversation focus (optional):</p>
          <div className="flex flex-wrap gap-2">
            {[
              { id: null, label: 'Open chat', icon: MessageCircle },
              { id: 'goals', label: 'Goals', icon: TrendingUp },
              { id: 'feelings', label: 'Feelings', icon: Heart },
              { id: 'gratitude', label: 'Gratitude', icon: Sparkles },
              { id: 'reflection', label: 'Reflection', icon: Brain },
              { id: 'guided', label: 'Guided Session', icon: Clipboard }
            ].map(theme => (
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
          <div key={i} className={`mb-4 ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
            <div className={`inline-block max-w-[85%] px-4 py-3 rounded-2xl ${
              msg.role === 'user'
                ? 'bg-white/20 text-white rounded-br-none'
                : 'bg-white/10 text-white/90 rounded-bl-none'
            }`}>
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
        </div>
      )}

      {/* Main control */}
      <div className="p-6 pb-[max(2rem,env(safe-area-inset-bottom))] flex flex-col items-center">
        {status === 'disconnected' ? (
          <button
            onClick={startConversation}
            className="w-24 h-24 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg shadow-purple-500/30 flex items-center justify-center hover:scale-105 transition-transform"
          >
            <Phone size={36} className="text-white" />
          </button>
        ) : (
          <button
            onClick={endConversation}
            className="w-24 h-24 rounded-full bg-red-500 shadow-lg shadow-red-500/30 flex items-center justify-center hover:scale-105 transition-transform animate-pulse"
          >
            <Phone size={36} className="text-white rotate-[135deg]" />
          </button>
        )}
        <p className="text-white/60 text-sm mt-4">
          {status === 'disconnected' ? 'Tap to start talking' : 'Tap to end conversation'}
        </p>
      </div>
    </div>
  );
};

export default RealtimeConversation;

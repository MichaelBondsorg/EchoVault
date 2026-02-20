import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { X, Send, Mic, Headphones, Volume2, StopCircle, Database } from 'lucide-react';
import MarkdownLite from '../ui/MarkdownLite';
import VoiceRecorder from '../input/VoiceRecorder';
import { synthesizeSpeech } from '../../utils/audio';
import { callOpenAI, generateEmbedding, cosineSimilarity, transcribeAudio } from '../../services/ai';

const Chat = ({ entries, onClose, category }) => {
  const [msgs, setMsgs] = useState([{ role: 'sys', text: `I'm your ${category} journal assistant. Ask me anything about your entries!` }]);
  const [txt, setTxt] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceInput, setVoiceInput] = useState(false);
  const [conversationMode, setConversationMode] = useState(false);
  const [conversationHistory, setConversationHistory] = useState([]);
  const endRef = useRef(null);
  const audioRef = useRef(null);

  useEffect(() => endRef.current?.scrollIntoView(), [msgs]);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const speak = async (text) => {
    // If already speaking, stop
    if (isSpeaking) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      setIsSpeaking(false);
      return;
    }

    setIsSpeaking(true);

    // Try OpenAI TTS first for better quality
    const audioUrl = await synthesizeSpeech(text, 'nova');

    if (audioUrl) {
      const audio = new Audio(audioUrl);
      audioRef.current = audio;

      audio.onended = () => {
        setIsSpeaking(false);
        audioRef.current = null;
        URL.revokeObjectURL(audioUrl);
        if (conversationMode) {
          setTimeout(() => setVoiceInput(true), 500);
        }
      };

      audio.onerror = () => {
        console.error('Audio playback error, falling back to Web Speech');
        setIsSpeaking(false);
        audioRef.current = null;
        speakWithWebSpeech(text);
      };

      audio.play().catch(err => {
        console.error('Audio play error:', err);
        speakWithWebSpeech(text);
      });
    } else {
      // Fallback to Web Speech API
      speakWithWebSpeech(text);
    }
  };

  const speakWithWebSpeech = (text) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      console.warn('Speech Synthesis API not available');
      setIsSpeaking(false);
      return;
    }

    try {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.onend = () => {
        setIsSpeaking(false);
        if (conversationMode) {
          setTimeout(() => setVoiceInput(true), 500);
        }
      };
      utterance.onerror = (error) => {
        console.error('Speech synthesis error:', error);
        setIsSpeaking(false);
      };
      setIsSpeaking(true);
      window.speechSynthesis.speak(utterance);
    } catch (error) {
      console.error('Speech synthesis error:', error);
      setIsSpeaking(false);
    }
  };

  const handleVoiceInput = async (b64, mime) => {
    setVoiceInput(false);
    setLoading(true);
    const transcript = await transcribeAudio(b64, mime);

    if (!transcript) {
      setLoading(false);
      if (conversationMode) setConversationMode(false);
      return;
    }

    if (transcript === 'API_RATE_LIMIT') {
      setMsgs(p => [...p, { role: 'sys', text: 'Too many requests - please wait a moment and try again.' }]);
      setLoading(false);
      if (conversationMode) setConversationMode(false);
      return;
    }

    if (transcript === 'API_AUTH_ERROR') {
      setMsgs(p => [...p, { role: 'sys', text: 'Voice transcription is not available - API authentication error.' }]);
      setLoading(false);
      if (conversationMode) setConversationMode(false);
      return;
    }

    if (transcript === 'API_BAD_REQUEST') {
      setMsgs(p => [...p, { role: 'sys', text: 'Audio format not supported - please try recording again.' }]);
      setLoading(false);
      if (conversationMode) setConversationMode(false);
      return;
    }

    if (transcript.startsWith('API_')) {
      setMsgs(p => [...p, { role: 'sys', text: 'Voice transcription temporarily unavailable - please try again or type your question.' }]);
      setLoading(false);
      if (conversationMode) setConversationMode(false);
      return;
    }

    if (transcript.includes('NO_SPEECH')) {
      setMsgs(p => [...p, { role: 'sys', text: 'No speech detected - please try speaking closer to the microphone.' }]);
      setLoading(false);
      if (conversationMode) setConversationMode(false);
      return;
    }

    setTxt(transcript);
    send(transcript);
  };

  const send = async (overrideText) => {
    const textToSend = overrideText || txt;
    if (!textToSend.trim()) return;

    setTxt('');
    setMsgs(p => [...p, { role: 'user', text: textToSend }]);
    setLoading(true);

    // RAG: Generate embedding for the question and retrieve relevant entries
    const questionEmbedding = await generateEmbedding(textToSend);

    let relevantContext = '';
    let foundEntries = [];

    if (questionEmbedding) {
      // Use cosine similarity to find most relevant entries
      foundEntries = entries
        .filter(e => e.embedding)
        .map(e => ({
          ...e,
          similarity: cosineSimilarity(questionEmbedding, e.embedding)
        }))
        .filter(e => e.similarity > 0.3) // Only use reasonably relevant entries
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 10); // Top 10 most relevant entries

      if (foundEntries.length > 0) {
        relevantContext = foundEntries
          .map(e => `[${e.createdAt.toLocaleDateString()}] ${e.title || 'Entry'}: ${e.text}`)
          .join('\n\n');
      }
    }

    // Fallback to recent entries if no relevant ones found
    if (!relevantContext) {
      relevantContext = entries.slice(0, 5)
        .map(e => `[${e.createdAt.toLocaleDateString()}] ${e.title || 'Entry'}: ${e.text}`)
        .join('\n\n');
    }

    // Build conversation history for context (last 6 exchanges)
    const recentHistory = conversationHistory.slice(-6)
      .map(h => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.text}`)
      .join('\n');

    // Enhanced system prompt for conversational AI
    const systemPrompt = `You are a warm, empathetic journal companion helping the user reflect on their ${category} life. You have access to their journal entries and remember the current conversation.

PERSONALITY:
- Be conversational and natural, like a supportive friend
- Ask thoughtful follow-up questions to deepen reflection
- Notice patterns and gently point them out
- Validate emotions before offering perspective
- Keep responses concise (2-4 sentences) but meaningful

${recentHistory ? `CONVERSATION SO FAR:\n${recentHistory}\n\n` : ''}JOURNAL ENTRIES (most relevant):
${relevantContext}

Remember: You're having a real conversation. Reference what they've shared, ask follow-ups, and help them explore their thoughts deeper.`;

    // Use OpenAI with RAG context and conversation memory
    const ans = await callOpenAI(systemPrompt, textToSend);

    const response = ans || "I'm here to listen. Could you tell me more about what's on your mind?";

    // Update conversation history
    setConversationHistory(prev => [
      ...prev,
      { role: 'user', text: textToSend },
      { role: 'ai', text: response }
    ]);

    setMsgs(p => [...p, {
      role: 'ai',
      text: response,
      sources: foundEntries.length > 0 ? foundEntries.length : null
    }]);
    setLoading(false);

    if (conversationMode && ans) {
      speak(ans);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="fixed inset-0 bg-white z-50 flex flex-col pt-[env(safe-area-inset-top)]"
    >
      <div className="p-4 border-b border-honey-100 flex justify-between items-center bg-gradient-to-r from-honey-500 to-honey-600 text-white shadow-soft">
        <div className="flex gap-2 items-center">
          <motion.button
            onClick={() => {
              const newMode = !conversationMode;
              setConversationMode(newMode);
              if (newMode && !isSpeaking) setVoiceInput(true);
              if (!newMode && typeof window !== 'undefined' && 'speechSynthesis' in window) {
                try {
                  window.speechSynthesis.cancel();
                } catch (error) {
                  console.error('Error canceling speech:', error);
                }
                setVoiceInput(false);
              }
            }}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            className={`p-1 rounded-full transition-colors ${conversationMode ? 'bg-white/20 text-accent' : 'hover:bg-white/10'}`}
          >
            <Headphones size={20} className={conversationMode ? "animate-pulse" : ""} />
          </motion.button>
          <span className="font-display font-bold text-lg">Journal Assistant ({category})</span>
        </div>
        <motion.button
          onClick={onClose}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          className="p-1 hover:bg-white/10 rounded-full"
        >
          <X size={24}/>
        </motion.button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-warm-50">
        {msgs.map((m, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}
          >
            <div className={`max-w-[85%] p-4 rounded-2xl text-sm shadow-soft ${m.role === 'user' ? 'bg-honey-600 text-white rounded-br-none' : 'bg-white text-warm-800 border border-warm-200 rounded-bl-none'}`}>
              <MarkdownLite text={m.text} variant={m.role === 'user' ? 'light' : 'default'} />
              {m.role === 'ai' && m.sources && (
                <div className="mt-2 pt-2 border-t border-warm-200 text-xs text-warm-500 flex items-center gap-1">
                  <Database size={12} /> Based on {m.sources} relevant journal {m.sources === 1 ? 'entry' : 'entries'}
                </div>
              )}
            </div>
            {m.role === 'ai' && (
              <button onClick={() => speak(m.text)} className="mt-1 text-warm-400 hover:text-honey-600 p-1">
                {isSpeaking ? <StopCircle size={16} /> : <Volume2 size={16} />}
              </button>
            )}
          </motion.div>
        ))}
        {loading && <div className="text-xs text-warm-400 p-2 text-center animate-pulse">Searching your journal...</div>}
        <div ref={endRef} />
      </div>

      {voiceInput && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute inset-x-0 bottom-0 h-48 bg-white border-t border-warm-200 z-10 flex flex-col items-center justify-center"
        >
          <p className="mb-4 text-warm-500 font-medium">{conversationMode ? "Listening (Conversation Mode)..." : "Listening..."}</p>
          <VoiceRecorder onSave={handleVoiceInput} onSwitch={() => setVoiceInput(false)} loading={false} minimal={true} />
          <button onClick={() => { setVoiceInput(false); setConversationMode(false); }} className="mt-4 text-sm text-red-500 font-medium">Cancel</button>
        </motion.div>
      )}

      <div className="p-4 bg-white border-t border-warm-200 pb-[max(2rem,env(safe-area-inset-bottom))]">
        <div className="flex gap-2 items-center bg-warm-50 p-1 rounded-full border border-warm-200 focus-within:ring-2 focus-within:ring-honey-500">
          <button onClick={() => setVoiceInput(true)} className="p-2 text-terra-600 hover:bg-terra-50 rounded-full"><Mic size={20}/></button>
          <input value={txt} onChange={e => setTxt(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} className="flex-1 bg-transparent border-none p-2 focus:ring-0 text-sm outline-none font-body text-warm-800" placeholder="Say something..." />
          <motion.button
            onClick={() => send()}
            disabled={loading}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="bg-honey-600 text-white p-2 rounded-full hover:bg-honey-700 disabled:bg-warm-300 transition-colors"
          >
            <Send size={18}/>
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
};

export default Chat;

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Mic, Square, Trash2, Search, LogOut, Loader2, Sparkles, MessageCircle, X, Send,
  Lightbulb, Edit2, Check, Share, LogIn, Activity, AlertTriangle, TrendingUp,
  Database, Briefcase, User as UserIcon, Keyboard, RefreshCw, Calendar, MessageSquarePlus,
  Brain, Volume2, StopCircle, Bell, Headphones, BookOpen
} from 'lucide-react';

import { initializeApp } from 'firebase/app';
import {
  getAuth, onAuthStateChanged, signOut, signInWithCustomToken,
  GoogleAuthProvider, signInWithPopup
} from 'firebase/auth';
import {
  getFirestore, collection, addDoc, query, orderBy, onSnapshot,
  Timestamp, deleteDoc, doc, updateDoc, limit, getDocs
} from 'firebase/firestore';

// --- Configuration ---
const firebaseConfig = {
  apiKey: "AIzaSyBuhwHcdxEuYHf6F5SVlWR5BLRio_7kqAg",
  authDomain: "echo-vault-app.firebaseapp.com",
  projectId: "echo-vault-app",
  storageBucket: "echo-vault-app.firebasestorage.app",
  messagingSenderId: "581319345416",
  appId: "1:581319345416:web:777247342fffc94989d8bd"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const APP_COLLECTION_ID = 'echo-vault-v5-fresh';
const GEMINI_API_KEY = "AIzaSyC9Btuhp2wUGx5c1EA6w1lyguy7RJewGRw";

// --- iOS Meta Injection ---
const useIOSMeta = () => {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const meta = document.createElement('meta');
    meta.name = 'apple-mobile-web-app-capable';
    meta.content = 'yes';
    document.head.appendChild(meta);
    const style = document.createElement('meta');
    style.name = 'apple-mobile-web-app-status-bar-style';
    style.content = 'black-translucent';
    document.head.appendChild(style);
    return () => {
      if (document.head.contains(meta)) document.head.removeChild(meta);
      if (document.head.contains(style)) document.head.removeChild(style);
    };
  }, []);
};

// --- NOTIFICATION MANAGER ---
const useNotifications = () => {
  // FIX: Check if Notification API is available before accessing it
  const [permission, setPermission] = useState(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      return Notification.permission;
    }
    return 'default';
  });

  const requestPermission = async () => {
    // FIX: Check if Notification API exists
    if (typeof window === 'undefined' || !('Notification' in window)) {
      console.warn('Notification API not available');
      return;
    }

    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result === 'granted') {
        new Notification("EchoVault", { body: "Notifications enabled! We'll remind you to journal." });
      }
    } catch (error) {
      console.error('Notification permission error:', error);
    }
  };

  useEffect(() => {
    // FIX: Check if Notification API exists before using it
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (permission !== 'granted') return;

    const checkTime = () => {
      const now = new Date();
      const hour = now.getHours();
      const min = now.getMinutes();
      try {
        if (hour === 9 && min === 0) new Notification("EchoVault: Morning Plan", { body: "What are you planning to do today? Record a quick thought." });
        if (hour === 20 && min === 0) new Notification("EchoVault: End of Day", { body: "How did it go? Close your loops for the day." });
      } catch (error) {
        console.error('Notification error:', error);
      }
    };
    const interval = setInterval(checkTime, 60000);
    return () => clearInterval(interval);
  }, [permission]);

  return { permission, requestPermission };
};

// --- SAFETY HELPERS ---
const safeString = (val) => {
  if (typeof val === 'string') return val;
  if (typeof val === 'number') return String(val);
  if (typeof val === 'object' && val !== null) return JSON.stringify(val);
  return "";
};

const safeDate = (val) => {
  try {
    if (!val) return new Date();
    if (val.toDate) return val.toDate();
    if (val instanceof Date) return val;
    if (typeof val === 'string' || typeof val === 'number') return new Date(val);
    return new Date();
  } catch (e) { return new Date(); }
};

const sanitizeEntry = (id, data) => {
  return {
    id: id,
    text: safeString(data.text),
    category: safeString(data.category) || 'personal',
    tags: Array.isArray(data.tags) ? data.tags : [],
    title: safeString(data.title) || safeString(data.analysis?.summary) || "Untitled Memory",
    analysis: data.analysis || { mood_score: 0.5 },
    analysisStatus: data.analysisStatus || 'complete',
    embedding: data.embedding || null,
    contextualInsight: data.contextualInsight || null,
    createdAt: safeDate(data.createdAt)
  };
};

// --- VECTOR MATH ---
const cosineSimilarity = (vecA, vecB) => {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    magA += vecA[i] * vecA[i];
    magB += vecB[i] * vecB[i];
  }
  return magA && magB ? dot / (Math.sqrt(magA) * Math.sqrt(magB)) : 0;
};

const findRelevantMemories = (targetVector, allEntries, category, topK = 5) => {
  if (!targetVector) return [];
  const contextEntries = allEntries.filter(e => e.category === category);
  const scored = contextEntries.map(e => ({
    ...e,
    score: e.embedding ? cosineSimilarity(targetVector, e.embedding) : -1
  }));
  return scored.filter(e => e.score > 0.35).sort((a, b) => b.score - a.score).slice(0, topK);
};

// --- GEMINI API ---
const callGemini = async (systemPrompt, userPrompt) => {
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: userPrompt }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] }
      })
    });

    // FIX: Check HTTP status
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      console.error('Gemini API error:', res.status, errorData);
      return null;
    }

    const data = await res.json();
    const result = data.candidates?.[0]?.content?.parts?.[0]?.text || null;

    // FIX: Log if no result returned
    if (!result) {
      console.error('Gemini API returned no content:', data);
    }

    return result;
  } catch (e) {
    console.error('Gemini API exception:', e);
    return null;
  }
};

const generateEmbedding = async (text) => {
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: { parts: [{ text: text }] } })
    });
    const data = await res.json();
    return data.embedding?.values || null;
  } catch (e) { return null; }
};

const transcribeAudio = async (base64, mimeType) => {
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: "Transcribe audio exactly. If silent, return 'NO_SPEECH'." },
            { inlineData: { mimeType: mimeType, data: base64 } }
          ]
        }]
      })
    });

    // FIX: Check HTTP status
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      console.error('Transcribe API error:', res.status, errorData);

      // Return error indicator instead of null
      if (res.status === 429) return 'API_RATE_LIMIT';
      if (res.status === 401) return 'API_AUTH_ERROR';
      return 'API_ERROR';
    }

    const data = await res.json();
    const result = data.candidates?.[0]?.content?.parts?.[0]?.text || null;

    // FIX: Log if no result returned
    if (!result) {
      console.error('Transcribe API returned no content:', data);
      return 'API_NO_CONTENT';
    }

    console.log('Transcription result:', result);
    return result;
  } catch (e) {
    console.error('Transcribe API exception:', e);
    return 'API_EXCEPTION';
  }
};

// --- THE AI ROUTER (The new Brain) ---
// This function decides WHICH therapeutic framework to apply.
const analyzeEntry = async (text) => {
  const prompt = `
    Analyze this journal entry and determine the most appropriate therapeutic framework.

    ROUTING LOGIC:
    1. IF text shows anxiety, negative self-talk, or cognitive distortion -> Use 'cbt' framework.
    2. IF text describes a mistake, a learning experience, or confusion -> Use 'gibbs' framework (Reflective Cycle).
    3. OTHERWISE -> Use 'general' framework.

    Return JSON:
    {
      "title": "Short creative title (max 6 words)",
      "tags": ["Tag1", "Tag2"],
      "mood_score": 0.5 (0.0=bad, 1.0=good),
      "framework": "cbt" | "gibbs" | "general",

      // Include ONLY IF framework == 'cbt'
      "cbt_breakdown": {
        "trigger": "The situation",
        "automatic_thought": "The negative thought",
        "distortion": "Label (e.g. Catastrophizing)",
        "challenge": "Rational reframe"
      },

      // Include ONLY IF framework == 'gibbs'
      "gibbs_reflection": {
        "evaluation": "What was good/bad?",
        "analysis": "Making sense of it",
        "action_plan": "What to do next time?"
      }
    }
  `;
  try {
    const raw = await callGemini(prompt, text);

    // FIX: Better error handling if API call failed
    if (!raw) {
      console.error('analyzeEntry: No response from Gemini API');
      return {
        title: text.substring(0, 50) + (text.length > 50 ? '...' : ''),
        tags: [],
        mood_score: 0.5,
        framework: 'general'
      };
    }

    const jsonStr = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(jsonStr);

    // FIX: Validate required fields
    return {
      title: parsed.title || text.substring(0, 50) + (text.length > 50 ? '...' : ''),
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      mood_score: typeof parsed.mood_score === 'number' ? parsed.mood_score : 0.5,
      framework: parsed.framework || 'general',
      cbt_breakdown: parsed.cbt_breakdown,
      gibbs_reflection: parsed.gibbs_reflection
    };
  } catch (e) {
    console.error('analyzeEntry error:', e);
    return {
      title: text.substring(0, 50) + (text.length > 50 ? '...' : ''),
      tags: [],
      mood_score: 0.5,
      framework: 'general'
    };
  }
};

const generateInsight = async (current, relevantHistory, recentHistory) => {
  const historyMap = new Map();
  [...recentHistory, ...relevantHistory].forEach(e => historyMap.set(e.id, e));
  const uniqueHistory = Array.from(historyMap.values());

  if (uniqueHistory.length === 0) return null;

  const context = uniqueHistory.map(e => `[${e.createdAt.toLocaleDateString()}] ${e.text}`).join('\n');

  const prompt = `
    You are a proactive memory assistant.
    Analyze the CURRENT ENTRY against the user's HISTORY.

    Output JSON:
    {
      "found": true,
      "type": "warning" | "encouragement" | "pattern" | "reminder",
      "message": "Insightful observation...",
      "followUpQuestions": ["Question 1?", "Question 2?"]
    }

    If no strong connection, return { "found": false }.
  `;

  try {
    const raw = await callGemini(prompt, `HISTORY:\n${context}\n\nCURRENT ENTRY:\n${current}`);

    // FIX: Handle null response
    if (!raw) {
      console.error('generateInsight: No response from Gemini API');
      return null;
    }

    const jsonStr = raw.replace(/```json|```/g, '').trim();
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error('generateInsight error:', e);
    return null;
  }
};

const askJournalAI = async (entries, question) => {
  const context = entries.slice(0, 30).map(e => `[${e.createdAt.toLocaleDateString()}] [${e.title}] ${e.text}`).join('\n');
  const systemPrompt = `Answer based ONLY on journal entries. Use ### headers and * bullets. CONTEXT:\n${context}`;
  return await callGemini(systemPrompt, question);
};

const generateSynthesisAI = async (entries) => {
  const context = entries.slice(0, 20).map(e => e.text).join('\n---\n');
  const systemPrompt = `Analyze these entries. Format with ### Headers and * Bullets. 1. Theme 2. Topics 3. Summary.`;
  return await callGemini(systemPrompt, context);
};

// --- UI COMPONENTS ---

const DecompressionScreen = ({ onClose }) => {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t1 = setTimeout(() => setStep(1), 100);
    const t2 = setTimeout(() => setStep(2), 3000); // Breathe In
    const t3 = setTimeout(() => setStep(3), 6000); // Hold
    const t4 = setTimeout(() => setStep(4), 9000); // Breathe Out
    const t5 = setTimeout(() => onClose(), 12000); // Finish
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); clearTimeout(t5); };
  }, [onClose]); // FIX: Added onClose to dependency array

  return (
    <div className="fixed inset-0 bg-indigo-900 z-50 flex flex-col items-center justify-center text-white animate-in fade-in duration-500">
      <div className="relative mb-8">
        <div className={`absolute inset-0 bg-indigo-400 rounded-full opacity-30 blur-xl transition-all duration-[3000ms] ${step === 2 ? 'scale-150' : step === 4 ? 'scale-50' : 'scale-100'}`}></div>
        <Brain size={64} className={`relative z-10 transition-all duration-[3000ms] ${step === 2 ? 'scale-110' : 'scale-90'}`}/>
      </div>
      <h2 className="text-2xl font-bold mb-2 transition-opacity duration-500">
        {step <= 1 && "Heavy thoughts captured."}
        {step === 2 && "Breathe in..."}
        {step === 3 && "Hold..."}
        {step === 4 && "Let it go..."}
      </h2>
      <p className="text-indigo-300">Processing your feelings...</p>
    </div>
  );
};

const MarkdownLite = ({ text }) => {
  if (!text) return null;
  return (
    <div className="space-y-2 text-gray-800 leading-relaxed text-sm">
      {safeString(text).split('\n').map((line, i) => {
        const t = line.trim();
        if (!t) return <div key={i} className="h-1" />;
        if (t.startsWith('###')) return <h3 key={i} className="text-base font-bold text-indigo-900 mt-3">{t.replace(/###\s*/, '')}</h3>;
        if (t.startsWith('*') || t.startsWith('-')) return (
          <div key={i} className="flex gap-2 ml-1 items-start">
            <span className="text-indigo-500 text-[10px] mt-1.5">●</span>
            <p className="flex-1">{t.replace(/^[\*\-]\s*/, '')}</p>
          </div>
        );
        return <p key={i}>{t}</p>;
      })}
    </div>
  );
};

const MoodHeatmap = ({ entries }) => {
  const days = useMemo(() => new Array(30).fill(null).map((_, i) => {
    const d = new Date(); d.setDate(new Date().getDate() - (29 - i)); return d;
  }), []);

  const getColor = (d) => {
    const entry = entries.find(e => e.createdAt.getDate() === d.getDate() && e.createdAt.getMonth() === d.getMonth());
    if (!entry || typeof entry.analysis.mood_score !== 'number') return 'bg-gray-100';
    if (entry.analysis.mood_score >= 0.7) return 'bg-green-400';
    if (entry.analysis.mood_score >= 0.4) return 'bg-blue-300';
    return 'bg-red-300';
  };

  return (
    <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm mb-6">
      <div className="flex items-center gap-2 mb-3 text-gray-700 font-semibold text-xs uppercase tracking-wide"><Activity size={14} /> Mood (30 Days)</div>
      <div className="flex justify-between gap-1">{days.map((d, i) => <div key={i} className={`h-8 w-full rounded-sm ${getColor(d)} transition-colors`} title={d.toLocaleDateString()} />)}</div>
    </div>
  );
};

const EntryCard = ({ entry, onDelete, onUpdate, onReply }) => {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(entry.title);
  const isPending = entry.analysisStatus === 'pending';

  useEffect(() => { setTitle(entry.title); }, [entry.title]);

  const insightMsg = entry.contextualInsight?.message ? safeString(entry.contextualInsight.message) : null;
  const followUpQuestions = Array.isArray(entry.contextualInsight?.followUpQuestions)
    ? entry.contextualInsight.followUpQuestions
    : entry.contextualInsight?.followUpQuestion
      ? [entry.contextualInsight.followUpQuestion]
      : [];

  const toggleCategory = () => {
    const newCategory = entry.category === 'work' ? 'personal' : 'work';
    onUpdate(entry.id, { category: newCategory });
  };

  return (
    <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 hover:shadow-md transition-shadow mb-4 relative overflow-hidden">
      {isPending && <div className="absolute top-0 left-0 right-0 h-1 bg-gray-100"><div className="h-full bg-indigo-500 animate-progress-indeterminate"></div></div>}

      {/* Insight Box */}
      {entry.contextualInsight?.found && insightMsg && (
        <div className={`mb-4 p-3 rounded-lg text-sm border flex flex-col gap-2 ${entry.contextualInsight.type === 'warning' ? 'bg-red-50 border-red-100 text-red-800' : 'bg-blue-50 border-blue-100 text-blue-800'}`}>
          <div className="flex gap-3">
            <Lightbulb size={18} className="shrink-0 mt-0.5"/>
            <div>
              <div className="font-bold text-[10px] uppercase opacity-75 tracking-wider mb-1">{safeString(entry.contextualInsight.type)}</div>
              {insightMsg}
            </div>
          </div>
          {followUpQuestions.length > 0 && (
            <div className="mt-2 pt-2 border-t border-black/10 flex flex-col gap-2">
              {followUpQuestions.map((q, i) => (
                <div key={i} className="flex items-start justify-between gap-2">
                  <span className="text-xs font-medium italic flex-1">"{q}"</span>
                  <button onClick={() => onReply(q)} className="flex items-center gap-1 text-[10px] font-bold bg-white/80 px-2 py-1 rounded hover:bg-white transition-colors shadow-sm uppercase tracking-wide shrink-0">
                    <MessageSquarePlus size={12}/> Reply
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* CBT Breakdown */}
      {entry.analysis.framework === 'cbt' && entry.analysis.cbt_breakdown && (
        <div className="mb-4 bg-indigo-50 p-3 rounded-lg border border-indigo-100 text-sm space-y-2">
          <div className="flex items-center gap-2 text-indigo-700 font-bold text-xs uppercase"><Brain size={12}/> Cognitive Restructuring</div>
          <div className="grid gap-2">
            <div><span className="font-semibold text-indigo-900">Thought:</span> {entry.analysis.cbt_breakdown.automatic_thought}</div>
            <div className="bg-white p-2 rounded border border-indigo-100"><span className="font-semibold text-green-700">Challenge:</span> {entry.analysis.cbt_breakdown.challenge}</div>
          </div>
        </div>
      )}

      {/* Gibbs Reflection */}
      {entry.analysis.framework === 'gibbs' && entry.analysis.gibbs_reflection && (
        <div className="mb-4 bg-orange-50 p-3 rounded-lg border border-orange-100 text-sm space-y-2">
          <div className="flex items-center gap-2 text-orange-800 font-bold text-xs uppercase"><BookOpen size={12}/> Reflective Cycle</div>
          <div className="grid gap-2">
            <div><span className="font-semibold text-orange-900">Analysis:</span> {entry.analysis.gibbs_reflection.analysis}</div>
            <div className="bg-white p-2 rounded border border-orange-100"><span className="font-semibold text-orange-800">Next Time:</span> {entry.analysis.gibbs_reflection.action_plan}</div>
          </div>
        </div>
      )}

      <div className="flex justify-between items-start mb-3">
        <div className="flex gap-2 flex-wrap items-center">
          <button
            onClick={toggleCategory}
            className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wide hover:opacity-80 transition-opacity flex items-center gap-1 ${entry.category === 'work' ? 'bg-slate-100 text-slate-600' : 'bg-orange-50 text-orange-600'}`}
            title="Click to switch category"
          >
            {entry.category}
            <RefreshCw size={8} className="opacity-50" />
          </button>
          {entry.tags.map((t, i) => <span key={i} className="text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">#{safeString(t)}</span>)}
        </div>
        <div className="flex items-center gap-2">
          {typeof entry.analysis.mood_score === 'number' && <span className="px-2 py-1 rounded-full text-[10px] font-bold bg-gray-100">{(entry.analysis.mood_score * 100).toFixed(0)}%</span>}
          <button onClick={() => onDelete(entry.id)} className="text-gray-300 hover:text-red-400 transition-colors"><Trash2 size={16}/></button>
        </div>
      </div>

      <div className="mb-2 flex items-center gap-2">
        {editing ? (
          <div className="flex-1 flex gap-2">
            <input value={title} onChange={e => setTitle(e.target.value)} className="flex-1 font-bold text-lg border-b-2 border-indigo-500 focus:outline-none" autoFocus />
            <button onClick={() => { onUpdate(entry.id, { title }); setEditing(false); }} className="text-green-600"><Check size={18}/></button>
          </div>
        ) : (
          <>
            <h3 className={`text-lg font-bold text-gray-800 ${isPending ? 'animate-pulse' : ''}`}>{isPending ? "Processing..." : title}</h3>
            {!isPending && <button onClick={() => setEditing(true)} className="text-gray-300 hover:text-indigo-500 opacity-50 hover:opacity-100"><Edit2 size={14}/></button>}
          </>
        )}
      </div>

      <div className="text-xs text-gray-400 mb-4 flex items-center gap-1 font-medium"><Calendar size={12}/> {entry.createdAt.toLocaleDateString()}</div>
      <p className="text-gray-600 text-sm whitespace-pre-wrap leading-relaxed">{entry.text}</p>
    </div>
  );
};

const Chat = ({ entries, onClose, category }) => {
  const [msgs, setMsgs] = useState([{ role: 'sys', text: `I'm your ${category} memory AI. Talk to yourself.` }]);
  const [txt, setTxt] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceInput, setVoiceInput] = useState(false);
  const [conversationMode, setConversationMode] = useState(false);
  const endRef = useRef(null);

  useEffect(() => endRef.current?.scrollIntoView(), [msgs]);

  const speak = (text) => {
    // FIX: Check if speechSynthesis is available
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      console.warn('Speech Synthesis API not available');
      return;
    }

    try {
      if (isSpeaking) {
        window.speechSynthesis.cancel();
        setIsSpeaking(false);
        if (conversationMode) setConversationMode(false);
        return;
      }
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
    if (transcript) {
      setTxt(transcript);
      send(transcript);
    } else {
      setLoading(false);
      if (conversationMode) setConversationMode(false);
    }
  };

  const send = async (overrideText) => {
    const textToSend = overrideText || txt;
    if (!textToSend.trim()) return;

    setTxt('');
    setMsgs(p => [...p, { role: 'user', text: textToSend }]);
    setLoading(true);

    const context = entries.slice(0, 30).map(e => `[${e.createdAt.toLocaleDateString()}] ${e.text}`).join('\n');
    const ans = await callGemini(`Answer user as a helpful inner voice. Use Markdown. CONTEXT:\n${context}`, textToSend);

    setMsgs(p => [...p, { role: 'ai', text: ans || "I couldn't find an answer." }]);
    setLoading(false);

    if (conversationMode && ans) {
        speak(ans);
    }
  };

  return (
    <div className="fixed inset-0 bg-white z-50 flex flex-col pt-[env(safe-area-inset-top)] animate-in slide-in-from-bottom-10 duration-200">
      <div className="p-4 border-b flex justify-between items-center bg-indigo-600 text-white shadow-md">
        <div className="flex gap-2 items-center">
            <button
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
                className={`p-1 rounded-full transition-colors ${conversationMode ? 'bg-white/20 text-yellow-300' : 'hover:bg-indigo-700'}`}
            >
                <Headphones size={20} className={conversationMode ? "animate-pulse" : ""} />
            </button>
            <span className="font-bold text-lg">Talk to Yourself ({category})</span>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-indigo-700 rounded-full"><X size={24}/></button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
        {msgs.map((m, i) => (
          <div key={i} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
            <div className={`max-w-[85%] p-4 rounded-2xl text-sm shadow-sm ${m.role === 'user' ? 'bg-indigo-600 text-white rounded-br-none' : 'bg-white text-gray-800 border border-gray-200 rounded-bl-none'}`}>
              <MarkdownLite text={m.text} />
            </div>
            {m.role === 'ai' && (
              <button onClick={() => speak(m.text)} className="mt-1 text-gray-400 hover:text-indigo-600 p-1">
                {isSpeaking ? <StopCircle size={16} /> : <Volume2 size={16} />}
              </button>
            )}
          </div>
        ))}
        {loading && <div className="text-xs text-gray-400 p-2 text-center animate-pulse">Thinking...</div>}
        <div ref={endRef} />
      </div>

      {voiceInput && (
        <div className="absolute inset-x-0 bottom-0 h-48 bg-white border-t z-10 flex flex-col items-center justify-center animate-in slide-in-from-bottom-10">
           <p className="mb-4 text-gray-500 font-medium">{conversationMode ? "Listening (Conversation Mode)..." : "Listening..."}</p>
           <VoiceRecorder onSave={handleVoiceInput} onSwitch={() => setVoiceInput(false)} loading={false} minimal={true} />
           <button onClick={() => { setVoiceInput(false); setConversationMode(false); }} className="mt-4 text-sm text-red-500 font-medium">Cancel</button>
        </div>
      )}

      <div className="p-4 bg-white border-t pb-[max(2rem,env(safe-area-inset-bottom))]">
        <div className="flex gap-2 items-center bg-gray-50 p-1 rounded-full border border-gray-200 focus-within:ring-2 focus-within:ring-indigo-500">
          <button onClick={() => setVoiceInput(true)} className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-full"><Mic size={20}/></button>
          <input value={txt} onChange={e => setTxt(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} className="flex-1 bg-transparent border-none p-2 focus:ring-0 text-sm outline-none" placeholder="Say something..." />
          <button onClick={() => send()} disabled={loading} className="bg-indigo-600 text-white p-2 rounded-full hover:bg-indigo-700 disabled:bg-gray-300 transition-colors"><Send size={18}/></button>
        </div>
      </div>
    </div>
  );
};

const WeeklyReport = ({ text, onClose }) => (
  <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
    <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl relative max-h-[80vh] overflow-y-auto flex flex-col">
      <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"><X size={20}/></button>
      <h2 className="font-bold text-xl mb-4 text-indigo-600 flex gap-2 items-center"><Lightbulb size={24}/> Weekly Synthesis</h2>
      <div className="flex-1 overflow-y-auto"><MarkdownLite text={text} /></div>
    </div>
  </div>
);

const VoiceRecorder = ({ onSave, onSwitch, loading, minimal }) => {
  const [rec, setRec] = useState(false);
  const [mr, setMr] = useState(null);
  const [secs, setSecs] = useState(0);
  const timer = useRef(null);

  useEffect(() => { return () => { if (timer.current) clearInterval(timer.current); }; }, []);

  const start = async () => {
    // FIX: Check if MediaDevices API is available
    if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("Microphone access not available in this browser");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
      const r = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 16000 });
      const chunks = [];
      r.ondataavailable = e => chunks.push(e.data);
      r.onstop = () => {
        const reader = new FileReader();
        reader.readAsDataURL(new Blob(chunks, { type: mime }));
        reader.onloadend = () => onSave(reader.result.split(',')[1], mime);
        stream.getTracks().forEach(t => t.stop());
      };
      r.start(); setMr(r); setRec(true);
      setSecs(0); timer.current = setInterval(() => setSecs(s => s + 1), 1000);
    } catch (e) {
      alert("Microphone access denied or error occurred");
      console.error(e);
    }
  };

  const stop = () => { if (mr) { mr.stop(); setRec(false); clearInterval(timer.current); } };

  if (minimal) {
    return (
      <button onClick={rec ? stop : start} className={`h-16 w-16 rounded-full flex items-center justify-center shadow-lg transition-all ${rec ? 'bg-red-500 scale-110 animate-pulse' : 'bg-indigo-600 hover:bg-indigo-700'}`}>
        {rec ? <Square className="text-white fill-current"/> : <Mic className="text-white" size={32}/>}
      </button>
    );
  }

  return (
    <div className="fixed bottom-0 w-full bg-white border-t p-4 z-20 pb-[max(2rem,env(safe-area-inset-bottom))] shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]">
      {loading && <div className="absolute inset-0 bg-white/90 flex justify-center items-center z-30 text-indigo-600 font-medium"><Loader2 className="animate-spin mr-2"/> Processing...</div>}
      <div className="flex justify-between items-center max-w-md mx-auto">
        <button onClick={onSwitch} disabled={rec} className="p-3 rounded-full text-gray-400 hover:bg-gray-100"><Keyboard size={24}/></button>
        <button onClick={rec ? stop : start} className={`h-16 w-16 rounded-full flex items-center justify-center shadow-lg transition-all ${rec ? 'bg-red-500 scale-110 animate-pulse' : 'bg-indigo-600 hover:bg-indigo-700'}`}>
          {rec ? <Square className="text-white fill-current"/> : <Mic className="text-white" size={32}/>}
        </button>
        <div className="w-12 flex justify-center">{rec && <div className="bg-gray-800 text-white text-xs font-mono py-1 px-2 rounded">{Math.floor(secs/60)}:{String(secs%60).padStart(2,'0')}</div>}</div>
      </div>
    </div>
  );
};

const TextInput = ({ onSave, onCancel, loading }) => {
  const [val, setVal] = useState('');
  return (
    <div className="fixed bottom-0 w-full bg-white border-t p-4 z-20 pb-[max(2rem,env(safe-area-inset-bottom))] shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] animate-in slide-in-from-bottom-10">
      <div className="max-w-md mx-auto">
        <textarea value={val} onChange={e => setVal(e.target.value)} className="w-full border rounded-xl p-3 mb-3 h-32 focus:ring-2 focus:ring-indigo-500 outline-none" placeholder="Type your memory..." autoFocus />
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 text-gray-500 hover:bg-gray-100 rounded-lg font-medium">Cancel</button>
          <button onClick={() => onSave(val)} disabled={!val.trim() || loading} className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium flex gap-2 items-center hover:bg-indigo-700 disabled:bg-gray-300">
            {loading ? <Loader2 className="animate-spin" size={18}/> : <Send size={18}/>} Save
          </button>
        </div>
      </div>
    </div>
  );
};

export default function App() {
  useIOSMeta();
  const { permission, requestPermission } = useNotifications();
  const [user, setUser] = useState(null);
  const [entries, setEntries] = useState([]);
  const [view, setView] = useState('feed');
  const [cat, setCat] = useState('personal');
  const [mode, setMode] = useState('voice');
  const [processing, setProcessing] = useState(false);
  const [report, setReport] = useState(null);
  const [backfilling, setBackfilling] = useState(false);
  const [replyContext, setReplyContext] = useState(null);
  const [showDecompression, setShowDecompression] = useState(false);

  // Auth
  useEffect(() => {
    const init = async () => {
      // FIX: Proper window check for global variable
      if (typeof window !== 'undefined' && typeof window.__initial_auth_token !== 'undefined' && window.__initial_auth_token) {
        try {
          await signInWithCustomToken(auth, window.__initial_auth_token);
        } catch (error) {
          console.error('Auth error:', error);
        }
      }
    };
    init();
    return onAuthStateChanged(auth, setUser);
  }, []);

  // Data Feed
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'artifacts', APP_COLLECTION_ID, 'users', user.uid, 'entries'), orderBy('createdAt', 'desc'), limit(100));
    return onSnapshot(q, snap => {
      const safeData = snap.docs.map(doc => sanitizeEntry(doc.id, doc.data()));
      setEntries(safeData);
    });
  }, [user]);

  const visible = useMemo(() => entries.filter(e => e.category === cat), [entries, cat]);

  const handleBackfill = async () => {
    if (!confirm("Process old memories?")) return;
    setBackfilling(true);
    const snapshot = await getDocs(collection(db, 'artifacts', APP_COLLECTION_ID, 'users', user.uid, 'entries'));
    let count = 0;
    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();
      if (!data.embedding && data.text) {
        const embedding = await generateEmbedding(data.text);
        if (embedding) {
          await updateDoc(doc(db, 'artifacts', APP_COLLECTION_ID, 'users', user.uid, 'entries', docSnap.id), { embedding, category: 'personal' });
          count++;
        }
      }
    }
    alert(`Updated ${count} memories!`);
    setBackfilling(false);
  };

  const saveEntry = async (textInput) => {
    if (!user) return;
    setProcessing(true);

    let finalTex = textInput;
    if (replyContext) {
      finalTex = `[Replying to: "${replyContext}"]\n\n${textInput}`;
    }

    const embedding = await generateEmbedding(finalTex);
    const related = findRelevantMemories(embedding, entries, cat);
    const recent = entries.slice(0, 5);

    try {
      const ref = await addDoc(collection(db, 'artifacts', APP_COLLECTION_ID, 'users', user.uid, 'entries'), {
        text: finalTex, category: cat, analysisStatus: 'pending', embedding,
        createdAt: Timestamp.now(), userId: user.uid
      });

      setProcessing(false);
      setMode('voice');
      setReplyContext(null);

      // FIX: Added .catch() to ensure entry always gets marked as complete
      Promise.all([analyzeEntry(finalTex), generateInsight(finalTex, related, recent)])
        .then(async ([analysis, insight]) => {
          console.log('Analysis complete:', { analysis, insight });

          // AI ROUTER CHECK: Decompression for low mood
          if (analysis && analysis.mood_score < 0.35) {
            setShowDecompression(true);
          }

          await updateDoc(ref, {
            analysis: analysis || {},
            title: analysis?.title || "New Memory",
            tags: analysis?.tags || [],
            contextualInsight: insight?.found ? insight : null,
            analysisStatus: 'complete'
          });
        })
        .catch(async (error) => {
          // FIX: Critical - always mark as complete even if analysis fails
          console.error('Analysis failed, marking entry as complete with fallback values:', error);

          await updateDoc(ref, {
            analysis: {
              mood_score: 0.5,
              framework: 'general'
            },
            title: finalTex.substring(0, 50) + (finalTex.length > 50 ? '...' : ''),
            tags: [],
            contextualInsight: null,
            analysisStatus: 'complete'
          });
        });
    } catch (e) {
      console.error('Save failed:', e);
      alert("Save failed");
      setProcessing(false);
    }
  };

  const handleAudioWrapper = async (base64, mime) => {
    setProcessing(true);
    const transcript = await transcribeAudio(base64, mime);

    // FIX: Better error messages based on error type
    if (!transcript) {
      alert("Transcription failed - please try again");
      setProcessing(false);
      return;
    }

    // Handle different error types with specific messages
    if (transcript === 'API_RATE_LIMIT') {
      alert("Too many requests - please wait a moment and try again");
      setProcessing(false);
      return;
    }

    if (transcript === 'API_AUTH_ERROR') {
      alert("API authentication error - please check settings");
      setProcessing(false);
      return;
    }

    if (transcript.startsWith('API_')) {
      alert("Transcription service temporarily unavailable - please try again");
      setProcessing(false);
      return;
    }

    if (transcript.includes("NO_SPEECH")) {
      alert("No speech detected - please try speaking closer to the microphone");
      setProcessing(false);
      return;
    }

    await saveEntry(transcript);
  };

  const handleReply = (question) => {
    setReplyContext(question);
    setMode('voice');
  };

  const handleReport = async () => {
    const txt = visible.slice(0, 20).map(e => e.text).join('\n');
    const ans = await callGemini(`Analyze past week's ${cat} entries. Format with ### and *.`, txt);
    setReport(ans);
  };

  if (!user) return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-gray-50">
      <div className="h-16 w-16 bg-indigo-600 rounded-2xl flex items-center justify-center mb-4 shadow-lg rotate-3"><Activity className="text-white"/></div>
      <h1 className="text-2xl font-bold mb-6">EchoVault</h1>
      <button onClick={() => signInWithPopup(auth, new GoogleAuthProvider())} className="flex gap-2 bg-white px-6 py-3 rounded-lg shadow border font-medium text-gray-700 hover:bg-gray-50"><LogIn/> Sign in with Google</button>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 pb-40 pt-[env(safe-area-inset-top)]">
      {showDecompression && <DecompressionScreen onClose={() => setShowDecompression(false)} />}

      <div className="bg-white border-b p-4 sticky top-0 z-20 shadow-sm">
        <div className="flex justify-between items-center mb-4">
          <h1 className="font-bold text-lg flex gap-2 text-gray-800"><Brain className="text-indigo-600"/> EchoVault</h1>
          <div className="flex gap-2">
            <button onClick={requestPermission} className={`p-2 rounded-full hover:bg-gray-100 ${permission === 'granted' ? 'text-indigo-600' : 'text-gray-400'}`} title="Notifications"><Bell size={20}/></button>
            <button onClick={handleBackfill} disabled={backfilling} className="p-2 rounded-full hover:bg-gray-100 text-gray-500"><Database size={20} className={backfilling ? "animate-spin" : ""}/></button>
            <button onClick={handleReport} className="p-2 rounded-full hover:bg-gray-100 text-gray-500"><Lightbulb size={20}/></button>
            <button onClick={() => setView('chat')} className="p-2 rounded-full hover:bg-gray-100 text-gray-500"><MessageCircle size={20}/></button>
            <button onClick={() => signOut(auth)} className="p-2 rounded-full hover:bg-red-50 text-red-500"><LogOut size={20}/></button>
          </div>
        </div>
        <div className="flex bg-gray-100 p-1 rounded-lg">
          <button onClick={() => setCat('personal')} className={`flex-1 flex justify-center items-center gap-2 py-1.5 text-xs font-bold rounded transition-all ${cat === 'personal' ? 'bg-white shadow text-indigo-600' : 'text-gray-500'}`}><UserIcon size={14}/> Personal</button>
          <button onClick={() => setCat('work')} className={`flex-1 flex justify-center items-center gap-2 py-1.5 text-xs font-bold rounded transition-all ${cat === 'work' ? 'bg-white shadow text-indigo-600' : 'text-gray-500'}`}><Briefcase size={14}/> Work</button>
        </div>
      </div>

      <div className="max-w-md mx-auto p-4">
        {visible.length > 0 && <MoodHeatmap entries={visible} />}
        <div className="space-y-4">
          {visible.map(e => <EntryCard key={e.id} entry={e} onDelete={id => deleteDoc(doc(db, 'artifacts', APP_COLLECTION_ID, 'users', user.uid, 'entries', id))} onUpdate={(id, d) => updateDoc(doc(db, 'artifacts', APP_COLLECTION_ID, 'users', user.uid, 'entries', id), d)} onReply={handleReply} />)}
        </div>

        {visible.length === 0 && (
          <div className="text-center py-12">
            <div className="h-24 w-24 bg-indigo-50 rounded-full flex items-center justify-center mx-auto mb-4 text-indigo-300"><Mic size={40}/></div>
            <h3 className="text-lg font-medium text-gray-900">No {cat} memories yet</h3>
            <p className="text-gray-500 mt-2 text-sm">Switch categories or record your first entry.</p>
            <div className="mt-8 p-4 bg-blue-50 rounded-xl text-sm text-blue-800 text-left"><p className="font-bold mb-1 flex items-center gap-2"><Share size={14}/> Install on iPhone</p><p>Tap <strong>Share</strong> → <strong>Add to Home Screen</strong>.</p></div>
          </div>
        )}
      </div>

      {replyContext && (
        <div className="fixed bottom-24 left-4 right-4 bg-indigo-900 text-white p-3 rounded-lg z-30 flex justify-between items-center shadow-lg animate-in slide-in-from-bottom-2">
          <div className="text-xs">
            <span className="opacity-70 block text-[10px] uppercase font-bold">Replying to:</span>
            "{replyContext}"
          </div>
          <button onClick={() => setReplyContext(null)} className="p-1 hover:bg-white/20 rounded"><X size={16}/></button>
        </div>
      )}

      {mode === 'voice' ? (
        <VoiceRecorder onSave={handleAudioWrapper} onSwitch={() => setMode('text')} loading={processing} />
      ) : (
        <TextInput onSave={saveEntry} onCancel={() => setMode('voice')} loading={processing} />
      )}

      {view === 'chat' && <Chat entries={visible} onClose={() => setView('feed')} category={cat} />}
      {report && <WeeklyReport text={report} onClose={() => setReport(null)} />}
    </div>
  );
}

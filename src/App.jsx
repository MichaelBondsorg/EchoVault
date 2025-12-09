import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Mic, Square, Trash2, Search, LogOut, Loader2, Sparkles, MessageCircle, X, Send,
  Lightbulb, Edit2, Check, Share, LogIn, Activity, AlertTriangle, TrendingUp, TrendingDown,
  Database, Briefcase, User as UserIcon, Keyboard, RefreshCw, Calendar, MessageSquarePlus,
  Brain, Volume2, StopCircle, Bell, Headphones, Shield, Phone, Heart, Plus, ChevronRight,
  FileText, Clipboard, Info, Wind, Droplets, Hand, Footprints, Download, CheckSquare, BarChart3,
  Menu
} from 'lucide-react';

// UI Components
import { celebrate, Button, Modal, ModalHeader, ModalBody, Badge, MoodBadge, BreathingLoader } from './components/ui';

// Config
import {
  auth, db,
  onAuthStateChanged, signOut, signInWithCustomToken,
  GoogleAuthProvider, signInWithPopup,
  collection, addDoc, query, orderBy, onSnapshot,
  Timestamp, deleteDoc, doc, updateDoc, limit, getDocs, setDoc
} from './config/firebase';
import { AI_CONFIG, GEMINI_API_KEY, OPENAI_API_KEY } from './config/ai';
import {
  APP_COLLECTION_ID, CURRENT_CONTEXT_VERSION,
  CRISIS_KEYWORDS, WARNING_INDICATORS, DEFAULT_SAFETY_PLAN,
  PERSONAL_PROMPTS, WORK_PROMPTS
} from './config/constants';

// Utils
import { safeString, removeUndefined } from './utils/string';
import { safeDate } from './utils/date';
import { sanitizeEntry } from './utils/entries';

// Services
import { callGemini, callOpenAI, generateEmbedding, cosineSimilarity, findRelevantMemories, transcribeAudio } from './services/ai';
import {
  classifyEntry, analyzeEntry, generateInsight, extractEnhancedContext,
  computeMoodTrajectory, detectCyclicalPatterns, askJournalAI
} from './services/analysis';
import { checkCrisisKeywords, checkWarningIndicators, checkLongitudinalRisk, analyzeLongitudinalPatterns } from './services/safety';
import { retrofitEntriesInBackground } from './services/entries';

// Hooks
import { useIOSMeta } from './hooks/useIOSMeta';
import { useNotifications } from './hooks/useNotifications';

// --- Remaining App-specific functions ---

const shuffleArray = (array) => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

const getPromptsForSession = (category, smartReflections) => {
  if (smartReflections.length > 0) {
    return { type: 'smart', prompts: smartReflections.slice(0, 3) };
  }
  
  const bank = category === 'work' ? WORK_PROMPTS : PERSONAL_PROMPTS;
  
  // Track recently shown prompts in localStorage
  const recentlyShown = JSON.parse(localStorage.getItem('recentPrompts') || '[]');
  const available = bank.filter(p => !recentlyShown.includes(p.id));
  const pool = available.length >= 3 ? available : bank;
  const selected = shuffleArray(pool).slice(0, 3);
  
  // Update localStorage (keep last 10)
  localStorage.setItem('recentPrompts', JSON.stringify([
    ...selected.map(p => p.id),
    ...recentlyShown
  ].slice(0, 10)));
  
  return { type: 'standard', prompts: selected.map(p => p.text) };
};

// --- PDF LOADER (lazy-loads jsPDF from CDN) ---
let jsPDFPromise = null;
const loadJsPDF = () => {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('PDF export is only available in the browser'));
  }
  if (window.jspdf && window.jspdf.jsPDF) {
    return Promise.resolve(window.jspdf.jsPDF);
  }
  if (jsPDFPromise) return jsPDFPromise;
  
  jsPDFPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-jspdf]');
    if (existing) {
      existing.addEventListener('load', () => {
        if (window.jspdf && window.jspdf.jsPDF) resolve(window.jspdf.jsPDF);
        else reject(new Error('jsPDF global not found after script load'));
      });
      existing.addEventListener('error', () => reject(new Error('Failed to load jsPDF script')));
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    script.async = true;
    script.dataset.jspdf = 'true';
    script.onload = () => {
      if (window.jspdf && window.jspdf.jsPDF) resolve(window.jspdf.jsPDF);
      else reject(new Error('jsPDF global not found after script load'));
    };
    script.onerror = () => reject(new Error('Failed to load jsPDF script'));
    document.body.appendChild(script);
  });
  return jsPDFPromise;
};

// --- OpenAI Text-to-Speech ---
const synthesizeSpeech = async (text, voice = 'nova') => {
  if (!OPENAI_API_KEY) {
    console.warn('OpenAI API key not available for TTS');
    return null;
  }

  try {
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'tts-1',
        input: text,
        voice: voice, // alloy, echo, fable, onyx, nova, shimmer
        response_format: 'mp3'
      })
    });

    if (!response.ok) {
      console.error('TTS API error:', response.status);
      return null;
    }

    const audioBlob = await response.blob();
    return URL.createObjectURL(audioBlob);
  } catch (e) {
    console.error('TTS synthesis error:', e);
    return null;
  }
};

// Analysis functions (classifyEntry, analyzeEntry, generateInsight, etc.) imported from services/analysis


const generateSynthesisAI = async (entries) => {
  const context = entries.slice(0, 20).map(e => e.text).join('\n---\n');
  const systemPrompt = `Analyze these entries. Format with ### Headers and * Bullets. 1. Theme 2. Topics 3. Summary.`;
  return await callGemini(systemPrompt, context);
};

const generateDailySynthesis = async (dayEntries) => {
  const reflectionEntries = dayEntries.filter(e => e.entry_type !== 'task');
  if (reflectionEntries.length === 0) return null;
  
  const context = reflectionEntries.map((e, i) => `Entry ${i + 1} [${e.createdAt.toLocaleTimeString()}]: ${e.text}`).join('\n---\n');
  const prompt = `
    You are summarizing journal entries from a single day.

    1. Write a 2-3 sentence summary that captures:
       - The emotional arc of the day (how feelings evolved)
       - Key themes/events
       - Any significant mood shifts

    2. Then identify the key factors that most contributed to the person's overall mood.
       Think in terms of specific events, thoughts, or situations.

    Return a JSON object ONLY, no markdown, no extra text:

    {
      "summary": "2-3 sentence prose summary here",
      "bullets": [
        "Concise factor 1 (e.g. Morning anxiety about job search after email)",
        "Concise factor 2",
        "Concise factor 3"
      ]
    }

    Rules:
    - 3-6 bullets max.
    - Each bullet should be 1 short sentence (max 15 words).
    - Each bullet should clearly point to what was driving the mood (event/thought/situation).
    - Do NOT include bullet characters like '-', '*', or '•' in the text.
  `;
  
  try {
    const result = await callGemini(prompt, context);
    if (!result) return null;

    try {
      // Try multiple approaches to extract JSON from the response
      let jsonStr = result;

      // Approach 1: Extract content from markdown code blocks (handles ```json ... ``` or ``` ... ```)
      const codeBlockMatch = result.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (codeBlockMatch) {
        jsonStr = codeBlockMatch[1];
      } else {
        // Approach 2: Simple strip of markdown markers
        jsonStr = result.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      }

      // Approach 3: If still not valid JSON, try to find JSON object in the string
      if (!jsonStr.startsWith('{')) {
        const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          jsonStr = jsonMatch[0];
        }
      }

      const parsed = JSON.parse(jsonStr.trim());
      if (parsed && typeof parsed.summary === 'string' && Array.isArray(parsed.bullets)) {
        return parsed;
      }
    } catch (parseErr) {
      console.error('generateDailySynthesis JSON parse error:', parseErr, 'Raw result:', result);
    }

    // Fallback: try to display something readable if we can't parse JSON
    // Strip any markdown code blocks for display
    const cleanedResult = result.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '').trim();
    return { summary: cleanedResult, bullets: [] };
  } catch (e) {
    console.error('generateDailySynthesis error:', e);
    return null;
  }
};

// --- UI COMPONENTS ---

// Crisis Soft-Block Modal (Phase 0 - Tier 1)
const CrisisSoftBlockModal = ({ onResponse, onClose }) => {
  return (
    <AnimatePresence>
      <motion.div
        className="modal-backdrop flex items-center justify-center p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.div
          className="modal-content p-6"
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="h-12 w-12 bg-primary-100 rounded-full flex items-center justify-center">
              <Heart className="text-primary-600" size={24} />
            </div>
            <div>
              <h2 className="text-lg font-display font-bold text-warm-900">Just checking in</h2>
              <p className="text-sm text-warm-500">I noticed some heavy words</p>
            </div>
          </div>

          <p className="text-warm-600 mb-6 font-body">Are you okay? Your wellbeing matters most.</p>

          <div className="space-y-3">
            <motion.button
              onClick={() => onResponse('okay')}
              className="w-full p-4 text-left rounded-2xl border-2 border-warm-200 hover:border-primary-300 hover:bg-primary-50 transition-all"
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
            >
              <div className="font-semibold text-warm-800">I'm okay, just venting</div>
              <div className="text-sm text-warm-500">Continue saving my entry</div>
            </motion.button>

            <motion.button
              onClick={() => onResponse('support')}
              className="w-full p-4 text-left rounded-2xl border-2 border-warm-200 hover:border-secondary-300 hover:bg-secondary-50 transition-all"
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
            >
              <div className="font-semibold text-warm-800">I could use some support</div>
              <div className="text-sm text-warm-500">Show me helpful resources</div>
            </motion.button>

            <motion.button
              onClick={() => onResponse('crisis')}
              className="w-full p-4 text-left rounded-2xl border-2 border-red-200 hover:border-red-400 hover:bg-red-50 transition-all"
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
            >
              <div className="font-semibold text-red-700">I'm in crisis</div>
              <div className="text-sm text-red-500">Connect me with help now</div>
            </motion.button>
          </div>

          <button
            onClick={onClose}
            className="mt-4 w-full text-center text-sm text-warm-400 hover:text-warm-600 transition-colors"
          >
            Cancel
          </button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

// Crisis Resources Screen (shown after "I could use support" or "I'm in crisis")
const CrisisResourcesScreen = ({ level, onClose, onContinue }) => {
  const isCrisis = level === 'crisis';

  return (
    <AnimatePresence>
      <motion.div
        className="modal-backdrop flex items-center justify-center p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.div
          className="modal-content p-6 max-h-[90vh] overflow-y-auto"
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
        >
          <div className="text-center mb-6">
            <motion.div
              className={`h-16 w-16 mx-auto rounded-full flex items-center justify-center mb-4 ${isCrisis ? 'bg-red-100' : 'bg-secondary-100'}`}
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.1, type: "spring", damping: 15 }}
            >
              <Phone className={isCrisis ? 'text-red-600' : 'text-secondary-600'} size={32} />
            </motion.div>
            <h2 className="text-xl font-display font-bold text-warm-900">
              {isCrisis ? "Help is available right now" : "Support resources"}
            </h2>
            <p className="text-warm-500 mt-2 font-body">
              {isCrisis
                ? "You don't have to face this alone. Please reach out."
                : "Here are some resources that might help."}
            </p>
          </div>

          <div className="space-y-3 mb-6">
            <motion.a
              href="tel:988"
              className={`flex items-center gap-4 p-4 rounded-2xl border-2 ${isCrisis ? 'border-red-200 bg-red-50' : 'border-warm-200'} hover:shadow-soft transition-all`}
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
            >
              <div className={`h-12 w-12 rounded-full flex items-center justify-center ${isCrisis ? 'bg-red-200' : 'bg-warm-200'}`}>
                <Phone className={isCrisis ? 'text-red-700' : 'text-warm-700'} size={20} />
              </div>
              <div>
                <div className="font-bold text-warm-900">988 Suicide & Crisis Lifeline</div>
                <div className="text-sm text-warm-500">Call or text 988 - Available 24/7</div>
              </div>
            </motion.a>

            <motion.a
              href="sms:741741&body=HOME"
              className="flex items-center gap-4 p-4 rounded-2xl border-2 border-warm-200 hover:shadow-soft transition-all"
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
            >
              <div className="h-12 w-12 rounded-full bg-warm-200 flex items-center justify-center">
                <MessageCircle className="text-warm-700" size={20} />
              </div>
              <div>
                <div className="font-bold text-warm-900">Crisis Text Line</div>
                <div className="text-sm text-warm-500">Text HOME to 741741</div>
              </div>
            </motion.a>

            <motion.a
              href="tel:911"
              className="flex items-center gap-4 p-4 rounded-2xl border-2 border-warm-200 hover:shadow-soft transition-all"
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
            >
              <div className="h-12 w-12 rounded-full bg-warm-200 flex items-center justify-center">
                <AlertTriangle className="text-warm-700" size={20} />
              </div>
              <div>
                <div className="font-bold text-warm-900">Emergency Services</div>
                <div className="text-sm text-warm-500">Call 911 for immediate help</div>
              </div>
            </motion.a>
          </div>

          {!isCrisis && (
            <Button
              variant="primary"
              className="w-full mb-3"
              onClick={onContinue}
            >
              Continue with my entry
            </Button>
          )}

          <button
            onClick={onClose}
            className="w-full py-3 text-warm-500 hover:text-warm-700 text-sm transition-colors"
          >
            {isCrisis ? "I'll reach out for help" : "Close"}
          </button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

// Safety Plan Screen (Phase 0 - Story 0.5)
const SafetyPlanScreen = ({ plan, onUpdate, onClose }) => {
  const [editingSection, setEditingSection] = useState(null);
  const [newItem, setNewItem] = useState('');
  
  const addItem = (section) => {
    if (!newItem.trim()) return;
    const updated = { ...plan };
    if (section === 'copingStrategies') {
      updated[section] = [...(updated[section] || []), { activity: newItem, notes: '' }];
    } else if (section === 'supportContacts') {
      updated[section] = [...(updated[section] || []), { name: newItem, phone: '', relationship: '' }];
    } else {
      updated[section] = [...(updated[section] || []), newItem];
    }
    onUpdate(updated);
    setNewItem('');
    setEditingSection(null);
  };
  
  const removeItem = (section, index) => {
    const updated = { ...plan };
    updated[section] = updated[section].filter((_, i) => i !== index);
    onUpdate(updated);
  };
  
  const SectionCard = ({ title, icon: Icon, section, items, renderItem }) => (
    <motion.div
      className="card"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon size={18} className="text-primary-600" />
          <h3 className="font-semibold text-warm-800">{title}</h3>
        </div>
        <motion.button
          onClick={() => setEditingSection(editingSection === section ? null : section)}
          className="text-primary-600 hover:text-primary-800 p-1 rounded-full hover:bg-primary-50 transition-colors"
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
        >
          <Plus size={18} />
        </motion.button>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-warm-400 italic">No items yet - tap + to add</p>
      ) : (
        <div className="space-y-2">
          {items.map((item, i) => (
            <motion.div
              key={i}
              className="flex items-center justify-between bg-warm-50 rounded-xl p-3"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.05 }}
            >
              <span className="text-sm text-warm-700">{renderItem(item)}</span>
              <button onClick={() => removeItem(section, i)} className="text-warm-400 hover:text-red-500 transition-colors">
                <X size={14} />
              </button>
            </motion.div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {editingSection === section && (
          <motion.div
            className="mt-3 flex gap-2"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <input
              type="text"
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              placeholder="Add new item..."
              className="input flex-1 text-sm"
              autoFocus
            />
            <Button variant="primary" size="sm" onClick={() => addItem(section)}>
              Add
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );

  return (
    <motion.div
      className="fixed inset-0 bg-warm-50 z-50 overflow-y-auto"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="sticky top-0 bg-white/95 backdrop-blur-sm border-b border-warm-100 p-4 flex items-center justify-between z-10 shadow-soft">
        <div className="flex items-center gap-3">
          <Shield className="text-primary-600" size={24} />
          <h1 className="text-lg font-display font-bold text-warm-900">My Safety Plan</h1>
        </div>
        <motion.button
          onClick={onClose}
          className="p-2 hover:bg-warm-100 rounded-full transition-colors"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <X size={20} className="text-warm-600" />
        </motion.button>
      </div>

      <div className="max-w-md mx-auto p-4 space-y-4 pb-20">
        <motion.div
          className="bg-primary-50 rounded-2xl p-4 border border-primary-100"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <p className="text-sm text-primary-800 font-body">
            Your safety plan is here for difficult moments. Customize it during calm times so it's ready when you need it.
          </p>
        </motion.div>
        
        <SectionCard
          title="Warning Signs"
          icon={AlertTriangle}
          section="warningSignsPersonal"
          items={plan.warningSignsPersonal || []}
          renderItem={(item) => item}
        />
        
        <SectionCard
          title="Coping Strategies"
          icon={Wind}
          section="copingStrategies"
          items={plan.copingStrategies || []}
          renderItem={(item) => item.activity}
        />
        
        <SectionCard
          title="Reasons for Living"
          icon={Heart}
          section="reasonsForLiving"
          items={plan.reasonsForLiving || []}
          renderItem={(item) => item}
        />
        
        <SectionCard
          title="Support Contacts"
          icon={Phone}
          section="supportContacts"
          items={plan.supportContacts || []}
          renderItem={(item) => item.name}
        />
        
        <motion.div
          className="card"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="flex items-center gap-2 mb-3">
            <Phone size={18} className="text-red-600" />
            <h3 className="font-semibold text-warm-800">Crisis Lines (Always Available)</h3>
          </div>
          <div className="space-y-2">
            {(plan.professionalContacts || DEFAULT_SAFETY_PLAN.professionalContacts).map((contact, i) => (
              <motion.a
                key={i}
                href={contact.phone.length <= 3 ? `tel:${contact.phone}` : `sms:${contact.phone}`}
                className="flex items-center justify-between bg-red-50 rounded-xl p-3 hover:bg-red-100 transition-colors"
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
              >
                <span className="text-sm font-medium text-red-800">{contact.name}</span>
                <span className="text-sm text-red-600">{contact.phone}</span>
              </motion.a>
            ))}
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
};

// Get Help Button (always visible in header)
const GetHelpButton = ({ onClick }) => (
  <motion.button
    onClick={onClick}
    className="p-2 rounded-full hover:bg-red-50 text-red-500 transition-colors"
    title="Get Help"
    whileHover={{ scale: 1.1 }}
    whileTap={{ scale: 0.9 }}
  >
    <Shield size={20} />
  </motion.button>
);

// Hamburger Menu for header navigation
const HamburgerMenu = ({
  onShowInsights,
  onShowExport,
  onRequestPermission,
  onOpenChat,
  onOpenVoice,
  onLogout,
  notificationPermission
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const menuItems = [
    { icon: BarChart3, label: 'View Patterns', onClick: onShowInsights, color: 'text-warm-600' },
    { icon: FileText, label: 'Export for Therapist', onClick: onShowExport, color: 'text-warm-600' },
    { icon: Bell, label: 'Notifications', onClick: onRequestPermission, color: notificationPermission === 'granted' ? 'text-primary-600' : 'text-warm-400' },
    { icon: MessageCircle, label: 'Text Chat', onClick: onOpenChat, color: 'text-warm-600' },
    { icon: Phone, label: 'Voice Conversation', onClick: onOpenVoice, color: 'text-primary-600' },
    { icon: LogOut, label: 'Sign Out', onClick: onLogout, color: 'text-red-500', hoverBg: 'hover:bg-red-50' },
  ];

  return (
    <div className="relative" ref={menuRef}>
      <motion.button
        onClick={() => setIsOpen(!isOpen)}
        className="p-2 rounded-full hover:bg-warm-100 text-warm-600 transition-colors"
        title="Menu"
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
      >
        <Menu size={20} />
      </motion.button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            className="absolute right-0 top-full mt-2 w-56 bg-white/95 backdrop-blur-sm rounded-2xl shadow-soft-lg border border-warm-100 py-2 z-50 overflow-hidden"
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
          >
            {menuItems.map((item, index) => (
              <motion.button
                key={index}
                onClick={() => {
                  item.onClick();
                  setIsOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-4 py-3 text-sm ${item.color} ${item.hoverBg || 'hover:bg-warm-50'} transition-colors`}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05 }}
                whileHover={{ x: 4 }}
              >
                <item.icon size={18} />
                <span className="font-medium">{item.label}</span>
              </motion.button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const DecompressionScreen = ({ onClose }) => {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t1 = setTimeout(() => setStep(1), 100);
    const t2 = setTimeout(() => setStep(2), 3000); // Breathe In
    const t3 = setTimeout(() => setStep(3), 6000); // Hold
    const t4 = setTimeout(() => setStep(4), 9000); // Breathe Out
    const t5 = setTimeout(() => onClose(), 12000); // Finish
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); clearTimeout(t5); };
  }, [onClose]);

  return (
    <motion.div
      className="fixed inset-0 bg-gradient-to-br from-primary-800 to-primary-900 z-50 flex flex-col items-center justify-center text-white"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="relative mb-8">
        <motion.div
          className="absolute inset-0 bg-primary-400 rounded-full opacity-30 blur-xl"
          animate={{
            scale: step === 2 ? 1.5 : step === 4 ? 0.5 : 1
          }}
          transition={{ duration: 3, ease: "easeInOut" }}
        />
        <motion.div
          animate={{
            scale: step === 2 ? 1.1 : 0.9
          }}
          transition={{ duration: 3, ease: "easeInOut" }}
        >
          <Brain size={64} className="relative z-10" />
        </motion.div>
      </div>
      <motion.h2
        className="text-2xl font-display font-bold mb-2"
        key={step}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        {step <= 1 && "Heavy thoughts captured."}
        {step === 2 && "Breathe in..."}
        {step === 3 && "Hold..."}
        {step === 4 && "Let it go..."}
      </motion.h2>
      <p className="text-primary-300 font-body">Processing your feelings...</p>
    </motion.div>
  );
};

const MarkdownLite = ({ text, variant = 'default' }) => {
  if (!text) return null;
  const isLight = variant === 'light';
  return (
    <div className={`space-y-2 leading-relaxed text-sm font-body ${isLight ? 'text-white' : 'text-warm-800'}`}>
      {safeString(text).split('\n').map((line, i) => {
        const t = line.trim();
        if (!t) return <div key={i} className="h-1" />;
        if (t.startsWith('###')) return <h3 key={i} className={`text-base font-display font-bold mt-3 ${isLight ? 'text-white' : 'text-primary-900'}`}>{t.replace(/###\s*/, '')}</h3>;
        if (t.startsWith('*') || t.startsWith('-')) return (
          <div key={i} className="flex gap-2 ml-1 items-start">
            <span className={`text-[10px] mt-1.5 ${isLight ? 'text-primary-200' : 'text-primary-500'}`}>●</span>
            <p className="flex-1">{t.replace(/^[\*\-]\s*/, '')}</p>
          </div>
        );
        return <p key={i}>{t}</p>;
      })}
    </div>
  );
};

const MoodHeatmap = ({ entries, onDayClick }) => {
  const days = useMemo(() => new Array(30).fill(null).map((_, i) => {
    const d = new Date(); d.setDate(new Date().getDate() - (29 - i)); return d;
  }), []);

  const getDayData = (d) => {
    const dayEntries = entries.filter(e => 
      e.createdAt.getDate() === d.getDate() && 
      e.createdAt.getMonth() === d.getMonth() &&
      e.createdAt.getFullYear() === d.getFullYear()
    );
    const moodEntries = dayEntries.filter(e => e.entry_type !== 'task' && typeof e.analysis?.mood_score === 'number');
    const avgMood = moodEntries.length > 0 
      ? moodEntries.reduce((sum, e) => sum + e.analysis.mood_score, 0) / moodEntries.length 
      : null;
    const moodScores = moodEntries.map(e => e.analysis.mood_score);
    const volatility = moodScores.length > 1 
      ? Math.max(...moodScores) - Math.min(...moodScores) 
      : 0;
    return { entries: dayEntries, avgMood, volatility, hasEntries: dayEntries.length > 0 };
  };

  const getMoodColor = (score) => {
    if (typeof score !== 'number') return '#e5e7eb';
    if (score >= 0.89) return '#15803d';
    if (score >= 0.78) return '#16a34a';
    if (score >= 0.67) return '#22c55e';
    if (score >= 0.56) return '#84cc16';
    if (score >= 0.44) return '#eab308';
    if (score >= 0.33) return '#ea580c';
    if (score >= 0.22) return '#dc2626';
    if (score >= 0.11) return '#991b1b';
    return '#7f1d1d';
  };

  return (
    <motion.div
      className="card mb-6"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="flex items-center gap-2 mb-3 text-warm-700 font-semibold text-xs uppercase tracking-wide">
        <Activity size={14} className="text-primary-600" /> Mood (30 Days)
      </div>
      <div className="flex justify-between items-end gap-1">
        {days.map((d, i) => {
          const dayData = getDayData(d);
          const { avgMood, hasEntries } = dayData;
          return (
            <motion.button
              key={i}
              className={`flex-1 rounded-lg transition-all ${hasEntries ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
              style={{
                backgroundColor: getMoodColor(avgMood),
                height: avgMood !== null ? `${Math.max(20, avgMood * 60)}px` : '20px',
                minWidth: '8px'
              }}
              title={`${d.toLocaleDateString()}${hasEntries ? `: ${dayData.entries.length} entries${avgMood !== null ? ` - ${(avgMood * 100).toFixed(0)}%` : ''}` : ': No entry'}`}
              onClick={() => hasEntries && onDayClick && onDayClick(d, dayData)}
              disabled={!hasEntries}
              whileHover={hasEntries ? { scale: 1.1, y: -2 } : {}}
              whileTap={hasEntries ? { scale: 0.95 } : {}}
            />
          );
        })}
      </div>
      <div className="mt-3 flex justify-between items-center text-xs text-warm-500">
        <span>Low</span>
        <span className="text-warm-600 font-medium">Mood Scale</span>
        <span>High</span>
      </div>
    </motion.div>
  );
};

const DailySummaryModal = ({ date, dayData, onClose, onDelete, onUpdate }) => {
  const [synthesis, setSynthesis] = useState(null);
  const [loadingSynthesis, setLoadingSynthesis] = useState(true);
  
  useEffect(() => {
    const loadSynthesis = async () => {
      if (dayData.entries.length > 0) {
        const result = await generateDailySynthesis(dayData.entries);
        setSynthesis(result);
      }
      setLoadingSynthesis(false);
    };
    loadSynthesis();
  }, [dayData.entries]);
  
  const sortedEntries = [...dayData.entries].sort((a, b) => a.createdAt - b.createdAt);
  const getMoodEmoji = (score) => {
    if (score === null || score === undefined) return '';
    if (score >= 0.75) return '😊';
    if (score >= 0.55) return '🙂';
    if (score >= 0.35) return '😐';
    if (score >= 0.15) return '😟';
    return '😢';
  };
  
  return (
    <AnimatePresence>
      <motion.div
        className="modal-backdrop flex items-center justify-center p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.div
          className="bg-white rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-soft-xl"
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
        >
          <div className="p-6 border-b border-warm-100">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-xl font-display font-bold text-warm-800">{date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
                <p className="text-sm text-warm-500">{dayData.entries.length} entries {dayData.volatility > 0.3 && <span className="text-accent">(high mood volatility)</span>}</p>
              </div>
              <motion.button
                onClick={onClose}
                className="text-warm-400 hover:text-warm-600 transition-colors"
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
              >
                <X size={24} />
              </motion.button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {loadingSynthesis ? (
              <motion.div
                className="bg-primary-50 p-4 rounded-2xl border border-primary-100 flex items-center gap-3"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
              >
                <Loader2 size={18} className="animate-spin text-primary-500" />
                <span className="text-sm text-primary-700">Generating daily summary...</span>
              </motion.div>
            ) : synthesis && (
              <motion.div
                className="bg-primary-50 p-4 rounded-2xl border border-primary-100"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <div className="flex items-center gap-2 text-primary-700 font-semibold text-xs uppercase mb-2">
                  <Sparkles size={14} /> Daily Summary
                </div>
                <p className="text-sm text-primary-900 leading-relaxed font-body">
                  {typeof synthesis === 'string' ? synthesis : synthesis.summary}
                </p>
                {synthesis.bullets && synthesis.bullets.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-primary-200">
                    <p className="text-xs font-semibold text-primary-800 mb-2 uppercase tracking-wide">
                      Key mood drivers
                    </p>
                    <ul className="list-disc list-inside space-y-1 text-sm text-primary-900/90">
                      {synthesis.bullets.map((bullet, idx) => (
                        <li key={idx}>{bullet}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </motion.div>
            )}

            {sortedEntries.map((entry, index) => (
              <motion.div
                key={entry.id}
                className="border border-warm-100 rounded-2xl p-4 hover:shadow-soft transition-all"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
              >
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-warm-400">{entry.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    {entry.entry_type && entry.entry_type !== 'reflection' && (
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                        entry.entry_type === 'task' ? 'bg-yellow-100 text-yellow-700' :
                        entry.entry_type === 'mixed' ? 'bg-primary-100 text-primary-700' :
                        entry.entry_type === 'vent' ? 'bg-secondary-100 text-secondary-700' : 'bg-warm-100 text-warm-600'
                      }`}>{entry.entry_type}</span>
                    )}
                    {typeof entry.analysis?.mood_score === 'number' && (
                      <span className="text-lg">{getMoodEmoji(entry.analysis.mood_score)}</span>
                    )}
                  </div>
                  <motion.button
                    onClick={() => onDelete(entry.id)}
                    className="text-warm-300 hover:text-red-400 transition-colors"
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                  >
                    <Trash2 size={14} />
                  </motion.button>
                </div>
                <h4 className="font-semibold text-warm-800 mb-1">{entry.title}</h4>
                <p className="text-sm text-warm-600 line-clamp-3 font-body">{entry.text}</p>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

const TherapistExportScreen = ({ entries, onClose }) => {
  const [selectedEntries, setSelectedEntries] = useState(new Set());
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [exporting, setExporting] = useState(false);
  const [exportFormat, setExportFormat] = useState('pdf');
  
  const filteredEntries = useMemo(() => {
    let filtered = entries.filter(e => e.entry_type !== 'task');
    if (dateRange.start) {
      const startDate = new Date(dateRange.start);
      filtered = filtered.filter(e => e.createdAt >= startDate);
    }
    if (dateRange.end) {
      const endDate = new Date(dateRange.end);
      endDate.setHours(23, 59, 59);
      filtered = filtered.filter(e => e.createdAt <= endDate);
    }
    return filtered.sort((a, b) => a.createdAt - b.createdAt);
  }, [entries, dateRange]);
  
  const toggleEntry = (id) => {
    const newSelected = new Set(selectedEntries);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedEntries(newSelected);
  };
  
  const selectAll = () => {
    setSelectedEntries(new Set(filteredEntries.map(e => e.id)));
  };
  
  const selectNone = () => {
    setSelectedEntries(new Set());
  };
  
  const getMoodEmoji = (score) => {
    if (score === null || score === undefined) return '';
    if (score >= 0.75) return '😊';
    if (score >= 0.55) return '🙂';
    if (score >= 0.35) return '😐';
    if (score >= 0.15) return '😟';
    return '😢';
  };
  
  const generatePDF = async () => {
    setExporting(true);
    try {
      const jsPDF = await loadJsPDF();
      const doc = new jsPDF();
      
      const selectedList = filteredEntries.filter(e => selectedEntries.has(e.id));
      const moodScores = selectedList.filter(e => typeof e.analysis?.mood_score === 'number').map(e => e.analysis.mood_score);
      const avgMood = moodScores.length > 0 ? moodScores.reduce((a, b) => a + b, 0) / moodScores.length : null;
      
      doc.setFontSize(20);
      doc.text('EchoVault Journal Export', 20, 20);
      
      doc.setFontSize(10);
      doc.text(`Generated: ${new Date().toLocaleDateString()}`, 20, 30);
      doc.text(`Entries: ${selectedList.length}`, 20, 36);
      if (avgMood !== null) {
        doc.text(`Average Mood: ${(avgMood * 100).toFixed(0)}%`, 20, 42);
      }
      
      let yPos = 55;
      const pageHeight = 280;
      const margin = 20;
      
      selectedList.forEach((entry, index) => {
        if (yPos > pageHeight - 40) {
          doc.addPage();
          yPos = 20;
        }
        
        doc.setFontSize(12);
        doc.setFont(undefined, 'bold');
        doc.text(`${entry.createdAt.toLocaleDateString()} - ${entry.title}`, margin, yPos);
        yPos += 6;
        
        if (typeof entry.analysis?.mood_score === 'number') {
          doc.setFontSize(9);
          doc.setFont(undefined, 'normal');
          doc.text(`Mood: ${(entry.analysis.mood_score * 100).toFixed(0)}%`, margin, yPos);
          yPos += 5;
        }
        
        doc.setFontSize(10);
        doc.setFont(undefined, 'normal');
        const textLines = doc.splitTextToSize(entry.text, 170);
        textLines.forEach(line => {
          if (yPos > pageHeight - 10) {
            doc.addPage();
            yPos = 20;
          }
          doc.text(line, margin, yPos);
          yPos += 5;
        });
        
        if (entry.analysis?.cbt_breakdown) {
          const cbt = entry.analysis.cbt_breakdown;
          yPos += 3;
          doc.setFontSize(9);
          doc.setFont(undefined, 'italic');
          
          if (cbt.automatic_thought) {
            if (yPos > pageHeight - 20) { doc.addPage(); yPos = 20; }
            doc.text(`Thought: ${cbt.automatic_thought}`, margin + 5, yPos);
            yPos += 4;
          }
          if (cbt.distortion) {
            if (yPos > pageHeight - 20) { doc.addPage(); yPos = 20; }
            doc.text(`Distortion: ${cbt.distortion}`, margin + 5, yPos);
            yPos += 4;
          }
          if (cbt.suggested_reframe || cbt.challenge) {
            if (yPos > pageHeight - 20) { doc.addPage(); yPos = 20; }
            doc.text(`Reframe: ${cbt.suggested_reframe || cbt.challenge}`, margin + 5, yPos);
            yPos += 4;
          }
        }
        
        yPos += 8;
      });
      
      doc.save('echovault-export.pdf');
    } catch (e) {
      console.error('PDF generation failed:', e);
      alert('PDF generation failed. Falling back to JSON export.');
      generateJSON();
    }
    setExporting(false);
  };
  
  const generateJSON = () => {
    const selectedList = filteredEntries.filter(e => selectedEntries.has(e.id));
    const exportData = {
      exportDate: new Date().toISOString(),
      entryCount: selectedList.length,
      entries: selectedList.map(e => ({
        date: e.createdAt.toISOString(),
        title: e.title,
        text: e.text,
        mood_score: e.analysis?.mood_score,
        entry_type: e.entry_type,
        tags: e.tags,
        cbt_breakdown: e.analysis?.cbt_breakdown
      }))
    };
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'echovault-export.json';
    a.click();
    URL.revokeObjectURL(url);
  };
  
  const handleExport = () => {
    if (selectedEntries.size === 0) {
      alert('Please select at least one entry to export.');
      return;
    }
    if (exportFormat === 'pdf') {
      generatePDF();
    } else {
      generateJSON();
    }
  };
  
  return (
    <AnimatePresence>
      <motion.div
        className="modal-backdrop flex items-center justify-center p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.div
          className="bg-white rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-soft-xl"
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
        >
          <div className="p-6 border-b border-warm-100 bg-gradient-to-r from-primary-600 to-secondary-600 text-white">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-xl font-display font-bold flex items-center gap-2"><FileText size={20} /> Export for Therapist</h2>
                <p className="text-sm opacity-80 mt-1 font-body">Select entries to include in your export</p>
              </div>
              <motion.button
                onClick={onClose}
                className="text-white/80 hover:text-white"
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
              >
                <X size={24} />
              </motion.button>
            </div>
          </div>

          <div className="p-4 border-b border-warm-100 bg-warm-50">
            <div className="flex flex-wrap gap-4 items-end">
              <div>
                <label className="text-xs font-semibold text-warm-500 uppercase block mb-1">From</label>
                <input
                  type="date"
                  value={dateRange.start}
                  onChange={e => setDateRange(prev => ({ ...prev, start: e.target.value }))}
                  className="input text-sm py-2"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-warm-500 uppercase block mb-1">To</label>
                <input
                  type="date"
                  value={dateRange.end}
                  onChange={e => setDateRange(prev => ({ ...prev, end: e.target.value }))}
                  className="input text-sm py-2"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-warm-500 uppercase block mb-1">Format</label>
                <select
                  value={exportFormat}
                  onChange={e => setExportFormat(e.target.value)}
                  className="input text-sm py-2"
                >
                  <option value="pdf">PDF</option>
                  <option value="json">JSON</option>
                </select>
              </div>
              <div className="flex gap-2">
                <button onClick={selectAll} className="text-xs text-primary-600 hover:underline font-medium">Select All</button>
                <button onClick={selectNone} className="text-xs text-warm-500 hover:underline">Clear</button>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            <p className="text-xs text-warm-500 mb-3">{selectedEntries.size} of {filteredEntries.length} entries selected</p>
            <div className="space-y-2">
              {filteredEntries.map((entry, index) => (
                <motion.div
                  key={entry.id}
                  onClick={() => toggleEntry(entry.id)}
                  className={`p-3 rounded-2xl border-2 cursor-pointer transition-all ${
                    selectedEntries.has(entry.id)
                      ? 'border-primary-500 bg-primary-50'
                      : 'border-warm-200 hover:border-warm-300'
                  }`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.02 }}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-5 h-5 rounded-lg border-2 flex items-center justify-center mt-0.5 transition-colors ${
                      selectedEntries.has(entry.id) ? 'bg-primary-600 border-primary-600' : 'border-warm-300'
                    }`}>
                      {selectedEntries.has(entry.id) && <Check size={14} className="text-white" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs text-warm-400">{entry.createdAt.toLocaleDateString()}</span>
                        {typeof entry.analysis?.mood_score === 'number' && (
                          <span className="text-sm">{getMoodEmoji(entry.analysis.mood_score)}</span>
                        )}
                      </div>
                      <h4 className="font-medium text-warm-800 truncate">{entry.title}</h4>
                      <p className="text-sm text-warm-500 line-clamp-2 font-body">{entry.text}</p>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>

          <div className="p-4 border-t border-warm-100 bg-warm-50">
            <Button
              variant="primary"
              className="w-full"
              onClick={handleExport}
              disabled={exporting || selectedEntries.size === 0}
              loading={exporting}
            >
              {exporting ? 'Generating...' : `Export ${selectedEntries.size} Entries`}
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

const InsightsPanel = ({ entries, onClose }) => {
  const patterns = useMemo(() => analyzeLongitudinalPatterns(entries), [entries]);

  const getPatternIcon = (type) => {
    switch (type) {
      case 'weekly_low': return <TrendingDown size={16} className="text-accent" />;
      case 'weekly_high': return <TrendingUp size={16} className="text-mood-great" />;
      case 'trigger_correlation': return <AlertTriangle size={16} className="text-amber-500" />;
      case 'recovery_pattern': return <Heart size={16} className="text-secondary-500" />;
      case 'monthly_summary': return <Calendar size={16} className="text-primary-500" />;
      default: return <Sparkles size={16} className="text-secondary-600" />;
    }
  };

  const getPatternColor = (type) => {
    switch (type) {
      case 'weekly_low': return 'bg-accent-light border-accent';
      case 'weekly_high': return 'bg-mood-great/10 border-mood-great/30';
      case 'trigger_correlation': return 'bg-amber-50 border-amber-200';
      case 'recovery_pattern': return 'bg-secondary-50 border-secondary-200';
      case 'monthly_summary': return 'bg-primary-50 border-primary-200';
      default: return 'bg-secondary-50 border-secondary-200';
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        className="modal-backdrop flex items-center justify-center p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.div
          className="bg-white rounded-3xl max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col shadow-soft-xl"
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
        >
          <div className="p-6 border-b border-warm-100 bg-gradient-to-r from-secondary-600 to-primary-600 text-white">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-xl font-display font-bold flex items-center gap-2"><BarChart3 size={20} /> Your Patterns</h2>
                <p className="text-sm opacity-80 mt-1 font-body">Insights from your journal entries</p>
              </div>
              <motion.button
                onClick={onClose}
                className="text-white/80 hover:text-white"
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
              >
                <X size={24} />
              </motion.button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {patterns.length === 0 ? (
              <motion.div
                className="text-center py-12"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <div className="h-20 w-20 bg-warm-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <BarChart3 size={32} className="text-warm-400" />
                </div>
                <h3 className="text-lg font-display font-medium text-warm-800">Not enough data yet</h3>
                <p className="text-sm text-warm-500 mt-2 font-body">Keep journaling! Patterns will appear after you have at least 7 entries with mood data.</p>
              </motion.div>
            ) : (
              <div className="space-y-3">
                {patterns.map((pattern, i) => (
                  <motion.div
                    key={i}
                    className={`p-4 rounded-2xl border ${getPatternColor(pattern.type)}`}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.1 }}
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5">{getPatternIcon(pattern.type)}</div>
                      <div>
                        <p className="text-sm font-medium text-warm-800">{pattern.message}</p>
                        {pattern.type === 'trigger_correlation' && (
                          <p className="text-xs text-warm-500 mt-1">Based on {Math.round(pattern.percentDiff)}% mood difference</p>
                        )}
                        {pattern.type === 'recovery_pattern' && (
                          <p className="text-xs text-warm-500 mt-1">Based on {pattern.samples} recovery instances</p>
                        )}
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>

          <div className="p-4 border-t border-warm-100 bg-warm-50">
            <p className="text-xs text-warm-500 text-center font-body">Patterns are calculated from your recent entries and update automatically</p>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

const EntryCard = ({ entry, onDelete, onUpdate }) => {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(entry.title);
  const isPending = entry.analysisStatus === 'pending';
  const entryType = entry.entry_type || 'reflection';
  const isTask = entryType === 'task';
  const isMixed = entryType === 'mixed';
  const isVent = entryType === 'vent';

  useEffect(() => { setTitle(entry.title); }, [entry.title]);

  const insightMsg = entry.contextualInsight?.message ? safeString(entry.contextualInsight.message) : null;
  const cbt = entry.analysis?.cbt_breakdown;
  const ventSupport = entry.analysis?.vent_support;
  const celebration = entry.analysis?.celebration;
  const taskAcknowledgment = entry.analysis?.task_acknowledgment;

  const toggleCategory = () => {
    const newCategory = entry.category === 'work' ? 'personal' : 'work';
    onUpdate(entry.id, { category: newCategory });
  };

  // Mood-based accent color for entry cards
  const getMoodAccent = () => {
    const score = entry.analysis?.mood_score;
    if (typeof score !== 'number') return 'border-l-warm-300';
    if (score >= 0.75) return 'border-l-mood-great';
    if (score >= 0.55) return 'border-l-mood-good';
    if (score >= 0.35) return 'border-l-mood-neutral';
    if (score >= 0.15) return 'border-l-mood-low';
    return 'border-l-mood-struggling';
  };

  const cardStyle = isTask
    ? 'bg-yellow-50/80 border-yellow-200'
    : 'bg-white border-warm-100';

  return (
    <motion.div
      className={`entry-card ${getMoodAccent()} ${cardStyle}`}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.2 }}
    >
      {isPending && (
        <div className="absolute top-0 left-0 right-0 h-1 bg-warm-100 overflow-hidden rounded-t-2xl">
          <motion.div
            className="h-full bg-primary-500"
            animate={{ x: ['-100%', '100%'] }}
            transition={{ repeat: Infinity, duration: 1.5, ease: 'easeInOut' }}
          />
        </div>
      )}

      {/* Insight Box - now includes validation when both exist */}
      {entry.contextualInsight?.found && insightMsg && !isTask && (() => {
        const insightType = entry.contextualInsight.type;
        const isPositive = ['progress', 'streak', 'absence', 'encouragement'].includes(insightType);
        const isWarning = insightType === 'warning';
        const colorClass = isWarning
          ? 'bg-red-50 border-red-100 text-red-800'
          : isPositive
            ? 'bg-mood-great/10 border-mood-great/30 text-mood-great'
            : 'bg-primary-50 border-primary-100 text-primary-800';
        return (
          <motion.div
            className={`mb-4 p-3 rounded-xl text-sm border flex gap-3 ${colorClass}`}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
          >
            <Lightbulb size={18} className="shrink-0 mt-0.5"/>
            <div>
              <div className="font-bold text-[10px] uppercase opacity-75 tracking-wider mb-1">{safeString(insightType)}</div>
              {insightMsg}
              {cbt?.validation && (
                <p className="mt-2 text-warm-600 italic border-t border-warm-200 pt-2">{cbt.validation}</p>
              )}
            </div>
          </motion.div>
        );
      })()}

      {/* Vent Support Display */}
      {isVent && ventSupport && (
        <div className="mb-4 space-y-3">
          {ventSupport.validation && (
            <p className="text-warm-500 italic text-sm font-body">{ventSupport.validation}</p>
          )}
          {ventSupport.cooldown && (
            <motion.div
              className="bg-secondary-50 p-3 rounded-xl border border-secondary-100"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <div className="flex items-center gap-2 text-secondary-700 font-semibold text-xs uppercase mb-2">
                <Wind size={14} /> {ventSupport.cooldown.technique || 'Grounding'}
              </div>
              <p className="text-sm text-secondary-800 font-body">{ventSupport.cooldown.instruction}</p>
            </motion.div>
          )}
        </div>
      )}

      {/* Celebration Display - for positive/win entries */}
      {entry.analysis?.framework === 'celebration' && celebration && (
        <div className="mb-4 space-y-3">
          {celebration.affirmation && (
            <motion.div
              className="bg-gradient-to-r from-mood-great/10 to-primary-50 p-3 rounded-xl border border-mood-great/20"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
            >
              <div className="flex items-center gap-2 text-mood-great font-semibold text-xs uppercase mb-2">
                <Sparkles size={14} /> Nice!
              </div>
              <p className="text-sm text-warm-800 font-body">{celebration.affirmation}</p>
              {celebration.amplify && (
                <p className="text-xs text-primary-600 mt-2 italic">{celebration.amplify}</p>
              )}
            </motion.div>
          )}
        </div>
      )}

      {/* Task Acknowledgment - for mixed entries with emotional weight */}
      {isMixed && taskAcknowledgment && (
        <p className="text-warm-500 italic text-sm mb-4 font-body">{taskAcknowledgment}</p>
      )}

      {/* Enhanced CBT Breakdown with Visual Hierarchy */}
      {entry.analysis?.framework === 'cbt' && cbt && (
        <div className="mb-4 space-y-3">
          {/* Validation - italicized gray, appears first (only if no insight to fold into) */}
          {cbt.validation && !entry.contextualInsight?.found && (
            <p className="text-warm-500 italic text-sm font-body">{cbt.validation}</p>
          )}

          {/* Distortion Badge - only show if mood < 0.4 OR serious distortion type */}
          {cbt.distortion && (
            entry.analysis?.mood_score < 0.4 ||
            ['Catastrophizing', 'All-or-Nothing Thinking', 'All-or-Nothing', 'Mind Reading', 'Fortune Telling', 'Emotional Reasoning'].some(d =>
              cbt.distortion?.toLowerCase().includes(d.toLowerCase())
            )
          ) && (
            <div className="flex items-center gap-2">
              <span className="bg-accent-light text-accent-dark px-2 py-1 rounded-full text-xs font-semibold flex items-center gap-1">
                <Info size={12} />
                {cbt.distortion}
              </span>
            </div>
          )}

          {/* Automatic Thought */}
          {cbt.automatic_thought && (
            <div className="text-sm text-warm-700 font-body">
              <span className="font-semibold">Thought:</span> {cbt.automatic_thought}
            </div>
          )}

          {/* NEW: Combined Perspective card (question + reframe) */}
          {cbt.perspective && (
            <motion.div
              className="bg-gradient-to-r from-primary-50 to-mood-great/10 p-3 rounded-xl border-l-4 border-primary-400"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <div className="text-xs font-semibold text-primary-600 uppercase mb-1">💭 Perspective</div>
              <p className="text-sm text-warm-700 font-body">{cbt.perspective}</p>
            </motion.div>
          )}

          {/* LEGACY: Socratic Question - for backwards compatibility with old entries */}
          {!cbt.perspective && cbt.socratic_question && (
            <div className="bg-primary-50 p-3 rounded-xl border-l-4 border-primary-400">
              <div className="text-xs font-semibold text-primary-600 uppercase mb-1">Reflect:</div>
              <p className="text-sm text-primary-800 font-body">{cbt.socratic_question}</p>
            </div>
          )}

          {/* LEGACY: Cognitive Reframe - for backwards compatibility with old entries */}
          {!cbt.perspective && (cbt.suggested_reframe || cbt.challenge) && (
            <div className="text-sm font-body">
              <span className="text-mood-great font-semibold">Try thinking:</span>{' '}
              <span className="text-warm-800">{cbt.suggested_reframe || cbt.challenge}</span>
            </div>
          )}

          {/* Behavioral Activation - action card */}
          {cbt.behavioral_activation && (
            <motion.div
              className="bg-secondary-50 p-3 rounded-xl border border-secondary-100"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <div className="flex items-center gap-2 text-secondary-700 font-semibold text-xs uppercase mb-2">
                <Footprints size={14} /> Try This (Under 5 min)
              </div>
              <p className="text-sm text-secondary-800 font-medium">{cbt.behavioral_activation.activity}</p>
              {cbt.behavioral_activation.rationale && (
                <p className="text-xs text-secondary-600 mt-1">{cbt.behavioral_activation.rationale}</p>
              )}
            </motion.div>
          )}
        </div>
      )}

      {/* Legacy CBT Breakdown (for backwards compatibility) */}
      {entry.analysis?.framework === 'cbt' && cbt && !cbt.validation && !cbt.socratic_question && cbt.challenge && !cbt.suggested_reframe && (
        <div className="mb-4 bg-primary-50 p-3 rounded-xl border border-primary-100 text-sm space-y-2">
          <div className="flex items-center gap-2 text-primary-700 font-bold text-xs uppercase"><Brain size={12}/> Cognitive Restructuring</div>
          <div className="grid gap-2">
            <div><span className="font-semibold text-primary-900">Thought:</span> {cbt.automatic_thought}</div>
            <div className="bg-white p-2 rounded-lg border border-primary-100"><span className="font-semibold text-mood-great">Challenge:</span> {cbt.challenge}</div>
          </div>
        </div>
      )}

      <div className="flex justify-between items-start mb-3">
        <div className="flex gap-2 flex-wrap items-center">
          <motion.button
            onClick={toggleCategory}
            className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide hover:opacity-80 transition-opacity flex items-center gap-1 ${entry.category === 'work' ? 'bg-warm-100 text-warm-600' : 'bg-accent-light text-accent-dark'}`}
            title="Click to switch category"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            {entry.category}
            <RefreshCw size={8} className="opacity-50" />
          </motion.button>
          {/* Entry Type Badge */}
          {entryType !== 'reflection' && (
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide flex items-center gap-1 ${
              isTask ? 'bg-yellow-100 text-yellow-700' :
              isMixed ? 'bg-primary-100 text-primary-700' :
              isVent ? 'bg-secondary-100 text-secondary-700' : 'bg-warm-100 text-warm-600'
            }`}>
              {isMixed && <Clipboard size={10} />}
              {entryType}
            </span>
          )}
          {entry.tags.map((t, i) => {
            const tag = safeString(t);
            // Different styling for structured tags
            if (tag.startsWith('@person:')) {
              return <span key={i} className="text-[10px] font-semibold text-primary-600 bg-primary-50 px-2 py-0.5 rounded-full">{tag.replace('@person:', '👤 ')}</span>;
            } else if (tag.startsWith('@place:')) {
              return <span key={i} className="text-[10px] font-semibold text-mood-great bg-mood-great/10 px-2 py-0.5 rounded-full">{tag.replace('@place:', '📍 ')}</span>;
            } else if (tag.startsWith('@goal:')) {
              return <span key={i} className="text-[10px] font-semibold text-accent-dark bg-accent-light px-2 py-0.5 rounded-full">{tag.replace('@goal:', '🎯 ')}</span>;
            } else if (tag.startsWith('@situation:')) {
              return <span key={i} className="text-[10px] font-semibold text-secondary-600 bg-secondary-50 px-2 py-0.5 rounded-full">{tag.replace('@situation:', '📌 ')}</span>;
            } else if (tag.startsWith('@self:')) {
              return <span key={i} className="text-[10px] font-semibold text-secondary-700 bg-secondary-100 px-2 py-0.5 rounded-full">{tag.replace('@self:', '💭 ')}</span>;
            }
            // Regular topic tags
            return <span key={i} className="text-[10px] font-semibold text-primary-600 bg-primary-50 px-2 py-0.5 rounded-full">#{tag}</span>;
          })}
        </div>
        <div className="flex items-center gap-2">
          {typeof entry.analysis?.mood_score === 'number' && entry.analysis.mood_score !== null && (
            <span className="px-2 py-1 rounded-full text-[10px] font-bold bg-warm-100 text-warm-700">{(entry.analysis.mood_score * 100).toFixed(0)}%</span>
          )}
          <motion.button
            onClick={() => onDelete(entry.id)}
            className="text-warm-300 hover:text-red-400 transition-colors"
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
          >
            <Trash2 size={16}/>
          </motion.button>
        </div>
      </div>

      <div className="mb-2 flex items-center gap-2">
        {editing ? (
          <div className="flex-1 flex gap-2">
            <input value={title} onChange={e => setTitle(e.target.value)} className="flex-1 font-display font-bold text-lg border-b-2 border-primary-500 focus:outline-none bg-transparent" autoFocus />
            <motion.button
              onClick={() => { onUpdate(entry.id, { title }); setEditing(false); }}
              className="text-mood-great"
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
            >
              <Check size={18}/>
            </motion.button>
          </div>
        ) : (
          <>
            <h3 className={`text-lg font-display font-bold text-warm-800 ${isPending ? 'animate-pulse' : ''}`}>{isPending ? "Processing..." : title}</h3>
            {!isPending && (
              <motion.button
                onClick={() => setEditing(true)}
                className="text-warm-300 hover:text-primary-500 opacity-50 hover:opacity-100"
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
              >
                <Edit2 size={14}/>
              </motion.button>
            )}
          </>
        )}
      </div>

      <div className="text-xs text-warm-400 mb-4 flex items-center gap-1 font-medium"><Calendar size={12}/> {entry.createdAt.toLocaleDateString()}</div>
      <p className="text-warm-600 text-sm whitespace-pre-wrap leading-relaxed font-body">{entry.text}</p>

      {/* Extracted Tasks for mixed entries */}
      {isMixed && entry.extracted_tasks && entry.extracted_tasks.length > 0 && (
        <div className="mt-4 pt-3 border-t border-warm-100">
          <div className="text-xs font-semibold text-warm-500 uppercase mb-2 flex items-center gap-1">
            <Clipboard size={12} /> Tasks
          </div>
          <div className="space-y-1">
            {entry.extracted_tasks.map((task, i) => (
              <motion.div
                key={i}
                className="flex items-center gap-2 text-sm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.05 }}
              >
                <input
                  type="checkbox"
                  checked={task.completed}
                  onChange={() => {
                    const updatedTasks = [...entry.extracted_tasks];
                    updatedTasks[i] = { ...task, completed: !task.completed };
                    onUpdate(entry.id, { extracted_tasks: updatedTasks });
                  }}
                  className="rounded border-warm-300 text-primary-600 focus:ring-primary-500"
                />
                <span className={task.completed ? 'line-through text-warm-400' : 'text-warm-700'}>{task.text}</span>
              </motion.div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
};

const Chat = ({ entries, onClose, category }) => {
  const [msgs, setMsgs] = useState([{ role: 'sys', text: `I'm your ${category} journal assistant. Ask me anything about your entries!` }]);
  const [txt, setTxt] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceInput, setVoiceInput] = useState(false);
  const [conversationMode, setConversationMode] = useState(false);
  const [conversationHistory, setConversationHistory] = useState([]); // For memory
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
            <span className="font-bold text-lg">Journal Assistant ({category})</span>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-indigo-700 rounded-full"><X size={24}/></button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
        {msgs.map((m, i) => (
          <div key={i} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
            <div className={`max-w-[85%] p-4 rounded-2xl text-sm shadow-sm ${m.role === 'user' ? 'bg-indigo-600 text-white rounded-br-none' : 'bg-white text-gray-800 border border-gray-200 rounded-bl-none'}`}>
              <MarkdownLite text={m.text} variant={m.role === 'user' ? 'light' : 'default'} />
              {m.role === 'ai' && m.sources && (
                <div className="mt-2 pt-2 border-t border-gray-200 text-xs text-gray-500 flex items-center gap-1">
                  <Database size={12} /> Based on {m.sources} relevant journal {m.sources === 1 ? 'entry' : 'entries'}
                </div>
              )}
            </div>
            {m.role === 'ai' && (
              <button onClick={() => speak(m.text)} className="mt-1 text-gray-400 hover:text-indigo-600 p-1">
                {isSpeaking ? <StopCircle size={16} /> : <Volume2 size={16} />}
              </button>
            )}
          </div>
        ))}
        {loading && <div className="text-xs text-gray-400 p-2 text-center animate-pulse">Searching your journal...</div>}
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

// --- REALTIME CONVERSATION COMPONENT ---
// True voice-to-voice conversation using OpenAI Realtime API
const RealtimeConversation = ({ entries, onClose, category }) => {
  const [status, setStatus] = useState('disconnected'); // disconnected, connecting, connected, speaking, listening
  const [transcript, setTranscript] = useState([]);
  const [error, setError] = useState(null);
  const [conversationTheme, setConversationTheme] = useState(null); // null, 'goals', 'feelings', 'gratitude', 'reflection'

  const wsRef = useRef(null);
  const audioContextRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const audioQueueRef = useRef([]);
  const isPlayingRef = useRef(false);

  // Build context from journal entries
  const getJournalContext = useCallback(() => {
    const recentEntries = entries.slice(0, 10)
      .map(e => `[${e.createdAt.toLocaleDateString()}] ${e.title || 'Entry'}: ${e.text.substring(0, 200)}`)
      .join('\n');
    return recentEntries;
  }, [entries]);

  // Get theme-specific prompts
  const getThemePrompt = () => {
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
  };

  // Proactive conversation starters based on journal patterns
  const getConversationStarter = useCallback(() => {
    // Guided session has a specific starter
    if (conversationTheme === 'guided') {
      return "Welcome to your guided journaling session! Let's take a few minutes to check in with yourself. To start, on a scale of 1 to 10, how are you feeling right now? And what's contributing to that number?";
    }

    // Theme-specific starters
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
      // Connect to OpenAI Realtime API via WebSocket
      const ws = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17', [
        'realtime',
        `openai-insecure-api-key.${OPENAI_API_KEY}`,
        'openai-beta.realtime-v1'
      ]);

      ws.onopen = () => {
        console.log('Realtime WebSocket connected');
        setStatus('connected');

        // Configure the session
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

        // Send initial greeting after a short delay
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

const WeeklyReport = ({ text, onClose }) => (
  <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
    <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl relative max-h-[80vh] overflow-y-auto flex flex-col">
      <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"><X size={20}/></button>
      <h2 className="font-bold text-xl mb-4 text-indigo-600 flex gap-2 items-center"><Lightbulb size={24}/> Weekly Synthesis</h2>
      <div className="flex-1 overflow-y-auto"><MarkdownLite text={text} /></div>
    </div>
  </div>
);

const PromptScreen = ({ prompts, mode, onModeChange, onSave, onClose, loading, category, onRefreshPrompts }) => {
  const [textValue, setTextValue] = useState('');
  const [recording, setRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [displayPrompts, setDisplayPrompts] = useState(prompts);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    setDisplayPrompts(prompts);
  }, [prompts]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);
  
  const handleRefresh = () => {
    setIsRefreshing(true);
    const result = getPromptsForSession(category, []);
    setDisplayPrompts(result.prompts);
    if (onRefreshPrompts) onRefreshPrompts(result.prompts);
    setTimeout(() => setIsRefreshing(false), 300);
  };

  const startRecording = async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("Microphone access not available");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
      const recorder = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 128000 });
      const chunks = [];

      recorder.ondataavailable = e => chunks.push(e.data);
      recorder.onstop = () => {
        const reader = new FileReader();
        reader.readAsDataURL(new Blob(chunks, { type: mime }));
        reader.onloadend = () => onSave(reader.result.split(',')[1], mime);
        stream.getTracks().forEach(t => t.stop());
      };

      recorder.start();
      setMediaRecorder(recorder);
      setRecording(true);
      setRecordSeconds(0);
      timerRef.current = setInterval(() => setRecordSeconds(s => s + 1), 1000);
    } catch (e) {
      alert("Microphone access denied");
      console.error(e);
    }
  };

  const stopRecording = () => {
    if (mediaRecorder) {
      mediaRecorder.stop();
      setRecording(false);
      clearInterval(timerRef.current);
    }
  };

  return (
    <div className="fixed inset-0 bg-white z-40 flex flex-col pt-[env(safe-area-inset-top)] animate-in slide-in-from-bottom-10 duration-200">
      <div className="p-4 border-b flex justify-between items-center bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-md">
        <h2 className="font-bold text-lg flex gap-2 items-center"><MessageCircle size={20}/> New Entry</h2>
        <button onClick={onClose} className="p-1 hover:bg-white/20 rounded-full"><X size={24}/></button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 bg-gray-50">
        {displayPrompts.length > 0 && (
          <div className="mb-4">
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide flex items-center gap-2">
                <Sparkles size={12}/> Reflect on these
              </h3>
              <button 
                onClick={handleRefresh}
                className={`text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1 transition-transform ${isRefreshing ? 'animate-spin' : ''}`}
                title="Get new prompts"
              >
                <RefreshCw size={14} />
                Refresh
              </button>
            </div>
            <div className={`bg-white rounded-xl p-4 border border-gray-200 shadow-sm transition-opacity ${isRefreshing ? 'opacity-50' : ''}`}>
              <div className="space-y-2">
                {displayPrompts.map((prompt, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="text-indigo-500 text-xs mt-0.5">•</span>
                    <p className="text-sm text-gray-700 italic">"{prompt}"</p>
                  </div>
                ))}
              </div>
            </div>
            <button
              onClick={() => onModeChange('skip')}
              className="mt-2 text-xs text-gray-400 hover:text-gray-600"
            >
              Skip prompts and write freely
            </button>
          </div>
        )}

        {!mode && (
          <div className="mb-4">
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Choose input method</h3>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => onModeChange('voice')}
                className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white p-6 rounded-xl shadow-lg hover:shadow-xl transition-all flex flex-col items-center gap-2"
              >
                <Mic size={28} className="opacity-90"/>
                <span className="font-bold text-base">Record</span>
              </button>
              <button
                onClick={() => onModeChange('text')}
                className="bg-gradient-to-r from-purple-600 to-pink-600 text-white p-6 rounded-xl shadow-lg hover:shadow-xl transition-all flex flex-col items-center gap-2"
              >
                <Keyboard size={28} className="opacity-90"/>
                <span className="font-bold text-base">Type</span>
              </button>
            </div>
          </div>
        )}

        {mode === 'text' && (
          <div className="mb-4">
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Your thoughts</h3>
            <textarea
              value={textValue}
              onChange={e => setTextValue(e.target.value)}
              className="w-full border rounded-xl p-4 h-48 focus:ring-2 focus:ring-indigo-500 outline-none bg-white shadow-sm"
              placeholder="Type your entry here... You can address the prompts above or write freely."
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-3">
              <button
                onClick={() => {onModeChange(null); setTextValue('');}}
                className="px-4 py-2 text-gray-500 hover:bg-gray-100 rounded-lg font-medium"
              >
                Back
              </button>
              <button
                onClick={() => onSave(textValue)}
                disabled={!textValue.trim() || loading}
                className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-medium flex gap-2 items-center hover:bg-indigo-700 disabled:bg-gray-300"
              >
                {loading ? <Loader2 className="animate-spin" size={18}/> : <Send size={18}/>} Save
              </button>
            </div>
          </div>
        )}

        {mode === 'voice' && (
          <div className="mb-4">
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Voice recording</h3>
            <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm flex flex-col items-center gap-4">
              <button
                onClick={recording ? stopRecording : startRecording}
                disabled={loading}
                className={`h-20 w-20 rounded-full flex items-center justify-center shadow-lg transition-all ${recording ? 'bg-red-500 scale-110 animate-pulse' : 'bg-indigo-600 hover:bg-indigo-700'} disabled:opacity-50`}
              >
                {recording ? <Square className="text-white fill-current" size={32}/> : <Mic className="text-white" size={32}/>}
              </button>

              {recording && (
                <div className="bg-gray-800 text-white text-sm font-mono py-1.5 px-3 rounded">
                  {Math.floor(recordSeconds/60)}:{String(recordSeconds%60).padStart(2,'0')}
                </div>
              )}

              {loading && (
                <div className="flex items-center gap-2 text-indigo-600 font-medium">
                  <Loader2 className="animate-spin" size={18}/> Processing...
                </div>
              )}

              <button
                onClick={() => onModeChange(null)}
                className="text-sm text-gray-500 hover:text-gray-700 font-medium"
                disabled={recording || loading}
              >
                Back
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

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

const NewEntryButton = ({ onClick }) => {
  return (
    <div className="fixed bottom-0 w-full bg-white border-t p-4 z-20 pb-[max(2rem,env(safe-area-inset-bottom))] shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]">
      <div className="flex justify-center items-center max-w-md mx-auto">
        <button
          onClick={onClick}
          className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-8 py-4 rounded-full shadow-lg hover:shadow-xl transition-all flex items-center gap-3 font-bold text-lg"
        >
          <Mic size={24} className="opacity-90"/>
          New Entry
        </button>
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
  const [mode, setMode] = useState('idle');
  const [processing, setProcessing] = useState(false);
  const [replyContext, setReplyContext] = useState(null);
  const [showDecompression, setShowDecompression] = useState(false);
  const [showPrompts, setShowPrompts] = useState(false);
  const [promptMode, setPromptMode] = useState(null);
  
  // Safety features (Phase 0)
  const [safetyPlan, setSafetyPlan] = useState(DEFAULT_SAFETY_PLAN);
  const [showSafetyPlan, setShowSafetyPlan] = useState(false);
  const [crisisModal, setCrisisModal] = useState(null);
  const [crisisResources, setCrisisResources] = useState(null);
  const [pendingEntry, setPendingEntry] = useState(null);
  
  // Daily Summary Modal (Phase 2)
  const [dailySummaryModal, setDailySummaryModal] = useState(null);
  
  // Therapist Export (Phase 3)
  const [showExport, setShowExport] = useState(false);
  
  // Insights Panel (Phase 4)
  const [showInsights, setShowInsights] = useState(false);

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

  // Background retrofit for enhanced context extraction
  const retrofitStarted = useRef(false);
  const [retrofitProgress, setRetrofitProgress] = useState(null);

  useEffect(() => {
    if (!user || entries.length === 0 || retrofitStarted.current) return;

    // Check if any entries need retrofitting
    const needsRetrofit = entries.some(e => (e.context_version || 0) < CURRENT_CONTEXT_VERSION);
    if (!needsRetrofit) return;

    retrofitStarted.current = true;

    // Start retrofit in background after a short delay to let UI settle
    const timeoutId = setTimeout(() => {
      console.log('Starting background retrofit of entries...');
      retrofitEntriesInBackground(
        entries,
        user.uid,
        db,
        (processed, total) => setRetrofitProgress({ processed, total })
      ).then(() => {
        setRetrofitProgress(null);
      }).catch(err => {
        console.error('Retrofit failed:', err);
        setRetrofitProgress(null);
      });
    }, 3000); // Wait 3 seconds before starting

    return () => clearTimeout(timeoutId);
  }, [user, entries]);

  // Load Safety Plan (Phase 0)
  useEffect(() => {
    if (!user) return;
    const safetyPlanRef = doc(db, 'artifacts', APP_COLLECTION_ID, 'users', user.uid, 'safetyPlan', 'plan');
    return onSnapshot(safetyPlanRef, (snap) => {
      if (snap.exists()) {
        setSafetyPlan({ ...DEFAULT_SAFETY_PLAN, ...snap.data() });
      } else {
        setSafetyPlan(DEFAULT_SAFETY_PLAN);
      }
    });
  }, [user]);

  // Save Safety Plan handler
  const updateSafetyPlan = useCallback(async (newPlan) => {
    if (!user) return;
    const safetyPlanRef = doc(db, 'artifacts', APP_COLLECTION_ID, 'users', user.uid, 'safetyPlan', 'plan');
    const planData = removeUndefined({
      ...newPlan,
      updatedAt: Timestamp.now()
    });
    try {
      await setDoc(safetyPlanRef, planData, { merge: true });
      setSafetyPlan(newPlan);
    } catch (e) {
      console.error('Failed to save safety plan:', e);
    }
  }, [user]);

  // Longitudinal risk check (Phase 0 - Tier 3)
  useEffect(() => {
    if (!user || entries.length < 3) return;
    const hasRisk = checkLongitudinalRisk(entries);
    if (hasRisk) {
      console.log('Longitudinal risk detected - consider showing proactive support');
    }
  }, [user, entries]);

  // Self-healing: Backfill embeddings for entries that are missing them
  useEffect(() => {
    if (!user || entries.length === 0) return;

    const backfillMissingEmbeddings = async () => {
      const entriesWithoutEmbedding = entries.filter(
        e => !e.embedding || !Array.isArray(e.embedding) || e.embedding.length === 0
      );

      if (entriesWithoutEmbedding.length === 0) return;

      console.log(`Found ${entriesWithoutEmbedding.length} entries without embeddings, backfilling...`);

      const MAX_BACKFILL_PER_SESSION = 5;
      const toBackfill = entriesWithoutEmbedding.slice(0, MAX_BACKFILL_PER_SESSION);

      for (const entry of toBackfill) {
        if (!entry.text || entry.text.trim().length === 0) continue;

        try {
          const embedding = await generateEmbedding(entry.text);
          if (embedding) {
            await updateDoc(
              doc(db, 'artifacts', APP_COLLECTION_ID, 'users', user.uid, 'entries', entry.id),
              { embedding }
            );
            console.log(`Backfilled embedding for entry ${entry.id}`);
          }
        } catch (e) {
          console.error(`Failed to backfill embedding for entry ${entry.id}:`, e);
        }

        await new Promise(resolve => setTimeout(resolve, 500));
      }

      if (entriesWithoutEmbedding.length > MAX_BACKFILL_PER_SESSION) {
        console.log(`${entriesWithoutEmbedding.length - MAX_BACKFILL_PER_SESSION} entries still need embeddings (will process on next session)`);
      }
    };

    const timeoutId = setTimeout(backfillMissingEmbeddings, 2000);
    return () => clearTimeout(timeoutId);
  }, [user, entries.length]);

  const visible = useMemo(() => entries.filter(e => e.category === cat), [entries, cat]);

  // Collect all follow-up questions from recent entries
  const availablePrompts = useMemo(() => {
    const prompts = [];
    const recentEntries = visible.slice(0, 10); // Look at last 10 entries

    recentEntries.forEach(entry => {
      if (entry.contextualInsight?.found && entry.contextualInsight.followUpQuestions) {
        const questions = Array.isArray(entry.contextualInsight.followUpQuestions)
          ? entry.contextualInsight.followUpQuestions
          : [entry.contextualInsight.followUpQuestions];
        questions.forEach(q => {
          if (q && !prompts.includes(q)) prompts.push(q);
        });
      }
      // Handle legacy single followUpQuestion field
      if (entry.contextualInsight?.followUpQuestion && !prompts.includes(entry.contextualInsight.followUpQuestion)) {
        prompts.push(entry.contextualInsight.followUpQuestion);
      }
    });

    return prompts.slice(0, 5); // Return max 5 prompts
  }, [visible]);

  const handleCrisisResponse = useCallback(async (response) => {
    setCrisisModal(null);
    
    if (response === 'okay') {
      if (pendingEntry) {
        await doSaveEntry(pendingEntry.text, pendingEntry.safetyFlagged, response);
        setPendingEntry(null);
      }
    } else if (response === 'support') {
      setCrisisResources('support');
    } else if (response === 'crisis') {
      setCrisisResources('crisis');
      setPendingEntry(null);
    }
  }, [pendingEntry]);

  const handleCrisisResourcesContinue = useCallback(async () => {
    setCrisisResources(null);
    if (pendingEntry) {
      await doSaveEntry(pendingEntry.text, pendingEntry.safetyFlagged, 'support');
      setPendingEntry(null);
    }
  }, [pendingEntry]);

  const doSaveEntry = async (textInput, safetyFlagged = false, safetyUserResponse = null) => {
    if (!user) return;

    let finalTex = textInput;
    if (replyContext) {
      finalTex = `[Replying to: "${replyContext}"]\n\n${textInput}`;
    }

    const embedding = await generateEmbedding(finalTex);
    const related = findRelevantMemories(embedding, entries, cat);
    const recent = entries.slice(0, 5);
    
    const hasWarning = checkWarningIndicators(finalTex);

    try {
      const entryData = {
        text: finalTex, 
        category: cat, 
        analysisStatus: 'pending', 
        embedding,
        createdAt: Timestamp.now(), 
        userId: user.uid
      };
      
      if (safetyFlagged) {
        entryData.safety_flagged = true;
        if (safetyUserResponse) {
          entryData.safety_user_response = safetyUserResponse;
        }
      }
      
      if (hasWarning) {
        entryData.has_warning_indicators = true;
      }
      
      const ref = await addDoc(collection(db, 'artifacts', APP_COLLECTION_ID, 'users', user.uid, 'entries'), entryData);

      setProcessing(false);
      setMode('idle');
      setReplyContext(null);
      setShowPrompts(false);
      setPromptMode(null);

      (async () => {
        try {
          const classification = await classifyEntry(finalTex);
          console.log('Entry classification:', classification);

          // Run analysis, insight generation, and enhanced context extraction in parallel
          const [analysis, insight, enhancedContext] = await Promise.all([
            analyzeEntry(finalTex, classification.entry_type),
            classification.entry_type !== 'task' ? generateInsight(finalTex, related, recent, entries) : Promise.resolve(null),
            classification.entry_type !== 'task' ? extractEnhancedContext(finalTex, recent) : Promise.resolve(null)
          ]);

          console.log('Analysis complete:', { analysis, insight, classification, enhancedContext });

          if (analysis && analysis.mood_score !== null && analysis.mood_score < 0.35) {
            setShowDecompression(true);
          }

          // Merge topic tags from analysis with structured tags from enhanced context
          const topicTags = analysis?.tags || [];
          const structuredTags = enhancedContext?.structured_tags || [];
          const contextTopicTags = enhancedContext?.topic_tags || [];
          const allTags = [...new Set([...topicTags, ...structuredTags, ...contextTopicTags])];

          const updateData = {
            title: analysis?.title || "New Memory",
            tags: allTags,
            analysisStatus: 'complete',
            entry_type: classification.entry_type,
            classification_confidence: classification.confidence,
            context_version: CURRENT_CONTEXT_VERSION
          };

          // Store situation continuation info if detected
          if (enhancedContext?.continues_situation) {
            updateData.continues_situation = enhancedContext.continues_situation;
          }

          // Store goal update info if detected
          if (enhancedContext?.goal_update?.tag) {
            updateData.goal_update = enhancedContext.goal_update;
          }
          
          if (classification.extracted_tasks && classification.extracted_tasks.length > 0) {
            updateData.extracted_tasks = classification.extracted_tasks.map(t => ({ text: t, completed: false }));
          }

          updateData.analysis = {
            mood_score: analysis?.mood_score,
            framework: analysis?.framework || 'general'
          };

          if (analysis?.cbt_breakdown && typeof analysis.cbt_breakdown === 'object' && Object.keys(analysis.cbt_breakdown).length > 0) {
            updateData.analysis.cbt_breakdown = analysis.cbt_breakdown;
          }

          if (analysis?.vent_support) {
            updateData.analysis.vent_support = analysis.vent_support;
          }

          // Celebration framework for positive entries
          if (analysis?.celebration && typeof analysis.celebration === 'object') {
            updateData.analysis.celebration = analysis.celebration;
          }

          // Task acknowledgment for mixed entries
          if (analysis?.task_acknowledgment) {
            updateData.analysis.task_acknowledgment = analysis.task_acknowledgment;
          }

          if (insight?.found) {
            updateData.contextualInsight = insight;
          }

          console.log('Final updateData to save:', JSON.stringify(updateData, null, 2));

          const cleanedUpdateData = removeUndefined(updateData);

          try {
            await updateDoc(ref, cleanedUpdateData);
          } catch (updateError) {
            console.error('Failed to update document:', updateError);
            throw updateError;
          }
        } catch (error) {
          console.error('Analysis failed, marking entry as complete with fallback values:', error);

          try {
            const fallbackData = {
              analysis: {
                mood_score: 0.5,
                framework: 'general'
              },
              title: finalTex.substring(0, 50) + (finalTex.length > 50 ? '...' : ''),
              tags: [],
              analysisStatus: 'complete',
              entry_type: 'reflection'
            };

            const cleanedFallbackData = removeUndefined(fallbackData);
            await updateDoc(ref, cleanedFallbackData);
          } catch (fallbackError) {
            console.error('Even fallback update failed:', fallbackError);
          }
        }
      })();
    } catch (e) {
      console.error('Save failed:', e);
      alert("Save failed");
      setProcessing(false);
    }
  };

  const saveEntry = async (textInput) => {
    if (!user) return;
    setProcessing(true);
    
    const hasCrisis = checkCrisisKeywords(textInput);
    
    if (hasCrisis) {
      setPendingEntry({ text: textInput, safetyFlagged: true });
      setCrisisModal(true);
      setProcessing(false);
      return;
    }
    
    await doSaveEntry(textInput);
  };

  const handleAudioWrapper = async (base64, mime) => {
    setProcessing(true);
    const transcript = await transcribeAudio(base64, mime);

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

    if (transcript === 'API_BAD_REQUEST') {
      alert("Audio format not supported - please try recording again");
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
    setMode('recording_voice');
  };

  const handlePromptSave = async (data, mimeType) => {
    // Handle both text and audio from PromptScreen
    if (typeof data === 'string' && !mimeType) {
      // Text entry
      await saveEntry(data);
    } else {
      // Audio entry
      await handleAudioWrapper(data, mimeType);
    }
  };

  if (!user) return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-gradient-to-br from-warm-50 to-primary-50">
      <motion.div
        className="h-16 w-16 bg-gradient-to-br from-primary-600 to-primary-700 rounded-3xl flex items-center justify-center mb-4 shadow-soft-lg rotate-3"
        initial={{ scale: 0, rotate: -10 }}
        animate={{ scale: 1, rotate: 3 }}
        transition={{ type: "spring", damping: 15 }}
      >
        <Activity className="text-white"/>
      </motion.div>
      <motion.h1
        className="text-2xl font-display font-bold mb-6 text-warm-800"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        EchoVault
      </motion.h1>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
      >
        <Button
          variant="secondary"
          onClick={() => signInWithPopup(auth, new GoogleAuthProvider())}
          className="flex gap-2 items-center"
        >
          <LogIn size={18}/> Sign in with Google
        </Button>
      </motion.div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-warm-50 to-white pb-40 pt-[env(safe-area-inset-top)]">
      <AnimatePresence>
        {showDecompression && <DecompressionScreen onClose={() => setShowDecompression(false)} />}
      </AnimatePresence>

      {/* Retrofit Progress Indicator */}
      <AnimatePresence>
        {retrofitProgress && (
          <motion.div
            className="fixed bottom-24 left-4 right-4 z-30 flex justify-center pointer-events-none"
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
          >
            <div className="bg-warm-800 text-white px-4 py-2 rounded-full shadow-soft-lg text-sm flex items-center gap-2">
              <Loader2 className="animate-spin" size={14} />
              <span className="font-body">Enhancing entries... {retrofitProgress.processed}/{retrofitProgress.total}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {crisisModal && (
        <CrisisSoftBlockModal 
          onResponse={handleCrisisResponse}
          onClose={() => {
            setCrisisModal(null);
            setPendingEntry(null);
          }}
        />
      )}
      
      {crisisResources && (
        <CrisisResourcesScreen 
          level={crisisResources}
          onClose={() => {
            setCrisisResources(null);
            setPendingEntry(null);
          }}
          onContinue={handleCrisisResourcesContinue}
        />
      )}
      
      {showSafetyPlan && (
        <SafetyPlanScreen 
          plan={safetyPlan}
          onUpdate={updateSafetyPlan}
          onClose={() => setShowSafetyPlan(false)}
        />
      )}
      
      {dailySummaryModal && (
        <DailySummaryModal
          date={dailySummaryModal.date}
          dayData={dailySummaryModal.dayData}
          onClose={() => setDailySummaryModal(null)}
          onDelete={id => deleteDoc(doc(db, 'artifacts', APP_COLLECTION_ID, 'users', user.uid, 'entries', id))}
          onUpdate={(id, d) => updateDoc(doc(db, 'artifacts', APP_COLLECTION_ID, 'users', user.uid, 'entries', id), d)}
        />
      )}
      
      {showExport && (
        <TherapistExportScreen
          entries={entries}
          onClose={() => setShowExport(false)}
        />
      )}
      
      {showInsights && (
        <InsightsPanel
          entries={entries}
          onClose={() => setShowInsights(false)}
        />
      )}

      <motion.div
        className="bg-white/95 backdrop-blur-sm border-b border-warm-100 p-4 sticky top-0 z-20 shadow-soft"
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
      >
        <div className="flex justify-between items-center mb-4">
          <motion.h1
            className="font-display font-bold text-lg flex gap-2 text-warm-800"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <Brain className="text-primary-600"/> EchoVault
          </motion.h1>
          <div className="flex gap-2">
            <GetHelpButton onClick={() => setShowSafetyPlan(true)} />
            <HamburgerMenu
              onShowInsights={() => setShowInsights(true)}
              onShowExport={() => setShowExport(true)}
              onRequestPermission={requestPermission}
              onOpenChat={() => setView('chat')}
              onOpenVoice={() => setView('realtime')}
              onLogout={() => signOut(auth)}
              notificationPermission={permission}
            />
          </div>
        </div>
        <div className="flex bg-warm-100 p-1 rounded-2xl">
          <motion.button
            onClick={() => setCat('personal')}
            className={`flex-1 flex justify-center items-center gap-2 py-2 text-xs font-bold rounded-xl transition-all ${cat === 'personal' ? 'bg-white shadow-soft text-primary-600' : 'text-warm-500'}`}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <UserIcon size={14}/> Personal
          </motion.button>
          <motion.button
            onClick={() => setCat('work')}
            className={`flex-1 flex justify-center items-center gap-2 py-2 text-xs font-bold rounded-xl transition-all ${cat === 'work' ? 'bg-white shadow-soft text-primary-600' : 'text-warm-500'}`}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <Briefcase size={14}/> Work
          </motion.button>
        </div>
      </motion.div>

      <div className="max-w-md mx-auto p-4">
        {visible.length > 0 && <MoodHeatmap entries={visible} onDayClick={(date, dayData) => setDailySummaryModal({ date, dayData })} />}
        <AnimatePresence mode="popLayout">
          <div className="space-y-4">
            {visible.map(e => <EntryCard key={e.id} entry={e} onDelete={id => deleteDoc(doc(db, 'artifacts', APP_COLLECTION_ID, 'users', user.uid, 'entries', id))} onUpdate={(id, d) => updateDoc(doc(db, 'artifacts', APP_COLLECTION_ID, 'users', user.uid, 'entries', id), d)} />)}
          </div>
        </AnimatePresence>

        {visible.length === 0 && (
          <motion.div
            className="text-center py-12"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <motion.div
              className="h-24 w-24 bg-primary-50 rounded-full flex items-center justify-center mx-auto mb-4 text-primary-300"
              animate={{ scale: [1, 1.05, 1] }}
              transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}
            >
              <Mic size={40}/>
            </motion.div>
            <h3 className="text-lg font-display font-medium text-warm-900">No {cat} memories yet</h3>
            <p className="text-warm-500 mt-2 text-sm font-body">Switch categories or record your first entry.</p>
            <motion.div
              className="mt-8 p-4 bg-primary-50 rounded-2xl text-sm text-primary-800 text-left border border-primary-100"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
            >
              <p className="font-bold mb-1 flex items-center gap-2"><Share size={14}/> Install on iPhone</p>
              <p className="font-body">Tap <strong>Share</strong> → <strong>Add to Home Screen</strong>.</p>
            </motion.div>
          </motion.div>
        )}
      </div>

      <AnimatePresence>
        {replyContext && !showPrompts && (
          <motion.div
            className="fixed bottom-24 left-4 right-4 bg-primary-900 text-white p-3 rounded-2xl z-30 flex justify-between items-center shadow-soft-lg"
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
          >
            <div className="text-xs">
              <span className="opacity-70 block text-[10px] uppercase font-bold">Replying to:</span>
              "{replyContext}"
            </div>
            <motion.button
              onClick={() => setReplyContext(null)}
              className="p-1 hover:bg-white/20 rounded-lg"
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
            >
              <X size={16}/>
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {showPrompts ? (
        <PromptScreen
          prompts={availablePrompts}
          mode={promptMode}
          onModeChange={setPromptMode}
          onSave={handlePromptSave}
          onClose={() => {
            setShowPrompts(false);
            setPromptMode(null);
          }}
          loading={processing}
          category={cat}
        />
      ) : mode === 'recording_voice' ?(
        <VoiceRecorder onSave={handleAudioWrapper} onSwitch={() => setMode('recording_text')} loading={processing} />
      ) : mode === 'recording_text' ? (
        <TextInput onSave={saveEntry} onCancel={() => {setMode('idle'); setReplyContext(null);}} loading={processing} />
      ) : (
        <NewEntryButton onClick={() => setShowPrompts(true)} />
      )}

      {view === 'chat' && <Chat entries={visible} onClose={() => setView('feed')} category={cat} />}
      {view === 'realtime' && <RealtimeConversation entries={visible} onClose={() => setView('feed')} category={cat} />}
    </div>
  );
}

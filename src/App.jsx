import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Mic, Loader2, LogIn, Activity, Brain, Share,
  User as UserIcon, Briefcase, X
} from 'lucide-react';

// Config
import {
  auth, db,
  onAuthStateChanged, signOut, signInWithCustomToken,
  GoogleAuthProvider, signInWithPopup,
  collection, addDoc, query, orderBy, onSnapshot,
  Timestamp, deleteDoc, doc, updateDoc, limit, setDoc
} from './config/firebase';
import {
  APP_COLLECTION_ID, CURRENT_CONTEXT_VERSION,
  DEFAULT_SAFETY_PLAN
} from './config/constants';

// Utils
import { safeString, removeUndefined, formatMentions } from './utils/string';
import { safeDate } from './utils/date';
import { sanitizeEntry } from './utils/entries';

// Services
import { generateEmbedding, findRelevantMemories, transcribeAudio } from './services/ai';
import {
  classifyEntry, analyzeEntry, generateInsight, extractEnhancedContext
} from './services/analysis';
import { checkCrisisKeywords, checkWarningIndicators, checkLongitudinalRisk } from './services/safety';
import { retrofitEntriesInBackground } from './services/entries';

// Hooks
import { useIOSMeta } from './hooks/useIOSMeta';
import { useNotifications } from './hooks/useNotifications';

// Components
import {
  CrisisSoftBlockModal, DailySummaryModal, WeeklyReport, InsightsPanel,
  CrisisResourcesScreen, SafetyPlanScreen, DecompressionScreen, TherapistExportScreen, PromptScreen,
  Chat, RealtimeConversation,
  EntryCard, MoodHeatmap,
  VoiceRecorder, TextInput, NewEntryButton,
  MarkdownLite, GetHelpButton, HamburgerMenu
} from './components';

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

    const needsRetrofit = entries.some(e => (e.context_version || 0) < CURRENT_CONTEXT_VERSION);
    if (!needsRetrofit) return;

    retrofitStarted.current = true;

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
    }, 3000);

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
    const recentEntries = visible.slice(0, 10);

    recentEntries.forEach(entry => {
      if (entry.contextualInsight?.found && entry.contextualInsight.followUpQuestions) {
        const questions = Array.isArray(entry.contextualInsight.followUpQuestions)
          ? entry.contextualInsight.followUpQuestions
          : [entry.contextualInsight.followUpQuestions];
        questions.forEach(q => {
          if (q && !prompts.includes(q)) prompts.push(q);
        });
      }
      if (entry.contextualInsight?.followUpQuestion && !prompts.includes(entry.contextualInsight.followUpQuestion)) {
        prompts.push(entry.contextualInsight.followUpQuestion);
      }
    });

    return prompts.slice(0, 5);
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

          const [analysis, insight, enhancedContext] = await Promise.all([
            analyzeEntry(finalTex, classification.entry_type),
            classification.entry_type !== 'task' ? generateInsight(finalTex, related, recent, entries) : Promise.resolve(null),
            classification.entry_type !== 'task' ? extractEnhancedContext(finalTex, recent) : Promise.resolve(null)
          ]);

          console.log('Analysis complete:', { analysis, insight, classification, enhancedContext });

          if (analysis && analysis.mood_score !== null && analysis.mood_score < 0.35) {
            setShowDecompression(true);
          }

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

          if (enhancedContext?.continues_situation) {
            updateData.continues_situation = enhancedContext.continues_situation;
          }

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

          if (analysis?.celebration && typeof analysis.celebration === 'object') {
            updateData.analysis.celebration = analysis.celebration;
          }

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

  const handlePromptSave = async (data, mimeType) => {
    if (typeof data === 'string' && !mimeType) {
      await saveEntry(data);
    } else {
      await handleAudioWrapper(data, mimeType);
    }
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

      {/* Retrofit Progress Indicator */}
      {retrofitProgress && (
        <div className="fixed bottom-24 left-4 right-4 z-30 flex justify-center pointer-events-none">
          <div className="bg-gray-800 text-white px-4 py-2 rounded-full shadow-lg text-sm flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2">
            <Loader2 className="animate-spin" size={14} />
            <span>Enhancing entries... {retrofitProgress.processed}/{retrofitProgress.total}</span>
          </div>
        </div>
      )}

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

      <div className="bg-white border-b p-4 sticky top-0 z-20 shadow-sm">
        <div className="flex justify-between items-center mb-4">
          <h1 className="font-bold text-lg flex gap-2 text-gray-800"><Brain className="text-indigo-600"/> EchoVault</h1>
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
        <div className="flex bg-gray-100 p-1 rounded-lg">
          <button onClick={() => setCat('personal')} className={`flex-1 flex justify-center items-center gap-2 py-1.5 text-xs font-bold rounded transition-all ${cat === 'personal' ? 'bg-white shadow text-indigo-600' : 'text-gray-500'}`}><UserIcon size={14}/> Personal</button>
          <button onClick={() => setCat('work')} className={`flex-1 flex justify-center items-center gap-2 py-1.5 text-xs font-bold rounded transition-all ${cat === 'work' ? 'bg-white shadow text-indigo-600' : 'text-gray-500'}`}><Briefcase size={14}/> Work</button>
        </div>
      </div>

      <div className="max-w-md mx-auto p-4">
        {visible.length > 0 && <MoodHeatmap entries={visible} onDayClick={(date, dayData) => setDailySummaryModal({ date, dayData })} />}
        <div className="space-y-4">
          {visible.map(e => <EntryCard key={e.id} entry={e} onDelete={id => deleteDoc(doc(db, 'artifacts', APP_COLLECTION_ID, 'users', user.uid, 'entries', id))} onUpdate={(id, d) => updateDoc(doc(db, 'artifacts', APP_COLLECTION_ID, 'users', user.uid, 'entries', id), d)} />)}
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

      {replyContext && !showPrompts && (
        <div className="fixed bottom-24 left-4 right-4 bg-indigo-900 text-white p-3 rounded-lg z-30 flex justify-between items-center shadow-lg animate-in slide-in-from-bottom-2">
          <div className="text-xs">
            <span className="opacity-70 block text-[10px] uppercase font-bold">Replying to:</span>
            "{replyContext}"
          </div>
          <button onClick={() => setReplyContext(null)} className="p-1 hover:bg-white/20 rounded"><X size={16}/></button>
        </div>
      )}

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
      ) : mode === 'recording_voice' ? (
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

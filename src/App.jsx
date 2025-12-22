import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Mic, Loader2, LogIn, Activity, Brain, Share,
  User as UserIcon, Briefcase, X
} from 'lucide-react';

// UI Components
import { celebrate, Button, Modal, ModalHeader, ModalBody, Badge, MoodBadge, BreathingLoader } from './components/ui';

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
import { safeDate, formatDateForInput, getTodayForInput, parseDateInput, getDateString, getISOYearWeek } from './utils/date';
import { sanitizeEntry } from './utils/entries';

// Services
import { generateEmbedding, findRelevantMemories, transcribeAudio } from './services/ai';
import {
  classifyEntry, analyzeEntry, generateInsight, extractEnhancedContext
} from './services/analysis';
import { checkCrisisKeywords, checkWarningIndicators, checkLongitudinalRisk } from './services/safety';
import { retrofitEntriesInBackground } from './services/entries';
import { inferCategory } from './services/prompts';
import { detectTemporalContext, needsConfirmation, formatEffectiveDate } from './services/temporal';
import { completeActionItem, handleEntryDateChange, calculateStreak } from './services/dashboard';

// Hooks
import { useIOSMeta } from './hooks/useIOSMeta';
import { useNotifications } from './hooks/useNotifications';
import { useNetworkStatus } from './hooks/useNetworkStatus';

// Components
import {
  CrisisSoftBlockModal, DailySummaryModal, WeeklyReport, InsightsPanel,
  CrisisResourcesScreen, SafetyPlanScreen, DecompressionScreen, TherapistExportScreen, JournalScreen,
  Chat, RealtimeConversation,
  MoodHeatmap,
  MarkdownLite, GetHelpButton, HamburgerMenu,
  DayDashboard, EntryBar
} from './components';

// Dashboard Enhancement Components
import { QuickStatsBar, GoalsProgress, WeeklyDigest, SituationTimeline } from './components/dashboard/shared';

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

// Analysis functions (classifyEntry, analyzeEntry, generateInsight, etc.) imported from services/analysis


export default function App() {
  console.log('[EchoVault] App component rendering...');
  useIOSMeta();
  const { permission, requestPermission } = useNotifications();
  const { isOnline, wasOffline, clearWasOffline } = useNetworkStatus();
  const [user, setUser] = useState(null);
  const [entries, setEntries] = useState([]);
  const [view, setView] = useState('feed');
  const [cat, setCat] = useState('personal');
  const [processing, setProcessing] = useState(false);
  const [replyContext, setReplyContext] = useState(null);
  const [showDecompression, setShowDecompression] = useState(false);
  const [offlineQueue, setOfflineQueue] = useState([]);

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

  // Journal Screen (Day Dashboard MVP)
  const [showJournal, setShowJournal] = useState(false);

  // Temporal Context (Phase 2) - for backdating entries
  const [pendingTemporalEntry, setPendingTemporalEntry] = useState(null);

  // Process offline queue when back online
  useEffect(() => {
    const processOfflineQueue = async () => {
      if (!isOnline || !wasOffline || offlineQueue.length === 0 || !user) return;

      console.log(`Processing ${offlineQueue.length} offline entries...`);
      clearWasOffline();

      for (const offlineEntry of offlineQueue) {
        try {
          // Generate embedding for the entry
          const embedding = await generateEmbedding(offlineEntry.text);

          // Prepare entry data for Firestore
          const entryData = {
            text: offlineEntry.text,
            category: offlineEntry.category,
            analysisStatus: 'pending',
            embedding,
            createdAt: Timestamp.fromDate(offlineEntry.createdAt),
            effectiveDate: Timestamp.fromDate(offlineEntry.effectiveDate || offlineEntry.createdAt),
            userId: user.uid
          };

          if (offlineEntry.safety_flagged) {
            entryData.safety_flagged = true;
            if (offlineEntry.safety_user_response) {
              entryData.safety_user_response = offlineEntry.safety_user_response;
            }
          }

          if (offlineEntry.has_warning_indicators) {
            entryData.has_warning_indicators = true;
          }

          // Save to Firestore
          const ref = await addDoc(
            collection(db, 'artifacts', APP_COLLECTION_ID, 'users', user.uid, 'entries'),
            entryData
          );

          console.log(`Saved offline entry: ${offlineEntry.offlineId}`);

          // Run analysis in background (same as online flow)
          (async () => {
            try {
              const recent = entries.slice(0, 5);
              const related = findRelevantMemories(embedding, entries, offlineEntry.category);

              const classification = await classifyEntry(offlineEntry.text);
              const [analysis, insight, enhancedContext] = await Promise.all([
                analyzeEntry(offlineEntry.text, classification.entry_type),
                classification.entry_type !== 'task' ? generateInsight(offlineEntry.text, related, recent, entries) : Promise.resolve(null),
                classification.entry_type !== 'task' ? extractEnhancedContext(offlineEntry.text, recent) : Promise.resolve(null)
              ]);

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
                context_version: CURRENT_CONTEXT_VERSION,
                analysis: {
                  mood_score: analysis?.mood_score,
                  framework: analysis?.framework || 'general'
                }
              };

              if (enhancedContext?.continues_situation) {
                updateData.continues_situation = enhancedContext.continues_situation;
              }
              if (enhancedContext?.goal_update?.tag) {
                updateData.goal_update = enhancedContext.goal_update;
              }
              if (classification.extracted_tasks?.length > 0) {
                // extracted_tasks already comes as [{text: "...", completed: false}] from Cloud Function
                updateData.extracted_tasks = classification.extracted_tasks;
              }
              if (analysis?.cbt_breakdown) updateData.analysis.cbt_breakdown = analysis.cbt_breakdown;
              if (analysis?.vent_support) updateData.analysis.vent_support = analysis.vent_support;
              if (analysis?.celebration) updateData.analysis.celebration = analysis.celebration;
              if (analysis?.task_acknowledgment) updateData.analysis.task_acknowledgment = analysis.task_acknowledgment;
              if (insight?.found) updateData.contextualInsight = insight;

              await updateDoc(ref, removeUndefined(updateData));
            } catch (error) {
              console.error('Analysis failed for offline entry:', error);
              await updateDoc(ref, {
                title: offlineEntry.text.substring(0, 50) + (offlineEntry.text.length > 50 ? '...' : ''),
                tags: [],
                analysisStatus: 'complete',
                entry_type: 'reflection',
                analysis: { mood_score: 0.5, framework: 'general' }
              });
            }
          })();
        } catch (error) {
          console.error('Failed to save offline entry:', error);
        }
      }

      // Clear the offline queue
      setOfflineQueue([]);
    };

    processOfflineQueue();
  }, [isOnline, wasOffline, offlineQueue, user, entries, clearWasOffline]);

  // Auth
  useEffect(() => {
    console.log('[EchoVault] Setting up auth listener...');
    const init = async () => {
      if (typeof window !== 'undefined' && typeof window.__initial_auth_token !== 'undefined' && window.__initial_auth_token) {
        try {
          console.log('[EchoVault] Found initial auth token, signing in...');
          await signInWithCustomToken(auth, window.__initial_auth_token);
        } catch (error) {
          console.error('[EchoVault] Auth error:', error);
        }
      }
    };
    init();
    return onAuthStateChanged(auth, (user) => {
      console.log('[EchoVault] Auth state changed:', user ? `User: ${user.uid}` : 'No user');
      setUser(user);
    });
  }, []);

  // Data Feed
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'artifacts', APP_COLLECTION_ID, 'users', user.uid, 'entries'), orderBy('createdAt', 'desc'), limit(100));
    return onSnapshot(q, snap => {
      const safeData = snap.docs.map(doc => {
        try {
          return sanitizeEntry(doc.id, doc.data());
        } catch (error) {
          console.error('Failed to sanitize entry:', doc.id, error);
          return null;
        }
      }).filter(Boolean);
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

  // Filter and sort entries by effectiveDate (or createdAt if not set)
  const visible = useMemo(() => {
    const filtered = entries.filter(e => e.category === cat);
    // Sort by effectiveDate if available, otherwise createdAt (descending - newest first)
    return filtered.sort((a, b) => {
      const dateA = a.effectiveDate || a.createdAt;
      const dateB = b.effectiveDate || b.createdAt;
      return dateB - dateA;
    });
  }, [entries, cat]);

  // Handle entry update with date change cache invalidation
  // Options parameter keeps control logic separate from data (Fix A: Control Coupling)
  const handleEntryUpdate = useCallback(async (entryId, updates, options = {}) => {
    if (!user) return;

    const entryRef = doc(db, 'artifacts', APP_COLLECTION_ID, 'users', user.uid, 'entries', entryId);

    // Perform the update
    await updateDoc(entryRef, updates);

    // Check if this is a date change that needs cache invalidation
    if (options.dateChanged) {
      const { oldDate, newDate } = options.dateChanged;
      const entry = entries.find(e => e.id === entryId);
      const category = entry?.category || cat;

      // Invalidate caches in the background
      handleEntryDateChange(user.uid, entryId, oldDate, newDate, category)
        .then(result => {
          console.log('Cache invalidation complete:', result);
        })
        .catch(err => {
          console.error('Cache invalidation failed:', err);
        });
    }
  }, [user, entries, cat]);

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

  const doSaveEntry = async (textInput, safetyFlagged = false, safetyUserResponse = null, temporalContext = null) => {
    if (!user) return;

    let finalTex = textInput;
    if (replyContext) {
      finalTex = `[Replying to: "${replyContext}"]\n\n${textInput}`;
    }

    const hasWarning = checkWarningIndicators(finalTex);

    // Calculate effectiveDate - either from temporal detection or current time
    const now = new Date();
    const effectiveDate = temporalContext?.detected && temporalContext?.effectiveDate
      ? temporalContext.effectiveDate
      : now;

    console.log('Saving entry with:', {
      hasTemporalContext: !!temporalContext,
      temporalDetected: temporalContext?.detected,
      effectiveDate: effectiveDate.toDateString(),
      isBackdated: effectiveDate.toDateString() !== now.toDateString()
    });

    // If offline, queue the entry for later processing
    if (!isOnline) {
      console.log('Offline: queuing entry for later processing');
      const offlineEntry = {
        text: finalTex,
        category: cat,
        offlineId: Date.now().toString(),
        createdAt: now,
        effectiveDate: effectiveDate,
        safety_flagged: safetyFlagged || undefined,
        safety_user_response: safetyUserResponse || undefined,
        has_warning_indicators: hasWarning || undefined
      };
      setOfflineQueue(prev => [...prev, offlineEntry]);
      setProcessing(false);
      setReplyContext(null);
      return;
    }

    // Online: generate embedding and save
    // Wrap embedding generation with timeout for mobile reliability
    let embedding = null;
    try {
      // Set a 15-second timeout for embedding generation (mobile connections can be slow)
      const embeddingPromise = generateEmbedding(finalTex);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Embedding timeout')), 15000)
      );
      embedding = await Promise.race([embeddingPromise, timeoutPromise]);
    } catch (embeddingError) {
      // Log but continue - we'll save the entry without embedding and backfill later
      console.warn('Embedding generation failed, will backfill later:', embeddingError.message);
    }

    const related = embedding ? findRelevantMemories(embedding, entries, cat) : [];
    const recent = entries.slice(0, 5);

    try {
      const entryData = {
        text: finalTex,
        category: cat,
        analysisStatus: 'pending',
        embedding,
        createdAt: Timestamp.now(),
        effectiveDate: Timestamp.fromDate(effectiveDate),
        userId: user.uid
      };

      // Store temporal context if detected (past reference)
      if (temporalContext?.detected && temporalContext?.reference) {
        entryData.temporalContext = {
          detected: true,
          reference: temporalContext.reference,
          originalPhrase: temporalContext.originalPhrase,
          confidence: temporalContext.confidence,
          backdated: effectiveDate.toDateString() !== now.toDateString()
        };
      }

      // Store future mentions for follow-up prompts
      if (temporalContext?.futureMentions?.length > 0) {
        entryData.futureMentions = temporalContext.futureMentions.map(mention => ({
          targetDate: Timestamp.fromDate(mention.targetDate),
          event: mention.event,
          sentiment: mention.sentiment,
          phrase: mention.phrase,
          confidence: mention.confidence,
          isRecurring: mention.isRecurring || false,
          recurringPattern: mention.recurringPattern || null
        }));
      }

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
      setReplyContext(null);

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
            // Cloud Function returns tasks as [{text: "...", completed: false}]
            // But apply defensive normalization to ensure correct structure
            updateData.extracted_tasks = classification.extracted_tasks.map(t => ({
              text: typeof t === 'string' ? t : (t.text || t),
              completed: t.completed ?? false
            }));
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
      // Provide more helpful error message based on error type
      const errorMessage = e.code === 'permission-denied'
        ? 'Save failed: Permission denied. Please sign in again.'
        : e.code === 'unavailable' || e.message?.includes('network')
        ? 'Save failed: Network error. Please check your connection and try again.'
        : 'Save failed. Please try again.';
      alert(errorMessage);
      setProcessing(false);
    }
  };

  const saveEntry = async (textInput) => {
    if (!user) return;
    setProcessing(true);

    // Check for crisis keywords first (safety priority)
    const hasCrisis = checkCrisisKeywords(textInput);
    if (hasCrisis) {
      setPendingEntry({ text: textInput, safetyFlagged: true });
      setCrisisModal(true);
      setProcessing(false);
      return;
    }

    // Detect temporal context (Phase 2)
    // Add timeout for mobile reliability
    try {
      const temporalPromise = detectTemporalContext(textInput);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Temporal detection timeout')), 10000)
      );
      const temporal = await Promise.race([temporalPromise, timeoutPromise]);
      console.log('Temporal detection result:', {
        detected: temporal.detected,
        effectiveDate: temporal.effectiveDate,
        reference: temporal.reference,
        confidence: temporal.confidence,
        futureMentions: temporal.futureMentions?.length || 0,
        needsConfirm: temporal.detected ? (temporal.confidence >= 0.5 && temporal.confidence <= 0.8) : false,
        willAutoBackdate: temporal.detected && temporal.confidence > 0.8,
        reasoning: temporal.reasoning
      });

      if (temporal.detected) {
        if (needsConfirmation(temporal)) {
          // Medium confidence - ask user to confirm
          setPendingTemporalEntry({
            text: textInput,
            temporal
          });
          setProcessing(false);
          return;
        }

        // High confidence - auto-apply backdating
        if (temporal.confidence > 0.8) {
          console.log(`Auto-backdating entry to ${formatEffectiveDate(temporal.effectiveDate)}`);
          await doSaveEntry(textInput, false, null, temporal);
          return;
        }
      }

      // No temporal context or low confidence - save with current date
      await doSaveEntry(textInput);
    } catch (e) {
      console.error('Temporal detection failed, saving normally:', e);
      await doSaveEntry(textInput);
    }
  };

  // Handle temporal confirmation response
  const handleTemporalConfirm = async (confirmed) => {
    if (!pendingTemporalEntry) return;

    const { text, temporal } = pendingTemporalEntry;
    setPendingTemporalEntry(null);
    setProcessing(true);

    if (confirmed) {
      // User confirmed - save with backdated date
      await doSaveEntry(text, false, null, temporal);
    } else {
      // User declined - save with current date
      await doSaveEntry(text, false, null, null);
    }
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

  if (!user) {
    console.log('[EchoVault] Rendering login screen (no user)');
    return (
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
  }

  console.log('[EchoVault] Rendering main app (user logged in)');

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

      {/* Offline Indicator */}
      {!isOnline && (
        <div className="fixed top-[env(safe-area-inset-top)] left-0 right-0 z-50 bg-amber-500 text-white px-4 py-2 text-center text-sm font-medium">
          You're offline. Entries will be saved locally and synced when you're back online.
          {offlineQueue.length > 0 && ` (${offlineQueue.length} pending)`}
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

      {/* Temporal Context Confirmation Modal */}
      {pendingTemporalEntry && (
        <Modal onClose={() => {
          setPendingTemporalEntry(null);
          setProcessing(false);
        }}>
          <ModalHeader onClose={() => {
            setPendingTemporalEntry(null);
            setProcessing(false);
          }}>
            <span className="text-warm-800">Add to a different day?</span>
          </ModalHeader>
          <ModalBody>
            <p className="text-warm-600 mb-4 font-body">
              It sounds like you're talking about{' '}
              <span className="font-semibold text-primary-600">
                {formatEffectiveDate(pendingTemporalEntry.temporal.effectiveDate)}
              </span>
              {pendingTemporalEntry.temporal.originalPhrase && (
                <span className="text-warm-500">
                  {' '}("{pendingTemporalEntry.temporal.originalPhrase}")
                </span>
              )}
            </p>
            <p className="text-warm-500 text-sm font-body">
              Would you like this entry added to that day's summary instead of today?
            </p>
            <div className="flex gap-3 mt-6">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => handleTemporalConfirm(false)}
              >
                Keep as Today
              </Button>
              <Button
                variant="primary"
                className="flex-1"
                onClick={() => handleTemporalConfirm(true)}
              >
                Add to {formatEffectiveDate(pendingTemporalEntry.temporal.effectiveDate)}
              </Button>
            </div>
          </ModalBody>
        </Modal>
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
          onUpdate={handleEntryUpdate}
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
          userId={user?.uid}
          category={cat}
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
              onOpenJournal={() => setShowJournal(true)}
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

      <div className="max-w-md mx-auto p-4 pb-28">
        {/* Weekly Digest - Auto-collapsing weekly summary */}
        {entries.length >= 3 && (
          <WeeklyDigest
            entries={entries}
            category={cat}
            userId={user?.uid}
          />
        )}

        {/* Quick Stats Bar - Mood trend, streak, entry distribution */}
        {entries.length > 0 && (
          <QuickStatsBar
            entries={entries}
            category={cat}
          />
        )}

        {/* Mood Heatmap */}
        {entries.length > 0 && (
          <MoodHeatmap
            entries={visible}
            onDayClick={(date, dayData) => setDailySummaryModal({ date, dayData })}
          />
        )}

        {/* Goals Progress - Active goals with status tracking */}
        {entries.length > 0 && (
          <GoalsProgress
            entries={entries}
            category={cat}
            userId={user?.uid}
          />
        )}

        {/* Situation Timeline - Connected multi-entry stories */}
        {entries.length > 0 && (
          <SituationTimeline
            entries={entries}
            category={cat}
            onEntryClick={(entryId) => {
              // Could navigate to entry or show modal
              console.log('Navigate to entry:', entryId);
            }}
          />
        )}

        {/* Day Dashboard */}
        <DayDashboard
          entries={entries}
          category={cat}
          userId={user?.uid}
          user={user}
          onPromptClick={(prompt) => {
            setReplyContext(prompt);
          }}
          onToggleTask={async (task, source, index) => {
            console.log('Completing task:', task, source, index);
            if (user?.uid) {
              await completeActionItem(user.uid, cat, source, index);
            }
          }}
          onShowInsights={() => setShowInsights(true)}
          onStartRecording={() => {
            // Set a supportive prompt that triggers the entry bar
            setReplyContext("Let it out - I'm here to listen.");
          }}
          onStartTextEntry={() => {
            // Set a supportive prompt for text entry
            setReplyContext("Write what's on your mind...");
          }}
        />

        {/* Install Prompt for new users */}
        {entries.length === 0 && (
          <motion.div
            className="mt-8 p-4 bg-primary-50 rounded-2xl text-sm text-primary-800 text-left border border-primary-100"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
          >
            <p className="font-bold mb-1 flex items-center gap-2"><Share size={14}/> Install on iPhone</p>
            <p className="font-body">Tap <strong>Share</strong> → <strong>Add to Home Screen</strong>.</p>
          </motion.div>
        )}
      </div>

      {/* Entry Bar - Always visible at bottom */}
      <EntryBar
        onVoiceSave={handleAudioWrapper}
        onTextSave={saveEntry}
        loading={processing}
        disabled={false}
        promptContext={replyContext}
        onClearPrompt={() => setReplyContext(null)}
      />

      {/* Journal Screen (Timeline) */}
      <AnimatePresence>
        {showJournal && (
          <JournalScreen
            entries={entries}
            category={cat}
            onClose={() => setShowJournal(false)}
            onDelete={id => deleteDoc(doc(db, 'artifacts', APP_COLLECTION_ID, 'users', user.uid, 'entries', id))}
            onUpdate={handleEntryUpdate}
          />
        )}
      </AnimatePresence>

      {view === 'chat' && <Chat entries={visible} onClose={() => setView('feed')} category={cat} />}
      {view === 'realtime' && <RealtimeConversation entries={visible} onClose={() => setView('feed')} category={cat} />}
    </div>
  );
}

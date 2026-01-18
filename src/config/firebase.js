import { initializeApp } from 'firebase/app';
import {
  initializeAuth, getAuth, onAuthStateChanged, signOut, signInWithCustomToken,
  GoogleAuthProvider, signInWithPopup, signInWithCredential, OAuthProvider,
  setPersistence, browserLocalPersistence, indexedDBLocalPersistence, inMemoryPersistence,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail,
  updateProfile,
  // MFA support
  getMultiFactorResolver, PhoneAuthProvider, PhoneMultiFactorGenerator,
  TotpMultiFactorGenerator, RecaptchaVerifier
} from 'firebase/auth';
import {
  getFirestore, collection, addDoc, query, orderBy, onSnapshot,
  Timestamp, deleteDoc, doc, updateDoc, limit, getDocs, setDoc, getDoc,
  where, writeBatch, runTransaction
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Capacitor } from '@capacitor/core';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || (() => {
    throw new Error('VITE_FIREBASE_API_KEY environment variable is required');
  })(),
  authDomain: "echo-vault-app.firebaseapp.com",
  projectId: "echo-vault-app",
  storageBucket: "echo-vault-app.firebasestorage.app",
  messagingSenderId: "581319345416",
  appId: "1:581319345416:web:777247342fffc94989d8bd"
};

const app = initializeApp(firebaseConfig);

// Use initializeAuth with explicit persistence for native platforms
// This avoids the WKWebView hang caused by automatic environment detection
let auth;
if (Capacitor.isNativePlatform()) {
  console.log('[Firebase] Using initializeAuth with browserLocalPersistence for native platform');
  auth = initializeAuth(app, {
    persistence: browserLocalPersistence
  });
} else {
  console.log('[Firebase] Using getAuth for web platform');
  auth = getAuth(app);
}

export { auth };
export const db = getFirestore(app);
export const functions = getFunctions(app);

// Cloud Function callable references with extended timeouts for mobile reliability
export const analyzeJournalEntryFn = httpsCallable(functions, 'analyzeJournalEntry', { timeout: 120000 }); // 2 min
export const generateEmbeddingFn = httpsCallable(functions, 'generateEmbedding', { timeout: 60000 }); // 1 min
export const transcribeAudioFn = httpsCallable(functions, 'transcribeAudio', { timeout: 540000 }); // 9 min - matches server
export const transcribeWithToneFn = httpsCallable(functions, 'transcribeWithTone', { timeout: 540000 }); // 9 min - transcription + voice tone
export const askJournalAIFn = httpsCallable(functions, 'askJournalAI', { timeout: 120000 }); // 2 min
export const executePromptFn = httpsCallable(functions, 'executePrompt', { timeout: 120000 }); // 2 min
export const exchangeGoogleTokenFn = httpsCallable(functions, 'exchangeGoogleToken', { timeout: 30000 }); // 30s - auth should be fast
export const exchangeAppleTokenFn = httpsCallable(functions, 'exchangeAppleToken', { timeout: 30000 }); // 30s - auth should be fast
export const reprocessEntriesForGoalsFn = httpsCallable(functions, 'reprocessEntriesForGoals', { timeout: 540000 }); // 9 min
export const migrateEntitiesFromEntriesFn = httpsCallable(functions, 'migrateEntitiesFromEntries', { timeout: 540000 }); // 9 min

// Expose for console debugging
if (typeof window !== 'undefined') {
  window.__reprocessGoals = () => reprocessEntriesForGoalsFn().then(r => {
    console.log('Reprocess complete:', r.data);
    return r.data;
  });

  // Entity migration - run with dryRun first to see what would be created
  // Usage: __migrateEntities() for dry run, __migrateEntities(false) to actually create
  window.__migrateEntities = (dryRun = true, limit = 200) => migrateEntitiesFromEntriesFn({ dryRun, limit }).then(r => {
    console.log('Migration result:', r.data);
    return r.data;
  });
}

// Re-export Firebase utilities for convenience
export {
  onAuthStateChanged,
  signOut,
  signInWithCustomToken,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithCredential,
  OAuthProvider,
  setPersistence,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  inMemoryPersistence,
  // Email/password auth
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
  // MFA support
  getMultiFactorResolver,
  PhoneAuthProvider,
  PhoneMultiFactorGenerator,
  TotpMultiFactorGenerator,
  RecaptchaVerifier,
  // Firestore
  collection,
  addDoc,
  query,
  orderBy,
  onSnapshot,
  Timestamp,
  deleteDoc,
  doc,
  updateDoc,
  limit,
  getDocs,
  setDoc,
  getDoc,
  where,
  writeBatch,
  runTransaction
};

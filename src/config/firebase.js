import { initializeApp } from 'firebase/app';
import {
  getAuth, onAuthStateChanged, signOut, signInWithCustomToken,
  GoogleAuthProvider, signInWithPopup
} from 'firebase/auth';
import {
  getFirestore, collection, addDoc, query, orderBy, onSnapshot,
  Timestamp, deleteDoc, doc, updateDoc, limit, getDocs, setDoc, getDoc
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyBuhwHcdxEuYHf6F5SVlWR5BLRio_7kqAg",
  authDomain: "echo-vault-app.firebaseapp.com",
  projectId: "echo-vault-app",
  storageBucket: "echo-vault-app.firebasestorage.app",
  messagingSenderId: "581319345416",
  appId: "1:581319345416:web:777247342fffc94989d8bd"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app);

// Cloud Function callable references with extended timeouts for mobile reliability
export const analyzeJournalEntryFn = httpsCallable(functions, 'analyzeJournalEntry', { timeout: 120000 }); // 2 min
export const generateEmbeddingFn = httpsCallable(functions, 'generateEmbedding', { timeout: 60000 }); // 1 min
export const transcribeAudioFn = httpsCallable(functions, 'transcribeAudio', { timeout: 540000 }); // 9 min - matches server
export const askJournalAIFn = httpsCallable(functions, 'askJournalAI', { timeout: 120000 }); // 2 min
export const executePromptFn = httpsCallable(functions, 'executePrompt', { timeout: 120000 }); // 2 min

// Re-export Firebase utilities for convenience
export {
  onAuthStateChanged,
  signOut,
  signInWithCustomToken,
  GoogleAuthProvider,
  signInWithPopup,
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
  getDoc
};

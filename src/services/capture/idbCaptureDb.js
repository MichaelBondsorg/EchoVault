/**
 * Shared low-level IndexedDB plumbing for the `engram-capture` database.
 *
 * Two independent modules read/write this database — webChunkStore.js
 * (in-flight recording chunks) and audioVault.js (durable web blob storage,
 * `vault` store). IndexedDB only fires `onupgradeneeded` for the connection
 * that triggers a version bump, so schema creation for ALL stores lives
 * here, in one place, shared by both consumers via a cached open() promise.
 *
 * Feature-detected: on platforms without IndexedDB (SSR, some native
 * WebViews), `hasIndexedDb()` returns false and `openCaptureDb()` resolves
 * to null — callers must tolerate a null db and no-op.
 */

const DB_NAME = 'engram-capture';
const DB_VERSION = 1;

const getIdbGlobal = () => {
  if (typeof indexedDB !== 'undefined') return indexedDB;
  if (typeof globalThis !== 'undefined' && globalThis.indexedDB) return globalThis.indexedDB;
  return null;
};

export const hasIndexedDb = () => getIdbGlobal() !== null;

export const getKeyRange = () => {
  if (typeof IDBKeyRange !== 'undefined') return IDBKeyRange;
  if (typeof globalThis !== 'undefined' && globalThis.IDBKeyRange) return globalThis.IDBKeyRange;
  return null;
};

export const reqP = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('idb_request_failed'));
  });

let dbPromise = null;

/** Reset the cached connection — test-only helper. */
export const __resetCaptureDb = () => {
  dbPromise = null;
};

export const openCaptureDb = () => {
  const idb = getIdbGlobal();
  if (!idb) return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    const request = idb.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('chunks')) {
        const chunkStore = db.createObjectStore('chunks', { keyPath: ['ownerUid', 'draftId', 'seq'] });
        chunkStore.createIndex('byDraft', ['ownerUid', 'draftId']);
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: ['ownerUid', 'draftId'] });
      }
      if (!db.objectStoreNames.contains('vault')) {
        db.createObjectStore('vault', { keyPath: ['ownerUid', 'id'] });
      }
    };
    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = () => resolve(null);
  });

  return dbPromise;
};

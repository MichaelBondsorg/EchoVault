/**
 * Service Worker for background audio processing
 *
 * This service worker enables audio transcription to continue even when:
 * - The user locks their phone
 * - The user switches to another app
 * - The browser tab is backgrounded
 *
 * It uses the Background Sync API to queue transcription requests
 * that will be processed when conditions allow.
 */

const CACHE_NAME = 'echov-audio-v1';
const PENDING_TRANSCRIPTIONS_STORE = 'pending-transcriptions';

// Listen for install event
self.addEventListener('install', (event) => {
  console.log('[SW-Audio] Service worker installed');
  self.skipWaiting();
});

// Listen for activate event
self.addEventListener('activate', (event) => {
  console.log('[SW-Audio] Service worker activated');
  event.waitUntil(clients.claim());
});

// Handle messages from the main app
self.addEventListener('message', async (event) => {
  const { type, payload } = event.data;

  if (type === 'QUEUE_TRANSCRIPTION') {
    console.log('[SW-Audio] Queueing transcription request');

    // Store the transcription request in IndexedDB
    try {
      await storeTranscriptionRequest(payload);

      // Try to register a sync event
      if ('sync' in self.registration) {
        await self.registration.sync.register('process-transcription');
        console.log('[SW-Audio] Sync registered');
      } else {
        // No sync API, try to process immediately
        await processTranscription(payload);
      }

      // Notify the client
      event.source.postMessage({ type: 'TRANSCRIPTION_QUEUED', id: payload.id });
    } catch (error) {
      console.error('[SW-Audio] Failed to queue transcription:', error);
      event.source.postMessage({ type: 'TRANSCRIPTION_ERROR', error: error.message });
    }
  }

  if (type === 'CHECK_PENDING') {
    const pending = await getPendingTranscriptions();
    event.source.postMessage({ type: 'PENDING_TRANSCRIPTIONS', pending });
  }
});

// Background sync event - process queued transcriptions
self.addEventListener('sync', async (event) => {
  if (event.tag === 'process-transcription') {
    console.log('[SW-Audio] Processing queued transcriptions');
    event.waitUntil(processAllPendingTranscriptions());
  }
});

// IndexedDB helpers
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('echov-audio-db', 1);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(PENDING_TRANSCRIPTIONS_STORE)) {
        db.createObjectStore(PENDING_TRANSCRIPTIONS_STORE, { keyPath: 'id' });
      }
    };
  });
}

async function storeTranscriptionRequest(request) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PENDING_TRANSCRIPTIONS_STORE, 'readwrite');
    const store = tx.objectStore(PENDING_TRANSCRIPTIONS_STORE);

    const req = store.put({
      ...request,
      createdAt: Date.now(),
      status: 'pending'
    });

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getPendingTranscriptions() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PENDING_TRANSCRIPTIONS_STORE, 'readonly');
    const store = tx.objectStore(PENDING_TRANSCRIPTIONS_STORE);
    const req = store.getAll();

    req.onsuccess = () => resolve(req.result.filter(t => t.status === 'pending'));
    req.onerror = () => reject(req.error);
  });
}

async function updateTranscriptionStatus(id, status, result = null) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PENDING_TRANSCRIPTIONS_STORE, 'readwrite');
    const store = tx.objectStore(PENDING_TRANSCRIPTIONS_STORE);

    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const data = getReq.result;
      if (data) {
        data.status = status;
        if (result) data.result = result;
        data.updatedAt = Date.now();
        store.put(data);
      }
      resolve();
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

async function deleteTranscription(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PENDING_TRANSCRIPTIONS_STORE, 'readwrite');
    const store = tx.objectStore(PENDING_TRANSCRIPTIONS_STORE);
    const req = store.delete(id);

    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// Process a single transcription
async function processTranscription(request) {
  const { id, base64, mime, functionUrl } = request;

  console.log('[SW-Audio] Processing transcription:', id);

  try {
    await updateTranscriptionStatus(id, 'processing');

    // Make the API request
    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: { audio: base64, mimeType: mime }
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const result = await response.json();

    // Notify all clients about the result
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({
        type: 'TRANSCRIPTION_COMPLETE',
        id,
        result: result.result || result
      });
    });

    // Clean up
    await deleteTranscription(id);
    console.log('[SW-Audio] Transcription complete:', id);

    return result;
  } catch (error) {
    console.error('[SW-Audio] Transcription failed:', error);
    await updateTranscriptionStatus(id, 'failed', { error: error.message });
    throw error;
  }
}

// Process all pending transcriptions
async function processAllPendingTranscriptions() {
  const pending = await getPendingTranscriptions();
  console.log('[SW-Audio] Processing', pending.length, 'pending transcriptions');

  for (const request of pending) {
    try {
      await processTranscription(request);
    } catch (error) {
      console.error('[SW-Audio] Failed to process transcription:', request.id, error);
    }
  }
}

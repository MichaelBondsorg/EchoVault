import { useState, useCallback, useEffect, useRef } from 'react';

/**
 * Hook to handle background audio processing
 *
 * This hook enables audio transcription to continue even when:
 * - The user locks their phone
 * - The user switches to another app
 * - The browser tab is backgrounded
 *
 * It uses a combination of:
 * - Service Worker with Background Sync for offline/background processing
 * - localStorage backup for recovery
 * - Visibility API for detecting background state
 */
export const useBackgroundAudio = () => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [wasBackgrounded, setWasBackgrounded] = useState(false);
  const swRef = useRef(null);
  const pendingCallbacksRef = useRef(new Map());

  // Register service worker
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw-audio.js')
        .then((registration) => {
          console.log('[BackgroundAudio] Service worker registered');
          swRef.current = registration;
        })
        .catch((error) => {
          console.warn('[BackgroundAudio] Service worker registration failed:', error);
        });

      // Listen for messages from service worker
      navigator.serviceWorker.addEventListener('message', (event) => {
        const { type, id, result, error, pending } = event.data;

        if (type === 'TRANSCRIPTION_COMPLETE') {
          console.log('[BackgroundAudio] Transcription completed in background:', id);
          const callback = pendingCallbacksRef.current.get(id);
          if (callback) {
            callback.resolve(result);
            pendingCallbacksRef.current.delete(id);
          }
          setIsProcessing(pendingCallbacksRef.current.size > 0);
          checkPendingTranscriptions();
        }

        if (type === 'TRANSCRIPTION_ERROR') {
          console.error('[BackgroundAudio] Transcription error:', error);
          const callback = pendingCallbacksRef.current.get(id);
          if (callback) {
            callback.reject(new Error(error));
            pendingCallbacksRef.current.delete(id);
          }
          setIsProcessing(pendingCallbacksRef.current.size > 0);
        }

        if (type === 'PENDING_TRANSCRIPTIONS') {
          setPendingCount(pending?.length || 0);
        }
      });
    }
  }, []);

  // Track visibility changes
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && isProcessing) {
        console.log('[BackgroundAudio] App backgrounded while processing');
        setWasBackgrounded(true);
      } else if (document.visibilityState === 'visible') {
        if (wasBackgrounded) {
          console.log('[BackgroundAudio] App returned from background');
          // Check if we have pending transcriptions in the service worker
          checkPendingTranscriptions();
        }
        setWasBackgrounded(false);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isProcessing, wasBackgrounded]);

  // Check for pending transcriptions
  const checkPendingTranscriptions = useCallback(() => {
    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'CHECK_PENDING' });
    }
  }, []);

  /**
   * Queue an audio transcription for background processing
   * This will continue even if the app is backgrounded
   */
  const queueTranscription = useCallback(async (base64, mime, functionUrl) => {
    const id = `transcription_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // If service worker is available, use it for background processing
    if (navigator.serviceWorker?.controller) {
      setIsProcessing(true);

      return new Promise((resolve, reject) => {
        pendingCallbacksRef.current.set(id, { resolve, reject });

        navigator.serviceWorker.controller.postMessage({
          type: 'QUEUE_TRANSCRIPTION',
          payload: { id, base64, mime, functionUrl }
        });

        // Set a timeout for the transcription (5 minutes)
        setTimeout(() => {
          if (pendingCallbacksRef.current.has(id)) {
            pendingCallbacksRef.current.delete(id);
            setIsProcessing(pendingCallbacksRef.current.size > 0);
            reject(new Error('Transcription timed out'));
          }
        }, 5 * 60 * 1000);
      });
    }

    // Fallback: no service worker, return null to use normal processing
    console.log('[BackgroundAudio] No service worker, using normal processing');
    return null;
  }, []);

  /**
   * Backup audio to localStorage for recovery
   */
  const backupAudio = useCallback((base64, mime) => {
    const key = `echov_audio_backup_${Date.now()}`;
    try {
      if (base64.length < 10 * 1024 * 1024) {
        localStorage.setItem(key, JSON.stringify({
          base64,
          mime,
          timestamp: Date.now()
        }));
        console.log('[BackgroundAudio] Audio backed up:', key);
        return key;
      }
    } catch (error) {
      console.warn('[BackgroundAudio] Backup failed:', error);
    }
    return null;
  }, []);

  /**
   * Clear audio backup after successful processing
   */
  const clearBackup = useCallback((key) => {
    if (key) {
      try {
        localStorage.removeItem(key);
        console.log('[BackgroundAudio] Backup cleared:', key);
      } catch (error) {
        console.warn('[BackgroundAudio] Failed to clear backup:', error);
      }
    }
  }, []);

  /**
   * Recover any backed up audio
   */
  const recoverBackups = useCallback(() => {
    const backups = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('echov_audio_backup_')) {
        try {
          const data = JSON.parse(localStorage.getItem(key));
          // Only recover backups less than 24 hours old
          if (data.timestamp && Date.now() - data.timestamp < 24 * 60 * 60 * 1000) {
            backups.push({ key, ...data });
          }
        } catch (error) {
          // Invalid data
        }
      }
    }
    return backups;
  }, []);

  return {
    isProcessing,
    pendingCount,
    wasBackgrounded,
    queueTranscription,
    backupAudio,
    clearBackup,
    recoverBackups,
    checkPendingTranscriptions
  };
};

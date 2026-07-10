import { useCallback } from 'react';

/**
 * Hook to handle audio backup and recovery
 *
 * Provides localStorage-based backup for audio data recovery.
 * Service worker removed in favor of Gemini fused transcription.
 */
export const useBackgroundAudio = () => {
  // Keeping this hook for backup/recovery functions only
  // Service worker removed: now using Gemini fused transcription

  // Service worker removed: now using Gemini fused transcription via transcribeEntry
  // Keeping backup/recovery functions for graceful degradation


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
    backupAudio,
    clearBackup,
    recoverBackups
  };
};

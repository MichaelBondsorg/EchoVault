import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, Square, Keyboard, X, Loader2, Send } from 'lucide-react';

/**
 * EntryBar - Persistent bottom bar for instant entry creation
 *
 * Features:
 * - One-tap voice recording (mic turns red and starts immediately)
 * - One-tap text input (keyboard opens immediately)
 * - Always visible at bottom of screen
 * - Can show prompt context when responding to a prompt
 */
const EntryBar = ({ onVoiceSave, onTextSave, loading, disabled, promptContext, onClearPrompt }) => {
  const [mode, setMode] = useState('idle'); // idle, recording, typing
  const [recording, setRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [textValue, setTextValue] = useState('');
  const timerRef = useRef(null);
  const textInputRef = useRef(null);

  // Use refs to always have the latest callbacks
  // This prevents stale closure issues during long recordings
  const onVoiceSaveRef = useRef(onVoiceSave);
  const onTextSaveRef = useRef(onTextSave);
  useEffect(() => {
    onVoiceSaveRef.current = onVoiceSave;
    onTextSaveRef.current = onTextSave;
  }, [onVoiceSave, onTextSave]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Auto-open text mode when prompt context is provided
  useEffect(() => {
    if (promptContext && mode === 'idle') {
      setMode('typing');
    }
  }, [promptContext]);

  // Focus text input when switching to typing mode
  useEffect(() => {
    if (mode === 'typing' && textInputRef.current) {
      textInputRef.current.focus();
    }
  }, [mode]);

  const startRecording = async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("Microphone access not available in this browser");
      return;
    }

    try {
      console.log('[Recording] Starting microphone capture...');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
      console.log('[Recording] Using MIME type:', mime);

      const recorder = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 16000 });
      const chunks = [];

      recorder.ondataavailable = e => {
        if (e.data && e.data.size > 0) {
          chunks.push(e.data);
          console.log('[Recording] Chunk received:', e.data.size, 'bytes, total chunks:', chunks.length);
        }
      };

      recorder.onerror = (e) => {
        console.error('[Recording] MediaRecorder error:', e);
        alert('Recording error occurred. Please try again.');
        setMode('idle');
        setRecording(false);
        clearInterval(timerRef.current);
        stream.getTracks().forEach(t => t.stop());
      };

      recorder.onstop = () => {
        console.log('[Recording] Stopped. Total chunks:', chunks.length);

        // Validate we have data
        if (chunks.length === 0) {
          console.error('[Recording] No audio data captured!');
          alert('No audio was captured. Please try again.');
          setMode('idle');
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        const blob = new Blob(chunks, { type: mime });
        console.log('[Recording] Created blob:', blob.size, 'bytes');

        if (blob.size === 0) {
          console.error('[Recording] Blob is empty!');
          alert('Recording failed - no data. Please try again.');
          setMode('idle');
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        const reader = new FileReader();

        reader.onerror = (e) => {
          console.error('[Recording] FileReader error:', e);
          alert('Failed to process recording. Please try again.');
          setMode('idle');
          stream.getTracks().forEach(t => t.stop());
        };

        reader.onloadend = () => {
          console.log('[Recording] FileReader complete, result length:', reader.result?.length || 0);

          if (!reader.result || reader.result.length < 100) {
            console.error('[Recording] FileReader result is empty or too small');
            alert('Recording processing failed. Please try again.');
            setMode('idle');
            stream.getTracks().forEach(t => t.stop());
            return;
          }

          const base64 = reader.result.split(',')[1];
          console.log('[Recording] Base64 length:', base64?.length || 0);

          if (!base64 || base64.length < 100) {
            console.error('[Recording] Base64 conversion failed');
            alert('Recording processing failed. Please try again.');
            setMode('idle');
            stream.getTracks().forEach(t => t.stop());
            return;
          }

          // Use ref to get the latest callback, avoiding stale closure
          console.log('[Recording] Sending to transcription...');
          onVoiceSaveRef.current(base64, mime);
          setMode('idle');
        };

        reader.readAsDataURL(blob);
        stream.getTracks().forEach(t => t.stop());
      };

      // Start recording with timeslice to capture data in chunks
      // This is crucial for mobile - ensures data is captured incrementally
      // rather than all at once when stopping (which can fail on mobile)
      recorder.start(1000); // Capture chunk every 1 second
      console.log('[Recording] MediaRecorder started with 1s timeslice');

      setMediaRecorder(recorder);
      setRecording(true);
      setMode('recording');
      setRecordingSeconds(0);
      timerRef.current = setInterval(() => setRecordingSeconds(s => s + 1), 1000);
    } catch (e) {
      console.error('[Recording] Setup error:', e);
      alert("Microphone access denied or error occurred: " + e.message);
    }
  };

  const stopRecording = () => {
    if (mediaRecorder) {
      mediaRecorder.stop();
      setRecording(false);
      clearInterval(timerRef.current);
    }
  };

  const handleMicClick = () => {
    if (mode === 'recording') {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const handleKeyboardClick = () => {
    setMode('typing');
    setTextValue('');
  };

  const handleTextSubmit = () => {
    if (textValue.trim()) {
      // If responding to a prompt, prefix the entry with the context
      const finalText = promptContext
        ? `[Responding to: "${promptContext}"]\n\n${textValue.trim()}`
        : textValue.trim();
      // Use ref to get the latest callback, avoiding stale closure
      onTextSaveRef.current(finalText);
      setTextValue('');
      setMode('idle');
      if (onClearPrompt) onClearPrompt();
    }
  };

  const handleTextCancel = () => {
    setTextValue('');
    setMode('idle');
    if (onClearPrompt) onClearPrompt();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleTextSubmit();
    }
    if (e.key === 'Escape') {
      handleTextCancel();
    }
  };

  const formatTime = (secs) => {
    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    return `${mins}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-20 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      <AnimatePresence mode="wait">
        {/* Loading Overlay */}
        {loading && (
          <motion.div
            className="absolute inset-0 bg-white/95 backdrop-blur-sm flex justify-center items-center z-30"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="flex items-center gap-2 text-primary-600 font-medium">
              <Loader2 className="animate-spin" size={20} />
              <span>Processing...</span>
            </div>
          </motion.div>
        )}

        {/* Text Input Mode */}
        {mode === 'typing' && (
          <motion.div
            className="bg-white border-t border-warm-200 shadow-soft-lg p-3"
            initial={{ y: 100 }}
            animate={{ y: 0 }}
            exit={{ y: 100 }}
          >
            <div className="max-w-md mx-auto">
              {/* Prompt Context Banner */}
              {promptContext && (
                <div className="mb-2 px-3 py-2 bg-primary-50 rounded-xl text-xs text-primary-700">
                  <span className="font-semibold">Responding to:</span> "{promptContext}"
                </div>
              )}
              <div className="flex gap-2 items-end">
                <div className="flex-1 relative">
                  <textarea
                    ref={textInputRef}
                    value={textValue}
                    onChange={(e) => setTextValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={promptContext ? "Your response..." : "What's on your mind?"}
                    className="w-full p-3 pr-10 border border-warm-200 rounded-2xl resize-none focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent min-h-[48px] max-h-[120px] font-body text-warm-800"
                    rows={1}
                    style={{ height: 'auto' }}
                    onInput={(e) => {
                      e.target.style.height = 'auto';
                      e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
                    }}
                  />
                </div>
                <motion.button
                  onClick={handleTextCancel}
                  className="p-3 text-warm-400 hover:text-warm-600 hover:bg-warm-100 rounded-full"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <X size={20} />
                </motion.button>
                <motion.button
                  onClick={handleTextSubmit}
                  disabled={!textValue.trim()}
                  className={`p-3 rounded-full ${textValue.trim() ? 'bg-primary-600 text-white' : 'bg-warm-100 text-warm-300'}`}
                  whileHover={textValue.trim() ? { scale: 1.05 } : {}}
                  whileTap={textValue.trim() ? { scale: 0.95 } : {}}
                >
                  <Send size={20} />
                </motion.button>
              </div>
            </div>
          </motion.div>
        )}

        {/* Recording Mode */}
        {mode === 'recording' && (
          <motion.div
            className="bg-white border-t border-warm-200 shadow-soft-lg p-4"
            initial={{ y: 100 }}
            animate={{ y: 0 }}
            exit={{ y: 100 }}
          >
            <div className="max-w-md mx-auto flex items-center justify-center gap-6">
              <div className="text-warm-500 text-sm font-mono w-12">
                {formatTime(recordingSeconds)}
              </div>
              <motion.button
                onClick={handleMicClick}
                className="h-16 w-16 rounded-full bg-red-500 flex items-center justify-center shadow-lg"
                animate={{ scale: [1, 1.08, 1] }}
                transition={{ duration: 1.5, repeat: Infinity }}
              >
                <Square className="text-white fill-white" size={24} />
              </motion.button>
              <div className="w-12 flex justify-center">
                <motion.div
                  className="h-3 w-3 rounded-full bg-red-500"
                  animate={{ opacity: [1, 0.3, 1] }}
                  transition={{ duration: 1, repeat: Infinity }}
                />
              </div>
            </div>
          </motion.div>
        )}

        {/* Idle Mode - Show both buttons */}
        {mode === 'idle' && (
          <motion.div
            className="bg-white/95 backdrop-blur-sm border-t border-warm-200 shadow-soft-lg p-4"
            initial={{ y: 100 }}
            animate={{ y: 0 }}
            exit={{ y: 100 }}
          >
            <div className="max-w-md mx-auto flex items-center justify-center gap-8">
              {/* Mic Button */}
              <motion.button
                onClick={handleMicClick}
                disabled={disabled || loading}
                className="h-14 w-14 rounded-full bg-primary-600 flex items-center justify-center shadow-soft-lg hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <Mic className="text-white" size={26} />
              </motion.button>

              {/* Keyboard Button */}
              <motion.button
                onClick={handleKeyboardClick}
                disabled={disabled || loading}
                className="h-14 w-14 rounded-full bg-warm-100 flex items-center justify-center shadow-soft hover:bg-warm-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <Keyboard className="text-warm-600" size={26} />
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default EntryBar;

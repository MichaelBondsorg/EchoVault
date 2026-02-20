import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Mic, Square, Keyboard, Loader2 } from 'lucide-react';

const VoiceRecorder = ({ onSave, onSwitch, loading, minimal }) => {
  const [rec, setRec] = useState(false);
  const [mr, setMr] = useState(null);
  const [secs, setSecs] = useState(0);
  const timer = useRef(null);
  const streamRef = useRef(null); // FIX: Store media stream for cleanup on unmount

  // Use ref to always have the latest onSave callback
  // This prevents stale closure issues during long recordings
  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  // FIX: Cleanup effect ensures stream is stopped on unmount, even if recording is active
  useEffect(() => {
    return () => {
      console.log('[VoiceRecorder] Unmount cleanup, runId:post-fix');
      if (timer.current) clearInterval(timer.current);
      // FIX: Ensure stream is cleaned up even if recording is active
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        console.log('[VoiceRecorder] Stream cleaned up on unmount, runId:post-fix');
      }
    };
  }, []);

  const start = async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("Microphone access not available in this browser");
      return;
    }

    try {
      console.log('[VoiceRecorder] Starting microphone capture...');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream; // FIX: Store stream in ref for cleanup
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
      console.log('[VoiceRecorder] Using MIME type:', mime);

      const r = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 16000 });
      const chunks = [];

      r.ondataavailable = e => {
        if (e.data && e.data.size > 0) {
          chunks.push(e.data);
          console.log('[VoiceRecorder] Chunk received:', e.data.size, 'bytes');
        }
      };

      r.onerror = (e) => {
        console.error('[VoiceRecorder] MediaRecorder error:', e);
        alert('Recording error occurred. Please try again.');
        setRec(false);
        clearInterval(timer.current);
        stream.getTracks().forEach(t => t.stop());
        streamRef.current = null; // FIX: Clear ref after cleanup
      };

      r.onstop = () => {
        console.log('[VoiceRecorder] Stopped. Total chunks:', chunks.length);

        // Helper to cleanup stream and clear ref
        const cleanupStream = () => {
          stream.getTracks().forEach(t => t.stop());
          streamRef.current = null; // FIX: Clear ref after cleanup
        };

        if (chunks.length === 0) {
          console.error('[VoiceRecorder] No audio data captured!');
          alert('No audio was captured. Please try again.');
          cleanupStream();
          return;
        }

        const blob = new Blob(chunks, { type: mime });
        console.log('[VoiceRecorder] Created blob:', blob.size, 'bytes');

        if (blob.size === 0) {
          console.error('[VoiceRecorder] Blob is empty!');
          alert('Recording failed - no data. Please try again.');
          cleanupStream();
          return;
        }

        const reader = new FileReader();

        reader.onerror = (e) => {
          console.error('[VoiceRecorder] FileReader error:', e);
          alert('Failed to process recording. Please try again.');
          cleanupStream();
        };

        reader.onloadend = () => {
          console.log('[VoiceRecorder] FileReader complete, result length:', reader.result?.length || 0);

          if (!reader.result || reader.result.length < 100) {
            console.error('[VoiceRecorder] FileReader result is empty');
            alert('Recording processing failed. Please try again.');
            cleanupStream();
            return;
          }

          const base64 = reader.result.split(',')[1];
          console.log('[VoiceRecorder] Base64 length:', base64?.length || 0);

          if (!base64 || base64.length < 100) {
            console.error('[VoiceRecorder] Base64 conversion failed');
            alert('Recording processing failed. Please try again.');
            cleanupStream();
            return;
          }

          // Use ref to get the latest onSave callback, avoiding stale closure
          console.log('[VoiceRecorder] Sending to transcription...');
          onSaveRef.current(base64, mime);
        };

        reader.readAsDataURL(blob);
        cleanupStream();
      };

      // Start with timeslice for incremental data capture (crucial for mobile)
      r.start(1000);
      console.log('[VoiceRecorder] MediaRecorder started with 1s timeslice');

      setMr(r);
      setRec(true);
      setSecs(0);
      timer.current = setInterval(() => setSecs(s => s + 1), 1000);
    } catch (e) {
      console.error('[VoiceRecorder] Setup error:', e);
      alert("Microphone access denied or error occurred: " + e.message);
    }
  };

  const stop = () => {
    if (mr) {
      mr.stop();
      setRec(false);
      clearInterval(timer.current);
    }
  };

  if (minimal) {
    return (
      <motion.button
        onClick={rec ? stop : start}
        whileHover={{ scale: rec ? 1 : 1.05 }}
        whileTap={{ scale: 0.95 }}
        animate={rec ? { scale: [1, 1.1, 1] } : {}}
        transition={rec ? { duration: 1.5, repeat: Infinity } : {}}
        className={`h-16 w-16 rounded-full flex items-center justify-center shadow-soft-lg transition-all ${rec ? 'bg-red-500' : 'bg-terra-500 hover:bg-terra-600'}`}
      >
        {rec ? <Square className="text-white fill-current"/> : <Mic className="text-white" size={32}/>}
      </motion.button>
    );
  }

  return (
    <div className="fixed bottom-0 w-full bg-white/80 backdrop-blur-sm border-t border-warm-200 p-4 z-20 pb-[max(2rem,env(safe-area-inset-bottom))] shadow-soft-lg">
      {loading && <div className="absolute inset-0 bg-white/90 flex justify-center items-center z-30 text-honey-600 font-medium"><Loader2 className="animate-spin mr-2"/> Processing...</div>}
      <div className="flex justify-between items-center max-w-md mx-auto">
        <button onClick={onSwitch} disabled={rec} className="p-3 rounded-full text-warm-400 hover:bg-warm-100"><Keyboard size={24}/></button>
        <motion.button
          onClick={rec ? stop : start}
          whileHover={{ scale: rec ? 1 : 1.05 }}
          whileTap={{ scale: 0.95 }}
          animate={rec ? { scale: [1, 1.1, 1] } : {}}
          transition={rec ? { duration: 1.5, repeat: Infinity } : {}}
          className={`h-16 w-16 rounded-full flex items-center justify-center shadow-soft-lg transition-all ${rec ? 'bg-red-500' : 'bg-terra-500 hover:bg-terra-600'}`}
        >
          {rec ? <Square className="text-white fill-current"/> : <Mic className="text-white" size={32}/>}
        </motion.button>
        <div className="w-12 flex justify-center">{rec && <div className="bg-warm-800 text-white text-xs font-mono py-1 px-2 rounded-lg">{Math.floor(secs/60)}:{String(secs%60).padStart(2,'0')}</div>}</div>
      </div>
    </div>
  );
};

export default VoiceRecorder;

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, MessageCircle, Sparkles, RefreshCw, Mic, Keyboard, Square, Loader2, Send, Brain } from 'lucide-react';
import { getPromptsForSession } from '../../utils/prompts';

const PromptScreen = ({ prompts, allSmartPrompts = [], mode, onModeChange, onSave, onClose, loading, category, onRefreshPrompts }) => {
  const [textValue, setTextValue] = useState('');
  const [recording, setRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [displayPrompts, setDisplayPrompts] = useState([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [promptSource, setPromptSource] = useState('smart'); // 'smart' or 'template'
  const timerRef = useRef(null);
  const shownSmartPromptsRef = useRef(new Set());

  // Initialize with smart prompts on mount, prioritizing bespoke reflections
  useEffect(() => {
    if (prompts.length > 0) {
      // Start with up to 3 smart prompts
      const initialPrompts = prompts.slice(0, 3);
      initialPrompts.forEach(p => shownSmartPromptsRef.current.add(p));
      setDisplayPrompts(initialPrompts);
      setPromptSource('smart');
    } else {
      // No smart prompts available, fall back to templates
      const result = getPromptsForSession(category, []);
      setDisplayPrompts(result.prompts);
      setPromptSource('template');
    }
  }, []); // Only run on mount

  // Update if prompts change significantly (e.g., category switch)
  useEffect(() => {
    if (prompts.length > 0 && displayPrompts.length === 0) {
      const initialPrompts = prompts.slice(0, 3);
      initialPrompts.forEach(p => shownSmartPromptsRef.current.add(p));
      setDisplayPrompts(initialPrompts);
      setPromptSource('smart');
    }
  }, [prompts]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const handleRefresh = () => {
    setIsRefreshing(true);

    // Get smart prompts that haven't been shown yet
    const allSmart = allSmartPrompts.length > 0 ? allSmartPrompts : prompts;
    const unshownSmartPrompts = allSmart.filter(p => !shownSmartPromptsRef.current.has(p));

    if (unshownSmartPrompts.length > 0) {
      // Show next batch of smart prompts
      const nextBatch = unshownSmartPrompts.slice(0, 3);
      nextBatch.forEach(p => shownSmartPromptsRef.current.add(p));
      setDisplayPrompts(nextBatch);
      setPromptSource('smart');
      if (onRefreshPrompts) onRefreshPrompts(nextBatch);
    } else {
      // All smart prompts exhausted, fall back to templates
      const result = getPromptsForSession(category, []);
      setDisplayPrompts(result.prompts);
      setPromptSource('template');
      if (onRefreshPrompts) onRefreshPrompts(result.prompts);
    }

    setTimeout(() => setIsRefreshing(false), 300);
  };

  const startRecording = async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("Microphone access not available");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
      const recorder = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 128000 });
      const chunks = [];

      recorder.ondataavailable = e => chunks.push(e.data);
      recorder.onstop = () => {
        const reader = new FileReader();
        reader.readAsDataURL(new Blob(chunks, { type: mime }));
        reader.onloadend = () => onSave(reader.result.split(',')[1], mime);
        stream.getTracks().forEach(t => t.stop());
      };

      recorder.start();
      setMediaRecorder(recorder);
      setRecording(true);
      setRecordSeconds(0);
      timerRef.current = setInterval(() => setRecordSeconds(s => s + 1), 1000);
    } catch (e) {
      alert("Microphone access denied");
      console.error(e);
    }
  };

  const stopRecording = () => {
    if (mediaRecorder) {
      mediaRecorder.stop();
      setRecording(false);
      clearInterval(timerRef.current);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="fixed inset-0 bg-warm-50 z-40 flex flex-col pt-[env(safe-area-inset-top)]"
    >
      <div className="p-4 border-b border-honey-100 flex justify-between items-center bg-gradient-to-r from-honey-500 to-honey-600 text-white shadow-soft">
        <h2 className="font-display font-bold text-lg flex gap-2 items-center"><MessageCircle size={20}/> New Entry</h2>
        <motion.button
          onClick={onClose}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          className="p-1 hover:bg-white/20 rounded-full"
        >
          <X size={24}/>
        </motion.button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 bg-warm-50">
        {displayPrompts.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4"
          >
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-xs font-display font-bold text-warm-500 uppercase tracking-wide flex items-center gap-2">
                {promptSource === 'smart' ? (
                  <>
                    <Brain size={12} className="text-purple-500"/> Your Reflections
                  </>
                ) : (
                  <>
                    <Sparkles size={12} className="text-accent"/> Prompts to Consider
                  </>
                )}
              </h3>
              <button
                onClick={handleRefresh}
                className={`text-xs text-honey-600 hover:text-honey-700 flex items-center gap-1 transition-transform ${isRefreshing ? 'animate-spin' : ''}`}
                title={promptSource === 'smart' ? "See more personal reflections" : "Get new prompts"}
              >
                <RefreshCw size={14} />
                {promptSource === 'smart' ? 'More' : 'Refresh'}
              </button>
            </div>
            <div className={`rounded-2xl p-4 border shadow-soft transition-opacity ${isRefreshing ? 'opacity-50' : ''} ${
              promptSource === 'smart'
                ? 'bg-gradient-to-br from-purple-50 to-indigo-50 border-purple-100'
                : 'bg-white border-warm-200'
            }`}>
              {promptSource === 'smart' && (
                <p className="text-[10px] text-purple-600 font-medium mb-2 uppercase tracking-wider">Based on your recent entries</p>
              )}
              <div className="space-y-2">
                {displayPrompts.map((prompt, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.1 }}
                    className="flex items-start gap-2"
                  >
                    <span className={`text-xs mt-0.5 ${promptSource === 'smart' ? 'text-purple-500' : 'text-honey-500'}`}>•</span>
                    <p className="text-sm text-warm-700 italic font-body">"{prompt}"</p>
                  </motion.div>
                ))}
              </div>
            </div>
            <button
              onClick={() => onModeChange('skip')}
              className="mt-2 text-xs text-warm-400 hover:text-warm-600"
            >
              Skip prompts and write freely
            </button>
          </motion.div>
        )}

        {!mode && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4"
          >
            <h3 className="text-xs font-display font-bold text-warm-500 uppercase tracking-wide mb-2">Choose input method</h3>
            <div className="grid grid-cols-2 gap-3">
              <motion.button
                onClick={() => onModeChange('voice')}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="bg-gradient-to-r from-terra-500 to-terra-600 text-white p-6 rounded-2xl shadow-soft-lg hover:shadow-xl transition-all flex flex-col items-center gap-2"
              >
                <Mic size={28} className="opacity-90"/>
                <span className="font-display font-bold text-base">Record</span>
              </motion.button>
              <motion.button
                onClick={() => onModeChange('text')}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="bg-gradient-to-r from-honey-500 to-honey-600 text-white p-6 rounded-2xl shadow-soft-lg hover:shadow-xl transition-all flex flex-col items-center gap-2"
              >
                <Keyboard size={28} className="opacity-90"/>
                <span className="font-display font-bold text-base">Type</span>
              </motion.button>
            </div>
          </motion.div>
        )}

        {mode === 'text' && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4"
          >
            <h3 className="text-xs font-display font-bold text-warm-500 uppercase tracking-wide mb-2">Your thoughts</h3>
            <textarea
              value={textValue}
              onChange={e => setTextValue(e.target.value)}
              className="w-full border border-warm-200 rounded-2xl p-4 h-48 focus:ring-2 focus:ring-honey-500 outline-none bg-white shadow-soft font-body text-warm-800"
              placeholder="Type your entry here... You can address the prompts above or write freely."
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-3">
              <motion.button
                onClick={() => {onModeChange(null); setTextValue('');}}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="px-4 py-2 text-warm-500 hover:bg-warm-100 rounded-xl font-medium"
              >
                Back
              </motion.button>
              <motion.button
                onClick={() => onSave(textValue)}
                disabled={!textValue.trim() || loading}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="px-6 py-2 bg-honey-600 text-white rounded-xl font-display font-medium flex gap-2 items-center hover:bg-honey-700 disabled:bg-warm-300"
              >
                {loading ? <Loader2 className="animate-spin" size={18}/> : <Send size={18}/>} Save
              </motion.button>
            </div>
          </motion.div>
        )}

        {mode === 'voice' && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4"
          >
            <h3 className="text-xs font-display font-bold text-warm-500 uppercase tracking-wide mb-2">Voice recording</h3>
            <div className="bg-white rounded-2xl p-6 border border-warm-200 shadow-soft flex flex-col items-center gap-4">
              <motion.button
                onClick={recording ? stopRecording : startRecording}
                disabled={loading}
                whileHover={{ scale: recording ? 1 : 1.05 }}
                whileTap={{ scale: 0.95 }}
                animate={recording ? { scale: [1, 1.1, 1] } : {}}
                transition={recording ? { duration: 1.5, repeat: Infinity } : {}}
                className={`h-20 w-20 rounded-full flex items-center justify-center shadow-soft-lg transition-all ${recording ? 'bg-red-500' : 'bg-terra-500 hover:bg-terra-600'} disabled:opacity-50`}
              >
                {recording ? <Square className="text-white fill-current" size={32}/> : <Mic className="text-white" size={32}/>}
              </motion.button>

              {recording && (
                <div className="bg-warm-800 text-white text-sm font-mono py-1.5 px-3 rounded-lg">
                  {Math.floor(recordSeconds/60)}:{String(recordSeconds%60).padStart(2,'0')}
                </div>
              )}

              {loading && (
                <div className="flex items-center gap-2 text-honey-600 font-medium">
                  <Loader2 className="animate-spin" size={18}/> Processing...
                </div>
              )}

              <button
                onClick={() => onModeChange(null)}
                className="text-sm text-warm-500 hover:text-warm-700 font-medium"
                disabled={recording || loading}
              >
                Back
              </button>
            </div>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
};

export default PromptScreen;

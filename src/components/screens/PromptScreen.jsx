import React, { useState, useEffect, useRef } from 'react';
import { X, MessageCircle, Sparkles, RefreshCw, Mic, Keyboard, Square, Loader2, Send } from 'lucide-react';
import { getPromptsForSession } from '../../utils/prompts';

const PromptScreen = ({ prompts, mode, onModeChange, onSave, onClose, loading, category, onRefreshPrompts }) => {
  const [textValue, setTextValue] = useState('');
  const [recording, setRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [displayPrompts, setDisplayPrompts] = useState(prompts);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    setDisplayPrompts(prompts);
  }, [prompts]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const handleRefresh = () => {
    setIsRefreshing(true);
    const result = getPromptsForSession(category, []);
    setDisplayPrompts(result.prompts);
    if (onRefreshPrompts) onRefreshPrompts(result.prompts);
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
    <div className="fixed inset-0 bg-white z-40 flex flex-col pt-[env(safe-area-inset-top)] animate-in slide-in-from-bottom-10 duration-200">
      <div className="p-4 border-b flex justify-between items-center bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-md">
        <h2 className="font-bold text-lg flex gap-2 items-center"><MessageCircle size={20}/> New Entry</h2>
        <button onClick={onClose} className="p-1 hover:bg-white/20 rounded-full"><X size={24}/></button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 bg-gray-50">
        {displayPrompts.length > 0 && (
          <div className="mb-4">
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide flex items-center gap-2">
                <Sparkles size={12}/> Reflect on these
              </h3>
              <button
                onClick={handleRefresh}
                className={`text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1 transition-transform ${isRefreshing ? 'animate-spin' : ''}`}
                title="Get new prompts"
              >
                <RefreshCw size={14} />
                Refresh
              </button>
            </div>
            <div className={`bg-white rounded-xl p-4 border border-gray-200 shadow-sm transition-opacity ${isRefreshing ? 'opacity-50' : ''}`}>
              <div className="space-y-2">
                {displayPrompts.map((prompt, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="text-indigo-500 text-xs mt-0.5">•</span>
                    <p className="text-sm text-gray-700 italic">"{prompt}"</p>
                  </div>
                ))}
              </div>
            </div>
            <button
              onClick={() => onModeChange('skip')}
              className="mt-2 text-xs text-gray-400 hover:text-gray-600"
            >
              Skip prompts and write freely
            </button>
          </div>
        )}

        {!mode && (
          <div className="mb-4">
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Choose input method</h3>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => onModeChange('voice')}
                className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white p-6 rounded-xl shadow-lg hover:shadow-xl transition-all flex flex-col items-center gap-2"
              >
                <Mic size={28} className="opacity-90"/>
                <span className="font-bold text-base">Record</span>
              </button>
              <button
                onClick={() => onModeChange('text')}
                className="bg-gradient-to-r from-purple-600 to-pink-600 text-white p-6 rounded-xl shadow-lg hover:shadow-xl transition-all flex flex-col items-center gap-2"
              >
                <Keyboard size={28} className="opacity-90"/>
                <span className="font-bold text-base">Type</span>
              </button>
            </div>
          </div>
        )}

        {mode === 'text' && (
          <div className="mb-4">
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Your thoughts</h3>
            <textarea
              value={textValue}
              onChange={e => setTextValue(e.target.value)}
              className="w-full border rounded-xl p-4 h-48 focus:ring-2 focus:ring-indigo-500 outline-none bg-white shadow-sm"
              placeholder="Type your entry here... You can address the prompts above or write freely."
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-3">
              <button
                onClick={() => {onModeChange(null); setTextValue('');}}
                className="px-4 py-2 text-gray-500 hover:bg-gray-100 rounded-lg font-medium"
              >
                Back
              </button>
              <button
                onClick={() => onSave(textValue)}
                disabled={!textValue.trim() || loading}
                className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-medium flex gap-2 items-center hover:bg-indigo-700 disabled:bg-gray-300"
              >
                {loading ? <Loader2 className="animate-spin" size={18}/> : <Send size={18}/>} Save
              </button>
            </div>
          </div>
        )}

        {mode === 'voice' && (
          <div className="mb-4">
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Voice recording</h3>
            <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm flex flex-col items-center gap-4">
              <button
                onClick={recording ? stopRecording : startRecording}
                disabled={loading}
                className={`h-20 w-20 rounded-full flex items-center justify-center shadow-lg transition-all ${recording ? 'bg-red-500 scale-110 animate-pulse' : 'bg-indigo-600 hover:bg-indigo-700'} disabled:opacity-50`}
              >
                {recording ? <Square className="text-white fill-current" size={32}/> : <Mic className="text-white" size={32}/>}
              </button>

              {recording && (
                <div className="bg-gray-800 text-white text-sm font-mono py-1.5 px-3 rounded">
                  {Math.floor(recordSeconds/60)}:{String(recordSeconds%60).padStart(2,'0')}
                </div>
              )}

              {loading && (
                <div className="flex items-center gap-2 text-indigo-600 font-medium">
                  <Loader2 className="animate-spin" size={18}/> Processing...
                </div>
              )}

              <button
                onClick={() => onModeChange(null)}
                className="text-sm text-gray-500 hover:text-gray-700 font-medium"
                disabled={recording || loading}
              >
                Back
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PromptScreen;

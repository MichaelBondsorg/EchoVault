import React, { useState, useEffect, useRef } from 'react';
import { Mic, Square, Keyboard, Loader2 } from 'lucide-react';

const VoiceRecorder = ({ onSave, onSwitch, loading, minimal }) => {
  const [rec, setRec] = useState(false);
  const [mr, setMr] = useState(null);
  const [secs, setSecs] = useState(0);
  const timer = useRef(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  const start = async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("Microphone access not available in this browser");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
      const r = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 16000 });
      const chunks = [];
      r.ondataavailable = e => chunks.push(e.data);
      r.onstop = () => {
        const reader = new FileReader();
        reader.readAsDataURL(new Blob(chunks, { type: mime }));
        reader.onloadend = () => onSave(reader.result.split(',')[1], mime);
        stream.getTracks().forEach(t => t.stop());
      };
      r.start();
      setMr(r);
      setRec(true);
      setSecs(0);
      timer.current = setInterval(() => setSecs(s => s + 1), 1000);
    } catch (e) {
      alert("Microphone access denied or error occurred");
      console.error(e);
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
      <button onClick={rec ? stop : start} className={`h-16 w-16 rounded-full flex items-center justify-center shadow-lg transition-all ${rec ? 'bg-red-500 scale-110 animate-pulse' : 'bg-indigo-600 hover:bg-indigo-700'}`}>
        {rec ? <Square className="text-white fill-current"/> : <Mic className="text-white" size={32}/>}
      </button>
    );
  }

  return (
    <div className="fixed bottom-0 w-full bg-white border-t p-4 z-20 pb-[max(2rem,env(safe-area-inset-bottom))] shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]">
      {loading && <div className="absolute inset-0 bg-white/90 flex justify-center items-center z-30 text-indigo-600 font-medium"><Loader2 className="animate-spin mr-2"/> Processing...</div>}
      <div className="flex justify-between items-center max-w-md mx-auto">
        <button onClick={onSwitch} disabled={rec} className="p-3 rounded-full text-gray-400 hover:bg-gray-100"><Keyboard size={24}/></button>
        <button onClick={rec ? stop : start} className={`h-16 w-16 rounded-full flex items-center justify-center shadow-lg transition-all ${rec ? 'bg-red-500 scale-110 animate-pulse' : 'bg-indigo-600 hover:bg-indigo-700'}`}>
          {rec ? <Square className="text-white fill-current"/> : <Mic className="text-white" size={32}/>}
        </button>
        <div className="w-12 flex justify-center">{rec && <div className="bg-gray-800 text-white text-xs font-mono py-1 px-2 rounded">{Math.floor(secs/60)}:{String(secs%60).padStart(2,'0')}</div>}</div>
      </div>
    </div>
  );
};

export default VoiceRecorder;

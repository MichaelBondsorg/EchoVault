import React, { useState, useEffect } from 'react';
import { Brain } from 'lucide-react';

const DecompressionScreen = ({ onClose }) => {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const t1 = setTimeout(() => setStep(1), 100);
    const t2 = setTimeout(() => setStep(2), 3000); // Breathe In
    const t3 = setTimeout(() => setStep(3), 6000); // Hold
    const t4 = setTimeout(() => setStep(4), 9000); // Breathe Out
    const t5 = setTimeout(() => onClose(), 12000); // Finish
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
      clearTimeout(t5);
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 bg-indigo-900 z-50 flex flex-col items-center justify-center text-white animate-in fade-in duration-500">
      <div className="relative mb-8">
        <div className={`absolute inset-0 bg-indigo-400 rounded-full opacity-30 blur-xl transition-all duration-[3000ms] ${step === 2 ? 'scale-150' : step === 4 ? 'scale-50' : 'scale-100'}`}></div>
        <Brain size={64} className={`relative z-10 transition-all duration-[3000ms] ${step === 2 ? 'scale-110' : 'scale-90'}`}/>
      </div>
      <h2 className="text-2xl font-bold mb-2 transition-opacity duration-500">
        {step <= 1 && "Heavy thoughts captured."}
        {step === 2 && "Breathe in..."}
        {step === 3 && "Hold..."}
        {step === 4 && "Let it go..."}
      </h2>
      <p className="text-indigo-300">Processing your feelings...</p>
    </div>
  );
};

export default DecompressionScreen;

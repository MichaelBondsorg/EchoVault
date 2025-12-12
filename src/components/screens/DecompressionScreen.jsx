import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
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
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 bg-gradient-to-b from-primary-800 to-primary-900 z-50 flex flex-col items-center justify-center text-white"
    >
      <div className="relative mb-8">
        <motion.div
          animate={{
            scale: step === 2 ? 1.5 : step === 4 ? 0.5 : 1,
            opacity: 0.3
          }}
          transition={{ duration: 3, ease: "easeInOut" }}
          className="absolute inset-0 bg-primary-400 rounded-full blur-xl"
        />
        <motion.div
          animate={{
            scale: step === 2 ? 1.1 : 0.9
          }}
          transition={{ duration: 3, ease: "easeInOut" }}
        >
          <Brain size={64} className="relative z-10" />
        </motion.div>
      </div>
      <motion.h2
        key={step}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-2xl font-display font-bold mb-2"
      >
        {step <= 1 && "Heavy thoughts captured."}
        {step === 2 && "Breathe in..."}
        {step === 3 && "Hold..."}
        {step === 4 && "Let it go..."}
      </motion.h2>
      <p className="text-primary-300 font-body">Processing your feelings...</p>

      {/* Breathing indicator */}
      <div className="mt-8 flex gap-2">
        {[1, 2, 3, 4].map((dot) => (
          <motion.div
            key={dot}
            animate={{
              scale: step >= dot ? 1.2 : 0.8,
              opacity: step >= dot ? 1 : 0.3
            }}
            transition={{ duration: 0.3 }}
            className="w-2 h-2 rounded-full bg-primary-400"
          />
        ))}
      </div>
    </motion.div>
  );
};

export default DecompressionScreen;

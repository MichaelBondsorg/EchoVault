import React from 'react';
import { motion } from 'framer-motion';
import { Mic } from 'lucide-react';

const NewEntryButton = ({ onClick }) => {
  return (
    <div className="fixed bottom-0 w-full bg-white/80 backdrop-blur-sm border-t border-warm-200 p-4 z-20 pb-[max(2rem,env(safe-area-inset-bottom))] shadow-soft-lg">
      <div className="flex justify-center items-center max-w-md mx-auto">
        <motion.button
          onClick={onClick}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="bg-gradient-to-r from-honey-500 to-honey-600 text-white px-8 py-4 rounded-full shadow-soft-lg hover:shadow-xl transition-all flex items-center gap-3 font-display font-bold text-lg"
        >
          <Mic size={24} className="opacity-90"/>
          New Entry
        </motion.button>
      </div>
    </div>
  );
};

export default NewEntryButton;

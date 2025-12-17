import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Send, Loader2 } from 'lucide-react';

const TextInput = ({ onSave, onCancel, loading }) => {
  const [val, setVal] = useState('');

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="fixed bottom-0 w-full bg-white/80 backdrop-blur-sm border-t border-warm-200 p-4 z-20 pb-[max(2rem,env(safe-area-inset-bottom))] shadow-soft-lg"
    >
      <div className="max-w-md mx-auto">
        <textarea
          value={val}
          onChange={e => setVal(e.target.value)}
          className="w-full border border-warm-200 rounded-2xl p-3 mb-3 h-32 focus:ring-2 focus:ring-primary-500 outline-none bg-white shadow-soft font-body text-warm-800"
          placeholder="Type your memory..."
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <motion.button
            onClick={onCancel}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="px-4 py-2 text-warm-500 hover:bg-warm-100 rounded-xl font-medium"
          >
            Cancel
          </motion.button>
          <motion.button
            onClick={() => onSave(val)}
            disabled={!val.trim() || loading}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="px-4 py-2 bg-primary-600 text-white rounded-xl font-display font-medium flex gap-2 items-center hover:bg-primary-700 disabled:bg-warm-300"
          >
            {loading ? <Loader2 className="animate-spin" size={18}/> : <Send size={18}/>} Save
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
};

export default TextInput;

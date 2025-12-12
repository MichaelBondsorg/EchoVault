import React from 'react';
import { motion } from 'framer-motion';
import { Heart } from 'lucide-react';

const CrisisSoftBlockModal = ({ onResponse, onClose }) => {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", duration: 0.3 }}
        className="bg-white rounded-3xl max-w-md w-full p-6 shadow-soft-lg"
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="h-12 w-12 bg-primary-100 rounded-full flex items-center justify-center">
            <Heart className="text-primary-600" size={24} />
          </div>
          <div>
            <h2 className="text-lg font-display font-bold text-warm-900">Just checking in</h2>
            <p className="text-sm text-warm-500">I noticed some heavy words</p>
          </div>
        </div>

        <p className="text-warm-600 mb-6 font-body">Are you okay? Your wellbeing matters most.</p>

        <div className="space-y-3">
          <motion.button
            onClick={() => onResponse('okay')}
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
            className="w-full p-4 text-left rounded-2xl border-2 border-warm-200 hover:border-primary-300 hover:bg-primary-50 transition-all"
          >
            <div className="font-display font-semibold text-warm-800">I'm okay, just venting</div>
            <div className="text-sm text-warm-500 font-body">Continue saving my entry</div>
          </motion.button>

          <motion.button
            onClick={() => onResponse('support')}
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
            className="w-full p-4 text-left rounded-2xl border-2 border-warm-200 hover:border-secondary-300 hover:bg-secondary-50 transition-all"
          >
            <div className="font-display font-semibold text-warm-800">I could use some support</div>
            <div className="text-sm text-warm-500 font-body">Show me helpful resources</div>
          </motion.button>

          <motion.button
            onClick={() => onResponse('crisis')}
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
            className="w-full p-4 text-left rounded-2xl border-2 border-red-200 hover:border-red-400 hover:bg-red-50 transition-all"
          >
            <div className="font-display font-semibold text-red-700">I'm in crisis</div>
            <div className="text-sm text-red-500 font-body">Connect me with help now</div>
          </motion.button>
        </div>

        <button
          onClick={onClose}
          className="mt-4 w-full text-center text-sm text-warm-400 hover:text-warm-600"
        >
          Cancel
        </button>
      </motion.div>
    </motion.div>
  );
};

export default CrisisSoftBlockModal;

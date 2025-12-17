import React from 'react';
import { motion } from 'framer-motion';
import { Phone, MessageCircle, AlertTriangle } from 'lucide-react';

const CrisisResourcesScreen = ({ level, onClose, onContinue }) => {
  const isCrisis = level === 'crisis';

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
        className="bg-white rounded-3xl max-w-md w-full p-6 shadow-soft-lg max-h-[90vh] overflow-y-auto"
      >
        <div className="text-center mb-6">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", delay: 0.1 }}
            className={`h-16 w-16 mx-auto rounded-full flex items-center justify-center mb-4 ${isCrisis ? 'bg-red-100' : 'bg-primary-100'}`}
          >
            <Phone className={isCrisis ? 'text-red-600' : 'text-primary-600'} size={32} />
          </motion.div>
          <h2 className="text-xl font-display font-bold text-warm-900">
            {isCrisis ? "Help is available right now" : "Support resources"}
          </h2>
          <p className="text-warm-500 mt-2 font-body">
            {isCrisis
              ? "You don't have to face this alone. Please reach out."
              : "Here are some resources that might help."}
          </p>
        </div>

        <div className="space-y-3 mb-6">
          <motion.a
            href="tel:988"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
            className={`flex items-center gap-4 p-4 rounded-2xl border-2 ${isCrisis ? 'border-red-200 bg-red-50' : 'border-warm-200'} hover:shadow-soft transition-all`}
          >
            <div className={`h-12 w-12 rounded-full flex items-center justify-center ${isCrisis ? 'bg-red-200' : 'bg-warm-200'}`}>
              <Phone className={isCrisis ? 'text-red-700' : 'text-warm-700'} size={20} />
            </div>
            <div>
              <div className="font-display font-bold text-warm-900">988 Suicide & Crisis Lifeline</div>
              <div className="text-sm text-warm-500 font-body">Call or text 988 - Available 24/7</div>
            </div>
          </motion.a>

          <motion.a
            href="sms:741741&body=HOME"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3 }}
            className="flex items-center gap-4 p-4 rounded-2xl border-2 border-warm-200 hover:shadow-soft transition-all"
          >
            <div className="h-12 w-12 rounded-full bg-warm-200 flex items-center justify-center">
              <MessageCircle className="text-warm-700" size={20} />
            </div>
            <div>
              <div className="font-display font-bold text-warm-900">Crisis Text Line</div>
              <div className="text-sm text-warm-500 font-body">Text HOME to 741741</div>
            </div>
          </motion.a>

          <motion.a
            href="tel:911"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.4 }}
            className="flex items-center gap-4 p-4 rounded-2xl border-2 border-warm-200 hover:shadow-soft transition-all"
          >
            <div className="h-12 w-12 rounded-full bg-warm-200 flex items-center justify-center">
              <AlertTriangle className="text-warm-700" size={20} />
            </div>
            <div>
              <div className="font-display font-bold text-warm-900">Emergency Services</div>
              <div className="text-sm text-warm-500 font-body">Call 911 for immediate help</div>
            </div>
          </motion.a>
        </div>

        {!isCrisis && (
          <motion.button
            onClick={onContinue}
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
            className="w-full py-3 bg-primary-600 text-white rounded-2xl font-display font-semibold hover:bg-primary-700 transition-colors mb-3"
          >
            Continue with my entry
          </motion.button>
        )}

        <button
          onClick={onClose}
          className="w-full py-3 text-warm-500 hover:text-warm-700 text-sm font-body"
        >
          {isCrisis ? "I'll reach out for help" : "Close"}
        </button>
      </motion.div>
    </motion.div>
  );
};

export default CrisisResourcesScreen;

import React from 'react';
import { Phone, MessageCircle, AlertTriangle } from 'lucide-react';

const CrisisResourcesScreen = ({ level, onClose, onContinue }) => {
  const isCrisis = level === 'crisis';

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 animate-in fade-in duration-300">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="text-center mb-6">
          <div className={`h-16 w-16 mx-auto rounded-full flex items-center justify-center mb-4 ${isCrisis ? 'bg-red-100' : 'bg-blue-100'}`}>
            <Phone className={isCrisis ? 'text-red-600' : 'text-blue-600'} size={32} />
          </div>
          <h2 className="text-xl font-bold text-gray-900">
            {isCrisis ? "Help is available right now" : "Support resources"}
          </h2>
          <p className="text-gray-500 mt-2">
            {isCrisis
              ? "You don't have to face this alone. Please reach out."
              : "Here are some resources that might help."}
          </p>
        </div>

        <div className="space-y-3 mb-6">
          <a
            href="tel:988"
            className={`flex items-center gap-4 p-4 rounded-xl border-2 ${isCrisis ? 'border-red-200 bg-red-50' : 'border-gray-200'} hover:shadow-md transition-all`}
          >
            <div className={`h-12 w-12 rounded-full flex items-center justify-center ${isCrisis ? 'bg-red-200' : 'bg-gray-200'}`}>
              <Phone className={isCrisis ? 'text-red-700' : 'text-gray-700'} size={20} />
            </div>
            <div>
              <div className="font-bold text-gray-900">988 Suicide & Crisis Lifeline</div>
              <div className="text-sm text-gray-500">Call or text 988 - Available 24/7</div>
            </div>
          </a>

          <a
            href="sms:741741&body=HOME"
            className="flex items-center gap-4 p-4 rounded-xl border-2 border-gray-200 hover:shadow-md transition-all"
          >
            <div className="h-12 w-12 rounded-full bg-gray-200 flex items-center justify-center">
              <MessageCircle className="text-gray-700" size={20} />
            </div>
            <div>
              <div className="font-bold text-gray-900">Crisis Text Line</div>
              <div className="text-sm text-gray-500">Text HOME to 741741</div>
            </div>
          </a>

          <a
            href="tel:911"
            className="flex items-center gap-4 p-4 rounded-xl border-2 border-gray-200 hover:shadow-md transition-all"
          >
            <div className="h-12 w-12 rounded-full bg-gray-200 flex items-center justify-center">
              <AlertTriangle className="text-gray-700" size={20} />
            </div>
            <div>
              <div className="font-bold text-gray-900">Emergency Services</div>
              <div className="text-sm text-gray-500">Call 911 for immediate help</div>
            </div>
          </a>
        </div>

        {!isCrisis && (
          <button
            onClick={onContinue}
            className="w-full py-3 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition-colors mb-3"
          >
            Continue with my entry
          </button>
        )}

        <button
          onClick={onClose}
          className="w-full py-3 text-gray-500 hover:text-gray-700 text-sm"
        >
          {isCrisis ? "I'll reach out for help" : "Close"}
        </button>
      </div>
    </div>
  );
};

export default CrisisResourcesScreen;

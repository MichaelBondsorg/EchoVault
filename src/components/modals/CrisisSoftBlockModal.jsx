import React from 'react';
import { Heart } from 'lucide-react';

const CrisisSoftBlockModal = ({ onResponse, onClose }) => {
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 animate-in fade-in duration-300">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl animate-in zoom-in-95 duration-300">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-12 w-12 bg-indigo-100 rounded-full flex items-center justify-center">
            <Heart className="text-indigo-600" size={24} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900">Just checking in</h2>
            <p className="text-sm text-gray-500">I noticed some heavy words</p>
          </div>
        </div>

        <p className="text-gray-600 mb-6">Are you okay? Your wellbeing matters most.</p>

        <div className="space-y-3">
          <button
            onClick={() => onResponse('okay')}
            className="w-full p-4 text-left rounded-xl border-2 border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 transition-all"
          >
            <div className="font-semibold text-gray-800">I'm okay, just venting</div>
            <div className="text-sm text-gray-500">Continue saving my entry</div>
          </button>

          <button
            onClick={() => onResponse('support')}
            className="w-full p-4 text-left rounded-xl border-2 border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-all"
          >
            <div className="font-semibold text-gray-800">I could use some support</div>
            <div className="text-sm text-gray-500">Show me helpful resources</div>
          </button>

          <button
            onClick={() => onResponse('crisis')}
            className="w-full p-4 text-left rounded-xl border-2 border-red-200 hover:border-red-400 hover:bg-red-50 transition-all"
          >
            <div className="font-semibold text-red-700">I'm in crisis</div>
            <div className="text-sm text-red-500">Connect me with help now</div>
          </button>
        </div>

        <button
          onClick={onClose}
          className="mt-4 w-full text-center text-sm text-gray-400 hover:text-gray-600"
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

export default CrisisSoftBlockModal;

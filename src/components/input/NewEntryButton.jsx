import React from 'react';
import { Mic } from 'lucide-react';

const NewEntryButton = ({ onClick }) => {
  return (
    <div className="fixed bottom-0 w-full bg-white border-t p-4 z-20 pb-[max(2rem,env(safe-area-inset-bottom))] shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]">
      <div className="flex justify-center items-center max-w-md mx-auto">
        <button
          onClick={onClick}
          className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-8 py-4 rounded-full shadow-lg hover:shadow-xl transition-all flex items-center gap-3 font-bold text-lg"
        >
          <Mic size={24} className="opacity-90"/>
          New Entry
        </button>
      </div>
    </div>
  );
};

export default NewEntryButton;

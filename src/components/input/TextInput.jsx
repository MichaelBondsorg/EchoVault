import React, { useState } from 'react';
import { Send, Loader2 } from 'lucide-react';

const TextInput = ({ onSave, onCancel, loading }) => {
  const [val, setVal] = useState('');

  return (
    <div className="fixed bottom-0 w-full bg-white border-t p-4 z-20 pb-[max(2rem,env(safe-area-inset-bottom))] shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] animate-in slide-in-from-bottom-10">
      <div className="max-w-md mx-auto">
        <textarea
          value={val}
          onChange={e => setVal(e.target.value)}
          className="w-full border rounded-xl p-3 mb-3 h-32 focus:ring-2 focus:ring-indigo-500 outline-none"
          placeholder="Type your memory..."
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 text-gray-500 hover:bg-gray-100 rounded-lg font-medium">Cancel</button>
          <button
            onClick={() => onSave(val)}
            disabled={!val.trim() || loading}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium flex gap-2 items-center hover:bg-indigo-700 disabled:bg-gray-300"
          >
            {loading ? <Loader2 className="animate-spin" size={18}/> : <Send size={18}/>} Save
          </button>
        </div>
      </div>
    </div>
  );
};

export default TextInput;

import React from 'react';
import { X, Lightbulb } from 'lucide-react';
import MarkdownLite from '../ui/MarkdownLite';

const WeeklyReport = ({ text, onClose }) => (
  <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
    <div className="bg-white dark:bg-hearth-800 rounded-2xl p-6 max-w-md w-full shadow-2xl dark:shadow-none dark:ring-1 dark:ring-hearth-700 relative max-h-[80vh] overflow-y-auto flex flex-col">
      <button onClick={onClose} className="absolute top-4 right-4 text-hearth-400 hover:text-hearth-600 dark:text-hearth-500 dark:hover:text-hearth-300"><X size={20}/></button>
      <h2 className="font-bold text-xl mb-4 text-lavender-600 dark:text-lavender-400 flex gap-2 items-center"><Lightbulb size={24}/> Weekly Synthesis</h2>
      <div className="flex-1 overflow-y-auto dark:text-hearth-100"><MarkdownLite text={text} /></div>
    </div>
  </div>
);

export default WeeklyReport;

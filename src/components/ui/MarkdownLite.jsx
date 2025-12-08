import React from 'react';
import { safeString } from '../../utils/string';

const MarkdownLite = ({ text, variant = 'default' }) => {
  if (!text) return null;
  const isLight = variant === 'light';
  return (
    <div className={`space-y-2 leading-relaxed text-sm ${isLight ? 'text-white' : 'text-gray-800'}`}>
      {safeString(text).split('\n').map((line, i) => {
        const t = line.trim();
        if (!t) return <div key={i} className="h-1" />;
        if (t.startsWith('###')) return <h3 key={i} className={`text-base font-bold mt-3 ${isLight ? 'text-white' : 'text-indigo-900'}`}>{t.replace(/###\s*/, '')}</h3>;
        if (t.startsWith('*') || t.startsWith('-')) return (
          <div key={i} className="flex gap-2 ml-1 items-start">
            <span className={`text-[10px] mt-1.5 ${isLight ? 'text-indigo-200' : 'text-indigo-500'}`}>●</span>
            <p className="flex-1">{t.replace(/^[\*\-]\s*/, '')}</p>
          </div>
        );
        return <p key={i}>{t}</p>;
      })}
    </div>
  );
};

export default MarkdownLite;

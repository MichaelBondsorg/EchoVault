import React from 'react';
import { safeString } from '../../utils/string';

/**
 * Parse inline markdown (bold) and return React elements
 */
const parseInlineMarkdown = (text, isLight) => {
  if (!text) return null;

  // Split by **bold** pattern, keeping the delimiters for processing
  const parts = text.split(/(\*\*[^*]+\*\*)/g);

  return parts.map((part, idx) => {
    // Check if this part is bold (wrapped in **)
    if (part.startsWith('**') && part.endsWith('**')) {
      const boldText = part.slice(2, -2);
      return (
        <strong key={idx} className={`font-semibold ${isLight ? 'text-white' : 'text-warm-900 dark:text-warm-100'}`}>
          {boldText}
        </strong>
      );
    }
    return <span key={idx}>{part}</span>;
  });
};

const MarkdownLite = ({ text, variant = 'default' }) => {
  if (!text) return null;
  const isLight = variant === 'light';
  return (
    <div className={`space-y-2 leading-relaxed text-sm ${isLight ? 'text-white' : 'text-warm-800 dark:text-warm-200'}`}>
      {safeString(text).split('\n').map((line, i) => {
        const t = line.trim();
        if (!t) return <div key={i} className="h-1" />;
        if (t.startsWith('###')) return (
          <h3 key={i} className={`text-base font-bold mt-3 ${isLight ? 'text-white' : 'text-warm-900 dark:text-warm-100'}`}>
            {parseInlineMarkdown(t.replace(/###\s*/, ''), isLight)}
          </h3>
        );
        if (t.startsWith('*') && !t.startsWith('**')) return (
          <div key={i} className="flex gap-2 ml-1 items-start">
            <span className={`text-[10px] mt-1.5 ${isLight ? 'text-lavender-200' : 'text-lavender-500 dark:text-lavender-400'}`}>●</span>
            <p className="flex-1">{parseInlineMarkdown(t.replace(/^\*\s*/, ''), isLight)}</p>
          </div>
        );
        if (t.startsWith('-')) return (
          <div key={i} className="flex gap-2 ml-1 items-start">
            <span className={`text-[10px] mt-1.5 ${isLight ? 'text-lavender-200' : 'text-lavender-500 dark:text-lavender-400'}`}>●</span>
            <p className="flex-1">{parseInlineMarkdown(t.replace(/^-\s*/, ''), isLight)}</p>
          </div>
        );
        return <p key={i}>{parseInlineMarkdown(t, isLight)}</p>;
      })}
    </div>
  );
};

export default MarkdownLite;

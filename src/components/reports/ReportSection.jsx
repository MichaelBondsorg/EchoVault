import React from 'react';
import { MarkdownLite } from '../ui';
import ReportChart from './ReportChart';

export default function ReportSection({ section }) {
  if (!section) return null;

  return (
    <div className="py-4 border-b border-warm-100 dark:border-warm-700 last:border-0">
      <h3 className="text-base font-display font-semibold text-warm-800 dark:text-warm-100 mb-2">
        {section.title}
      </h3>

      {section.narrative && (
        <div className="text-sm text-warm-600 dark:text-warm-300 leading-relaxed">
          <MarkdownLite text={section.narrative} />
        </div>
      )}

      {section.chartData && <ReportChart chartData={section.chartData} />}

      {section.entryRefs?.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {section.entryRefs.map((ref, i) => (
            <span
              key={ref || i}
              className="text-xs text-honey-600 dark:text-honey-400 bg-honey-50 dark:bg-honey-900/30 px-2 py-1 rounded-full cursor-pointer hover:bg-honey-100 dark:hover:bg-honey-800/40 transition-colors"
            >
              Entry #{i + 1}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

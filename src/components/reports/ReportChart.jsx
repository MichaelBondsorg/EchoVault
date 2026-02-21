import React from 'react';
import { HEX_COLORS } from '../../utils/colorMap';

const COLORS = [HEX_COLORS.lavender, HEX_COLORS.lavenderLight, HEX_COLORS.sage, HEX_COLORS.honey, HEX_COLORS.terra, HEX_COLORS.sageLight];

export default function ReportChart({ chartData }) {
  if (!chartData) return null;

  if (chartData.type === 'sparkline' || chartData.type === 'mood_trend') {
    return <MoodTrendChart data={chartData.data} />;
  }
  if (chartData.type === 'category_breakdown') {
    return <CategoryBarChart data={chartData.data} />;
  }
  // For compound chart data objects (first section gets all charts)
  if (chartData.moodTrend) {
    return <MoodTrendChart data={chartData.moodTrend} />;
  }
  return null;
}

function MoodTrendChart({ data }) {
  if (!data || data.length === 0) return null;

  const width = 300;
  const height = 100;
  const padding = { top: 10, right: 10, bottom: 20, left: 30 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const values = data.map(d => d.value ?? d.score ?? 0);
  const minVal = 0;
  const maxVal = 10;

  const points = data.map((d, i) => {
    const x = padding.left + (i / Math.max(data.length - 1, 1)) * chartW;
    const y = padding.top + chartH - ((values[i] - minVal) / (maxVal - minVal)) * chartH;
    return { x, y };
  });

  const polyline = points.map(p => `${p.x},${p.y}`).join(' ');

  return (
    <div className="my-3">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full max-w-sm" role="img" aria-label="Mood trend chart">
        {/* Y-axis labels */}
        <text x={padding.left - 5} y={padding.top + 4} textAnchor="end" className="fill-warm-400" fontSize="8">10</text>
        <text x={padding.left - 5} y={padding.top + chartH + 4} textAnchor="end" className="fill-warm-400" fontSize="8">0</text>
        {/* Line */}
        <polyline fill="none" stroke={HEX_COLORS.lavender} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" points={polyline} />
        {/* Dots */}
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="3" fill={HEX_COLORS.lavender} />
        ))}
      </svg>
    </div>
  );
}

function CategoryBarChart({ data }) {
  if (!data || data.length === 0) return null;

  const maxVal = Math.max(...data.map(d => d.value || d.count || 0));

  return (
    <div className="my-3 space-y-2">
      {data.slice(0, 6).map((item, i) => {
        const val = item.value || item.count || 0;
        const pct = maxVal > 0 ? (val / maxVal) * 100 : 0;
        return (
          <div key={item.label || i} className="flex items-center gap-2">
            <span className="text-xs text-warm-500 w-20 truncate text-right">{item.label}</span>
            <div className="flex-1 bg-warm-100 dark:bg-warm-800 rounded-full h-3 overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${pct}%`, backgroundColor: COLORS[i % COLORS.length] }}
              />
            </div>
            <span className="text-xs text-warm-500 w-8">{val}</span>
          </div>
        );
      })}
    </div>
  );
}

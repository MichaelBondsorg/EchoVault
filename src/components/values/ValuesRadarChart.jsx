/**
 * Values Radar Chart Component
 *
 * Visual representation of value alignment as a radar/spider chart.
 * Shows alignment score for each value with prioritized values highlighted.
 */

import React, { useMemo } from 'react';
import { CORE_VALUES } from '../../services/values/valuesTracker';

const ValuesRadarChart = ({ alignment, prioritizedValues = [] }) => {
  // Get values with data
  const valuesWithData = useMemo(() => {
    if (!alignment?.byValue) return [];

    return Object.entries(alignment.byValue)
      .filter(([_, stats]) => stats.alignmentScore !== null)
      .map(([key, stats]) => ({
        key,
        label: CORE_VALUES[key]?.label.split(' ')[0] || key,
        score: stats.alignmentScore,
        isPrioritized: prioritizedValues.includes(key)
      }))
      .sort((a, b) => {
        // Prioritized first, then by score
        if (a.isPrioritized !== b.isPrioritized) return a.isPrioritized ? -1 : 1;
        return b.score - a.score;
      })
      .slice(0, 8); // Max 8 values for readability
  }, [alignment, prioritizedValues]);

  if (valuesWithData.length < 3) {
    return (
      <div className="text-center py-8 text-warm-500 text-sm">
        Need more varied entries to show radar chart
      </div>
    );
  }

  // SVG dimensions
  const size = 280;
  const center = size / 2;
  const maxRadius = 100;
  const levels = 4; // Concentric circles

  // Calculate points for each value
  const angleStep = (2 * Math.PI) / valuesWithData.length;

  const getPoint = (index, score) => {
    const angle = -Math.PI / 2 + index * angleStep; // Start from top
    const radius = score * maxRadius;
    return {
      x: center + radius * Math.cos(angle),
      y: center + radius * Math.sin(angle)
    };
  };

  const getLabelPoint = (index) => {
    const angle = -Math.PI / 2 + index * angleStep;
    const radius = maxRadius + 25;
    return {
      x: center + radius * Math.cos(angle),
      y: center + radius * Math.sin(angle)
    };
  };

  // Generate polygon points
  const polygonPoints = valuesWithData
    .map((_, idx) => {
      const point = getPoint(idx, valuesWithData[idx].score);
      return `${point.x},${point.y}`;
    })
    .join(' ');

  // Generate axis lines
  const axisLines = valuesWithData.map((_, idx) => {
    const end = getPoint(idx, 1);
    return { x1: center, y1: center, x2: end.x, y2: end.y };
  });

  // Color based on overall alignment
  const overallScore = alignment?.overallAlignment || 0.5;
  const fillColor = overallScore >= 0.7 ? '#22c55e' : overallScore >= 0.5 ? '#f59e0b' : '#ef4444';
  const fillOpacity = 0.3;
  const strokeColor = overallScore >= 0.7 ? '#16a34a' : overallScore >= 0.5 ? '#d97706' : '#dc2626';

  return (
    <div className="flex justify-center">
      <svg width={size} height={size} className="overflow-visible">
        {/* Background circles */}
        {Array.from({ length: levels }).map((_, level) => (
          <circle
            key={level}
            cx={center}
            cy={center}
            r={(maxRadius / levels) * (level + 1)}
            fill="none"
            stroke="#e5e5e5"
            strokeWidth={1}
            strokeDasharray={level === levels - 1 ? "none" : "3,3"}
          />
        ))}

        {/* Axis lines */}
        {axisLines.map((line, idx) => (
          <line
            key={idx}
            {...line}
            stroke="#d4d4d4"
            strokeWidth={1}
          />
        ))}

        {/* Data polygon */}
        <polygon
          points={polygonPoints}
          fill={fillColor}
          fillOpacity={fillOpacity}
          stroke={strokeColor}
          strokeWidth={2}
        />

        {/* Data points */}
        {valuesWithData.map((value, idx) => {
          const point = getPoint(idx, value.score);
          return (
            <circle
              key={value.key}
              cx={point.x}
              cy={point.y}
              r={value.isPrioritized ? 6 : 4}
              fill={value.isPrioritized ? strokeColor : '#fff'}
              stroke={strokeColor}
              strokeWidth={2}
            />
          );
        })}

        {/* Labels */}
        {valuesWithData.map((value, idx) => {
          const labelPos = getLabelPoint(idx);
          const angle = -Math.PI / 2 + idx * angleStep;

          // Adjust text anchor based on position
          let textAnchor = 'middle';
          if (Math.cos(angle) > 0.3) textAnchor = 'start';
          if (Math.cos(angle) < -0.3) textAnchor = 'end';

          // Adjust vertical alignment
          let dy = 0;
          if (Math.sin(angle) > 0.3) dy = 12;
          if (Math.sin(angle) < -0.3) dy = -4;

          return (
            <text
              key={value.key}
              x={labelPos.x}
              y={labelPos.y + dy}
              textAnchor={textAnchor}
              className={`text-xs ${
                value.isPrioritized ? 'font-semibold fill-warm-800' : 'fill-warm-500'
              }`}
            >
              {value.label}
              {value.isPrioritized && ' ★'}
            </text>
          );
        })}

        {/* Center score */}
        <text
          x={center}
          y={center}
          textAnchor="middle"
          dominantBaseline="middle"
          className="text-2xl font-bold fill-warm-700"
        >
          {Math.round(overallScore * 100)}%
        </text>
      </svg>
    </div>
  );
};

export default ValuesRadarChart;

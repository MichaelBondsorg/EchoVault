import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import ReportChart from '../ReportChart';

describe('ReportChart', () => {
  it('renders SVG mood line chart from sparkline data', () => {
    const chartData = {
      type: 'sparkline',
      data: [
        { date: '2026-02-09', value: 7 },
        { date: '2026-02-10', value: 5 },
        { date: '2026-02-11', value: 8 },
      ],
    };
    const { container } = render(<ReportChart chartData={chartData} />);
    expect(container.querySelector('svg')).toBeTruthy();
    expect(container.querySelector('polyline')).toBeTruthy();
    expect(container.querySelectorAll('circle')).toHaveLength(3);
  });

  it('renders SVG bar chart from category breakdown data', () => {
    const chartData = {
      type: 'category_breakdown',
      data: [
        { label: 'Work', value: 10 },
        { label: 'Personal', value: 8 },
      ],
    };
    const { container } = render(<ReportChart chartData={chartData} />);
    expect(screen.getByText('Work')).toBeTruthy();
    expect(screen.getByText('Personal')).toBeTruthy();
  });

  it('handles empty chartData gracefully', () => {
    const { container } = render(<ReportChart chartData={null} />);
    expect(container.innerHTML).toBe('');
  });

  it('handles empty data arrays gracefully', () => {
    const { container } = render(
      <ReportChart chartData={{ type: 'sparkline', data: [] }} />
    );
    expect(container.querySelector('svg')).toBeNull();
  });

  it('renders compound chart data with moodTrend property', () => {
    const chartData = {
      moodTrend: [
        { date: '2026-02-09', value: 6 },
        { date: '2026-02-10', value: 7 },
      ],
    };
    const { container } = render(<ReportChart chartData={chartData} />);
    expect(container.querySelector('svg')).toBeTruthy();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import ReportViewer from '../ReportViewer';
import { useReportsStore } from '../../../stores/reportsStore';

// Mock framer-motion
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }) => {
      const { initial, animate, exit, transition, ...rest } = props;
      return <div {...rest}>{children}</div>;
    },
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}));

const mockReport = (overrides = {}) => ({
  id: 'weekly-2026-02-09',
  cadence: 'weekly',
  status: 'ready',
  periodStart: { toDate: () => new Date(2026, 1, 9) },
  periodEnd: { toDate: () => new Date(2026, 1, 15) },
  sections: [
    { id: 'summary', title: 'This Week', narrative: 'Great week!', chartData: null, entities: [], entryRefs: [] },
    { id: 'insight', title: 'Insight', narrative: 'You showed growth.', chartData: null, entities: [], entryRefs: [] },
  ],
  metadata: { entryCount: 7, moodAvg: 7.2, topEntities: ['Work', 'Family'] },
  ...overrides,
});

describe('ReportViewer', () => {
  beforeEach(() => {
    useReportsStore.setState({
      activeReport: null,
      exportProgress: null,
    });
  });

  it('renders all sections from the active report', () => {
    useReportsStore.setState({ activeReport: mockReport() });
    render(<ReportViewer onBack={vi.fn()} />);
    expect(screen.getByText('This Week')).toBeTruthy();
    expect(screen.getByText('Insight')).toBeTruthy();
    expect(screen.getByText('Great week!')).toBeTruthy();
  });

  it('shows loading state when report status is generating', () => {
    useReportsStore.setState({ activeReport: mockReport({ status: 'generating', sections: [] }) });
    render(<ReportViewer onBack={vi.fn()} />);
    expect(screen.getByText('Generating your report...')).toBeTruthy();
  });

  it('shows error state when report status is failed', () => {
    useReportsStore.setState({ activeReport: mockReport({ status: 'failed', sections: [] }) });
    render(<ReportViewer onBack={vi.fn()} />);
    expect(screen.getByText('Report generation failed')).toBeTruthy();
  });

  it('shows metadata footer with entry count and mood', () => {
    useReportsStore.setState({ activeReport: mockReport() });
    render(<ReportViewer onBack={vi.fn()} />);
    expect(screen.getByText('7 entries')).toBeTruthy();
    expect(screen.getByText('Avg mood: 7.2/10')).toBeTruthy();
  });

  it('returns null when no active report', () => {
    const { container } = render(<ReportViewer onBack={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });
});

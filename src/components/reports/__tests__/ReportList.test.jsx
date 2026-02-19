import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ReportList from '../ReportList';
import { useReportsStore } from '../../../stores/reportsStore';
import { useAuthStore } from '../../../stores/authStore';

// Mock framer-motion
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }) => <div {...filterDomProps(props)}>{children}</div>,
    button: ({ children, ...props }) => <button {...filterDomProps(props)}>{children}</button>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}));

function filterDomProps(props) {
  const { initial, animate, exit, transition, whileHover, whileTap, ...rest } = props;
  return rest;
}

const mockReport = (overrides = {}) => ({
  id: 'weekly-2026-02-09',
  cadence: 'weekly',
  status: 'ready',
  periodStart: { toDate: () => new Date(2026, 1, 9) },
  periodEnd: { toDate: () => new Date(2026, 1, 15) },
  generatedAt: { toDate: () => new Date(2026, 1, 16) },
  metadata: { entryCount: 5 },
  ...overrides,
});

describe('ReportList', () => {
  beforeEach(() => {
    useReportsStore.setState({
      reports: [],
      loading: false,
      fetchReports: vi.fn(),
    });
    useAuthStore.setState({ user: { uid: 'user1' } });
  });

  it('shows loading spinner when reports are loading', () => {
    useReportsStore.setState({ loading: true });
    render(<ReportList onSelectReport={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('Loading reports...')).toBeTruthy();
  });

  it('shows empty state when no reports exist', () => {
    useReportsStore.setState({ reports: [], loading: false });
    render(<ReportList onSelectReport={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('No reports yet')).toBeTruthy();
  });

  it('renders report items with cadence badges', () => {
    useReportsStore.setState({
      reports: [
        mockReport(),
        mockReport({ id: 'monthly-2026-01-01', cadence: 'monthly' }),
      ],
      loading: false,
    });
    render(<ReportList onSelectReport={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('Weekly')).toBeTruthy();
    expect(screen.getByText('Monthly')).toBeTruthy();
  });

  it('clicking a report calls onSelectReport', () => {
    const onSelect = vi.fn();
    useReportsStore.setState({
      reports: [mockReport()],
      loading: false,
    });
    render(<ReportList onSelectReport={onSelect} onClose={vi.fn()} />);

    const buttons = screen.getAllByRole('button');
    // Find the report button (not the back button)
    const reportBtn = buttons.find(b => b.textContent.includes('Weekly'));
    fireEvent.click(reportBtn);
    expect(onSelect).toHaveBeenCalledWith('weekly-2026-02-09');
  });

  it('shows generating indicator for in-progress reports', () => {
    useReportsStore.setState({
      reports: [mockReport({ status: 'generating' })],
      loading: false,
    });
    render(<ReportList onSelectReport={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('Generating...')).toBeTruthy();
  });

  it('shows failed indicator for failed reports', () => {
    useReportsStore.setState({
      reports: [mockReport({ status: 'failed' })],
      loading: false,
    });
    render(<ReportList onSelectReport={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('Generation failed')).toBeTruthy();
  });
});

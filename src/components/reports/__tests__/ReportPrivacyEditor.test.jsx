import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ReportPrivacyEditor from '../ReportPrivacyEditor';

const mockReport = {
  id: 'weekly-2026-02-09',
  sections: [
    { id: 'summary', title: 'Summary', entities: ['Alice', 'Bob'], entryRefs: [] },
    { id: 'patterns', title: 'Patterns', entities: ['Alice'], entryRefs: [] },
    { id: 'crisis_section', title: 'Crisis Support', entities: [], entryRefs: [] },
  ],
};

describe('ReportPrivacyEditor', () => {
  it('renders section toggles for each report section', () => {
    render(
      <ReportPrivacyEditor report={mockReport} privacy={null} onSave={vi.fn()} onClose={vi.fn()} />
    );
    expect(screen.getByText('Summary')).toBeTruthy();
    expect(screen.getByText('Patterns')).toBeTruthy();
    expect(screen.getByText('Crisis Support')).toBeTruthy();
  });

  it('renders entity list with anonymize toggles', () => {
    render(
      <ReportPrivacyEditor report={mockReport} privacy={null} onSave={vi.fn()} onClose={vi.fn()} />
    );
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByText('Bob')).toBeTruthy();
  });

  it('crisis content toggle is disabled', () => {
    render(
      <ReportPrivacyEditor report={mockReport} privacy={null} onSave={vi.fn()} onClose={vi.fn()} />
    );
    const checkboxes = screen.getAllByRole('checkbox');
    // Crisis section checkbox should be disabled
    const crisisCheckbox = checkboxes.find((cb) => {
      const label = cb.closest('label');
      return label?.textContent?.includes('Crisis Support');
    });
    expect(crisisCheckbox.disabled).toBe(true);
  });

  it('saves preferences on confirm', () => {
    const onSave = vi.fn();
    render(
      <ReportPrivacyEditor report={mockReport} privacy={null} onSave={onSave} onClose={vi.fn()} />
    );
    fireEvent.click(screen.getByText('Save'));
    expect(onSave).toHaveBeenCalledWith({
      hiddenSections: [],
      anonymizedEntities: [],
    });
  });
});

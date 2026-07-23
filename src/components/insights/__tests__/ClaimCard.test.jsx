/**
 * ClaimCard — R4 Phase 1 Task 10. Five-question layout: badge, wording,
 * evidence line (incl. conditional hidden-sensitive disclosure), first
 * limitation, actions ("See days" / "Feedback" / conditional "Try as an
 * experiment"). No causal language anywhere in rendered copy.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ClaimCard, { evidenceLineFor, experimentTemplateFor, badgeLabelFor } from '../ClaimCard';

// Mirrors claimSchema.js's CAUSAL_RE — pinned independently here so a
// change to ClaimCard's own copy (not the schema's validator) is what this
// test actually exercises.
const CAUSAL_RE = /\b(boosts?|causes?|caused|improves?|improved|makes? you|leads? to|results? in|because of your)\b/i;

function baseClaim(overrides = {}) {
  return {
    id: 'claim_basic-activity-tag-gym-mood_abcd1234_v1',
    claimType: 'pattern_to_watch',
    subject: 'gym',
    direction: 'positive',
    wording: 'On days you mention gym, mood tends to run higher than on comparison days.',
    limitations: [
      'This is one observed pattern in your own data, not a general conclusion.',
      'Other things happening on the same days could also explain this.',
    ],
    analysisPlan: {
      hypothesisFamilyId: 'basic:activity:tag:gym:mood',
      candidateId: 'tag:gym',
    },
    evidence: {
      exposedDayCount: 12,
      comparisonDayCount: 40,
      observedSpanDays: 60,
      effectMoodPoints: -7.4,
      hiddenSensitiveSourceCount: 0,
      sourceEntryIds: ['e1', 'e2'],
    },
    receipt: { sources: [] },
    status: 'verified',
    ...overrides,
  };
}

describe('ClaimCard — five-question layout', () => {
  it('renders the wording, evidence line, and first limitation', () => {
    const claim = baseClaim();
    render(<ClaimCard claim={claim} />);

    expect(screen.getByText(claim.wording)).toBeTruthy();
    expect(screen.getByText('12 gym days vs 40 comparison days · 60-day span · 7 mood-point difference')).toBeTruthy();
    // P2-D7: the limitation line carries the fixed non-causal microcopy prefix.
    expect(screen.getByText(`Association, not cause — ${claim.limitations[0]}`)).toBeTruthy();
    // Only the FIRST limitation renders, not the second.
    expect(screen.queryByText(new RegExp(claim.limitations[1]))).toBeNull();
  });

  it('renders "Pattern to watch" badge for a pattern_to_watch claim', () => {
    render(<ClaimCard claim={baseClaim()} />);
    expect(screen.getByText('Pattern to watch')).toBeTruthy();
  });

  // Review finding (critical, R4 Phase 2 Task 6): the badge was hardcoded
  // "Pattern to watch" for every claim, mislabeling experiment_result claims
  // (feedable since T4) as the weakest tier even though the feed's own
  // type-count header already labels claims by type. The badge must derive
  // from `claim.claimType`.
  it('renders "Experiment result" badge for an experiment_result claim', () => {
    render(<ClaimCard claim={baseClaim({ claimType: 'experiment_result' })} />);
    expect(screen.getByText('Experiment result')).toBeTruthy();
    expect(screen.queryByText('Pattern to watch')).toBeNull();
  });

  it('renders "Observation" badge for an observation claim', () => {
    render(<ClaimCard claim={baseClaim({ claimType: 'observation' })} />);
    expect(screen.getByText('Observation')).toBeTruthy();
    expect(screen.queryByText('Pattern to watch')).toBeNull();
  });

  it('falls back to "Pattern to watch" for an unrecognized claimType (legacy tolerance)', () => {
    render(<ClaimCard claim={baseClaim({ claimType: 'some_future_type' })} />);
    expect(screen.getByText('Pattern to watch')).toBeTruthy();
  });

  it('falls back to "Pattern to watch" when claimType is absent entirely (legacy tolerance)', () => {
    const claim = baseClaim();
    delete claim.claimType;
    render(<ClaimCard claim={claim} />);
    expect(screen.getByText('Pattern to watch')).toBeTruthy();
  });

  it('hidden-sensitive disclosure appears only when hiddenSensitiveSourceCount > 0', () => {
    const { rerender } = render(<ClaimCard claim={baseClaim()} />);
    expect(screen.queryByText(/hidden from preview/i)).toBeNull();

    const withHidden = baseClaim({
      evidence: { ...baseClaim().evidence, hiddenSensitiveSourceCount: 2 },
    });
    rerender(<ClaimCard claim={withHidden} />);
    expect(screen.getByText(/2 contributing days hidden from preview \(sensitive\)/i)).toBeTruthy();
  });

  it('singularizes "day" when exactly 1 source is hidden', () => {
    const claim = baseClaim({
      evidence: { ...baseClaim().evidence, hiddenSensitiveSourceCount: 1 },
    });
    render(<ClaimCard claim={claim} />);
    expect(screen.getByText(/1 contributing day hidden from preview \(sensitive\)/i)).toBeTruthy();
  });

  it('no causal words appear anywhere in rendered copy (outside the fixed anti-causal microcopy)', () => {
    const claim = baseClaim({
      evidence: { ...baseClaim().evidence, hiddenSensitiveSourceCount: 3 },
    });
    const { container } = render(<ClaimCard claim={claim} />);
    // The P2-D7 microcopy literally contains "cause" ("Association, not
    // cause —") — it is the mandated ANTI-causal disclaimer, so assert it is
    // present, then scan everything OUTSIDE that fixed literal.
    const text = container.textContent;
    expect(text).toContain('Association, not cause — ');
    const outsideMicrocopy = text.replaceAll('Association, not cause — ', '');
    expect(CAUSAL_RE.test(outsideMicrocopy)).toBe(false);
  });

  // F4 (closure-wave final review): the button now requires BOTH a template
  // mapping AND a real `onTryExperiment` handler prop — a mapped claim with
  // no handler must render nothing (previously it always rendered a
  // guaranteed no-op in production, where no handler is ever wired). Every
  // "present" case below now supplies a handler explicitly; the "no
  // handler" and "no mapping + handler" cases are pinned as their own tests.
  it('"Try as an experiment" is present for a tag: claim when a handler is supplied', () => {
    render(<ClaimCard claim={baseClaim()} onTryExperiment={vi.fn()} />);
    expect(screen.getByText('Try as an experiment')).toBeTruthy();
  });

  it('"Try as an experiment" is absent for a tag: claim (mapping exists) when NO handler is supplied (F4)', () => {
    render(<ClaimCard claim={baseClaim()} />);
    expect(screen.queryByText('Try as an experiment')).toBeNull();
  });

  it('"Try as an experiment" is absent for an entity: claim (no mapping) even when a handler IS supplied (F4)', () => {
    const entityClaim = baseClaim({
      subject: 'Sarah',
      analysisPlan: { hypothesisFamilyId: 'basic:people:entity:sarah:mood', candidateId: 'entity:sarah' },
    });
    render(<ClaimCard claim={entityClaim} onTryExperiment={vi.fn()} />);
    expect(screen.queryByText('Try as an experiment')).toBeNull();
  });

  it('"Try as an experiment" is absent for a category: claim (no mapping) even when a handler IS supplied (F4)', () => {
    const categoryClaim = baseClaim({
      subject: 'work',
      analysisPlan: { hypothesisFamilyId: 'basic:category:category:work:mood', candidateId: 'category:work' },
    });
    render(<ClaimCard claim={categoryClaim} onTryExperiment={vi.fn()} />);
    expect(screen.queryByText('Try as an experiment')).toBeNull();
  });

  it('"Try as an experiment" is present for a mapped health: claim (sleepHours) when a handler is supplied', () => {
    const healthClaim = baseClaim({
      subject: 'sleep hours',
      analysisPlan: { hypothesisFamilyId: 'basic:health:health:sleepHours:mood', candidateId: 'health:sleepHours' },
    });
    render(<ClaimCard claim={healthClaim} onTryExperiment={vi.fn()} />);
    expect(screen.getByText('Try as an experiment')).toBeTruthy();
  });

  it('"Try as an experiment" is absent for an unmapped health: field even when a handler IS supplied', () => {
    const healthClaim = baseClaim({
      subject: 'HRV',
      analysisPlan: { hypothesisFamilyId: 'basic:health:health:hrv:mood', candidateId: 'health:hrv' },
    });
    render(<ClaimCard claim={healthClaim} onTryExperiment={vi.fn()} />);
    expect(screen.queryByText('Try as an experiment')).toBeNull();
  });
});

describe('ClaimCard — action handlers', () => {
  it('"See days" calls onShowReceipt(claim)', async () => {
    const claim = baseClaim();
    const onShowReceipt = vi.fn();
    render(<ClaimCard claim={claim} onShowReceipt={onShowReceipt} />);

    await fireEvent.click(screen.getByText('See days'));
    expect(onShowReceipt).toHaveBeenCalledWith(claim);
  });

  it('"Feedback" calls onFeedback(claim)', async () => {
    const claim = baseClaim();
    const onFeedback = vi.fn();
    render(<ClaimCard claim={claim} onFeedback={onFeedback} />);

    await fireEvent.click(screen.getByText('Feedback'));
    expect(onFeedback).toHaveBeenCalledWith(claim);
  });

  it('"Try as an experiment" calls onTryExperiment(templateId, tag) for a tag claim', async () => {
    const claim = baseClaim();
    const onTryExperiment = vi.fn();
    render(<ClaimCard claim={claim} onTryExperiment={onTryExperiment} />);

    await fireEvent.click(screen.getByText('Try as an experiment'));
    expect(onTryExperiment).toHaveBeenCalledWith('tag-presence-mood', 'gym');
  });

  it('"Try as an experiment" calls onTryExperiment(templateId, null) for a health claim', async () => {
    const healthClaim = baseClaim({
      subject: 'steps',
      analysisPlan: { hypothesisFamilyId: 'basic:health:health:steps:mood', candidateId: 'health:steps' },
    });
    const onTryExperiment = vi.fn();
    render(<ClaimCard claim={healthClaim} onTryExperiment={onTryExperiment} />);

    await fireEvent.click(screen.getByText('Try as an experiment'));
    expect(onTryExperiment).toHaveBeenCalledWith('steps-mood', null);
  });

  it('does not throw when no handler props are given (and renders no "Try as an experiment" button — F4: no handler means hidden)', async () => {
    render(<ClaimCard claim={baseClaim()} />);
    await fireEvent.click(screen.getByText('See days'));
    await fireEvent.click(screen.getByText('Feedback'));
    expect(screen.queryByText('Try as an experiment')).toBeNull();
  });
});

describe('ClaimCard — renders nothing for a missing claim', () => {
  it('returns null when claim is undefined', () => {
    const { container } = render(<ClaimCard claim={undefined} />);
    expect(container.textContent).toBe('');
  });
});

describe('experimentTemplateFor', () => {
  it('maps tag: candidateId to tag-presence-mood + the tag value', () => {
    expect(experimentTemplateFor(baseClaim())).toEqual({ templateId: 'tag-presence-mood', tag: 'gym' });
  });

  it('maps health:sleepHours / steps / recoveryScore to their templates', () => {
    expect(experimentTemplateFor(baseClaim({
      analysisPlan: { hypothesisFamilyId: 'f', candidateId: 'health:sleepHours' },
    }))).toEqual({ templateId: 'sleep-hours-mood-same-day', tag: null });
    expect(experimentTemplateFor(baseClaim({
      analysisPlan: { hypothesisFamilyId: 'f', candidateId: 'health:steps' },
    }))).toEqual({ templateId: 'steps-mood', tag: null });
    expect(experimentTemplateFor(baseClaim({
      analysisPlan: { hypothesisFamilyId: 'f', candidateId: 'health:recoveryScore' },
    }))).toEqual({ templateId: 'recovery-score-mood', tag: null });
  });

  it('returns null for entity:/category: candidateIds', () => {
    expect(experimentTemplateFor(baseClaim({
      analysisPlan: { hypothesisFamilyId: 'f', candidateId: 'entity:sarah' },
    }))).toBeNull();
    expect(experimentTemplateFor(baseClaim({
      analysisPlan: { hypothesisFamilyId: 'f', candidateId: 'category:work' },
    }))).toBeNull();
  });

  it('returns null for a claim with no analysisPlan/candidateId', () => {
    expect(experimentTemplateFor({})).toBeNull();
    expect(experimentTemplateFor(null)).toBeNull();
  });
});

describe('badgeLabelFor', () => {
  it('maps each known claimType to its label', () => {
    expect(badgeLabelFor(baseClaim({ claimType: 'experiment_result' }))).toBe('Experiment result');
    expect(badgeLabelFor(baseClaim({ claimType: 'pattern_to_watch' }))).toBe('Pattern to watch');
    expect(badgeLabelFor(baseClaim({ claimType: 'observation' }))).toBe('Observation');
  });

  it('falls back to "Pattern to watch" for unrecognized/absent claimType', () => {
    expect(badgeLabelFor(baseClaim({ claimType: 'unknown' }))).toBe('Pattern to watch');
    expect(badgeLabelFor({})).toBe('Pattern to watch');
    expect(badgeLabelFor(null)).toBe('Pattern to watch');
  });
});

// evidenceLineFor is exercised indirectly above; a couple of direct unit
// checks pin the exact format string independent of rendering.
describe('evidenceLineFor', () => {
  it('formats without a hidden-sensitive clause when count is 0', () => {
    expect(evidenceLineFor(baseClaim())).toBe(
      '12 gym days vs 40 comparison days · 60-day span · 7 mood-point difference',
    );
  });

  it('rounds |effectMoodPoints| regardless of sign', () => {
    const positive = baseClaim({ evidence: { ...baseClaim().evidence, effectMoodPoints: 3.6 } });
    expect(evidenceLineFor(positive)).toContain('4 mood-point difference');
  });
});

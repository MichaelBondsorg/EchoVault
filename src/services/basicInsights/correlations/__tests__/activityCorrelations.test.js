/**
 * activityCorrelations tests (R4 Task 1).
 *
 * Entries are run through the REAL adapter (`normalizeEntryForInsights`)
 * before reaching the engine, so these are effectively adapter+engine
 * integration tests — including the regression case for the live
 * `.toLowerCase()`-on-an-object crash the deep review reproduced.
 */
import { describe, it, expect } from 'vitest';
import { computeActivityCorrelations } from '../activityCorrelations';
import { normalizeEntryForInsights } from '../../../insights/entryAdapter';

const TZ = 'UTC';
const n = (raw) => normalizeEntryForInsights(raw, { timeZone: TZ });

const dayIso = (day) => `2026-07-${String(day).padStart(2, '0')}T12:00:00.000Z`;

describe('computeActivityCorrelations', () => {
  it('does not throw on an export-shaped entry with healthContext.activity as an OBJECT (the live crash site)', () => {
    const entries = [
      n({
        id: 'r1', createdAt: dayIso(1), content: 'Ran this morning',
        analysis: { mood_score: 0.8 },
        healthContext: { activity: { hasWorkout: true, workouts: [{ type: 'Running', durationMinutes: 30 }] } },
      }),
      n({ id: 'r2', createdAt: dayIso(2), content: 'quiet day', analysis: { mood_score: 0.5 } }),
      n({ id: 'r3', createdAt: dayIso(3), content: 'quiet day', analysis: { mood_score: 0.5 } }),
      n({ id: 'r4', createdAt: dayIso(4), content: 'quiet day', analysis: { mood_score: 0.5 } }),
      n({ id: 'r5', createdAt: dayIso(5), content: 'quiet day', analysis: { mood_score: 0.5 } }),
    ];
    expect(() => computeActivityCorrelations(entries)).not.toThrow();
  });

  it('detects an activity from healthSignals.activityTypes (workout object shape) and correlates it', () => {
    const entries = [];
    for (let i = 1; i <= 5; i++) {
      entries.push(n({
        id: `run-${i}`, createdAt: dayIso(i),
        analysis: { mood_score: 0.9 },
        healthContext: { activity: { hasWorkout: true, workouts: [{ type: 'Running' }] } },
      }));
    }
    for (let i = 1; i <= 5; i++) {
      entries.push(n({ id: `rest-${i}`, createdAt: dayIso(i + 10), content: 'normal day', analysis: { mood_score: 0.5 } }));
    }

    const insights = computeActivityCorrelations(entries);
    const running = insights.find(ins => ins.activityKey === 'running');
    expect(running).toBeTruthy();
    expect(running.entryIds.sort()).toEqual(['run-1', 'run-2', 'run-3', 'run-4', 'run-5']);
  });

  it('wording is association-only ("correlates with"), never causal ("boosts"/"lowers")', () => {
    const entries = [];
    for (let i = 1; i <= 5; i++) {
      entries.push(n({ id: `yoga-${i}`, createdAt: dayIso(i), content: 'yoga session today', analysis: { mood_score: 0.95 } }));
    }
    for (let i = 1; i <= 5; i++) {
      entries.push(n({ id: `plain-${i}`, createdAt: dayIso(i + 10), content: 'nothing special', analysis: { mood_score: 0.4 } }));
    }

    const insights = computeActivityCorrelations(entries);
    const yoga = insights.find(ins => ins.activityKey === 'yoga');
    expect(yoga).toBeTruthy();
    expect(yoga.insight).toContain('correlates with');
    expect(yoga.insight.toLowerCase()).not.toContain('boosts');
    expect(yoga.insight.toLowerCase()).not.toContain('lowers');
  });

  it('uses a non-overlapping complement baseline, not an all-entries average', () => {
    const entries = [];
    for (let i = 1; i <= 5; i++) {
      entries.push(n({ id: `yoga-${i}`, createdAt: dayIso(i), content: 'yoga class', analysis: { mood_score: 0.9 } }));
    }
    for (let i = 1; i <= 5; i++) {
      entries.push(n({ id: `plain-${i}`, createdAt: dayIso(i + 10), content: 'plain day', analysis: { mood_score: 0.5 } }));
    }

    const insights = computeActivityCorrelations(entries);
    const yoga = insights.find(ins => ins.activityKey === 'yoga');
    // Complement (non-yoga) average is exactly 0.5 -> baselineMood 50, not
    // the all-entries average (0.7 -> would read as baselineMood 70).
    expect(yoga.baselineMood).toBe(50);
    expect(yoga.activityMood).toBe(90);
    expect(yoga.moodDelta).toBe(40);
  });

  it('day-grounding: does not emit an insight when the activity spans fewer than MIN_UNIQUE_DAYS distinct days', () => {
    const entries = [];
    // 5 yoga entries, but only 2 distinct calendar days (same-day repeats)
    for (let i = 0; i < 5; i++) {
      entries.push(n({
        id: `yoga-${i}`,
        createdAt: `2026-07-0${(i % 2) + 1}T${8 + i}:00:00.000Z`,
        content: 'yoga session',
        analysis: { mood_score: 0.9 },
      }));
    }
    for (let i = 1; i <= 5; i++) {
      entries.push(n({ id: `plain-${i}`, createdAt: dayIso(i + 10), content: 'plain', analysis: { mood_score: 0.5 } }));
    }

    const insights = computeActivityCorrelations(entries);
    expect(insights.find(ins => ins.activityKey === 'yoga')).toBeUndefined();
  });

  it('empty-group guard: no insight when EVERY entry has the activity (no complement/absent group to compare against)', () => {
    const entries = [];
    for (let i = 1; i <= 6; i++) {
      entries.push(n({ id: `yoga-${i}`, createdAt: dayIso(i), content: 'yoga every day', analysis: { mood_score: 0.9 } }));
    }

    const insights = computeActivityCorrelations(entries);
    // Regression guard for the healthCorrelations-class average([])->0 bug:
    // must be "insufficient" (nothing emitted), never a fabricated delta
    // against a phantom absent-group average of 0.
    expect(insights.find(ins => ins.activityKey === 'yoga')).toBeUndefined();
  });
});

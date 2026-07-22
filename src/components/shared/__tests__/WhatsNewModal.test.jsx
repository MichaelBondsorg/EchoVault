/**
 * WhatsNewModal — flag-aware What's New tests.
 *
 * Covers: flag-off byte-identical nothing, single-flag single-entry
 * rendering, dismiss -> per-feature seen -> no reshow, a later flag flip
 * resurfacing only the new entry, the owner-scoped key shape, and a copy
 * regex over the FEATURE_ANNOUNCEMENTS catalog (no guilt/streak/hype
 * language — CLAUDE.md Trust & Capture voice discipline).
 *
 * Real timers throughout (not fake) — the modal's AnimatePresence exit
 * animation relies on requestAnimationFrame, which fake timers don't
 * advance, so dismissal assertions would hang. (First AnimatePresence
 * overlay test in this codebase — no prior precedent file exists; the
 * review corrected an earlier comment here that cited one.)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import WhatsNewModal from '../WhatsNewModal';
import { FEATURE_ANNOUNCEMENTS } from '../featureAnnouncements';
import { ownerStorageKey } from '../../../services/storage/ownerScopedStorage';

const getFlag = vi.fn();
vi.mock('../../../config/flags', () => ({ getFlag: (...a) => getFlag(...a) }));

const UID = 'user-1';

// The global test setup (src/test/setup.js) stubs `window.localStorage` as
// bare jest.fn() spies with no real storage behind them (see
// RevisitControls.test.jsx for the same precedent) — give those spies an
// in-memory backing store so dismissal actually persists/reads back here.
const localStorageStore = new Map();

beforeEach(() => {
  localStorageStore.clear();
  window.localStorage.getItem.mockImplementation((key) => (localStorageStore.has(key) ? localStorageStore.get(key) : null));
  window.localStorage.setItem.mockImplementation((key, value) => { localStorageStore.set(key, String(value)); });
  window.localStorage.removeItem.mockImplementation((key) => { localStorageStore.delete(key); });
  window.localStorage.clear.mockImplementation(() => { localStorageStore.clear(); });
  getFlag.mockReturnValue(false);
});

// The modal opens after a fixed 1000ms delay (see WhatsNewModal.jsx) — wait
// for it rather than asserting instantly.
async function expectDialogEventually(props) {
  const utils = render(<WhatsNewModal {...props} />);
  await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy(), { timeout: 2000 });
  return utils;
}

// For the negative case there's nothing to waitFor, so wait out the delay
// window and then assert absence.
async function expectNoDialogEver(props) {
  render(<WhatsNewModal {...props} />);
  await new Promise((resolve) => setTimeout(resolve, 1300));
  expect(screen.queryByRole('dialog')).toBeNull();
}

describe('WhatsNewModal — all flags off', () => {
  it('renders nothing (byte-identical nothing)', async () => {
    await expectNoDialogEver({ uid: UID });
  }, 10000);

  it('renders nothing even without a uid, regardless of flags', async () => {
    getFlag.mockReturnValue(true);
    await expectNoDialogEver({ uid: undefined });
  }, 10000);
});

describe('WhatsNewModal — one flag on', () => {
  it('shows only that entry', async () => {
    getFlag.mockImplementation((flag) => flag === 'openLoops');
    await expectDialogEventually({ uid: UID });

    expect(screen.getByText('Open Loops')).toBeTruthy();
    // No other catalog entry's title leaked in.
    for (const entry of FEATURE_ANNOUNCEMENTS) {
      if (entry.id !== 'openLoops') {
        expect(screen.queryByText(entry.title)).toBeNull();
      }
    }
  }, 10000);

  it('dismiss marks it seen and it does not reshow on remount', async () => {
    getFlag.mockImplementation((flag) => flag === 'openLoops');
    const { unmount } = await expectDialogEventually({ uid: UID });

    fireEvent.click(screen.getByText('Got it'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    unmount();

    await expectNoDialogEver({ uid: UID });
  }, 10000);

  it('per-feature seen key is owner-scoped (encodes uid + area + feature id)', async () => {
    getFlag.mockImplementation((flag) => flag === 'openLoops');
    await expectDialogEventually({ uid: UID });

    fireEvent.click(screen.getByText('Got it'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const expectedKey = ownerStorageKey(UID, 'whatsnew/seen/openLoops');
    expect(localStorage.getItem(expectedKey)).toBe('true');
    // Shape sanity: distinguishable per-owner, per-feature (not a single
    // global flag like the old lastSeenVersion key).
    expect(expectedKey).toContain(encodeURIComponent(UID));
  }, 10000);
});

describe('WhatsNewModal — staggered rollout (second flag flipped later)', () => {
  it('reshows with ONLY the newly-enabled entry, not the already-seen one', async () => {
    // First session: openLoops on, seen and dismissed.
    getFlag.mockImplementation((flag) => flag === 'openLoops');
    const { unmount } = await expectDialogEventually({ uid: UID });
    fireEvent.click(screen.getByText('Got it'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    unmount();

    // Later: insightReceipts also flipped on.
    getFlag.mockImplementation((flag) => flag === 'openLoops' || flag === 'insightReceipts');
    await expectDialogEventually({ uid: UID });

    expect(screen.getByText('Why am I seeing this?')).toBeTruthy();
    expect(screen.queryByText('Open Loops')).toBeNull();
  }, 10000);
});

describe('WhatsNewModal — copy discipline', () => {
  const BANNED = /\b(streak|guilt|don't miss|miss out|hurry|limited time|exclusive|amazing|badge|keep it up|in a row|urgent|act now)\b/i;

  it('no guilt/streak/hype language in any announcement title or blurb', () => {
    for (const entry of FEATURE_ANNOUNCEMENTS) {
      expect(entry.title, `title for ${entry.id}`).not.toMatch(BANNED);
      expect(entry.blurb, `blurb for ${entry.id}`).not.toMatch(BANNED);
    }
  });

  it('every catalog entry has an id, flag, title, and blurb', () => {
    for (const entry of FEATURE_ANNOUNCEMENTS) {
      expect(typeof entry.id).toBe('string');
      expect(typeof entry.flag).toBe('string');
      expect(typeof entry.title).toBe('string');
      expect(typeof entry.blurb).toBe('string');
    }
  });
});

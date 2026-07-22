import { ownerStorageKey } from '../../services/storage/ownerScopedStorage';

/**
 * FEATURE_ANNOUNCEMENTS — catalog for the flag-aware "What's New" modal
 * (WhatsNewModal.jsx). One entry per shippable, default-off feature from the
 * R1-R3 waves (see CLAUDE.md "Trust & Capture Invariants"). Each entry
 * renders in the modal ONLY when `getFlag(entry.flag)` is true, so a user
 * only ever sees announcements for features that are actually live for
 * them — flipping a flag later resurfaces exactly the newly-enabled entry,
 * never the ones already on and already seen.
 *
 * Copy discipline: calm, plain, non-clinical, non-marketing — matches the
 * voice already established across the app's own feature copy (Settings'
 * "Insight frequency" chips, RecipesScreen/SpaceManager/SessionPrepScreen
 * headers, IntentSuggestionTray's "plain, non-presumptive copy (no
 * guilt/urgency language)" doc comment). No streak/guilt/hype language —
 * see WhatsNewModal.test.jsx's copy regex, which scans this catalog.
 *
 * `id` doubles as the per-feature "seen" key (see `isAnnouncementSeen`/
 * `markAnnouncementsSeen` below) and currently equals `flag` for every
 * entry — kept as a separate field because the two mean different things
 * (id = stable identity for seen-tracking, flag = what gates visibility)
 * and a future entry might need to diverge (e.g. two announcements behind
 * one flag, or an announcement that outlives a flag rename).
 *
 * `tipTarget` (optional) documents which page-level first-use tip, if any,
 * this announcement points to — it is not read by WhatsNewModal itself,
 * just a breadcrumb so the two mechanisms stay traceable to each other.
 */
export const FEATURE_ANNOUNCEMENTS = [
  {
    id: 'openLoops',
    flag: 'openLoops',
    title: 'Open Loops',
    blurb:
      'Small things you mentioned wanting to follow up on — texting someone back, booking an appointment — now surface on Home so you can close them out when you’re ready. They never notify you, and dismissing one is final.',
  },
  {
    id: 'contextSpaces',
    flag: 'contextSpaces',
    title: 'Context Spaces',
    blurb:
      'Group entries into spaces like Work or Personal, then scope Ask Journal to just one. Find it in Settings → Context Spaces.',
  },
  {
    id: 'insightBudget',
    flag: 'insightBudget',
    title: 'Calmer insight pacing',
    blurb:
      'Choose how many insights you see — Quiet, Balanced, or Exploratory — in Settings → AI & Privacy.',
  },
  {
    id: 'insightReceipts',
    flag: 'insightReceipts',
    title: 'Why am I seeing this?',
    blurb:
      'Every insight now carries a receipt — the entries, time window, and sample size behind it. Look for the link on any insight, or open the Insight Control Center in Settings to review or exclude what feeds them.',
    tipTarget: 'InsightsPage',
  },
  {
    id: 'voiceChapters',
    flag: 'voiceChapters',
    title: 'Chapter markers',
    blurb:
      'Mark a new chapter while recording a voice entry, then rename or merge markers afterward. Your original recording and text are never touched.',
  },
  {
    id: 'reflectionRecipes',
    flag: 'reflectionRecipes',
    title: 'Reflection Recipes',
    blurb:
      'Ask a set of questions across your entries whenever you want to look back — monthly review, goal progress, relationship check-in, and more.',
  },
  {
    id: 'sessionPrep',
    flag: 'sessionPrep',
    title: 'Session Prep',
    blurb:
      'A private, editable brief built from your own entries for your next session — nothing leaves this app until you export it.',
  },
  {
    id: 'gentleRevisit',
    flag: 'gentleRevisit',
    title: 'Gentle Revisit',
    blurb:
      'An opt-in way to occasionally resurface a calm memory from your journal. It’s off until you turn it on in Settings, and you choose what stays hidden.',
  },
  {
    id: 'personalExperiments',
    flag: 'personalExperiments',
    title: 'Personal Experiments',
    blurb:
      'Test a hunch against your own entries. Experiments look for associations, not proof — a pattern here never shows that one thing caused another.',
  },
  {
    id: 'intentExtraction',
    flag: 'intentExtraction',
    title: 'Smarter task capture',
    blurb:
      'Mention something you need to do in an entry, and Engram can suggest it as a task or open loop — keep it, edit it, or say no thanks.',
  },
];

const SEEN_AREA_PREFIX = 'whatsnew/seen';

/**
 * Per-feature "seen" state, owner-scoped. WhatsNewModal's one mount site
 * (App.jsx, past the `if (!user) return` auth gate) always has a `uid` —
 * unlike some page-level tips that predate the owner-scope invariant and
 * mount before auth resolves, there's no reason for these new keys to fall
 * back to a plain global key. Missing uid => treated as always-unseen /
 * writes are no-ops (defensive only; the real mount site never hits this).
 */
export function isAnnouncementSeen(uid, id) {
  if (!uid) return false;
  try {
    return localStorage.getItem(ownerStorageKey(uid, `${SEEN_AREA_PREFIX}/${id}`)) === 'true';
  } catch {
    return false;
  }
}

export function markAnnouncementsSeen(uid, ids) {
  if (!uid) return;
  try {
    for (const id of ids) {
      localStorage.setItem(ownerStorageKey(uid, `${SEEN_AREA_PREFIX}/${id}`), 'true');
    }
  } catch {
    // localStorage unavailable (private mode, etc.) — the modal will simply
    // reappear next time, which is safe (never blocks anything else).
  }
}

/**
 * Enabled-but-unseen entries for this uid, in catalog order. Without a uid,
 * returns [] rather than guessing — WhatsNewModal never shows without a
 * stable owner to key dismissal against.
 */
export function getUnseenAnnouncements(uid, getFlag) {
  if (!uid) return [];
  return FEATURE_ANNOUNCEMENTS.filter(
    (entry) => getFlag(entry.flag) && !isAnnouncementSeen(uid, entry.id)
  );
}

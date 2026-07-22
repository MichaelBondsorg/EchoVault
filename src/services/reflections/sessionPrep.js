/**
 * Session Prep service (R2 Task 18).
 *
 * Ratified product decision: Session Prep = the existing Reflection Recipes
 * engine (Task 16) + an explicit, safety-reviewed PDF export. No new AI
 * machinery. `buildSessionBrief` runs the Session-preparation starter
 * questions (verbatim, sourced from `STARTER_RECIPES` so the two never
 * drift) through the exact same scope → date-range → exclusions →
 * `askJournalAI` pipeline `runRecipe.js` uses (`runQuestions`, exported
 * from there specifically for this reuse) — the only difference is an
 * EXPLICIT `sinceDate` supplied by the caller instead of a `timeRangeDays`
 * count-back-from-now. The PRD requires the since-date be stored on the
 * artifact and NEVER inferred, so this module never derives it from
 * anything: a missing/invalid/future `sinceDate` throws rather than
 * silently defaulting. The UI is responsible for pre-filling
 * `DEFAULT_SINCE_DAYS_BACK` days back into the date field before the user
 * ever confirms — that default lives at the call site, not in here.
 *
 * The resulting `reflections/{id}` doc (`kind:'session_brief'`) is
 * structurally the same shape `runRecipe.js` already produces — blocks are
 * `{id, type, question?, text, sources, editedByUser}` — with two
 * session-prep-only additions per block, `section`/`sectionKey` (fixed
 * display headers: "Changes since", "Moments to bring up", "Patterns",
 * "Open questions", plus "Topics" when provided and "My goals" for the
 * trailing empty user block). Firestore rules validate only the
 * REFLECTION doc's top-level keys (`hasOnly([...])`) and that `blocks is
 * list` — nothing about an individual block's own shape — so these extra
 * per-block fields are safe additions that need no rules change. `kind`,
 * `scope`, `period`, `title`, `blocks`, `status`, `createdAt`, `updatedAt`
 * are all in the rules' allowed key set; `recipeId`/`definitionVersion`
 * (recipe-run-only concepts) are simply omitted here, per the codebase's
 * no-null-stuffing convention.
 *
 * A session brief reuses `runRecipe.js`'s `updateBlock`/`addUserBlock`/
 * `removeBlock`/`reorderBlocks` editing helpers UNCHANGED — no new editing
 * machinery, and no risk of the editedByUser/sources semantics drifting
 * between recipe runs and session briefs.
 *
 * `regenerateSection` re-runs exactly ONE block's question through the same
 * `runQuestions` pipeline, using the brief's OWN stored `period` (never a
 * freshly-computed range) so a regenerated section still respects the
 * artifact's pinned since-date. If the target block has `editedByUser:true`
 * the caller must pass `{confirm:true}` or the call throws without writing.
 * Regeneration always resets `editedByUser` to false (the block becomes
 * fresh AI content again) and re-derives the Patterns missingness line.
 * Every other block is copied through unchanged — the write goes through
 * `writeBlocks` (imported straight from `runRecipe.js`), which writes
 * exactly `{blocks, updatedAt}`, so this can't drift from that contract.
 *
 * Export (`composeSessionPrepPdf`) is a separate, SAFETY-CRITICAL concern —
 * see that function's own doc comment.
 */
import { runQuestions, loadReflection, writeBlocks, reflectionsPath, newBlockId } from './runRecipe';
import { STARTER_RECIPES } from './starterRecipes';
import { computeMissingness, toISOTimestamp } from '../insights/receipts';
import { collection, addDoc } from '../../config/firebase';
import { loadJsPDF } from '../../utils/pdf';

const SESSION_PREP_TEMPLATE = STARTER_RECIPES.find((r) => r.name === 'Session preparation');

/** UI default for the since-date form field — never used inside this module. */
export const DEFAULT_SINCE_DAYS_BACK = 14;

/**
 * The four Session-preparation starter questions, exported so callers (the
 * UI's pre-run embedding-generation step, mirroring `RecipesScreen`'s
 * `confirmRun`) can build the exact same question set `buildSessionBrief`
 * will use — including the optional topics question — WITHOUT duplicating
 * the "find the Session preparation template" lookup themselves.
 */
export const SESSION_PREP_QUESTIONS = SESSION_PREP_TEMPLATE.questions;

// Fixed section headers, in order, one per Session-preparation starter
// question (index-aligned — `SESSION_PREP_TEMPLATE.questions` is pinned
// verbatim in `starterRecipes.js` and must not be reordered independently
// of this list).
const SECTIONS = [
  { key: 'changes_since', title: 'Changes since' },
  { key: 'moments', title: 'Moments to bring up' },
  { key: 'patterns', title: 'Patterns' },
  { key: 'open_questions', title: 'Open questions' },
];

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value?.toDate === 'function') return value.toDate();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Appends a parenthesized missingness annotation to `text`; pure passthrough when `missingness` is null. */
function withMissingness(text, missingness) {
  if (!missingness) return text ?? null;
  const base = text ?? '';
  return base ? `${base}\n\n(${missingness})` : `(${missingness})`;
}

/**
 * Build a Session Prep brief: the four Session-preparation starter
 * questions run through the recipe engine's pipeline against an EXPLICIT
 * since-date, plus an optional fifth question built from free-text
 * `topics`, plus an empty "My goals" user block for the user to fill in.
 *
 * @param {object} db
 * @param {string} uid
 * @param {{sinceDate: Date|string, scope?: {spaceId:string}|null, topics?: string, entries?: Array, embeddings?: Record<string, {v1?:number[], v2?:number[]}|number[]|null>}} options
 *   `sinceDate` is REQUIRED and stored AS-IS (never inferred/recomputed) —
 *   see module doc. `embeddings` — pre-computed `{[questionText]:
 *   embeddingVector}` map, same contract as `runRecipe`/`runQuestions`
 *   (CRITICAL: retrieval degrades to recency/tags without it).
 * @returns {Promise<object>} the created `reflections/{id}` doc, `{id, ...payload}`
 */
export async function buildSessionBrief(db, uid, options = {}) {
  const { scope = null, topics = '', entries = [], embeddings = {} } = options;
  const sinceDate = toDate(options.sinceDate);
  if (!sinceDate) {
    throw new Error('buildSessionBrief: a valid sinceDate is required.');
  }
  const end = new Date();
  if (sinceDate.getTime() > end.getTime()) {
    throw new Error('buildSessionBrief: sinceDate must not be in the future.');
  }

  const trimmedTopics = typeof topics === 'string' ? topics.trim() : '';
  const questions = [...SESSION_PREP_TEMPLATE.questions];
  if (trimmedTopics) questions.push(trimmedTopics);

  const { blocks: aiBlocks, filteredEntries } = await runQuestions(db, uid, {
    questions,
    scope,
    entries,
    embeddings,
    start: sinceDate,
    end,
  });

  const missingness = computeMissingness(filteredEntries, {
    start: sinceDate.toISOString(),
    end: end.toISOString(),
  });

  const sectionedBlocks = aiBlocks.map((block, index) => {
    if (index < SECTIONS.length) {
      const { key, title } = SECTIONS[index];
      return {
        ...block,
        section: title,
        sectionKey: key,
        text: key === 'patterns' ? withMissingness(block.text, missingness) : block.text,
      };
    }
    // The optional topics question, when present — always the last AI block.
    return { ...block, section: 'Topics', sectionKey: 'topics' };
  });

  const goalsBlock = {
    id: newBlockId(),
    type: 'user',
    section: 'My goals',
    sectionKey: 'goals',
    text: '',
    sources: [],
    editedByUser: false,
  };

  const now = new Date();
  const monthYear = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const payload = {
    kind: 'session_brief',
    scope,
    period: { start: sinceDate.toISOString(), end: end.toISOString() },
    title: `Session prep — ${monthYear}`,
    blocks: [...sectionedBlocks, goalsBlock],
    status: 'draft',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  const docRef = await addDoc(collection(db, reflectionsPath(uid)), payload);
  return { id: docRef.id, ...payload };
}

/**
 * Re-run exactly ONE section's question, using the brief's own stored
 * `period` (never a freshly-computed range — the since-date stays pinned to
 * the artifact). Every other block passes through byte-identical.
 *
 * @param {object} db
 * @param {string} uid
 * @param {string} briefId
 * @param {string} blockId
 * @param {{entries?: Array, embeddings?: Record<string, {v1?:number[], v2?:number[]}|number[]|null>, confirm?: boolean}} [ctx]
 *   `confirm` must be `true` to overwrite a block the user has already
 *   edited (`editedByUser:true`) — otherwise this throws without writing.
 * @returns {Promise<object>} the updated reflection
 */
export async function regenerateSection(db, uid, briefId, blockId, ctx = {}) {
  const { entries = [], embeddings = {}, confirm = false } = ctx;
  const reflection = await loadReflection(db, uid, briefId);
  const blocks = reflection.blocks || [];
  const target = blocks.find((b) => b.id === blockId);
  if (!target) {
    throw new Error(`regenerateSection: block ${blockId} not found on brief ${briefId}.`);
  }
  if (target.type !== 'ai' || !target.question) {
    throw new Error('regenerateSection: only AI-generated sections can be regenerated.');
  }
  if (target.editedByUser && !confirm) {
    throw new Error('regenerateSection: this section has been edited — pass {confirm:true} to overwrite it.');
  }

  const start = toDate(reflection.period?.start);
  const end = toDate(reflection.period?.end);
  const { blocks: freshBlocks, filteredEntries } = await runQuestions(db, uid, {
    questions: [target.question],
    scope: reflection.scope ?? null,
    entries,
    embeddings,
    start,
    end,
  });
  const freshBlock = freshBlocks[0];

  let text = freshBlock.text;
  if (target.sectionKey === 'patterns') {
    const missingness = computeMissingness(filteredEntries, {
      start: reflection.period?.start,
      end: reflection.period?.end,
    });
    text = withMissingness(text, missingness);
  }

  const regenerated = {
    ...freshBlock,
    id: target.id,
    section: target.section,
    sectionKey: target.sectionKey,
    text,
    editedByUser: false,
  };

  const updatedBlocks = blocks.map((b) => (b.id === blockId ? regenerated : b));
  const { updatedAt } = await writeBlocks(db, uid, briefId, updatedBlocks);
  return { ...reflection, blocks: updatedBlocks, updatedAt };
}

function formatDateLabel(iso) {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Compose a client-side Session Prep PDF via jsPDF (`src/utils/pdf`'s
 * `loadJsPDF` — no new dependency).
 *
 * SAFETY-CRITICAL (mental-health app export): this function must NEVER
 * write into the PDF —
 *   - the literal `safety_flagged`/`has_warning_indicators` field names or
 *     any "flagged"/"warning" label,
 *   - any content (date, excerpt, text) belonging to an entry that IS
 *     `safety_flagged` or `has_warning_indicators`,
 *   - any content for a source entry id that isn't present in
 *     `entriesById` at all (a missing lookup is treated exactly like an
 *     unsafe one — silently dropped, never a crash). Excluded-source
 *     entries never reach a block's `sources` in the first place:
 *     `runQuestions` filters them out of the retrieval pool at
 *     generation/regeneration time, so this composer never sees them.
 *     The `safety_flagged`/`has_warning_indicators` re-check below is
 *     defense-in-depth on top of that, not the primary gate. Or —
 *   - anything from a block that isn't in `brief.blocks` (removing a block
 *     before export removes its citations along with it — there is no
 *     separate "all sources ever cited" list this function could fall
 *     back to).
 *
 * Only per-claim SOURCE DATES are cited (as footnotes under each block),
 * never entry excerpts/text — the export is a summary artifact, not a raw
 * dump of journal content. "AI-generated" / "Your note" labels are
 * preserved verbatim per block, plus a metadata footer line.
 *
 * @param {{title?:string, period?:{start?:string,end?:string}, blocks:Array}} brief
 * @param {Record<string, object>} [entriesById] - only entries safe to cite
 *   should be present; this function also independently re-checks
 *   `safety_flagged`/`has_warning_indicators` on whatever IS present, as
 *   defense-in-depth.
 * @returns {Promise<object>} the composed jsPDF document instance (caller
 *   calls `.save(filename)` after the user's explicit export confirmation —
 *   this function itself never triggers a download).
 */
export async function composeSessionPrepPdf(brief, entriesById = {}) {
  const JsPDF = await loadJsPDF();
  const doc = new JsPDF();

  const margin = 20;
  const pageHeight = 280;
  const contentWidth = 170;
  let y = 20;

  const ensureSpace = (extra = 6) => {
    if (y + extra > pageHeight) {
      doc.addPage();
      y = 20;
    }
  };

  const writeWrapped = (text, { fontSize = 10, bold = false, italic = false, lineHeight = 5 } = {}) => {
    doc.setFontSize(fontSize);
    doc.setFont(undefined, bold ? 'bold' : italic ? 'italic' : 'normal');
    const lines = doc.splitTextToSize ? doc.splitTextToSize(text ?? '', contentWidth) : [text ?? ''];
    (Array.isArray(lines) ? lines : [lines]).forEach((line) => {
      ensureSpace(lineHeight);
      doc.text(line, margin, y);
      y += lineHeight;
    });
  };

  writeWrapped(brief?.title || 'Session Prep', { fontSize: 18, bold: true, lineHeight: 8 });
  const rangeLabel = [formatDateLabel(brief?.period?.start), formatDateLabel(brief?.period?.end)]
    .filter(Boolean)
    .join(' – ');
  if (rangeLabel) {
    writeWrapped(rangeLabel, { fontSize: 9, italic: true, lineHeight: 6 });
  }
  y += 2;

  (brief?.blocks || []).forEach((block) => {
    ensureSpace(14);
    writeWrapped(block.section || (block.type === 'ai' ? 'Section' : 'Your note'), { fontSize: 13, bold: true, lineHeight: 6 });
    writeWrapped(block.type === 'ai' ? 'AI-generated' : 'Your note', { fontSize: 8, italic: true, lineHeight: 5 });
    writeWrapped(block.text || '', { fontSize: 10.5, lineHeight: 5 });

    // Per-claim citations: source DATES only, and only for sources that
    // exist and are not safety-flagged in any way — see doc comment.
    const safeDates = (block.sources || [])
      .map((id) => entriesById?.[id])
      .filter((entry) => entry && !entry.safety_flagged && !entry.has_warning_indicators)
      .map((entry) =>
        formatDateLabel(
          toISOTimestamp(
            entry.createdAt ?? entry.date ?? entry.timestamp ?? entry.entryDate ?? entry.effectiveDate ?? null,
          ),
        ),
      )
      .filter(Boolean);
    if (safeDates.length > 0) {
      writeWrapped(`Sources: ${safeDates.join(', ')}`, { fontSize: 8, italic: true, lineHeight: 6 });
    }
    y += 4;
  });

  ensureSpace(10);
  writeWrapped(
    `Exported from Engram on ${formatDateLabel(new Date().toISOString())} — a personal reflection, not a clinical record.`,
    { fontSize: 8, italic: true, lineHeight: 5 },
  );

  return doc;
}

export default {
  DEFAULT_SINCE_DAYS_BACK,
  SESSION_PREP_QUESTIONS,
  buildSessionBrief,
  regenerateSection,
  composeSessionPrepPdf,
};

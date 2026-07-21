import { describe, it, expect, vi } from 'vitest';
import { buildCoreEntry } from '../buildCoreEntry';

const baseArgs = (overrides = {}) => ({
  text: 'A durable thought',
  category: 'reflection',
  user: { uid: 'user-1' },
  consentSnapshot: { aiProcessingConsent: true },
  captureContext: {
    capturedAt: '2026-07-20T10:00:00.000Z',
    captureTimezone: 'America/Los_Angeles',
    coarseLocation: { latitude: 37.76, longitude: -122.43 },
  },
  safety: { safetyFlagged: false, hasWarning: false },
  platform: 'web',
  ...overrides,
});

describe('buildCoreEntry', () => {
  it('stamps capture-time provenance (capturedAt + IANA timezone + entryInputVersion)', () => {
    const entry = buildCoreEntry(baseArgs());
    expect(entry.capturedAt).toBe('2026-07-20T10:00:00.000Z');
    expect(entry.captureTimezone).toBe('America/Los_Angeles');
    expect(entry.entryInputVersion).toBe(1);
  });

  it('falls back to the runtime IANA timezone when none supplied', () => {
    const expected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const entry = buildCoreEntry(baseArgs({ captureContext: { capturedAt: '2026-07-20T10:00:00.000Z' } }));
    expect(typeof entry.captureTimezone).toBe('string');
    expect(entry.captureTimezone).toBe(expected);
    expect(entry.captureTimezone.length).toBeGreaterThan(0);
  });

  it('carries a pending enrichment envelope with a requestedAt timestamp', () => {
    const entry = buildCoreEntry(baseArgs());
    expect(entry.enrichment.status).toBe('pending');
    expect(typeof entry.enrichment.requestedAt).toBe('string');
    expect(Number.isNaN(Date.parse(entry.enrichment.requestedAt))).toBe(false);
  });

  it('never places any optional enrichment field on the core object', () => {
    const entry = buildCoreEntry(baseArgs());
    for (const field of [
      'healthContext',
      'location',
      'environmentContext',
      'localAnalysis',
      'temporalContext',
      'futureMentions',
      'coarseLocation',
    ]) {
      expect(entry).not.toHaveProperty(field);
    }
  });

  it("honors a 'disabled' consent snapshot (analysisStatus disabled, consent false)", () => {
    const entry = buildCoreEntry(baseArgs({ consentSnapshot: { aiProcessingConsent: false } }));
    expect(entry.aiProcessingConsent).toBe(false);
    expect(entry.analysisStatus).toBe('disabled');
  });

  it("defaults to 'pending' analysis when consent is granted", () => {
    const entry = buildCoreEntry(baseArgs());
    expect(entry.aiProcessingConsent).toBe(true);
    expect(entry.analysisStatus).toBe('pending');
  });

  it('accepts a bare boolean consent snapshot', () => {
    expect(buildCoreEntry(baseArgs({ consentSnapshot: false })).analysisStatus).toBe('disabled');
    expect(buildCoreEntry(baseArgs({ consentSnapshot: true })).analysisStatus).toBe('pending');
  });

  it('applies voiceMoodScore only when voice confidence >= 0.6', () => {
    const high = buildCoreEntry(baseArgs({ voiceTone: { moodScore: 0.8, confidence: 0.6 } }));
    expect(high.voiceMoodScore).toBe(0.8);
    expect(high.voiceTone.moodScore).toBe(0.8);

    const low = buildCoreEntry(baseArgs({ voiceTone: { moodScore: 0.8, confidence: 0.59 } }));
    expect(low).not.toHaveProperty('voiceMoodScore');
    expect(low.voiceTone.moodScore).toBe(0.8); // voiceTone object still stored
  });

  it('leaves absent optionals absent (no null-stuffing)', () => {
    const entry = buildCoreEntry(baseArgs({ category: undefined, voiceTone: null, transcription: null }));
    expect(entry).not.toHaveProperty('category');
    expect(entry).not.toHaveProperty('voiceTone');
    expect(entry).not.toHaveProperty('voiceMoodScore');
    expect(entry).not.toHaveProperty('transcription');
    expect(entry).not.toHaveProperty('safety_flagged');
    expect(entry).not.toHaveProperty('has_warning_indicators');
    expect(entry).not.toHaveProperty('operationId');
    expect(entry).not.toHaveProperty('spaceId');
  });

  it('builds the versioned transcription shape when a raw transcript is supplied', () => {
    const entry = buildCoreEntry(baseArgs({ transcription: { rawTranscript: 'raw words' } }));
    expect(entry.transcription).toEqual({
      rawTranscript: 'raw words',
      cleanedTranscript: 'A durable thought',
      schemaVersion: 1,
      correctedByUser: false,
    });
  });

  it('flags needsHealthContext for web and clears it for native', () => {
    expect(buildCoreEntry(baseArgs({ platform: 'web' })).needsHealthContext).toBe(true);
    expect(buildCoreEntry(baseArgs({ platform: 'ios' })).needsHealthContext).toBe(false);
    expect(buildCoreEntry(baseArgs({ platform: 'android' })).needsHealthContext).toBe(false);
  });

  it('records safety fields (text-derived) when flagged', () => {
    const entry = buildCoreEntry(baseArgs({
      safety: { safetyFlagged: true, safetyUserResponse: 'support', hasWarning: true },
    }));
    expect(entry.safety_flagged).toBe(true);
    expect(entry.safety_user_response).toBe('support');
    expect(entry.has_warning_indicators).toBe(true);
  });

  it('includes operationId only when provided', () => {
    expect(buildCoreEntry(baseArgs({ operationId: 'op-123' })).operationId).toBe('op-123');
    expect(buildCoreEntry(baseArgs())).not.toHaveProperty('operationId');
  });

  it('includes spaceId only when a non-null space is passed', () => {
    expect(buildCoreEntry(baseArgs({ spaceId: 'space-9' })).spaceId).toBe('space-9');
    expect(buildCoreEntry(baseArgs())).not.toHaveProperty('spaceId');
    expect(buildCoreEntry(baseArgs({ spaceId: null }))).not.toHaveProperty('spaceId');
    expect(buildCoreEntry(baseArgs({ spaceId: undefined }))).not.toHaveProperty('spaceId');
  });

  it('sets the invariant core fields (userId, versions, platform, Firestore timestamps)', () => {
    const entry = buildCoreEntry(baseArgs({ platform: 'ios' }));
    expect(entry.userId).toBe('user-1');
    expect(entry.signalExtractionVersion).toBe(1);
    expect(entry.createdOnPlatform).toBe('ios');
    expect(typeof entry.createdAt.toDate).toBe('function'); // Firestore Timestamp
    expect(typeof entry.effectiveDate.toDate).toBe('function');
  });
});

describe('buildCoreEntry — Voice Chapters (Task 14)', () => {
  const chapterArgs = (overrides = {}) => baseArgs({
    text: 'Chapter one stuff. Chapter two stuff.',
    transcription: { rawTranscript: 'Chapter one stuff, um, chapter two stuff.' },
    chapters: [
      { startMs: 0, title: 'Chapter One', text: 'Chapter one stuff.' },
      { startMs: 12000, title: 'Chapter Two', text: 'Chapter two stuff.' },
    ],
    audioDurationMs: 20000,
    ...overrides,
  });

  it('computes charStart/charEnd offsets and attaches transcription.chapters', () => {
    const entry = buildCoreEntry(chapterArgs());
    expect(entry.transcription.chapters).toEqual([
      { id: 'ch_0', index: 0, startMs: 0, title: 'Chapter One', charStart: 0, charEnd: 18 },
      { id: 'ch_1', index: 1, startMs: 12000, title: 'Chapter Two', charStart: 19, charEnd: 37 },
    ]);
  });

  it('sets top-level audioDurationMs when provided', () => {
    const entry = buildCoreEntry(chapterArgs());
    expect(entry.audioDurationMs).toBe(20000);
  });

  it('omits transcription.chapters and audioDurationMs entirely when absent (no null-stuffing)', () => {
    const entry = buildCoreEntry(baseArgs({ transcription: { rawTranscript: 'raw words' } }));
    expect(entry.transcription).not.toHaveProperty('chapters');
    expect(entry).not.toHaveProperty('audioDurationMs');
  });

  it('never touches transcription.rawTranscript/cleanedTranscript when chapters are supplied', () => {
    const entry = buildCoreEntry(chapterArgs());
    expect(entry.transcription.rawTranscript).toBe('Chapter one stuff, um, chapter two stuff.');
    expect(entry.transcription.cleanedTranscript).toBe('Chapter one stuff. Chapter two stuff.');
  });

  it('resumes from the previous chapter end even when neither chapter text repeats elsewhere', () => {
    const entry = buildCoreEntry(chapterArgs({
      text: 'I said hello. Then I said hello again.',
      transcription: { rawTranscript: 'I said hello. Then I said hello again.' },
      chapters: [
        { startMs: 0, title: 'First Hello', text: 'I said hello.' },
        { startMs: 5000, title: 'Second Hello', text: 'Then I said hello again.' },
      ],
    }));
    // "I said hello." would match at index 0 if searched from 0 again — but the
    // walk must resume AFTER the first chapter's end, landing chapter two at
    // its real (later) position, not re-finding an earlier duplicate.
    expect(entry.transcription.chapters[0]).toMatchObject({ charStart: 0, charEnd: 13 });
    expect(entry.transcription.chapters[1]).toMatchObject({ charStart: 14, charEnd: 38 });
    expect(entry.text.slice(14, 38)).toBe('Then I said hello again.');
  });

  // Task 14 review — Important 2a: the test above never actually exercises
  // cursor-resumption, because neither chapter's TEXT repeats anywhere else
  // in the transcript — a non-resuming `indexOf(text, 0)` would land in
  // exactly the same place. This fixture has chapter text that genuinely
  // repeats verbatim ("I said hello." appears twice), so a naive
  // always-search-from-0 walk would compute the SAME charStart (0) for both
  // chapter one and chapter two. Assert the offsets are strictly increasing.
  it('genuinely repeated chapter text still lands each occurrence at its real, later position', () => {
    const entry = buildCoreEntry(chapterArgs({
      text: 'I said hello. I said hello. Then more.',
      transcription: { rawTranscript: 'I said hello. I said hello. Then more.' },
      chapters: [
        { startMs: 0, title: 'First', text: 'I said hello.' },
        { startMs: 4000, title: 'Second', text: 'I said hello.' },
        { startMs: 8000, title: 'Third', text: 'Then more.' },
      ],
    }));
    const [ch0, ch1, ch2] = entry.transcription.chapters;
    expect(ch0.charStart).toBe(0);
    expect(ch0.charEnd).toBe(13);
    // A non-cursor-resuming indexOf would ALSO compute charStart 0 here.
    expect(ch1.charStart).toBe(14);
    expect(ch1.charEnd).toBe(27);
    expect(ch2.charStart).toBe(28);
    expect(ch2.charEnd).toBe(38);
    // Strictly increasing — no chapter's offsets ever move backward or repeat.
    expect(ch0.charStart).toBeLessThan(ch1.charStart);
    expect(ch1.charStart).toBeLessThan(ch2.charStart);
  });

  // Task 14 review — Important 2b: the server's join validation normalizes
  // whitespace before comparing, so a chapter response that PASSED
  // validation can still carry internal whitespace that doesn't byte-match
  // the client's stored cleaned transcript. The walk must fall back to a
  // whitespace-tolerant search rather than failing the whole chapter set.
  it('falls back to a whitespace-tolerant search when raw indexOf fails due to internal whitespace drift', () => {
    const entry = buildCoreEntry(chapterArgs({
      text: 'I really enjoy long walks on the beach. Then I go home.',
      transcription: { rawTranscript: 'I really enjoy long walks on the beach, um, then I go home.' },
      chapters: [
        { startMs: 0, title: 'Walks', text: 'I  really enjoy   long walks on the beach.' }, // extra internal spaces
        { startMs: 5000, title: 'Home', text: 'Then I go home.' },
      ],
    }));
    expect(entry.transcription.chapters).not.toBeUndefined();
    expect(entry.transcription.chapters[0]).toMatchObject({ charStart: 0, charEnd: 39 });
    expect(entry.transcription.chapters[1]).toMatchObject({ charStart: 40, charEnd: 55 });
    expect(entry.text.slice(40, 55)).toBe('Then I go home.');
  });

  it('still omits chapters when the tolerant search ALSO fails (genuinely unmatchable text) — save proceeds', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const entry = buildCoreEntry(chapterArgs({
      text: 'I really enjoy long walks on the beach. Then I go home.',
      transcription: { rawTranscript: 'I really enjoy long walks on the beach, um, then I go home.' },
      chapters: [
        { startMs: 0, title: 'Walks', text: 'This sentence appears nowhere near the transcript.' },
        { startMs: 5000, title: 'Home', text: 'Then I go home.' },
      ],
    }));
    expect(entry.transcription).not.toHaveProperty('chapters');
    // Save still succeeds — the rest of the entry is fully intact.
    expect(entry.text).toBe('I really enjoy long walks on the beach. Then I go home.');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it('saves WITHOUT chapters when the offset walk fails (text mismatch), and logs once', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const entry = buildCoreEntry(chapterArgs({
      chapters: [
        { startMs: 0, title: 'Chapter One', text: 'This text does not appear in the transcript at all.' },
        { startMs: 12000, title: 'Chapter Two', text: 'Chapter two stuff.' },
      ],
    }));
    expect(entry.transcription).not.toHaveProperty('chapters');
    // Save still succeeds — the rest of the entry is fully intact.
    expect(entry.text).toBe('Chapter one stuff. Chapter two stuff.');
    expect(entry.transcription.rawTranscript).toBe('Chapter one stuff, um, chapter two stuff.');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it('does not attempt chapters when there is no transcription (typed entry)', () => {
    const entry = buildCoreEntry(baseArgs({
      transcription: null,
      chapters: [{ startMs: 0, title: 'X', text: 'A durable thought' }],
      audioDurationMs: 1000,
    }));
    expect(entry).not.toHaveProperty('transcription');
    // audioDurationMs is independent capture metadata — still recorded even
    // if chapters can't be (no rawTranscript to anchor offsets to).
    expect(entry.audioDurationMs).toBe(1000);
  });

  it('ignores a non-positive/invalid audioDurationMs', () => {
    expect(buildCoreEntry(baseArgs({ audioDurationMs: 0 }))).not.toHaveProperty('audioDurationMs');
    expect(buildCoreEntry(baseArgs({ audioDurationMs: -5 }))).not.toHaveProperty('audioDurationMs');
    expect(buildCoreEntry(baseArgs({ audioDurationMs: NaN }))).not.toHaveProperty('audioDurationMs');
    expect(buildCoreEntry(baseArgs({ audioDurationMs: null }))).not.toHaveProperty('audioDurationMs');
  });
});

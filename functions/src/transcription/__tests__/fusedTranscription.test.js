import { describe, it, expect } from 'vitest';
import {
  TRANSCRIPTION_PROMPT,
  buildGeminiRequestBody,
  parseFusedResponse,
  computeChapterBoundaries
} from '../fusedTranscription.js';

const wrap = (text) => ({ candidates: [{ content: { parts: [{ text }] } }] });

describe('buildGeminiRequestBody', () => {
  it('inlines audio and the prompt, requests JSON output', () => {
    const body = buildGeminiRequestBody('QUJD', 'audio/webm');
    expect(body.contents[0].parts[0].inline_data).toEqual({ mime_type: 'audio/webm', data: 'QUJD' });
    expect(body.contents[0].parts[1].text).toBe(TRANSCRIPTION_PROMPT);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
  });
});

describe('parseFusedResponse', () => {
  it('parses a clean JSON response', () => {
    const result = parseFusedResponse(wrap(JSON.stringify({
      rawTranscript: 'I had, um, a solid idea about the widget today.',
      transcript: 'I had a solid idea about the widget today.',
      toneAnalysis: { moodScore: 0.8, energy: 'high', emotions: ['excited'], confidence: 0.9, summary: 'Upbeat and energized.' }
    })));
    expect(result.transcript).toBe('I had a solid idea about the widget today.');
    expect(result.rawTranscript).toContain('um');
    expect(result.toneAnalysis.energy).toBe('high');
  });

  it('extracts JSON wrapped in markdown fences or prose', () => {
    const result = parseFusedResponse(wrap('```json\n{"transcript":"hello","toneAnalysis":null}\n```'));
    expect(result.transcript).toBe('hello');
    expect(result.toneAnalysis).toBeNull();
  });

  it('clamps tone values and defaults invalid energy to medium', () => {
    const result = parseFusedResponse(wrap(JSON.stringify({
      transcript: 'x',
      toneAnalysis: { moodScore: 7, energy: 'frantic', emotions: ['a','b','c','d','e','f','g'], confidence: -2, summary: '' }
    })));
    expect(result.toneAnalysis.moodScore).toBe(1);
    expect(result.toneAnalysis.confidence).toBe(0);
    expect(result.toneAnalysis.energy).toBe('medium');
    expect(result.toneAnalysis.emotions).toHaveLength(5);
    expect(result.toneAnalysis.summary).toBe('Unable to determine emotional state');
  });

  it('returns empty transcript + null tone for the no-speech contract', () => {
    const result = parseFusedResponse(wrap('{"transcript":"","toneAnalysis":null}'));
    expect(result).toEqual({ rawTranscript: '', transcript: '', toneAnalysis: null });
  });

  it('returns null for garbage / missing candidates (fallback signal)', () => {
    expect(parseFusedResponse(wrap('sorry, I cannot'))).toBeNull();
    expect(parseFusedResponse({})).toBeNull();
    expect(parseFusedResponse(wrap('{"nope": true}'))).toBeNull();
  });

  it('does NOT contain the destructive filler regex behavior (like/so/actually preserved)', () => {
    const result = parseFusedResponse(wrap(JSON.stringify({
      transcript: 'I actually like this, so well done.', toneAnalysis: null
    })));
    expect(result.transcript).toBe('I actually like this, so well done.');
  });

  it('cleans punctuation artifacts without changing the retained raw transcript', () => {
    const result = parseFusedResponse(wrap(JSON.stringify({
      rawTranscript: 'I slept pretty, um, good.',
      transcript: 'I slept pretty, , good .',
      toneAnalysis: null
    })));
    expect(result.rawTranscript).toBe('I slept pretty, um, good.');
    expect(result.transcript).toBe('I slept pretty, good.');
  });

  it('injects a bounded proper-noun dictionary into the prompt', () => {
    const body = buildGeminiRequestBody('QUJD', 'audio/webm', ["Barry's", 'Sterling']);
    expect(body.contents[0].parts[1].text).toContain("Barry's, Sterling");
  });
});

describe('buildGeminiRequestBody — chapter markers (Task 14)', () => {
  it('is byte-identical to the no-marker prompt when markers are absent', () => {
    const withoutArg = buildGeminiRequestBody('QUJD', 'audio/webm');
    const withEmptyArray = buildGeminiRequestBody('QUJD', 'audio/webm', [], []);
    expect(withoutArg.contents[0].parts[1].text).toBe(TRANSCRIPTION_PROMPT);
    expect(withEmptyArray.contents[0].parts[1].text).toBe(TRANSCRIPTION_PROMPT);
  });

  it('appends marker timestamps (mm:ss + ms) and instructs a chapters field when markers are present', () => {
    const body = buildGeminiRequestBody('QUJD', 'audio/webm', [], [{ tMs: 83000 }, { tMs: 225000 }], 362000);
    const text = body.contents[0].parts[1].text;
    expect(text.startsWith(TRANSCRIPTION_PROMPT)).toBe(true);
    expect(text).toContain('1:23');
    expect(text).toContain('83000');
    expect(text).toContain('3:45');
    expect(text).toContain('225000');
    expect(text).toContain('362000'); // durationMs
    expect(text).toContain('chapters');
    expect(text).toContain('3'); // markers.length + 1 chapter count appears somewhere
  });

  it('combines proper nouns AND markers additively', () => {
    const body = buildGeminiRequestBody('QUJD', 'audio/webm', ['Sterling'], [{ tMs: 5000 }], null);
    const text = body.contents[0].parts[1].text;
    expect(text).toContain('Sterling');
    expect(text).toContain('0:05');
  });

  it('omits the duration line when durationMs is absent', () => {
    const withDuration = buildGeminiRequestBody('QUJD', 'audio/webm', [], [{ tMs: 1000 }], 5000);
    const withoutDuration = buildGeminiRequestBody('QUJD', 'audio/webm', [], [{ tMs: 1000 }], null);
    expect(withDuration.contents[0].parts[1].text).toContain('5000');
    expect(withoutDuration.contents[0].parts[1].text).not.toContain('duration');
  });
});

describe('parseFusedResponse — chapters (Task 14)', () => {
  const chapterPayload = (chapters) => ({
    rawTranscript: 'Chapter one stuff. Chapter two stuff.',
    transcript: 'Chapter one stuff. Chapter two stuff.',
    toneAnalysis: null,
    chapters,
  });

  it('returns no chapters key when no markers were sent (default) — exact no-marker contract preserved', () => {
    const result = parseFusedResponse(wrap('{"transcript":"","toneAnalysis":null}'));
    expect(result).toEqual({ rawTranscript: '', transcript: '', toneAnalysis: null });
    expect(result).not.toHaveProperty('chapters');
  });

  it('accepts a valid chapters array whose joined text reproduces the transcript', () => {
    const result = parseFusedResponse(
      wrap(JSON.stringify(chapterPayload([
        { startMs: 0, title: 'Chapter One', text: 'Chapter one stuff.' },
        { startMs: 12000, title: 'Chapter Two', text: 'Chapter two stuff.' },
      ]))),
      { markers: [{ tMs: 12000 }] }
    );
    expect(result.chapters).toEqual([
      { startMs: 0, title: 'Chapter One', text: 'Chapter one stuff.' },
      { startMs: 12000, title: 'Chapter Two', text: 'Chapter two stuff.' },
    ]);
  });

  it('tolerates whitespace-only differences between the joined chapters and the transcript', () => {
    const result = parseFusedResponse(
      wrap(JSON.stringify(chapterPayload([
        { startMs: 0, title: 'Chapter One', text: '  Chapter one stuff.  ' },
        { startMs: 12000, title: 'Chapter Two', text: 'Chapter  two stuff.' },
      ]))),
      { markers: [{ tMs: 12000 }] }
    );
    expect(result.chapters).not.toBeNull();
    expect(result.chapters).toHaveLength(2);
  });

  it('rejects a chapter count that does not equal the canonical boundary count -> null', () => {
    const result = parseFusedResponse(
      wrap(JSON.stringify(chapterPayload([
        { startMs: 0, title: 'Only One', text: 'Chapter one stuff. Chapter two stuff.' },
      ]))),
      { markers: [{ tMs: 12000 }] } // boundaries [0, 12000] -> expects 2 chapters, got 1
    );
    expect(result.chapters).toBeNull();
    // transcription itself must still succeed even though chapters failed
    expect(result.transcript).toBe('Chapter one stuff. Chapter two stuff.');
  });

  it('rejects a mismatched join (chapters text does not reconstruct the transcript) -> null', () => {
    const result = parseFusedResponse(
      wrap(JSON.stringify(chapterPayload([
        { startMs: 0, title: 'Chapter One', text: 'Totally different opening.' },
        { startMs: 12000, title: 'Chapter Two', text: 'Chapter two stuff.' },
      ]))),
      { markers: [{ tMs: 12000 }] }
    );
    expect(result.chapters).toBeNull();
    expect(result.transcript).toBe('Chapter one stuff. Chapter two stuff.');
  });

  it('rejects malformed chapter entries (missing title/text/startMs) -> null', () => {
    const result = parseFusedResponse(
      wrap(JSON.stringify(chapterPayload([
        { startMs: 0, title: 'Chapter One' /* missing text */ },
        { startMs: 12000, title: 'Chapter Two', text: 'Chapter two stuff.' },
      ]))),
      { markers: [{ tMs: 12000 }] }
    );
    expect(result.chapters).toBeNull();
  });

  it('rejects a non-array/absent chapters field when markers were requested -> null', () => {
    const result = parseFusedResponse(wrap(JSON.stringify(chapterPayload(undefined))), { markers: [{ tMs: 12000 }] });
    expect(result.chapters).toBeNull();
  });

  // Task 14 review — Important 1: markers are ground truth for startMs, not
  // Gemini's echo. A validated (count+join OK) response whose per-chapter
  // startMs has drifted from the real marker timestamps must have those
  // values OVERWRITTEN with the canonical boundary list before being stored.
  it('overwrites drifted Gemini-echoed startMs values with the canonical boundary list', () => {
    const result = parseFusedResponse(
      wrap(JSON.stringify(chapterPayload([
        { startMs: 137, title: 'Chapter One', text: 'Chapter one stuff.' }, // drifted from 0
        { startMs: 11842, title: 'Chapter Two', text: 'Chapter two stuff.' }, // drifted from 12000
      ]))),
      { markers: [{ tMs: 12000 }] }
    );
    expect(result.chapters).toEqual([
      { startMs: 0, title: 'Chapter One', text: 'Chapter one stuff.' },
      { startMs: 12000, title: 'Chapter Two', text: 'Chapter two stuff.' },
    ]);
  });
});

// Task 14 review — Important 3 (+ MINOR): computeChapterBoundaries is the
// single shared source of truth for chapter boundary counts/values across
// the prompt builder, the response validator, and the startMs overwrite.
describe('computeChapterBoundaries (Task 14 review)', () => {
  it('prepends an implicit 0 boundary and sorts/dedupes marker timestamps', () => {
    expect(computeChapterBoundaries([{ tMs: 5000 }, { tMs: 12000 }])).toEqual([0, 5000, 12000]);
    expect(computeChapterBoundaries([{ tMs: 12000 }, { tMs: 5000 }, { tMs: 5000 }])).toEqual([0, 5000, 12000]);
  });

  it('does NOT duplicate the boundary when the user tapped a marker at exactly 0ms', () => {
    // Before the fix this produced [0, 0] (chapterCount markers.length+1 = 2);
    // the canonical boundary list must collapse to a single 0.
    expect(computeChapterBoundaries([{ tMs: 0 }])).toEqual([0]);
    expect(computeChapterBoundaries([{ tMs: 0 }, { tMs: 5000 }])).toEqual([0, 5000]);
  });

  it('MINOR: drops markers beyond durationMs when durationMs is known', () => {
    expect(computeChapterBoundaries([{ tMs: 5000 }, { tMs: 99999 }], 9000)).toEqual([0, 5000]);
    // Exactly at the boundary is kept (<=, not <).
    expect(computeChapterBoundaries([{ tMs: 9000 }], 9000)).toEqual([0, 9000]);
  });

  it('does not clamp when durationMs is absent/invalid', () => {
    expect(computeChapterBoundaries([{ tMs: 99999 }], null)).toEqual([0, 99999]);
    expect(computeChapterBoundaries([{ tMs: 99999 }], 0)).toEqual([0, 99999]);
    expect(computeChapterBoundaries([{ tMs: 99999 }], -1)).toEqual([0, 99999]);
  });

  it('returns just [0] for no/invalid markers', () => {
    expect(computeChapterBoundaries([])).toEqual([0]);
    expect(computeChapterBoundaries(undefined)).toEqual([0]);
  });
});

describe('buildGeminiRequestBody — 0ms marker boundary count (Task 14 review, Important 3)', () => {
  it('a single marker tapped at 0ms produces a 1-chapter instruction, not 2', () => {
    const body = buildGeminiRequestBody('QUJD', 'audio/webm', [], [{ tMs: 0 }], null);
    const text = body.contents[0].parts[1].text;
    expect(text).toContain('exactly 1 chapters');
    expect(text).toContain('[0]');
  });

  it('a normal marker set is unaffected — boundary count still markers.length + 1', () => {
    const body = buildGeminiRequestBody('QUJD', 'audio/webm', [], [{ tMs: 5000 }, { tMs: 12000 }], null);
    const text = body.contents[0].parts[1].text;
    expect(text).toContain('exactly 3 chapters');
    expect(text).toContain('[0, 5000, 12000]');
  });
});

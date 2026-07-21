import { describe, it, expect } from 'vitest';
import {
  TRANSCRIPTION_PROMPT,
  buildGeminiRequestBody,
  parseFusedResponse
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

  it('returns no chapters key when markerCount is 0 (default) — exact no-marker contract preserved', () => {
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
      { markerCount: 1 }
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
      { markerCount: 1 }
    );
    expect(result.chapters).not.toBeNull();
    expect(result.chapters).toHaveLength(2);
  });

  it('rejects a chapter count that does not equal markerCount + 1 -> null', () => {
    const result = parseFusedResponse(
      wrap(JSON.stringify(chapterPayload([
        { startMs: 0, title: 'Only One', text: 'Chapter one stuff. Chapter two stuff.' },
      ]))),
      { markerCount: 1 } // expects 2 chapters, got 1
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
      { markerCount: 1 }
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
      { markerCount: 1 }
    );
    expect(result.chapters).toBeNull();
  });

  it('rejects a non-array/absent chapters field when markers were requested -> null', () => {
    const result = parseFusedResponse(wrap(JSON.stringify(chapterPayload(undefined))), { markerCount: 1 });
    expect(result.chapters).toBeNull();
  });
});

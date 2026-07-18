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

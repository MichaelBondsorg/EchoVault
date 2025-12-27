import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config/index.js';

// Initialize Gemini
const genAI = config.geminiApiKey
  ? new GoogleGenerativeAI(config.geminiApiKey)
  : null;

/**
 * Voice tone analysis result
 */
export interface VoiceToneAnalysis {
  moodScore: number; // 0-1 scale (0 = very negative, 1 = very positive)
  energy: 'low' | 'medium' | 'high';
  emotions: string[]; // e.g., ['anxious', 'hopeful', 'tired']
  confidence: number; // 0-1 how confident the analysis is
  summary: string; // Brief description of emotional state
}

/**
 * Convert PCM buffer to base64 for Gemini
 */
const pcmToBase64 = (pcmBuffer: Buffer): string => {
  // Create WAV header for the PCM data
  const sampleRate = 24000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcmBuffer.length;
  const headerSize = 44;
  const fileSize = headerSize + dataSize;

  const wav = Buffer.alloc(fileSize);

  // RIFF header
  wav.write('RIFF', 0);
  wav.writeUInt32LE(fileSize - 8, 4);
  wav.write('WAVE', 8);

  // fmt subchunk
  wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM format
  wav.writeUInt16LE(numChannels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(byteRate, 28);
  wav.writeUInt16LE(blockAlign, 32);
  wav.writeUInt16LE(bitsPerSample, 34);

  // data subchunk
  wav.write('data', 36);
  wav.writeUInt32LE(dataSize, 40);

  // Copy PCM data
  pcmBuffer.copy(wav, 44);

  return wav.toString('base64');
};

/**
 * Analyze voice tone using Gemini
 * Takes the full session audio and returns emotional analysis
 */
export const analyzeVoiceTone = async (
  audioBuffer: Buffer,
  transcript?: string
): Promise<VoiceToneAnalysis | null> => {
  if (!genAI) {
    console.log('Gemini API not configured, skipping voice tone analysis');
    return null;
  }

  // Skip if audio is too short (less than 1 second at 24kHz 16-bit mono)
  if (audioBuffer.length < 48000) {
    console.log('Audio too short for tone analysis');
    return null;
  }

  try {
    const model = genAI.getGenerativeModel({ model: config.geminiModel });

    const audioBase64 = pcmToBase64(audioBuffer);

    const prompt = `Analyze the emotional tone and mood from this voice recording. Focus on:
1. The speaker's emotional state based on voice characteristics (tone, pace, pitch variations, pauses)
2. Energy level (low/medium/high)
3. Specific emotions you can detect

${transcript ? `The transcript of what they said: "${transcript}"` : ''}

Respond in this exact JSON format only, no other text:
{
  "moodScore": <number 0-1, where 0 is very negative/distressed and 1 is very positive/joyful>,
  "energy": "<low|medium|high>",
  "emotions": ["<emotion1>", "<emotion2>"],
  "confidence": <number 0-1 indicating analysis confidence>,
  "summary": "<brief 1-sentence description of their emotional state>"
}`;

    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: 'audio/wav',
          data: audioBase64,
        },
      },
      { text: prompt },
    ]);

    const response = result.response.text();

    // Parse JSON from response (don't log raw response to avoid leaking transcript)
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('Failed to parse Gemini voice analysis response - no JSON found');
      return null;
    }

    const analysis = JSON.parse(jsonMatch[0]) as VoiceToneAnalysis;

    // Validate and clamp values
    return {
      moodScore: Math.max(0, Math.min(1, analysis.moodScore)),
      energy: ['low', 'medium', 'high'].includes(analysis.energy)
        ? analysis.energy
        : 'medium',
      emotions: Array.isArray(analysis.emotions)
        ? analysis.emotions.slice(0, 5)
        : [],
      confidence: Math.max(0, Math.min(1, analysis.confidence)),
      summary: analysis.summary || 'Unable to determine emotional state',
    };
  } catch (error) {
    console.error('Voice tone analysis error:', error);
    return null;
  }
};

/**
 * Generate title and tags from transcript using Gemini
 */
export const generateTitleAndTags = async (
  transcript: string,
  sessionType?: string
): Promise<{ title: string; tags: string[] } | null> => {
  if (!genAI) {
    console.log('Gemini API not configured, skipping title generation');
    return null;
  }

  if (!transcript || transcript.length < 20) {
    return null;
  }

  try {
    const model = genAI.getGenerativeModel({ model: config.geminiModel });

    const prompt = `Based on this journal entry transcript, generate:
1. A concise, meaningful title (3-8 words) that captures the main theme
2. 2-5 relevant tags (single words or short phrases)

${sessionType ? `This was a "${sessionType}" guided session.` : ''}

Transcript:
"${transcript.slice(0, 2000)}"

Respond in this exact JSON format only:
{
  "title": "<title>",
  "tags": ["tag1", "tag2", "tag3"]
}`;

    const result = await model.generateContent(prompt);
    const response = result.response.text();

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return null;
    }

    const data = JSON.parse(jsonMatch[0]);
    return {
      title: data.title || 'Voice Entry',
      tags: Array.isArray(data.tags) ? data.tags.slice(0, 5) : [],
    };
  } catch (error) {
    console.error('Title generation error:', error);
    return null;
  }
};

/**
 * Check if voice tone analysis is available
 */
export const isVoiceToneAnalysisAvailable = (): boolean => {
  return !!genAI;
};

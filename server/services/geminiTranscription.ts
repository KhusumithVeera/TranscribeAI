import fs from 'fs';
import {
  AudioTranscriptionConfigMode,
  GoogleGenAI,
  type GenerateContentResponse,
  type Part,
  type WordInfo,
} from '@google/genai';
import type { TranscriptParagraph, TranscriptWord } from '../../src/lib/transcriptTypes.ts';

export const TRANSCRIBE_MODEL_ID = 'gemini-3.5-transcribe';
const INLINE_AUDIO_LIMIT_BYTES = 12 * 1024 * 1024; // 12 MB inline; larger audio uses Files API

export class TranscriptionError extends Error {
  code: string;
  statusCode: number;

  constructor(code: string, message: string, statusCode = 500) {
    super(message);
    this.name = 'TranscriptionError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface NormalizedTranscription {
  words: TranscriptWord[];
  paragraphs: TranscriptParagraph[];
  languageCode?: string;
  hasWordTimestamps: boolean;
  model: string;
}

function getGenAIClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new TranscriptionError(
      'API_KEY_MISSING',
      'GEMINI_API_KEY is not configured on the server. Please add a valid Gemini API key in Settings > Secrets and retry.',
      503
    );
  }

  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

/**
 * Parse timing offsets from protobuf duration strings ("1.240s", "450ms"),
 * numeric seconds, "MM:SS.mmm", or { seconds, nanos } objects.
 */
function parseOffsetSeconds(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;

    if (trimmed.endsWith('ms')) {
      const n = Number(trimmed.slice(0, -2));
      return Number.isFinite(n) ? n / 1000 : null;
    }
    if (trimmed.endsWith('s')) {
      const n = Number(trimmed.slice(0, -1));
      return Number.isFinite(n) ? n : null;
    }
    if (trimmed.includes(':')) {
      const parts = trimmed.split(':').map(Number);
      if (parts.every((p) => Number.isFinite(p))) {
        if (parts.length === 2) return parts[0] * 60 + parts[1];
        if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
      }
    }
    const direct = Number(trimmed);
    return Number.isFinite(direct) ? direct : null;
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as { seconds?: number | string; nanos?: number | string };
    if (obj.seconds !== undefined || obj.nanos !== undefined) {
      const secs = Number(obj.seconds ?? 0);
      const nanos = Number(obj.nanos ?? 0);
      if (Number.isFinite(secs) && Number.isFinite(nanos)) {
        return secs + nanos / 1e9;
      }
    }
  }
  return null;
}

interface RawWordToken {
  text: string;
  start: number;
  end: number;
  speakerId?: string;
}

function formatSpeakerLabel(raw?: string): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const zeroBased = /^spk[:_-](\d+)$/i.exec(trimmed);
  if (zeroBased) {
    const num = Number(zeroBased[1]);
    return `Speaker ${num + (trimmed.includes(':0') || num === 0 ? 1 : 0)}`;
  }
  return trimmed;
}

function extractRawTokensFromResponse(
  response: GenerateContentResponse,
  sourceDuration: number
): { tokens: RawWordToken[]; languageCode?: string; plainTextPresent: boolean } {
  const tokens: RawWordToken[] = [];
  let languageCode: string | undefined;
  let plainTextPresent = false;

  const candidates = response.candidates ?? [];
  for (const candidate of candidates) {
    const parts = (candidate.content?.parts ?? []) as Array<
      Part & {
        wordInfo?: Array<Record<string, unknown>>;
        word_info?: Array<Record<string, unknown>>;
        audio_transcription?: {
          text?: string;
          language_code?: string;
          speaker_label?: string;
          words?: Array<Record<string, unknown>>;
        };
      }
    >;

    for (const part of parts) {
      if (part.text && part.text.trim().length > 0) {
        plainTextPresent = true;
      }

      const transcription = part.audioTranscription ?? (part.audio_transcription
        ? {
            text: part.audio_transcription.text,
            languageCode: part.audio_transcription.language_code,
            speakerLabel: part.audio_transcription.speaker_label,
            words: part.audio_transcription.words as WordInfo[] | undefined,
          }
        : undefined);

      if (transcription) {
        if (transcription.text && transcription.text.trim().length > 0) {
          plainTextPresent = true;
        }
        if (transcription.languageCode && !languageCode) {
          languageCode = transcription.languageCode;
        }

        const speakerId = formatSpeakerLabel(transcription.speakerLabel);
        const wordList = transcription.words ?? [];
        for (const w of wordList) {
          const rec = w as WordInfo & Record<string, unknown>;
          const wordText = String(rec.word ?? rec.text ?? '').trim();
          const start = parseOffsetSeconds(rec.startOffset ?? rec.start_offset ?? rec.start);
          const end = parseOffsetSeconds(rec.endOffset ?? rec.end_offset ?? rec.end);
          const wordSpeaker = formatSpeakerLabel(
            (typeof rec.speakerLabel === 'string' && rec.speakerLabel) ||
              (typeof rec.speaker_label === 'string' && rec.speaker_label) ||
              (typeof rec.speakerTag === 'string' && rec.speakerTag) ||
              (typeof rec.speakerTag === 'number' ? `Speaker ${rec.speakerTag}` : undefined) ||
              speakerId
          );

          if (wordText && start !== null && end !== null) {
            const clampedStart = Math.max(0, Math.min(sourceDuration, start));
            const clampedEnd = Math.max(clampedStart, Math.min(sourceDuration, end));
            tokens.push({
              text: wordText,
              start: Number(clampedStart.toFixed(4)),
              end: Number(clampedEnd.toFixed(4)),
              speakerId: wordSpeaker,
            });
          }
        }
      }

      // Secondary check for direct wordInfo / word_info arrays on the part
      const altWords = part.wordInfo ?? part.word_info;
      if (Array.isArray(altWords) && altWords.length > 0) {
        for (const rec of altWords) {
          const wordText = String(rec.word ?? rec.text ?? '').trim();
          const start = parseOffsetSeconds(rec.startOffset ?? rec.start_offset ?? rec.start);
          const end = parseOffsetSeconds(rec.endOffset ?? rec.end_offset ?? rec.end);
          const wordSpeaker =
            (typeof rec.speakerLabel === 'string' && rec.speakerLabel) ||
            (typeof rec.speaker_tag === 'string' && rec.speaker_tag) ||
            (typeof rec.speaker_tag === 'number' ? `Speaker ${rec.speaker_tag}` : undefined) ||
            undefined;

          if (wordText && start !== null && end !== null) {
            const clampedStart = Math.max(0, Math.min(sourceDuration, start));
            const clampedEnd = Math.max(clampedStart, Math.min(sourceDuration, end));
            tokens.push({
              text: wordText,
              start: Number(clampedStart.toFixed(4)),
              end: Number(clampedEnd.toFixed(4)),
              speakerId: wordSpeaker,
            });
          }
        }
      }
    }
  }

  return { tokens, languageCode, plainTextPresent };
}

/**
 * Group normalized words into readable document paragraphs using speaker turns,
 * natural speech pauses, and sentence boundaries.
 */
function buildParagraphs(words: TranscriptWord[]): TranscriptParagraph[] {
  if (words.length === 0) return [];

  const paragraphs: TranscriptParagraph[] = [];
  let currentIds: string[] = [];
  let currentSpeaker: string | undefined = words[0].speakerId;
  const sentenceEndRe = /[.!?]["'”’)\]]*$/;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const prev = i > 0 ? words[i - 1] : null;

    const speakerChanged =
      prev !== null &&
      word.speakerId !== undefined &&
      prev.speakerId !== undefined &&
      word.speakerId !== prev.speakerId;

    const longPause = prev !== null && word.start - prev.end >= 1.35;
    const prevEndedSentence = prev !== null && sentenceEndRe.test(prev.text.trim());
    const paragraphFull = currentIds.length >= 38 && prevEndedSentence;

    if (currentIds.length > 0 && (speakerChanged || (longPause && prevEndedSentence) || paragraphFull)) {
      paragraphs.push({
        id: `p_${paragraphs.length + 1}`,
        speakerId: currentSpeaker,
        wordIds: currentIds,
      });
      currentIds = [];
      currentSpeaker = word.speakerId;
    }

    currentIds.push(word.id);
    if (!currentSpeaker && word.speakerId) {
      currentSpeaker = word.speakerId;
    }
  }

  if (currentIds.length > 0) {
    paragraphs.push({
      id: `p_${paragraphs.length + 1}`,
      speakerId: currentSpeaker,
      wordIds: currentIds,
    });
  }

  return paragraphs;
}

function classifyGeminiError(err: unknown): TranscriptionError {
  if (err instanceof TranscriptionError) {
    return err;
  }

  const rawMsg = err instanceof Error ? err.message : String(err);
  const upper = rawMsg.toUpperCase();

  if (upper.includes('API_KEY_INVALID') || upper.includes('API KEY NOT VALID')) {
    return new TranscriptionError(
      'API_KEY_INVALID',
      'The configured Gemini API key is invalid. Please update GEMINI_API_KEY in Settings > Secrets.',
      401
    );
  }
  if (upper.includes('PERMISSION_DENIED') || upper.includes('403')) {
    return new TranscriptionError(
      'PERMISSION_DENIED',
      'Access to gemini-3.5-transcribe was denied for the current API key. Check your key permissions in Settings > Secrets.',
      403
    );
  }
  if (upper.includes('RESOURCE_EXHAUSTED') || upper.includes('429')) {
    return new TranscriptionError(
      'RATE_LIMITED',
      'Gemini transcription quota was exceeded. Wait a moment or check your billing tier in Settings > Secrets.',
      429
    );
  }
  if (upper.includes('NOT_FOUND') || upper.includes('404')) {
    return new TranscriptionError(
      'MODEL_UNAVAILABLE',
      `The transcription model "${TRANSCRIBE_MODEL_ID}" is currently unavailable for this API key or endpoint.`,
      502
    );
  }

  return new TranscriptionError(
    'TRANSCRIPTION_FAILED',
    `Transcription service error: ${rawMsg.slice(0, 220)}`,
    502
  );
}

function isRetryableError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toUpperCase();
  if (
    msg.includes('400') ||
    msg.includes('401') ||
    msg.includes('403') ||
    msg.includes('404') ||
    msg.includes('API_KEY_INVALID') ||
    msg.includes('INVALID_ARGUMENT')
  ) {
    return false;
  }
  return (
    msg.includes('503') ||
    msg.includes('500') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('DEADLINE_EXCEEDED') ||
    msg.includes('FETCH FAILED') ||
    msg.includes('ECONNRESET')
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function transcribeAudioWithGemini(
  wavFilePath: string,
  sourceDuration: number
): Promise<NormalizedTranscription> {
  const ai = getGenAIClient();
  const stat = fs.statSync(wavFilePath);

  let uploadedFileName: string | null = null;
  let audioPart: Part;

  try {
    if (stat.size <= INLINE_AUDIO_LIMIT_BYTES) {
      const audioBuffer = fs.readFileSync(wavFilePath);
      audioPart = {
        inlineData: {
          mimeType: 'audio/wav',
          data: audioBuffer.toString('base64'),
        },
      };
    } else {
      const uploaded = await ai.files.upload({
        file: wavFilePath,
        config: { mimeType: 'audio/wav' },
      });
      uploadedFileName = uploaded.name ?? null;
      if (!uploaded.uri) {
        throw new TranscriptionError(
          'AUDIO_UPLOAD_FAILED',
          'Failed to upload extracted audio to Gemini Files API.',
          502
        );
      }
      audioPart = {
        fileData: {
          fileUri: uploaded.uri,
          mimeType: uploaded.mimeType ?? 'audio/wav',
        },
      };
    }

    const callModel = async (includeDiarization: boolean): Promise<GenerateContentResponse> => {
      return ai.models.generateContent({
        model: TRANSCRIBE_MODEL_ID,
        contents: [{ role: 'user', parts: [audioPart] }],
        config: {
          audioTranscriptionConfig: {
            mode: AudioTranscriptionConfigMode.VERBATIM,
            wordTimestamp: true,
            ...(includeDiarization ? { diarization: true } : {}),
          },
        },
      });
    };

    let response: GenerateContentResponse | null = null;
    let lastError: unknown = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await callModel(true);
        break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // If diarization flag is rejected on a specific audio or endpoint, retry without diarization
        if (msg.toLowerCase().includes('diarization')) {
          response = await callModel(false);
          break;
        }
        lastError = err;
        if (!isRetryableError(err) || attempt === 2) {
          throw classifyGeminiError(err);
        }
        await sleep(800 * Math.pow(2, attempt));
      }
    }

    if (!response) {
      throw classifyGeminiError(lastError);
    }

    const { tokens, languageCode, plainTextPresent } = extractRawTokensFromResponse(
      response,
      sourceDuration
    );

    if (tokens.length === 0) {
      if (plainTextPresent) {
        throw new TranscriptionError(
          'MISSING_WORD_TIMESTAMPS',
          'The transcription model returned text without word-level timestamps. TranscribeAI disables text-to-video cutting when exact word timestamps are unavailable.',
          422
        );
      }
      throw new TranscriptionError(
        'EMPTY_TRANSCRIPT',
        'No spoken words were detected in the audio track. Ensure the video contains clear speech.',
        422
      );
    }

    // Sort strictly by original start timestamp to preserve timeline invariants
    tokens.sort((a, b) => a.start - b.start || a.end - b.end);

    const words: TranscriptWord[] = tokens.map((tok, index) => ({
      id: `w_${index + 1}`,
      text: tok.text,
      start: tok.start,
      end: tok.end,
      ...(tok.speakerId ? { speakerId: tok.speakerId } : {}),
      deleted: false,
    }));

    const paragraphs = buildParagraphs(words);

    return {
      words,
      paragraphs,
      languageCode,
      hasWordTimestamps: true,
      model: TRANSCRIBE_MODEL_ID,
    };
  } finally {
    if (uploadedFileName) {
      ai.files.delete({ name: uploadedFileName }).catch(() => {
        // Best-effort cleanup of temporary remote audio file
      });
    }
  }
}

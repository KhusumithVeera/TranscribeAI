import { execFile } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import type {
  SpokenCueSegment,
  TimeRange,
  VoiceEnhancementPreset,
} from '../../src/lib/transcriptTypes.ts';
import { sourceToEditedTime } from '../../src/lib/timeRanges.ts';
import type { StoredProject } from './projectStore.ts';

const execFileAsync = promisify(execFile);

export const TTS_MODEL_ID = 'gemini-3.8-flash-lite-tts';
const MAX_WORDS_PER_TTS_BLOCK = 240;

export class VoiceSynthesisError extends Error {
  code: string;
  statusCode: number;

  constructor(code: string, message: string, statusCode = 500) {
    super(message);
    this.name = 'VoiceSynthesisError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

interface VoicePresetProfile {
  voiceName: 'Kore' | 'Zephyr';
  style: string;
}

const VOICE_PRESETS: Record<VoiceEnhancementPreset, VoicePresetProfile> = {
  calm_mild: {
    voiceName: 'Kore',
    style:
      'A young, calm, gentle female human voice with a mild, natural pitch. Warm, soothing, unhurried conversational narration with soft breath, smooth cadence, and zero harshness.',
  },
  soft_studio: {
    voiceName: 'Zephyr',
    style:
      'A young, serene, softly spoken female human voice with a mild, mellow pitch. Tranquil, comforting, gentle storytelling tone with smooth natural phrasing.',
  },
  warm_clear: {
    voiceName: 'Kore',
    style:
      'A young, composed, warm female human voice with a balanced mild pitch. Clear, poised, soothing documentary narration with relaxed, steady delivery.',
  },
};

function getGenAIClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new VoiceSynthesisError(
      'API_KEY_MISSING',
      'GEMINI_API_KEY is not configured on the server. Add a valid Gemini API key in Settings > Secrets to generate the soothing voice.',
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableTtsError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toUpperCase();
  if (
    msg.includes('400') ||
    msg.includes('401') ||
    msg.includes('403') ||
    msg.includes('404') ||
    msg.includes('API_KEY_INVALID')
  ) {
    return false;
  }
  return (
    msg.includes('500') ||
    msg.includes('503') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('DEADLINE_EXCEEDED') ||
    msg.includes('FETCH FAILED')
  );
}

async function probeAudioDuration(wavPath: string): Promise<number> {
  const { stdout } = await execFileAsync(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      wavPath,
    ],
    { timeout: 15_000 }
  );
  const dur = Number(stdout.trim());
  return Number.isFinite(dur) && dur > 0 ? dur : 0;
}

/**
 * Trim excess leading/trailing silence from a generated WAV clip so timing starts crisply
 * on the opening visual beat.
 */
async function trimEdgeSilence(inputWav: string, outputWav: string): Promise<number> {
  try {
    await execFileAsync(
      'ffmpeg',
      [
        '-y',
        '-i',
        inputWav,
        '-af',
        'silenceremove=start_periods=1:start_duration=0.02:start_threshold=-42dB:detection=peak,areverse,silenceremove=start_periods=1:start_duration=0.02:start_threshold=-42dB:detection=peak,areverse',
        '-ar',
        '24000',
        '-ac',
        '1',
        outputWav,
      ],
      { timeout: 30_000 }
    );
    const trimmedDur = await probeAudioDuration(outputWav);
    if (trimmedDur > 0.1) {
      return trimmedDur;
    }
  } catch {
    // Fall back to untrimmed WAV if silenceremove fails
  }
  fs.copyFileSync(inputWav, outputWav);
  return probeAudioDuration(outputWav);
}

async function synthesizeBlockWav(
  ai: GoogleGenAI,
  ttsCacheDir: string,
  text: string,
  preset: VoiceEnhancementPreset
): Promise<{ wavPath: string; duration: number }> {
  const profile = VOICE_PRESETS[preset] ?? VOICE_PRESETS.calm_mild;
  const cacheKey = crypto
    .createHash('sha256')
    .update(`${TTS_MODEL_ID}:${preset}:${profile.voiceName}:${text.trim()}`)
    .digest('hex')
    .slice(0, 24);

  const trimmedPath = path.join(ttsCacheDir, `${cacheKey}.trimmed.wav`);
  if (fs.existsSync(trimmedPath) && fs.statSync(trimmedPath).size > 44) {
    const duration = await probeAudioDuration(trimmedPath);
    if (duration > 0) {
      return { wavPath: trimmedPath, duration };
    }
  }

  let response: Awaited<ReturnType<typeof ai.models.generateContent>> | null = null;
  let lastErr: unknown = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      response = await ai.models.generateContent({
        model: TTS_MODEL_ID,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: text.trim(),
                speechMetadata: {
                  style: profile.style,
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: profile.voiceName,
              },
            },
          },
        },
      });
      break;
    } catch (err) {
      lastErr = err;
      if (!isRetryableTtsError(err) || attempt === 2) {
        const msg = err instanceof Error ? err.message : String(err);
        const upper = msg.toUpperCase();
        if (upper.includes('API_KEY_INVALID')) {
          throw new VoiceSynthesisError(
            'API_KEY_INVALID',
            'The configured Gemini API key is invalid. Check Settings > Secrets.',
            401
          );
        }
        if (upper.includes('PERMISSION_DENIED') || msg.includes('403')) {
          throw new VoiceSynthesisError(
            'PERMISSION_DENIED',
            'Access to Gemini voice synthesis was denied for the current API key.',
            403
          );
        }
        if (upper.includes('RESOURCE_EXHAUSTED') || msg.includes('429')) {
          throw new VoiceSynthesisError(
            'TTS_RATE_LIMITED',
            'Gemini voice synthesis quota was exceeded. Wait a moment or select a billing-enabled API key in Settings > Secrets.',
            429
          );
        }
        throw new VoiceSynthesisError(
          'TTS_FAILED',
          `Soothing voice synthesis failed: ${msg.slice(0, 180)}`,
          502
        );
      }
      await sleep(900 * Math.pow(2, attempt));
    }
  }

  if (!response) {
    throw new VoiceSynthesisError(
      'TTS_FAILED',
      `Voice synthesis returned no response: ${String(lastErr).slice(0, 140)}`,
      502
    );
  }

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) {
    throw new VoiceSynthesisError(
      'TTS_EMPTY_AUDIO',
      'The voice model did not return audio data for the transcript.',
      502
    );
  }

  const rawPath = path.join(ttsCacheDir, `${cacheKey}.raw.wav`);
  const tmpRawPath = `${rawPath}.${process.pid}.${Date.now()}.tmp`;
  const tmpTrimmedPath = `${trimmedPath}.${process.pid}.${Date.now()}.tmp`;

  try {
    // Unary generateContent returns a complete WAV file (RIFF header, 24kHz mono 16-bit)
    fs.writeFileSync(tmpRawPath, Buffer.from(base64Audio, 'base64'));
    fs.renameSync(tmpRawPath, rawPath);

    const duration = await trimEdgeSilence(rawPath, tmpTrimmedPath);
    fs.renameSync(tmpTrimmedPath, trimmedPath);

    try {
      fs.unlinkSync(rawPath);
    } catch {
      // ignore
    }

    return { wavPath: trimmedPath, duration };
  } catch (err) {
    for (const p of [tmpRawPath, tmpTrimmedPath]) {
      if (fs.existsSync(p)) {
        try {
          fs.unlinkSync(p);
        } catch {
          // ignore
        }
      }
    }
    throw err instanceof VoiceSynthesisError
      ? err
      : new VoiceSynthesisError('TTS_PROCESSING_FAILED', 'Could not prepare synthesized audio.', 500);
  }
}

interface NarrationBlock {
  text: string;
  editedStart: number;
  editedEnd: number;
}

/**
 * Group timed spoken cues into coherent narration blocks (~240 words max per block)
 * so short/medium videos synthesize in ONE seamless TTS call with natural pacing and low API usage,
 * while longer videos split cleanly at major pauses without exceeding model limits.
 */
function groupCuesIntoNarrationBlocks(
  cues: Array<{ text: string; editedStart: number; editedEnd: number }>
): NarrationBlock[] {
  if (cues.length === 0) return [];

  const blocks: NarrationBlock[] = [];
  let texts: string[] = [];
  let wordCount = 0;
  let blockStart = cues[0].editedStart;
  let blockEnd = cues[0].editedEnd;

  const flush = () => {
    if (texts.length === 0) return;
    blocks.push({
      text: texts.join(' '),
      editedStart: blockStart,
      editedEnd: blockEnd,
    });
    texts = [];
    wordCount = 0;
  };

  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    const cueWords = cue.text.split(/\s+/).filter(Boolean).length;
    const largeSilentGap = texts.length > 0 && cue.editedStart - blockEnd >= 4.0;

    if (texts.length > 0 && (wordCount + cueWords > MAX_WORDS_PER_TTS_BLOCK || largeSilentGap)) {
      flush();
      blockStart = cue.editedStart;
    }

    if (texts.length === 0) {
      blockStart = cue.editedStart;
    }
    texts.push(cue.text);
    wordCount += cueWords;
    blockEnd = Math.max(blockEnd, cue.editedEnd);
  }

  flush();
  return blocks;
}

/**
 * Build a full-duration, softly mastered WAV narration track aligned to the edited video's
 * timeline using Gemini TTS (young, calm, mild-pitch female human voice).
 */
export async function buildSoothingVoiceTrack(
  project: StoredProject,
  spokenCues: SpokenCueSegment[],
  retainedRanges: TimeRange[],
  editedDuration: number,
  preset: VoiceEnhancementPreset,
  trackHash: string
): Promise<string> {
  const ttsCacheDir = path.join(project.dir, 'tts-cache');
  fs.mkdirSync(ttsCacheDir, { recursive: true });

  const assembledPath = path.join(ttsCacheDir, `assembled_${trackHash}.wav`);
  if (fs.existsSync(assembledPath) && fs.statSync(assembledPath).size > 44) {
    return assembledPath;
  }

  const mappedCues = spokenCues
    .map((c) => {
      const text = (c.text ?? '').trim();
      const editedStart = sourceToEditedTime(c.sourceStart, retainedRanges);
      const editedEnd = sourceToEditedTime(c.sourceEnd, retainedRanges);
      return {
        text,
        editedStart: editedStart ?? 0,
        editedEnd: editedEnd ?? editedDuration,
      };
    })
    .filter((c) => c.text.length > 0);

  if (mappedCues.length === 0) {
    throw new VoiceSynthesisError(
      'NO_SPOKEN_TEXT',
      'No spoken transcript text remains to synthesize a soothing voice track.',
      400
    );
  }

  const blocks = groupCuesIntoNarrationBlocks(mappedCues);
  const ai = getGenAIClient();

  // Synthesize narration blocks sequentially to remain respectful of API rate limits
  const synthesized: Array<{
    wavPath: string;
    duration: number;
    editedStart: number;
    editedEnd: number;
  }> = [];

  for (const block of blocks) {
    const clip = await synthesizeBlockWav(ai, ttsCacheDir, block.text, preset);
    synthesized.push({
      wavPath: clip.wavPath,
      duration: clip.duration,
      editedStart: block.editedStart,
      editedEnd: block.editedEnd,
    });
  }

  // Place synthesized narration blocks cleanly onto the edited timeline with gentle natural tempo fit
  interface ScheduledBlock {
    wavPath: string;
    delayMs: number;
    tempo: number;
  }

  const scheduled: ScheduledBlock[] = [];
  let cursorSec = 0;

  for (let i = 0; i < synthesized.length; i++) {
    const clip = synthesized[i];
    const desiredStart = Math.max(0, clip.editedStart);
    const actualStart = i === 0 ? desiredStart : Math.max(desiredStart, cursorSec + 0.12);

    const nextDesiredStart =
      i < synthesized.length - 1 ? synthesized[i + 1].editedStart : editedDuration;
    const availableWindow = Math.max(0.5, nextDesiredStart - actualStart - 0.08);
    const originalSpokenSpan = Math.max(0.5, clip.editedEnd - clip.editedStart);

    let tempo = 1.0;
    if (clip.duration > availableWindow) {
      // Gently tighten pacing (capped at 1.25x so the female voice remains silky & natural)
      tempo = Math.min(1.25, clip.duration / availableWindow);
    } else if (clip.duration < originalSpokenSpan * 0.85) {
      // Gently relax pacing slightly (floor 0.90x) so calm narration fills the visual window naturally
      tempo = Math.max(0.9, clip.duration / (originalSpokenSpan * 0.94));
    }

    const effectiveDuration = clip.duration / tempo;
    scheduled.push({
      wavPath: clip.wavPath,
      delayMs: Math.max(0, Math.round(actualStart * 1000)),
      tempo: Number(tempo.toFixed(4)),
    });

    cursorSec = actualStart + effectiveDuration;
  }

  // Assemble all blocks onto a silent bed matching exact editedDuration + velvety studio mastering
  const finalDurationSec = Math.max(editedDuration, 0.2);
  const ffmpegArgs: string[] = [
    '-y',
    '-f',
    'lavfi',
    '-t',
    finalDurationSec.toFixed(4),
    '-i',
    'anullsrc=channel_layout=mono:sample_rate=24000',
  ];

  for (const item of scheduled) {
    ffmpegArgs.push('-i', item.wavPath);
  }

  const filterParts: string[] = [];
  const mixInputs: string[] = ['[0:a]'];

  for (let i = 0; i < scheduled.length; i++) {
    const item = scheduled[i];
    const inputIdx = i + 1;
    const chain: string[] = ['aresample=24000'];

    if (Math.abs(item.tempo - 1.0) > 0.015) {
      chain.push(`atempo=${item.tempo}`);
    }
    if (item.delayMs > 0) {
      chain.push(`adelay=${item.delayMs}|${item.delayMs}`);
    }
    chain.push('afade=t=in:st=0:d=0.015');

    filterParts.push(`[${inputIdx}:a]${chain.join(',')}[c${i}]`);
    mixInputs.push(`[c${i}]`);
  }

  filterParts.push(
    `${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=first:dropout_transition=0:normalize=0,` +
      `highpass=f=70,lowpass=f=11500,` +
      `equalizer=f=240:t=q:w=1.2:g=1.4,` +
      `equalizer=f=5200:t=q:w=1.8:g=-1.6,` +
      `acompressor=threshold=-18dB:ratio=2.2:attack=18:release=140:makeup=2,` +
      `alimiter=limit=0.94,` +
      `atrim=0:${finalDurationSec.toFixed(4)},asetpts=PTS-STARTPTS[outa]`
  );

  const tmpOut = `${assembledPath}.${process.pid}.${Date.now()}.tmp.wav`;

  try {
    await execFileAsync(
      'ffmpeg',
      [
        ...ffmpegArgs,
        '-filter_complex',
        filterParts.join(';'),
        '-map',
        '[outa]',
        '-ar',
        '44100',
        '-ac',
        '1',
        '-acodec',
        'pcm_s16le',
        tmpOut,
      ],
      { timeout: 180_000, maxBuffer: 8 * 1024 * 1024 }
    );

    if (!fs.existsSync(tmpOut) || fs.statSync(tmpOut).size < 44) {
      throw new VoiceSynthesisError(
        'TTS_ASSEMBLY_FAILED',
        'Assembled soothing voice audio track was empty.',
        500
      );
    }

    fs.renameSync(tmpOut, assembledPath);
    return assembledPath;
  } catch (err) {
    if (fs.existsSync(tmpOut)) {
      try {
        fs.unlinkSync(tmpOut);
      } catch {
        // ignore
      }
    }
    if (err instanceof VoiceSynthesisError) {
      throw err;
    }
    const detail = err instanceof Error ? err.message : 'Audio assembly failed';
    throw new VoiceSynthesisError(
      'TTS_ASSEMBLY_FAILED',
      `Failed to align soothing voice track with video. (${detail.slice(0, 140)})`,
      500
    );
  }
}

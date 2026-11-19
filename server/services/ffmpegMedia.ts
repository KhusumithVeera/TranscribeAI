import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import { APP_LIMITS } from '../config.ts';

const execFileAsync = promisify(execFile);

export class MediaValidationError extends Error {
  code: string;
  statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = 'MediaValidationError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface VideoProbeInfo {
  duration: number;
  width: number;
  height: number;
  hasVideo: boolean;
  hasAudio: boolean;
  videoCodec?: string;
  audioCodec?: string;
  sizeBytes: number;
}

let ffmpegChecked = false;
let ffmpegAvailableCache = false;

export async function checkFfmpegAvailable(): Promise<boolean> {
  if (ffmpegChecked) {
    return ffmpegAvailableCache;
  }
  try {
    await execFileAsync('ffmpeg', ['-version'], { timeout: 5000 });
    await execFileAsync('ffprobe', ['-version'], { timeout: 5000 });
    ffmpegAvailableCache = true;
  } catch {
    ffmpegAvailableCache = false;
  }
  ffmpegChecked = true;
  return ffmpegAvailableCache;
}

export async function probeVideo(filePath: string): Promise<VideoProbeInfo> {
  const available = await checkFfmpegAvailable();
  if (!available) {
    throw new MediaValidationError(
      'FFMPEG_UNAVAILABLE',
      'FFmpeg is not available in the server runtime and is required for media inspection and rendering.',
      503
    );
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    throw new MediaValidationError('FILE_NOT_FOUND', 'Uploaded media file could not be read.', 400);
  }

  if (stat.size === 0) {
    throw new MediaValidationError('EMPTY_FILE', 'The uploaded file is empty.', 400);
  }

  if (stat.size > APP_LIMITS.maxFileSizeBytes) {
    const maxMb = Math.round(APP_LIMITS.maxFileSizeBytes / (1024 * 1024));
    throw new MediaValidationError(
      'FILE_TOO_LARGE',
      `This video exceeds the ${maxMb} MB upload limit.`,
      413
    );
  }

  let stdout: string;
  try {
    const res = await execFileAsync(
      'ffprobe',
      [
        '-v',
        'error',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        filePath,
      ],
      { timeout: 20_000, maxBuffer: 4 * 1024 * 1024 }
    );
    stdout = res.stdout;
  } catch {
    throw new MediaValidationError(
      'CORRUPT_VIDEO',
      'Unable to read this file as a valid video. Please upload a standard MP4, MOV, or WebM video.',
      400
    );
  }

  let parsed: {
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
      duration?: string;
    }>;
    format?: {
      duration?: string;
      size?: string;
    };
  };

  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new MediaValidationError(
      'CORRUPT_VIDEO',
      'Could not inspect the video container metadata.',
      400
    );
  }

  const streams = parsed.streams ?? [];
  const videoStream = streams.find((s) => s.codec_type === 'video');
  const audioStream = streams.find((s) => s.codec_type === 'audio');

  if (!videoStream) {
    throw new MediaValidationError(
      'NO_VIDEO_STREAM',
      'No video track was found in this file. Please upload an MP4, MOV, or WebM video.',
      400
    );
  }

  const durationCandidates = [
    Number(parsed.format?.duration),
    Number(videoStream.duration),
    Number(audioStream?.duration),
  ].filter((n) => Number.isFinite(n) && n > 0);

  const duration = durationCandidates.length > 0 ? durationCandidates[0] : 0;

  if (duration <= 0) {
    throw new MediaValidationError(
      'INVALID_DURATION',
      'Could not determine the video duration. The file may be corrupted or incomplete.',
      400
    );
  }

  if (duration > APP_LIMITS.maxDurationSeconds) {
    const maxMins = Math.round(APP_LIMITS.maxDurationSeconds / 60);
    throw new MediaValidationError(
      'DURATION_EXCEEDED',
      `This video is ${(duration / 60).toFixed(1)} minutes long. Word-level transcription currently supports videos up to ${maxMins} minutes.`,
      400
    );
  }

  if (!audioStream) {
    throw new MediaValidationError(
      'NO_AUDIO_TRACK',
      'This video has no audio track. TranscribeAI requires spoken audio to generate a word-timestamped transcript.',
      400
    );
  }

  return {
    duration: Number(duration.toFixed(4)),
    width: Number(videoStream.width) || 1280,
    height: Number(videoStream.height) || 720,
    hasVideo: true,
    hasAudio: true,
    videoCodec: videoStream.codec_name,
    audioCodec: audioStream.codec_name,
    sizeBytes: stat.size,
  };
}

/**
 * Extract 16kHz mono 16-bit PCM WAV audio from the source video for transcription.
 */
export async function extractAudioWav(videoPath: string, outputWavPath: string): Promise<void> {
  const available = await checkFfmpegAvailable();
  if (!available) {
    throw new MediaValidationError(
      'FFMPEG_UNAVAILABLE',
      'FFmpeg is unavailable on the server.',
      503
    );
  }

  try {
    await execFileAsync(
      'ffmpeg',
      [
        '-y',
        '-i',
        videoPath,
        '-vn',
        '-acodec',
        'pcm_s16le',
        '-ar',
        '16000',
        '-ac',
        '1',
        outputWavPath,
      ],
      { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 }
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'FFmpeg audio extraction failed';
    throw new MediaValidationError(
      'AUDIO_EXTRACTION_FAILED',
      `Could not extract the audio track from this video. (${detail.slice(0, 140)})`,
      500
    );
  }

  if (!fs.existsSync(outputWavPath) || fs.statSync(outputWavPath).size < 44) {
    throw new MediaValidationError(
      'AUDIO_EXTRACTION_FAILED',
      'Extracted audio track was empty. Ensure the video contains an audible speech track.',
      400
    );
  }
}

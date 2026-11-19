import { execFile } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type {
  EditDecisionList,
  SpokenCueSegment,
  TimeRange,
  VoiceEnhancementConfig,
} from '../../src/lib/transcriptTypes.ts';
import {
  calculateTotalDuration,
  computeRetainedRanges,
  normalizeRanges,
} from '../../src/lib/timeRanges.ts';
import { checkFfmpegAvailable } from './ffmpegMedia.ts';
import { buildSoothingVoiceTrack, VoiceSynthesisError } from './sootheVoice.ts';
import type { StoredProject } from './projectStore.ts';

const execFileAsync = promisify(execFile);

export class RenderError extends Error {
  code: string;
  statusCode: number;

  constructor(code: string, message: string, statusCode = 500) {
    super(message);
    this.name = 'RenderError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface RenderResult {
  renderHash: string;
  outputPath: string;
  editedDuration: number;
  retainedRanges: TimeRange[];
  deletedRanges: TimeRange[];
  voiceEnhanced: boolean;
  cached: boolean;
}

const inflightRenders = new Map<string, Promise<RenderResult>>();

function computeRenderHash(
  projectId: string,
  deletedRanges: TimeRange[],
  duration: number,
  voiceEnhancement?: VoiceEnhancementConfig,
  spokenCues?: SpokenCueSegment[]
): string {
  const voiceEnabled = Boolean(voiceEnhancement?.enabled);
  const payload = JSON.stringify({
    projectId,
    duration: Number(duration.toFixed(4)),
    deletedRanges: deletedRanges.map((r) => [Number(r.start.toFixed(4)), Number(r.end.toFixed(4))]),
    voice: voiceEnabled
      ? {
          enabled: true,
          preset: voiceEnhancement?.preset ?? 'calm_mild',
          cues: (spokenCues ?? []).map((c) => [
            c.text.trim(),
            Number(c.sourceStart.toFixed(3)),
            Number(c.sourceEnd.toFixed(3)),
          ]),
        }
      : { enabled: false },
  });
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 24);
}

/**
 * Build a synchronized video+audio FFmpeg filter_complex graph for original audio mode.
 */
function buildVideoAudioFilterComplex(retainedRanges: TimeRange[]): string {
  const filters: string[] = [];
  const concatInputs: string[] = [];
  const totalSegments = retainedRanges.length;

  for (let i = 0; i < totalSegments; i++) {
    const seg = retainedRanges[i];
    const start = seg.start.toFixed(4);
    const end = seg.end.toFixed(4);
    const segDur = seg.end - seg.start;

    filters.push(`[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${i}]`);

    const audioChain: string[] = [`[0:a]atrim=start=${start}:end=${end}`, 'asetpts=PTS-STARTPTS'];

    const fadeDur = 0.008;
    if (segDur > 0.08) {
      if (i > 0) {
        audioChain.push(`afade=t=in:st=0:d=${fadeDur}`);
      }
      if (i < totalSegments - 1) {
        const fadeOutStart = Math.max(0, segDur - fadeDur).toFixed(4);
        audioChain.push(`afade=t=out:st=${fadeOutStart}:d=${fadeDur}`);
      }
    }

    filters.push(`${audioChain.join(',')}[a${i}]`);
    concatInputs.push(`[v${i}][a${i}]`);
  }

  filters.push(`${concatInputs.join('')}concat=n=${totalSegments}:v=1:a=1[outv][outa]`);
  return filters.join(';');
}

/**
 * Build a video-only FFmpeg filter_complex graph when replacing audio with the synthesized soothing voice track.
 */
function buildVideoOnlyFilterComplex(retainedRanges: TimeRange[]): string {
  const filters: string[] = [];
  const concatInputs: string[] = [];
  const totalSegments = retainedRanges.length;

  for (let i = 0; i < totalSegments; i++) {
    const seg = retainedRanges[i];
    const start = seg.start.toFixed(4);
    const end = seg.end.toFixed(4);
    filters.push(`[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${i}]`);
    concatInputs.push(`[v${i}]`);
  }

  filters.push(`${concatInputs.join('')}concat=n=${totalSegments}:v=1:a=0[outv]`);
  return filters.join(';');
}

export async function renderEditedVideo(
  project: StoredProject,
  editList: EditDecisionList,
  voiceEnhancement?: VoiceEnhancementConfig,
  spokenCues?: SpokenCueSegment[]
): Promise<RenderResult> {
  const available = await checkFfmpegAvailable();
  if (!available) {
    throw new RenderError(
      'FFMPEG_UNAVAILABLE',
      'FFmpeg is unavailable on the server and is required to cut and export video.',
      503
    );
  }

  const deletedRanges = normalizeRanges(editList?.deletedRanges ?? [], project.duration);
  const retainedRanges = computeRetainedRanges(deletedRanges, project.duration);

  if (retainedRanges.length === 0) {
    throw new RenderError(
      'NO_MEDIA_REMAINING',
      'All footage has been removed. Undo at least one cut to keep playable video before rendering or exporting.',
      400
    );
  }

  const editedDuration = calculateTotalDuration(retainedRanges);
  const voiceEnabled = Boolean(voiceEnhancement?.enabled);
  const voicePreset = voiceEnhancement?.preset ?? 'calm_mild';
  const renderHash = computeRenderHash(
    project.id,
    deletedRanges,
    project.duration,
    voiceEnhancement,
    spokenCues
  );
  const outputPath = path.join(project.rendersDir, `${renderHash}.mp4`);

  if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
    return {
      renderHash,
      outputPath,
      editedDuration,
      retainedRanges,
      deletedRanges,
      voiceEnhanced: voiceEnabled,
      cached: true,
    };
  }

  const dedupeKey = `${project.id}:${renderHash}`;
  const existing = inflightRenders.get(dedupeKey);
  if (existing) {
    return existing;
  }

  const renderPromise = (async (): Promise<RenderResult> => {
    const tmpPath = path.join(
      project.rendersDir,
      `${renderHash}.${process.pid}.${Date.now()}.tmp.mp4`
    );

    try {
      let args: string[];

      if (voiceEnabled) {
        const soothingAudioPath = await buildSoothingVoiceTrack(
          project,
          spokenCues ?? [],
          retainedRanges,
          editedDuration,
          voicePreset,
          renderHash
        );

        args = ['-y', '-i', project.originalPath, '-i', soothingAudioPath];

        if (deletedRanges.length === 0) {
          args.push(
            '-map',
            '0:v:0',
            '-map',
            '1:a:0',
            '-c:v',
            'libx264',
            '-preset',
            'veryfast',
            '-crf',
            '20',
            '-pix_fmt',
            'yuv420p',
            '-c:a',
            'aac',
            '-b:a',
            '160k',
            '-shortest',
            '-movflags',
            '+faststart',
            tmpPath
          );
        } else {
          const videoFilter = buildVideoOnlyFilterComplex(retainedRanges);
          args.push(
            '-filter_complex',
            videoFilter,
            '-map',
            '[outv]',
            '-map',
            '1:a:0',
            '-c:v',
            'libx264',
            '-preset',
            'veryfast',
            '-crf',
            '20',
            '-pix_fmt',
            'yuv420p',
            '-c:a',
            'aac',
            '-b:a',
            '160k',
            '-shortest',
            '-movflags',
            '+faststart',
            tmpPath
          );
        }
      } else {
        args = ['-y', '-i', project.originalPath];

        if (deletedRanges.length === 0) {
          args.push(
            '-c:v',
            'libx264',
            '-preset',
            'veryfast',
            '-crf',
            '20',
            '-pix_fmt',
            'yuv420p',
            '-c:a',
            'aac',
            '-b:a',
            '128k',
            '-movflags',
            '+faststart',
            tmpPath
          );
        } else {
          const filterComplex = buildVideoAudioFilterComplex(retainedRanges);
          args.push(
            '-filter_complex',
            filterComplex,
            '-map',
            '[outv]',
            '-map',
            '[outa]',
            '-c:v',
            'libx264',
            '-preset',
            'veryfast',
            '-crf',
            '20',
            '-pix_fmt',
            'yuv420p',
            '-c:a',
            'aac',
            '-b:a',
            '128k',
            '-movflags',
            '+faststart',
            tmpPath
          );
        }
      }

      await execFileAsync('ffmpeg', args, {
        timeout: 300_000,
        maxBuffer: 8 * 1024 * 1024,
      });

      if (!fs.existsSync(tmpPath) || fs.statSync(tmpPath).size === 0) {
        throw new RenderError('RENDER_EMPTY', 'FFmpeg finished but produced an empty output file.', 500);
      }

      fs.renameSync(tmpPath, outputPath);

      return {
        renderHash,
        outputPath,
        editedDuration,
        retainedRanges,
        deletedRanges,
        voiceEnhanced: voiceEnabled,
        cached: false,
      };
    } catch (err) {
      if (fs.existsSync(tmpPath)) {
        try {
          fs.unlinkSync(tmpPath);
        } catch {
          // ignore
        }
      }
      if (err instanceof RenderError || err instanceof VoiceSynthesisError) {
        throw err;
      }
      const detail = err instanceof Error ? err.message : 'Unknown FFmpeg error';
      throw new RenderError(
        'RENDER_FAILED',
        `Video rendering failed while processing the output. (${detail.slice(0, 160)})`,
        500
      );
    } finally {
      inflightRenders.delete(dedupeKey);
    }
  })();

  inflightRenders.set(dedupeKey, renderPromise);
  return renderPromise;
}

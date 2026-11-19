import path from 'path';
import os from 'os';

export const APP_LIMITS = {
  maxDurationSeconds: Number(process.env.CLIPSCRIPT_MAX_DURATION_SEC) || 15 * 60, // 15 minutes
  maxFileSizeBytes: Number(process.env.CLIPSCRIPT_MAX_FILE_SIZE_BYTES) || 250 * 1024 * 1024, // 250 MB
  allowedExtensions: ['.mp4', '.mov', '.webm'],
  allowedMimeTypes: new Set([
    'video/mp4',
    'video/quicktime',
    'video/webm',
    'video/x-m4v',
    'application/octet-stream',
  ]),
};

export const PROJECT_TTL_MS = 60 * 60 * 1000; // 1 hour inactivity cleanup
export const PROJECTS_ROOT_DIR = path.join(os.tmpdir(), 'clipscript-projects');

export const DEMO_VIDEO_PATH = path.resolve(
  process.cwd(),
  'public/assets/aistudio/clipscript_45_second_demo_bb9b89e4.mp4'
);
export const DEMO_VIDEO_FILENAME = 'clipscript_45_second_demo.mp4';

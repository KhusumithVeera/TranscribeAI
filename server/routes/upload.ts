import express, { type Request, type Response } from 'express';
import multer from 'multer';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  APP_LIMITS,
  DEMO_VIDEO_FILENAME,
  DEMO_VIDEO_PATH,
} from '../config.ts';
import {
  checkFfmpegAvailable,
  MediaValidationError,
  probeVideo,
} from '../services/ffmpegMedia.ts';
import {
  createProjectDirectory,
  getProject,
  registerProject,
  removeProject,
} from '../services/projectStore.ts';

const router = express.Router();

const uploadStagingDir = path.join(os.tmpdir(), 'clipscript-uploads');
fs.mkdirSync(uploadStagingDir, { recursive: true });

const upload = multer({
  dest: uploadStagingDir,
  limits: {
    fileSize: APP_LIMITS.maxFileSizeBytes,
    files: 1,
  },
});

function sanitizeFilename(raw: string): string {
  const base = path.basename(raw || 'video.mp4');
  return base.replace(/[^\w.\-() ]+/g, '_').slice(0, 140) || 'video.mp4';
}

function getExtension(filename: string): string {
  return path.extname(filename).toLowerCase();
}

export function streamVideoFile(
  req: Request,
  res: Response,
  filePath: string,
  downloadFilename?: string
): void {
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Media file not found or expired.' });
    return;
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const ext = getExtension(filePath);
  const contentType =
    ext === '.webm'
      ? 'video/webm'
      : ext === '.mov'
      ? 'video/quicktime'
      : 'video/mp4';

  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Accept-Ranges', 'bytes');

  if (downloadFilename) {
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${downloadFilename.replace(/"/g, '')}"`
    );
  }

  const range = req.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
      res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
      return;
    }

    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), fileSize - 1) : fileSize - 1;

    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end >= fileSize ||
      start > end
    ) {
      res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
      return;
    }

    const chunkSize = end - start + 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Content-Length': chunkSize,
      'Content-Type': contentType,
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': contentType,
    });
    fs.createReadStream(filePath).pipe(res);
  }
}

router.get('/health', async (_req, res) => {
  const ffmpegAvailable = await checkFfmpegAvailable();
  const demoAvailable = fs.existsSync(DEMO_VIDEO_PATH);
  res.json({
    ok: ffmpegAvailable,
    ffmpegAvailable,
    demoAvailable,
    limits: {
      maxDurationSeconds: APP_LIMITS.maxDurationSeconds,
      maxFileSizeBytes: APP_LIMITS.maxFileSizeBytes,
      allowedExtensions: APP_LIMITS.allowedExtensions,
    },
  });
});

router.post('/upload', (req, res) => {
  upload.single('video')(req, res, async (multerErr) => {
    if (multerErr) {
      if (multerErr instanceof multer.MulterError && multerErr.code === 'LIMIT_FILE_SIZE') {
        const maxMb = Math.round(APP_LIMITS.maxFileSizeBytes / (1024 * 1024));
        res.status(413).json({
          code: 'FILE_TOO_LARGE',
          error: `File exceeds the ${maxMb} MB upload limit.`,
        });
        return;
      }
      res.status(400).json({
        code: 'UPLOAD_ERROR',
        error: multerErr instanceof Error ? multerErr.message : 'File upload failed.',
      });
      return;
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({
        code: 'NO_FILE',
        error: 'Please select an MP4, MOV, or WebM video file to upload.',
      });
      return;
    }

    const originalFilename = sanitizeFilename(file.originalname);
    const ext = getExtension(originalFilename);

    const cleanupTemp = () => {
      try {
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      } catch {
        // ignore
      }
    };

    if (!APP_LIMITS.allowedExtensions.includes(ext)) {
      cleanupTemp();
      res.status(400).json({
        code: 'UNSUPPORTED_FILE_TYPE',
        error: `Unsupported file type "${ext || 'unknown'}". TranscribeAI supports MP4, MOV, and WebM videos.`,
      });
      return;
    }

    if (file.mimetype && !APP_LIMITS.allowedMimeTypes.has(file.mimetype)) {
      cleanupTemp();
      res.status(400).json({
        code: 'UNSUPPORTED_FILE_TYPE',
        error: `Unsupported MIME type "${file.mimetype}". TranscribeAI supports MP4, MOV, and WebM videos.`,
      });
      return;
    }

    const { id, dir, rendersDir } = createProjectDirectory();
    const originalPath = path.join(dir, `original${ext}`);

    try {
      fs.copyFileSync(file.path, originalPath);
      cleanupTemp();

      const info = await probeVideo(originalPath);
      const now = Date.now();
      const project = registerProject({
        id,
        dir,
        rendersDir,
        originalPath,
        filename: originalFilename,
        duration: info.duration,
        width: info.width,
        height: info.height,
        sizeBytes: info.sizeBytes,
        hasAudio: info.hasAudio,
        isDemo: false,
        createdAt: now,
        lastAccessedAt: now,
      });

      res.status(201).json({
        projectId: project.id,
        filename: project.filename,
        duration: project.duration,
        width: project.width,
        height: project.height,
        sizeBytes: project.sizeBytes,
        hasAudio: project.hasAudio,
        sourceUrl: `/api/projects/${project.id}/media/source`,
        isDemo: false,
      });
    } catch (err) {
      cleanupTemp();
      removeProject(id);
      if (err instanceof MediaValidationError) {
        res.status(err.statusCode).json({ code: err.code, error: err.message });
        return;
      }
      res.status(500).json({
        code: 'PROBE_FAILED',
        error: 'Failed to process the uploaded video.',
      });
    }
  });
});

router.post('/load-demo', async (_req, res) => {
  if (!fs.existsSync(DEMO_VIDEO_PATH)) {
    res.status(404).json({
      code: 'DEMO_NOT_FOUND',
      error: 'The 45-second demo video file is not available in this workspace.',
    });
    return;
  }

  const { id, dir, rendersDir } = createProjectDirectory();
  const originalPath = path.join(dir, 'original.mp4');

  try {
    fs.copyFileSync(DEMO_VIDEO_PATH, originalPath);
    const info = await probeVideo(originalPath);
    const now = Date.now();

    const project = registerProject({
      id,
      dir,
      rendersDir,
      originalPath,
      filename: DEMO_VIDEO_FILENAME,
      duration: info.duration,
      width: info.width,
      height: info.height,
      sizeBytes: info.sizeBytes,
      hasAudio: info.hasAudio,
      isDemo: true,
      createdAt: now,
      lastAccessedAt: now,
    });

    res.status(201).json({
      projectId: project.id,
      filename: project.filename,
      duration: project.duration,
      width: project.width,
      height: project.height,
      sizeBytes: project.sizeBytes,
      hasAudio: project.hasAudio,
      sourceUrl: `/api/projects/${project.id}/media/source`,
      isDemo: true,
    });
  } catch (err) {
    removeProject(id);
    if (err instanceof MediaValidationError) {
      res.status(err.statusCode).json({ code: err.code, error: err.message });
      return;
    }
    res.status(500).json({
      code: 'DEMO_LOAD_FAILED',
      error: 'Could not initialize the demo video project.',
    });
  }
});

router.get('/projects/:id/media/source', (req, res) => {
  const project = getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found or session expired.' });
    return;
  }
  streamVideoFile(req, res, project.originalPath);
});

router.delete('/projects/:id', (req, res) => {
  const removed = removeProject(req.params.id);
  res.json({ deleted: removed });
});

export default router;

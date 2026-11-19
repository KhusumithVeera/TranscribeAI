import express from 'express';
import fs from 'fs';
import path from 'path';
import { getProject } from '../services/projectStore.ts';
import { extractAudioWav, MediaValidationError } from '../services/ffmpegMedia.ts';
import {
  transcribeAudioWithGemini,
  TranscriptionError,
} from '../services/geminiTranscription.ts';

const router = express.Router();

router.post('/transcribe', async (req, res) => {
  const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId.trim() : '';
  if (!projectId) {
    res.status(400).json({
      code: 'MISSING_PROJECT_ID',
      error: 'A valid projectId is required to transcribe a video.',
    });
    return;
  }

  const project = getProject(projectId);
  if (!project) {
    res.status(404).json({
      code: 'PROJECT_NOT_FOUND',
      error: 'Video project session not found or has expired. Please upload the video again.',
    });
    return;
  }

  const wavPath = path.join(project.dir, `audio_${Date.now()}.wav`);

  try {
    await extractAudioWav(project.originalPath, wavPath);
    const result = await transcribeAudioWithGemini(wavPath, project.duration);

    res.json({
      projectId: project.id,
      duration: project.duration,
      languageCode: result.languageCode,
      hasWordTimestamps: result.hasWordTimestamps,
      words: result.words,
      paragraphs: result.paragraphs,
      model: result.model,
    });
  } catch (err) {
    if (err instanceof MediaValidationError) {
      res.status(err.statusCode).json({ code: err.code, error: err.message });
      return;
    }
    if (err instanceof TranscriptionError) {
      res.status(err.statusCode).json({ code: err.code, error: err.message });
      return;
    }
    res.status(500).json({
      code: 'TRANSCRIPTION_UNEXPECTED_ERROR',
      error: 'An unexpected error occurred during audio transcription.',
    });
  } finally {
    try {
      if (fs.existsSync(wavPath)) {
        fs.unlinkSync(wavPath);
      }
    } catch {
      // Best-effort cleanup of extracted audio
    }
  }
});

export default router;

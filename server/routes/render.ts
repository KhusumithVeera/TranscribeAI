import express from 'express';
import path from 'path';
import type {
  EditDecisionList,
  SpokenCueSegment,
  VoiceEnhancementConfig,
} from '../../src/lib/transcriptTypes.ts';
import { getProject, getRenderFilePath } from '../services/projectStore.ts';
import { renderEditedVideo, RenderError } from '../services/editRenderer.ts';
import { VoiceSynthesisError } from '../services/sootheVoice.ts';
import { streamVideoFile } from './upload.ts';

const router = express.Router();

router.post('/render', async (req, res) => {
  const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId.trim() : '';
  const editList = req.body?.editList as EditDecisionList | undefined;
  const voiceEnhancement = req.body?.voiceEnhancement as VoiceEnhancementConfig | undefined;
  const spokenCues = Array.isArray(req.body?.spokenCues)
    ? (req.body.spokenCues as SpokenCueSegment[])
    : undefined;

  if (!projectId) {
    res.status(400).json({
      code: 'MISSING_PROJECT_ID',
      error: 'A valid projectId is required to render the edited video.',
    });
    return;
  }

  if (!editList || !Array.isArray(editList.deletedRanges)) {
    res.status(400).json({
      code: 'INVALID_EDL',
      error: 'A valid editList with deletedRanges is required.',
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

  try {
    const result = await renderEditedVideo(project, editList, voiceEnhancement, spokenCues);
    const renderUrl = `/api/projects/${project.id}/media/render/${result.renderHash}`;
    const downloadUrl = `${renderUrl}?download=1`;

    res.json({
      projectId: project.id,
      renderHash: result.renderHash,
      renderUrl,
      downloadUrl,
      editedDuration: result.editedDuration,
      retainedRanges: result.retainedRanges,
      deletedRanges: result.deletedRanges,
      voiceEnhanced: result.voiceEnhanced,
      cached: result.cached,
    });
  } catch (err) {
    if (err instanceof RenderError || err instanceof VoiceSynthesisError) {
      res.status(err.statusCode).json({ code: err.code, error: err.message });
      return;
    }
    res.status(500).json({
      code: 'RENDER_UNEXPECTED_ERROR',
      error: 'An unexpected error occurred while rendering the edited video.',
    });
  }
});

router.get('/projects/:id/media/render/:hash', (req, res) => {
  const project = getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found or session expired.' });
    return;
  }

  const renderPath = getRenderFilePath(project, req.params.hash);
  if (!renderPath) {
    res.status(404).json({ error: 'Rendered video not found. Please re-render the edit.' });
    return;
  }

  const isDownload = req.query.download === '1' || req.query.download === 'true';
  let downloadName: string | undefined;
  if (isDownload) {
    const parsed = path.parse(project.filename);
    const safeBase = (parsed.name || 'transcribeai-video').replace(/[^\w.\-() ]+/g, '_');
    downloadName = `${safeBase}-edited.mp4`;
  }

  streamVideoFile(req, res, renderPath, downloadName);
});

export default router;

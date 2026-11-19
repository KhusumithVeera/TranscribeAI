import { useCallback, useEffect, useState } from 'react';
import type {
  HealthInfo,
  ProjectVideoMeta,
  TranscribeResponse,
} from './lib/transcriptTypes.ts';
import { UploadScreen } from './components/UploadScreen.tsx';
import { EditorShell } from './components/EditorShell.tsx';

export default function App() {
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [project, setProject] = useState<ProjectVideoMeta | null>(null);
  const [transcript, setTranscript] = useState<TranscribeResponse | null>(null);

  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isLoadingDemo, setIsLoadingDemo] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcribeStage, setTranscribeStage] = useState('');
  const [error, setError] = useState<{ title: string; message: string } | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setHealth(data as HealthInfo);
      })
      .catch(() => {
        // Health check optional on initial mount
      });
  }, []);

  const cleanupServerProject = useCallback((projectId?: string) => {
    if (!projectId) return;
    fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
      method: 'DELETE',
    }).catch(() => {});
  }, []);

  const handleSelectFile = useCallback(
    (file: File) => {
      setError(null);

      // Client-side upfront check before uploading large payloads
      const allowed = health?.limits.allowedExtensions ?? ['.mp4', '.mov', '.webm'];
      const lower = file.name.toLowerCase();
      if (!allowed.some((ext) => lower.endsWith(ext))) {
        setError({
          title: 'Unsupported file format',
          message: `Please select an MP4, MOV, or WebM video file. Received "${file.name}".`,
        });
        return;
      }

      const maxBytes = health?.limits.maxFileSizeBytes ?? 250 * 1024 * 1024;
      if (file.size > maxBytes) {
        const maxMb = Math.round(maxBytes / (1024 * 1024));
        setError({
          title: 'Video exceeds upload limit',
          message: `This file is larger than the ${maxMb} MB maximum upload size.`,
        });
        return;
      }

      if (project) {
        cleanupServerProject(project.projectId);
        setProject(null);
        setTranscript(null);
      }

      setIsUploading(true);
      setUploadProgress(0);

      const formData = new FormData();
      formData.append('video', file);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/upload');

      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable && ev.total > 0) {
          setUploadProgress(Math.min(100, Math.round((ev.loaded / ev.total) * 100)));
        }
      };

      xhr.onload = () => {
        setIsUploading(false);
        try {
          const payload = JSON.parse(xhr.responseText || '{}');
          if (xhr.status >= 200 && xhr.status < 300) {
            setProject(payload as ProjectVideoMeta);
          } else {
            setError({
              title: 'Could not use this video',
              message: payload?.error || 'The uploaded video could not be processed.',
            });
          }
        } catch {
          setError({
            title: 'Upload failed',
            message: 'Received an invalid response from the server.',
          });
        }
      };

      xhr.onerror = () => {
        setIsUploading(false);
        setError({
          title: 'Network error during upload',
          message: 'Could not reach the TranscribeAI server. Please try again.',
        });
      };

      xhr.send(formData);
    },
    [health, project, cleanupServerProject]
  );

  const handleLoadDemo = useCallback(async () => {
    setError(null);
    if (project) {
      cleanupServerProject(project.projectId);
      setProject(null);
      setTranscript(null);
    }

    setIsLoadingDemo(true);
    try {
      const res = await fetch('/api/load-demo', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to load the 45-second demo video.');
      }
      setProject(data as ProjectVideoMeta);
    } catch (err) {
      setError({
        title: 'Demo video unavailable',
        message: err instanceof Error ? err.message : 'Could not load demo asset.',
      });
    } finally {
      setIsLoadingDemo(false);
    }
  }, [project, cleanupServerProject]);

  const handleStartTranscribe = useCallback(async () => {
    if (!project) return;
    setError(null);
    setIsTranscribing(true);
    setTranscribeStage('Extracting audio track with FFmpeg…');

    const stageTimer = window.setTimeout(() => {
      setTranscribeStage('Transcribing verbatim words and timestamps with Gemini 3.5 Transcribe…');
    }, 1200);

    try {
      const res = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.projectId }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || 'Transcription failed.');
      }

      const parsed = data as TranscribeResponse;
      if (!parsed.hasWordTimestamps || !Array.isArray(parsed.words) || parsed.words.length === 0) {
        throw new Error(
          'Word-level timestamps were not returned for this audio. Text-to-video editing requires exact word timestamps.'
        );
      }

      setTranscript(parsed);
    } catch (err) {
      setError({
        title: 'Transcription failed',
        message:
          err instanceof Error
            ? err.message
            : 'Could not transcribe this video. Please verify your server configuration and retry.',
      });
    } finally {
      window.clearTimeout(stageTimer);
      setIsTranscribing(false);
      setTranscribeStage('');
    }
  }, [project]);

  const handleResetProject = useCallback(() => {
    if (project) {
      cleanupServerProject(project.projectId);
    }
    setProject(null);
    setTranscript(null);
    setError(null);
    setUploadProgress(0);
  }, [project, cleanupServerProject]);

  if (project && transcript) {
    return (
      <EditorShell
        key={project.projectId}
        project={project}
        initialWords={transcript.words}
        paragraphs={transcript.paragraphs}
        languageCode={transcript.languageCode}
        hasWordTimestamps={transcript.hasWordTimestamps}
        onResetProject={handleResetProject}
      />
    );
  }

  return (
    <UploadScreen
      health={health}
      uploadedVideo={project}
      isUploading={isUploading}
      uploadProgress={uploadProgress}
      isLoadingDemo={isLoadingDemo}
      isTranscribing={isTranscribing}
      transcribeStage={transcribeStage}
      error={error}
      onDismissError={() => setError(null)}
      onSelectFile={handleSelectFile}
      onLoadDemo={handleLoadDemo}
      onStartTranscribe={handleStartTranscribe}
      onReplaceVideo={handleResetProject}
    />
  );
}

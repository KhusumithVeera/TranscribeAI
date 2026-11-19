import { useRef, useState, type DragEvent } from 'react';
import {
  FileVideo,
  Film,
  Loader2,
  Play,
  RefreshCw,
  Upload,
} from 'lucide-react';
import type { HealthInfo, ProjectVideoMeta } from '../lib/transcriptTypes.ts';
import { formatFileSize, formatTimestamp } from '../lib/formatTime.ts';
import { ProcessingStatus } from './ProcessingStatus.tsx';
import { EditorialPhoto } from './EditorialPhoto.tsx';

const HERO_STUDIO_IMG = '/src/assets/images/hero_studio_creator_1795129290451.jpg';
const STEP_MIC_IMG = '/src/assets/images/workflow_soundwave_mic_1795129289438.jpg';
const STEP_SCRIPT_IMG = '/src/assets/images/workflow_editorial_script_1795129289162.jpg';
const STEP_LENS_IMG = '/src/assets/images/workflow_cinema_reel_1795129290182.jpg';

interface UploadScreenProps {
  health: HealthInfo | null;
  uploadedVideo: ProjectVideoMeta | null;
  isUploading: boolean;
  uploadProgress: number;
  isLoadingDemo: boolean;
  isTranscribing: boolean;
  transcribeStage: string;
  error: { title: string; message: string } | null;
  onDismissError: () => void;
  onSelectFile: (file: File) => void;
  onLoadDemo: () => void;
  onStartTranscribe: () => void;
  onReplaceVideo: () => void;
}

const WORKFLOW_CHAPTERS = [
  {
    step: '01. Upload & Preserve',
    caption: 'Drop an MP4, MOV, or WebM. Your original master file stays completely untouched.',
    image: STEP_MIC_IMG,
    alt: 'Minimalist brushed silver studio condenser microphone in soft morning light',
    fallback: 'Studio Audio Capture',
  },
  {
    step: '02. Edit the Manuscript',
    caption: 'Every spoken word—including filler words like "um"—maps to exact source timestamps.',
    image: STEP_SCRIPT_IMG,
    alt: 'Textured ivory manuscript pages and slender black pen resting on warm limestone',
    fallback: 'Verbatim Transcript',
  },
  {
    step: '03. Export Synced MP4',
    caption: 'Delete a word or sentence to remove the matching video and audio, then export MP4.',
    image: STEP_LENS_IMG,
    alt: 'Matte-black cinema lens resting on pale travertine stone in diffused daylight',
    fallback: 'Synchronized Export',
  },
];

export function UploadScreen({
  health,
  uploadedVideo,
  isUploading,
  uploadProgress,
  isLoadingDemo,
  isTranscribing,
  transcribeStage,
  error,
  onDismissError,
  onSelectFile,
  onLoadDemo,
  onStartTranscribe,
  onReplaceVideo,
}: UploadScreenProps) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const maxMinutes = Math.round((health?.limits.maxDurationSeconds ?? 900) / 60);
  const maxMb = Math.round((health?.limits.maxFileSizeBytes ?? 250 * 1024 * 1024) / (1024 * 1024));
  const demoAvailable = health?.demoAvailable ?? true;

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (isUploading || isLoadingDemo || isTranscribing) return;
    const file = e.dataTransfer.files?.[0];
    if (file) {
      onSelectFile(file);
    }
  };

  return (
    <div className="bg-studio-gradient flex min-h-screen flex-col text-[#14181F]">
      {/* 3-Zone Top Bar */}
      <header className="sticky top-0 z-20 border-b border-[#14181F]/8 bg-[#FAF8F4]/75 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1320px] items-center justify-between gap-8 px-6 py-4">
          {/* Zone 1: Single-element editorial wordmark */}
          <span className="font-serif-editorial text-xl font-semibold tracking-tight text-[#14181F] whitespace-nowrap shrink-0">
            TranscribeAI
          </span>

          {/* Zone 2: Clean single-line navigation anchors */}
          <nav
            aria-label="Workflow steps"
            className="hidden items-center gap-7 text-sm text-[#596370] md:flex"
          >
            <span
              className={`whitespace-nowrap shrink-0 ${
                !uploadedVideo ? 'font-medium text-[#14181F]' : 'text-[#0E746B]'
              }`}
            >
              Upload
            </span>
            <span
              className={`whitespace-nowrap shrink-0 ${
                uploadedVideo ? 'font-medium text-[#14181F]' : ''
              }`}
            >
              Transcribe
            </span>
            <span className="whitespace-nowrap shrink-0">Edit</span>
            <span className="whitespace-nowrap shrink-0">Export</span>
          </nav>

          {/* Zone 3: Single primary top-bar action */}
          <div className="flex items-center shrink-0">
            {!uploadedVideo ? (
              demoAvailable ? (
                <button
                  type="button"
                  onClick={onLoadDemo}
                  disabled={isUploading || isLoadingDemo}
                  className="rounded-lg bg-[#14181F] px-4 py-2 text-xs font-medium text-[#FAF8F4] transition-colors hover:bg-[#262D38] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E746B] disabled:opacity-45 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {isLoadingDemo ? 'Loading demo…' : 'Try 45s demo'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  className="rounded-lg bg-[#14181F] px-4 py-2 text-xs font-medium text-[#FAF8F4] transition-colors hover:bg-[#262D38] whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Select video
                </button>
              )
            ) : (
              <button
                type="button"
                onClick={onReplaceVideo}
                disabled={isTranscribing}
                className="rounded-lg border border-[#14181F]/15 bg-white/75 px-4 py-2 text-xs font-medium text-[#14181F] transition-colors hover:bg-white disabled:opacity-45 whitespace-nowrap shrink-0 cursor-pointer"
              >
                Choose another file
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="mx-auto flex w-full max-w-[1320px] flex-1 flex-col justify-center px-6 py-10 lg:py-14">
        {error && (
          <div className="mb-6">
            <ProcessingStatus
              tone="error"
              title={error.title}
              message={error.message}
              onDismiss={onDismissError}
              actionLabel={uploadedVideo ? 'Retry transcription' : undefined}
              onAction={uploadedVideo ? onStartTranscribe : undefined}
            />
          </div>
        )}

        {health && !health.ffmpegAvailable && (
          <div className="mb-6">
            <ProcessingStatus
              tone="warning"
              title="FFmpeg unavailable"
              message="The server runtime could not detect FFmpeg. Audio extraction and MP4 cutting require FFmpeg."
            />
          </div>
        )}

        {!uploadedVideo ? (
          <div className="space-y-14">
            {/* Editorial 2-column hero split */}
            <section className="grid grid-cols-1 items-stretch gap-10 lg:grid-cols-12 lg:gap-12">
              <div className="flex flex-col justify-between gap-8 lg:col-span-6">
                <div className="space-y-4">
                  <p className="text-xs font-medium tracking-wide text-[#0E746B]">
                    Document-first video editing
                  </p>
                  <h1 className="font-serif-editorial text-4xl font-medium tracking-tight text-[#14181F] [text-wrap:balance] sm:text-5xl sm:leading-[1.08]">
                    Edit video with the quiet clarity of a document.
                  </h1>
                  <p className="max-w-lg text-[15px] leading-relaxed text-[#596370]">
                    Upload a spoken video, read its verbatim timestamped transcript, and delete any
                    word or sentence to cut the matching video and audio automatically.
                  </p>
                </div>

                {/* Primary interactive upload dropzone */}
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (!isUploading && !isLoadingDemo) setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  className={`surface-glass flex flex-col items-center justify-center rounded-2xl border-2 border-dashed px-7 py-9 text-center transition-colors shadow-[0_18px_45px_-28px_rgba(20,24,31,0.18)] ${
                    isDragging
                      ? 'border-[#0E746B] bg-white/90'
                      : 'border-[#14181F]/16 hover:border-[#0E746B]/55'
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".mp4,.mov,.webm,video/mp4,video/quicktime,video/webm"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        onSelectFile(file);
                      }
                      e.target.value = '';
                    }}
                  />

                  {isUploading ? (
                    <div className="w-full max-w-sm space-y-4 py-2">
                      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-[#0E746B]/10 text-[#0E746B]">
                        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-[#14181F]">
                          {uploadProgress < 100
                            ? `Uploading video… ${uploadProgress}%`
                            : 'Inspecting video and audio tracks…'}
                        </p>
                        <p className="text-xs text-[#596370]">
                          Checking duration, resolution, and speech audio stream
                        </p>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#14181F]/10">
                        <div
                          style={{ width: `${Math.max(6, uploadProgress)}%` }}
                          className="h-full rounded-full bg-[#0E746B] transition-all duration-150"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl border border-[#14181F]/10 bg-white text-[#0E746B]">
                        <Upload className="h-5 w-5" aria-hidden="true" />
                      </div>

                      <div className="space-y-1">
                        <p className="text-base font-medium text-[#14181F]">
                          Drop your video here
                        </p>
                        <p className="text-xs text-[#596370]">
                          MP4, MOV, or WebM · Up to {maxMinutes} minutes · Max {maxMb} MB
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={isLoadingDemo}
                          className="inline-flex items-center gap-2 rounded-lg bg-[#14181F] px-5 py-2.5 text-sm font-medium text-[#FAF8F4] transition-colors hover:bg-[#262D38] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E746B] disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          <FileVideo className="h-4 w-4" aria-hidden="true" />
                          <span>Select video file</span>
                        </button>

                        {demoAvailable && (
                          <button
                            type="button"
                            onClick={onLoadDemo}
                            disabled={isLoadingDemo}
                            className="inline-flex items-center gap-2 rounded-lg border border-[#14181F]/15 bg-white/80 px-4 py-2.5 text-sm font-medium text-[#14181F] transition-colors hover:bg-white disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            {isLoadingDemo ? (
                              <Loader2
                                className="h-4 w-4 animate-spin text-[#0E746B]"
                                aria-hidden="true"
                              />
                            ) : (
                              <Play className="h-3.5 w-3.5 text-[#0E746B]" aria-hidden="true" />
                            )}
                            <span>{isLoadingDemo ? 'Preparing demo…' : 'Load 45s demo'}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Right editorial studio photography anchor */}
              <div className="relative min-h-[320px] overflow-hidden rounded-2xl border border-[#14181F]/10 shadow-[0_20px_50px_-28px_rgba(20,24,31,0.22)] lg:col-span-6">
                <EditorialPhoto
                  src={HERO_STUDIO_IMG}
                  alt="Minimalist filmmaker studio desk with matte-black cinema lens, silver microphone, and open linen notebook in warm morning light"
                  fallbackLabel="TranscribeAI Studio"
                  className="h-full w-full"
                  imgClassName="lg:h-full"
                />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#10141A]/80 via-[#10141A]/35 to-transparent px-6 pb-5 pt-16 text-white">
                  <p className="font-serif-editorial text-lg font-medium leading-snug">
                    Words become your cut timeline.
                  </p>
                  <p className="mt-1 text-xs text-white/80">
                    Verbatim transcription · Non-destructive cuts · Synchronized H.264 MP4 export
                  </p>
                </div>
              </div>
            </section>

            {/* Minimalist 3-column photography workflow gallery */}
            <section
              aria-label="How TranscribeAI works"
              className="border-t border-[#14181F]/10 pt-10"
            >
              <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
                {WORKFLOW_CHAPTERS.map((item) => (
                  <article key={item.step} className="group space-y-3.5">
                    <EditorialPhoto
                      src={item.image}
                      alt={item.alt}
                      fallbackLabel={item.fallback}
                      className="aspect-[4/3] w-full rounded-xl border border-[#14181F]/8"
                      imgClassName="transition-transform duration-500 ease-out group-hover:scale-[1.03]"
                    />
                    <div className="space-y-1">
                      <h2 className="font-serif-editorial text-lg font-medium text-[#14181F]">
                        {item.step}
                      </h2>
                      <p className="text-sm leading-relaxed text-[#596370]">{item.caption}</p>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </div>
        ) : (
          /* Post-upload preview & transcribe stage */
          <div className="grid grid-cols-1 items-stretch gap-8 lg:grid-cols-12">
            <div className="surface-glass flex flex-col overflow-hidden rounded-2xl border border-[#14181F]/10 shadow-[0_18px_45px_-28px_rgba(20,24,31,0.18)] lg:col-span-7">
              <div className="flex items-center justify-between gap-4 border-b border-[#14181F]/8 px-5 py-3 text-xs text-[#596370]">
                <span className="truncate font-medium text-[#14181F]">
                  {uploadedVideo.filename}
                </span>
                <span className="font-mono tabular-nums whitespace-nowrap shrink-0">
                  {formatTimestamp(uploadedVideo.duration)} · {uploadedVideo.width}×
                  {uploadedVideo.height} · {formatFileSize(uploadedVideo.sizeBytes)}
                </span>
              </div>
              <div className="relative aspect-video w-full bg-[#0F131A]">
                <video
                  src={uploadedVideo.sourceUrl}
                  controls
                  playsInline
                  preload="metadata"
                  className="h-full w-full object-contain"
                />
              </div>
            </div>

            <div className="surface-glass flex flex-col justify-between rounded-2xl border border-[#14181F]/10 p-7 shadow-[0_18px_45px_-28px_rgba(20,24,31,0.18)] lg:col-span-5">
              <div className="space-y-6">
                <div className="flex items-center gap-3.5">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0E746B]/10 text-[#0E746B]">
                    <Film className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="font-serif-editorial text-2xl font-medium text-[#14181F]">
                      Ready to transcribe
                    </h2>
                    <p className="text-xs text-[#596370]">
                      Your original upload remains untouched throughout editing
                    </p>
                  </div>
                </div>

                <dl className="divide-y divide-[#14181F]/8 border-y border-[#14181F]/8 text-sm">
                  <div className="flex items-center justify-between py-3">
                    <dt className="text-[#596370]">Duration</dt>
                    <dd className="font-mono tabular-nums font-medium text-[#14181F]">
                      {formatTimestamp(uploadedVideo.duration)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between py-3">
                    <dt className="text-[#596370]">Resolution</dt>
                    <dd className="font-mono tabular-nums text-[#14181F]">
                      {uploadedVideo.width} × {uploadedVideo.height}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between py-3">
                    <dt className="text-[#596370]">Audio track</dt>
                    <dd className="font-medium text-[#0E746B]">Detected · Ready</dd>
                  </div>
                  <div className="flex items-center justify-between py-3">
                    <dt className="text-[#596370]">Transcription mode</dt>
                    <dd className="text-[#14181F]">Verbatim + word timestamps</dd>
                  </div>
                </dl>

                {isTranscribing && (
                  <ProcessingStatus
                    tone="loading"
                    title="Transcribing speech…"
                    message={
                      transcribeStage ||
                      'Extracting audio track and mapping each spoken word to its exact timestamp.'
                    }
                  />
                )}
              </div>

              <div className="mt-8 space-y-3">
                <button
                  type="button"
                  onClick={onStartTranscribe}
                  disabled={isTranscribing}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#14181F] px-5 py-3 text-sm font-medium text-[#FAF8F4] transition-colors hover:bg-[#262D38] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E746B] focus-visible:ring-offset-2 focus-visible:ring-offset-[#FAF8F4] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                >
                  {isTranscribing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      <span>Transcribing video…</span>
                    </>
                  ) : (
                    <span>Transcribe video</span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={onReplaceVideo}
                  disabled={isTranscribing}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#14181F]/12 bg-white/60 px-4 py-2.5 text-xs font-medium text-[#596370] transition-colors hover:bg-white hover:text-[#14181F] disabled:opacity-45 cursor-pointer"
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Choose a different video</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

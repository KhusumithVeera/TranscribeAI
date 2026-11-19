import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FolderPlus, Redo2, Undo2 } from 'lucide-react';
import type {
  EditDecisionList,
  EditHistorySnapshot,
  ProjectVideoMeta,
  RenderResponse,
  TranscriptParagraph,
  TranscriptWord,
  VoiceEnhancementConfig,
} from '../lib/transcriptTypes.ts';
import {
  calculateTotalDuration,
  computeRetainedRanges,
  editedToSourceTime,
  sourceToEditedTime,
} from '../lib/timeRanges.ts';
import {
  addDeletedRangeToEdl,
  buildDeletionRangeFromWords,
  createEmptyEdl,
  removeDeletedRangeFromEdl,
} from '../lib/editDecisionList.ts';
import {
  buildSpokenCueSegments,
  findActiveWordId,
} from '../lib/selectionMapping.ts';
import { formatDurationCompact, formatTimestamp } from '../lib/formatTime.ts';
import { VideoPreview } from './VideoPreview.tsx';
import { MiniTimeline } from './MiniTimeline.tsx';
import { VoiceSoothePanel } from './VoiceSoothePanel.tsx';
import { TranscriptEditor } from './TranscriptEditor.tsx';
import { ExportButton } from './ExportButton.tsx';
import { ProcessingStatus } from './ProcessingStatus.tsx';

interface EditorShellProps {
  project: ProjectVideoMeta;
  initialWords: TranscriptWord[];
  paragraphs: TranscriptParagraph[];
  languageCode?: string;
  hasWordTimestamps: boolean;
  onResetProject: () => void;
}

export function EditorShell({
  project,
  initialWords,
  paragraphs,
  languageCode,
  hasWordTimestamps,
  onResetProject,
}: EditorShellProps) {
  const [words, setWords] = useState<TranscriptWord[]>(initialWords);
  const [editList, setEditList] = useState<EditDecisionList>(() => createEmptyEdl());
  const [undoStack, setUndoStack] = useState<EditHistorySnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<EditHistorySnapshot[]>([]);

  const [voiceConfig, setVoiceConfig] = useState<VoiceEnhancementConfig>({
    enabled: false,
    preset: 'calm_mild',
  });

  const [viewMode, setViewMode] = useState<'edited' | 'original'>('edited');
  const [renderResult, setRenderResult] = useState<RenderResponse | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [playerTime, setPlayerTime] = useState(0);
  const [toast, setToast] = useState<{
    message: string;
    tone: 'success' | 'info' | 'warning';
  } | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const renderSeqRef = useRef(0);
  const pendingSeekRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const showToast = useCallback(
    (message: string, tone: 'success' | 'info' | 'warning' = 'success') => {
      setToast({ message, tone });
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
      toastTimerRef.current = window.setTimeout(() => {
        setToast(null);
      }, 3800);
    },
    []
  );

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const retainedRanges = useMemo(
    () => computeRetainedRanges(editList.deletedRanges, project.duration),
    [editList.deletedRanges, project.duration]
  );

  const editedDuration = useMemo(
    () => calculateTotalDuration(retainedRanges),
    [retainedRanges]
  );

  const hasEdits = editList.deletedRanges.length > 0;
  const hasOutputChanges = hasEdits || voiceConfig.enabled;
  const allMediaDeleted = retainedRanges.length === 0;

  const activeVideoSrc = useMemo(() => {
    if (viewMode === 'original' || !hasOutputChanges) {
      return project.sourceUrl;
    }
    return renderResult?.renderUrl ?? project.sourceUrl;
  }, [viewMode, hasOutputChanges, project.sourceUrl, renderResult]);

  const activeDisplayDuration =
    viewMode === 'edited' && hasEdits ? editedDuration : project.duration;

  const currentSourceTime = useMemo(() => {
    if (viewMode === 'edited' && hasEdits && renderResult) {
      return editedToSourceTime(playerTime, renderResult.retainedRanges);
    }
    return Math.max(0, Math.min(project.duration, playerTime));
  }, [viewMode, hasEdits, renderResult, playerTime, project.duration]);

  const activeWordId = useMemo(
    () => findActiveWordId(words, currentSourceTime),
    [words, currentSourceTime]
  );

  const pausePlaybackSafely = useCallback(() => {
    const el = videoRef.current;
    if (el && !el.paused) {
      el.pause();
    }
    setIsPlaying(false);
  }, []);

  const requestRender = useCallback(
    async (
      nextEdl: EditDecisionList,
      nextWords: TranscriptWord[],
      nextVoice: VoiceEnhancementConfig
    ): Promise<RenderResponse | null> => {
      const seq = ++renderSeqRef.current;
      setRenderError(null);

      if (nextEdl.deletedRanges.length === 0 && !nextVoice.enabled) {
        setIsRendering(false);
        setRenderResult(null);
        return null;
      }

      const nextRetained = computeRetainedRanges(nextEdl.deletedRanges, project.duration);
      if (nextRetained.length === 0) {
        setIsRendering(false);
        setRenderResult(null);
        return null;
      }

      const spokenCues = nextVoice.enabled ? buildSpokenCueSegments(nextWords) : undefined;

      setIsRendering(true);
      try {
        const res = await fetch('/api/render', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: project.projectId,
            editList: nextEdl,
            voiceEnhancement: nextVoice,
            spokenCues,
          }),
        });
        const data = await res.json();

        if (seq !== renderSeqRef.current) {
          return null;
        }

        if (!res.ok) {
          throw new Error(data?.error || 'Failed to render edited video.');
        }

        const parsed = data as RenderResponse;
        setRenderResult(parsed);
        setViewMode('edited');
        setPlayerTime((prev) => Math.min(prev, parsed.editedDuration));
        return parsed;
      } catch (err) {
        if (seq === renderSeqRef.current) {
          const msg = err instanceof Error ? err.message : 'Video rendering failed.';
          setRenderError(msg);
        }
        return null;
      } finally {
        if (seq === renderSeqRef.current) {
          setIsRendering(false);
        }
      }
    },
    [project.projectId, project.duration]
  );

  const handleLoadedMetadata = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (pendingSeekRef.current !== null) {
      const target = Math.max(0, Math.min(el.duration || 0, pendingSeekRef.current));
      el.currentTime = target;
      setPlayerTime(target);
      pendingSeekRef.current = null;
    }
  }, []);

  const handleVoiceConfigChange = useCallback(
    (nextVoice: VoiceEnhancementConfig) => {
      pausePlaybackSafely();
      setVoiceConfig(nextVoice);
      if (nextVoice.enabled) {
        showToast('Applying young, calm female soothing voice to output…', 'info');
      } else {
        showToast('Switched back to original video audio', 'info');
      }
      void requestRender(editList, words, nextVoice);
    },
    [pausePlaybackSafely, editList, words, requestRender, showToast]
  );

  const commitEdit = useCallback(
    (
      nextWords: TranscriptWord[],
      nextEdl: EditDecisionList,
      summary: string,
      shouldRender: boolean
    ) => {
      pausePlaybackSafely();
      setUndoStack((prev) => [
        ...prev,
        {
          words,
          editList,
          summary,
        },
      ]);
      setRedoStack([]);
      setWords(nextWords);
      setEditList(nextEdl);
      showToast(summary, 'success');

      if (shouldRender || voiceConfig.enabled) {
        void requestRender(nextEdl, nextWords, voiceConfig);
      }
    },
    [words, editList, voiceConfig, pausePlaybackSafely, requestRender, showToast]
  );

  const handleDeleteWords = useCallback(
    (wordIds: string[]) => {
      if (!hasWordTimestamps || wordIds.length === 0) return;
      const idSet = new Set(wordIds);
      const targets = words.filter((w) => idSet.has(w.id) && !w.deleted);
      if (targets.length === 0) return;

      const deletionRange = buildDeletionRangeFromWords(targets, project.duration);
      if (!deletionRange) return;

      const nextEdl = addDeletedRangeToEdl(editList, deletionRange, project.duration);
      const nextWords = words.map((w) => (idSet.has(w.id) ? { ...w, deleted: true } : w));
      const cutSeconds = Math.max(0, deletionRange.end - deletionRange.start);
      const summary = `Removed ${targets.length} ${targets.length === 1 ? 'word' : 'words'} · ${formatDurationCompact(cutSeconds)}`;

      commitEdit(nextWords, nextEdl, summary, true);
    },
    [hasWordTimestamps, words, editList, project.duration, commitEdit]
  );

  const handleRestoreWord = useCallback(
    (word: TranscriptWord) => {
      const matchingRange = editList.deletedRanges.find(
        (r) => word.start >= r.start - 0.05 && word.end <= r.end + 0.05
      );

      let nextEdl: EditDecisionList;
      let nextWords: TranscriptWord[];

      if (matchingRange) {
        nextEdl = removeDeletedRangeFromEdl(editList, matchingRange, project.duration);
        nextWords = words.map((w) =>
          w.deleted && w.start >= matchingRange.start - 0.05 && w.end <= matchingRange.end + 0.05
            ? { ...w, deleted: false }
            : w
        );
      } else {
        nextEdl = editList;
        nextWords = words.map((w) => (w.id === word.id ? { ...w, deleted: false } : w));
      }

      commitEdit(nextWords, nextEdl, 'Restored cut segment', true);
    },
    [editList, words, project.duration, commitEdit]
  );

  const handleCorrectWordText = useCallback(
    (wordId: string, correctedText: string) => {
      const nextWords = words.map((w) =>
        w.id === wordId
          ? {
              ...w,
              correctedText: correctedText === w.text ? undefined : correctedText,
            }
          : w
      );
      commitEdit(
        nextWords,
        editList,
        voiceConfig.enabled
          ? 'Updated transcript and soothing voice wording'
          : 'Updated transcript spelling (source audio unchanged)',
        voiceConfig.enabled
      );
    },
    [words, editList, voiceConfig.enabled, commitEdit]
  );

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    pausePlaybackSafely();
    const prevSnapshot = undoStack[undoStack.length - 1];
    const currentSnapshot: EditHistorySnapshot = {
      words,
      editList,
      summary: prevSnapshot.summary,
    };

    const edlChanged = prevSnapshot.editList.version !== editList.version;
    setUndoStack((s) => s.slice(0, -1));
    setRedoStack((s) => [...s, currentSnapshot]);
    setWords(prevSnapshot.words);
    setEditList(prevSnapshot.editList);
    showToast(`Undid: ${prevSnapshot.summary}`, 'info');

    if (edlChanged || voiceConfig.enabled) {
      void requestRender(prevSnapshot.editList, prevSnapshot.words, voiceConfig);
    }
  }, [undoStack, words, editList, voiceConfig, pausePlaybackSafely, requestRender, showToast]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    pausePlaybackSafely();
    const nextSnapshot = redoStack[redoStack.length - 1];
    const currentSnapshot: EditHistorySnapshot = {
      words,
      editList,
      summary: nextSnapshot.summary,
    };

    const edlChanged = nextSnapshot.editList.version !== editList.version;
    setRedoStack((s) => s.slice(0, -1));
    setUndoStack((s) => [...s, currentSnapshot]);
    setWords(nextSnapshot.words);
    setEditList(nextSnapshot.editList);
    showToast(`Redid: ${nextSnapshot.summary}`, 'info');

    if (edlChanged || voiceConfig.enabled) {
      void requestRender(nextSnapshot.editList, nextSnapshot.words, voiceConfig);
    }
  }, [redoStack, words, editList, voiceConfig, pausePlaybackSafely, requestRender, showToast]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInputFocused =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        if (isInputFocused) return;
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        if (isInputFocused) return;
        e.preventDefault();
        handleRedo();
        return;
      }

      if (e.key === ' ' && !isInputFocused) {
        e.preventDefault();
        const el = videoRef.current;
        if (!el || isRendering || (allMediaDeleted && viewMode === 'edited')) return;
        if (el.paused) {
          void el.play().catch(() => {});
        } else {
          el.pause();
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleUndo, handleRedo, isRendering, allMediaDeleted, viewMode]);

  const handleSeekToSourceTime = useCallback(
    (sourceTime: number) => {
      const el = videoRef.current;
      let targetTime = sourceTime;

      if (viewMode === 'edited' && hasEdits) {
        const mapped = sourceToEditedTime(
          sourceTime,
          renderResult?.retainedRanges ?? retainedRanges
        );
        if (mapped === null) return;
        targetTime = mapped;
      }

      const clamped = Math.max(0, Math.min(activeDisplayDuration, targetTime));
      if (el && el.readyState >= 1) {
        el.currentTime = clamped;
      } else {
        pendingSeekRef.current = clamped;
      }
      setPlayerTime(clamped);
    },
    [viewMode, hasEdits, renderResult, retainedRanges, activeDisplayDuration]
  );

  const handleSeekToWord = useCallback(
    (word: TranscriptWord) => {
      handleSeekToSourceTime(word.start);
    },
    [handleSeekToSourceTime]
  );

  const handleScrub = useCallback((time: number) => {
    const el = videoRef.current;
    if (el) {
      el.currentTime = time;
    }
    setPlayerTime(time);
  }, []);

  const handleTogglePlay = useCallback(() => {
    const el = videoRef.current;
    if (!el || isRendering || (allMediaDeleted && viewMode === 'edited')) return;
    if (el.paused) {
      void el.play().catch(() => {});
    } else {
      el.pause();
    }
  }, [isRendering, allMediaDeleted, viewMode]);

  const handleChangeViewMode = useCallback(
    (nextMode: 'edited' | 'original') => {
      if (nextMode === viewMode) return;
      pausePlaybackSafely();
      const sourceAtSwitch = currentSourceTime;
      if (nextMode === 'original') {
        pendingSeekRef.current = sourceAtSwitch;
      } else {
        const mapped = sourceToEditedTime(
          sourceAtSwitch,
          renderResult?.retainedRanges ?? retainedRanges
        );
        pendingSeekRef.current = mapped ?? 0;
      }
      setViewMode(nextMode);
    },
    [viewMode, pausePlaybackSafely, currentSourceTime, renderResult, retainedRanges]
  );

  const handleExportMp4 = useCallback(async () => {
    if (allMediaDeleted) return;
    setIsExporting(true);
    setRenderError(null);

    try {
      let downloadUrl = renderResult?.downloadUrl;

      if (!downloadUrl) {
        const spokenCues = voiceConfig.enabled ? buildSpokenCueSegments(words) : undefined;
        const res = await fetch('/api/render', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: project.projectId,
            editList,
            voiceEnhancement: voiceConfig,
            spokenCues,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error || 'Could not export MP4.');
        }
        const parsed = data as RenderResponse;
        if (editList.deletedRanges.length > 0 || voiceConfig.enabled) {
          setRenderResult(parsed);
        }
        downloadUrl = parsed.downloadUrl;
      }

      const fileRes = await fetch(downloadUrl);
      if (!fileRes.ok) {
        throw new Error('Export file could not be downloaded from the server.');
      }

      const blob = await fileRes.blob();
      const objectUrl = URL.createObjectURL(blob);
      const baseName = project.filename.replace(/\.[^.]+$/, '') || 'transcribeai-video';
      const suffix = voiceConfig.enabled ? '-soothing-edited.mp4' : '-edited.mp4';

      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = `${baseName}${suffix}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();

      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
      showToast(`Exported ${baseName}${suffix}`, 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'MP4 export failed.';
      setRenderError(msg);
    } finally {
      setIsExporting(false);
    }
  }, [
    allMediaDeleted,
    renderResult,
    voiceConfig,
    words,
    project.projectId,
    project.filename,
    editList,
    showToast,
  ]);

  return (
    <div className="bg-studio-gradient flex min-h-screen flex-col text-[#14181F]">
      {/* 3-Zone Editor Top Bar */}
      <header className="sticky top-0 z-30 border-b border-[#14181F]/8 bg-[#FAF8F4]/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-6 px-6 py-3">
          {/* Zone 1: Brand wordmark */}
          <span className="font-serif-editorial text-xl font-semibold tracking-tight text-[#14181F] whitespace-nowrap shrink-0">
            TranscribeAI
          </span>

          {/* Zone 2: Quiet unboxed project metadata */}
          <div className="hidden min-w-0 items-center gap-2 text-xs text-[#596370] md:flex">
            <span className="max-w-[260px] truncate font-medium text-[#14181F]">
              {project.filename}
            </span>
            <span aria-hidden="true" className="text-[#CBD2DA]">
              ·
            </span>
            <span className="font-mono tabular-nums whitespace-nowrap">
              {formatTimestamp(editedDuration)}
            </span>
            {hasEdits && (
              <>
                <span aria-hidden="true" className="text-[#CBD2DA]">
                  ·
                </span>
                <span className="font-mono tabular-nums font-medium text-[#0E746B] whitespace-nowrap">
                  {editList.deletedRanges.length}{' '}
                  {editList.deletedRanges.length === 1 ? 'cut' : 'cuts'}
                </span>
              </>
            )}
            {voiceConfig.enabled && (
              <>
                <span aria-hidden="true" className="text-[#CBD2DA]">
                  ·
                </span>
                <span className="font-medium text-[#0E746B] whitespace-nowrap">
                  Soothing voice
                </span>
              </>
            )}
          </div>

          {/* Zone 3: Undo, Redo, New Video, Export MP4 */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleUndo}
              disabled={undoStack.length === 0}
              title="Undo (Ctrl/Cmd+Z)"
              aria-label="Undo last edit"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#14181F]/12 bg-white/75 px-3 text-xs font-medium text-[#14181F] transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Undo</span>
            </button>

            <button
              type="button"
              onClick={handleRedo}
              disabled={redoStack.length === 0}
              title="Redo (Ctrl/Cmd+Shift+Z)"
              aria-label="Redo edit"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#14181F]/12 bg-white/75 px-3 text-xs font-medium text-[#14181F] transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Redo2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Redo</span>
            </button>

            <button
              type="button"
              onClick={onResetProject}
              title="Close project and upload a new video"
              aria-label="Upload a new video"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#14181F]/12 bg-white/75 px-3 text-xs font-medium text-[#596370] transition-colors hover:bg-white hover:text-[#14181F] whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FolderPlus className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden lg:inline">New video</span>
            </button>

            <ExportButton
              disabled={allMediaDeleted}
              disabledReason="All footage has been cut. Undo a cut before exporting."
              isExporting={isExporting}
              isRendering={isRendering}
              onExport={handleExportMp4}
            />
          </div>
        </div>
      </header>

      {/* Main Editor Grid */}
      <main className="mx-auto w-full max-w-[1440px] flex-1 px-6 py-5">
        {renderError && (
          <div className="mb-4">
            <ProcessingStatus
              tone="error"
              title="Render error"
              message={renderError}
              onDismiss={() => setRenderError(null)}
              actionLabel={hasOutputChanges ? 'Retry render' : undefined}
              onAction={
                hasOutputChanges ? () => void requestRender(editList, words, voiceConfig) : undefined
              }
            />
          </div>
        )}

        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
          {/* Left column: Video preview + Mini timeline cut map + Output voice studio control */}
          <div className="space-y-4 lg:col-span-5">
            <VideoPreview
              videoRef={videoRef}
              videoSrc={activeVideoSrc}
              viewMode={viewMode}
              hasOutputChanges={hasOutputChanges}
              voiceEnhanced={voiceConfig.enabled}
              isRendering={isRendering}
              allMediaDeleted={allMediaDeleted}
              displayDuration={activeDisplayDuration}
              currentTime={playerTime}
              isPlaying={isPlaying}
              onChangeViewMode={handleChangeViewMode}
              onTogglePlay={handleTogglePlay}
              onScrub={handleScrub}
              onTimeUpdate={setPlayerTime}
              onPlayStateChange={setIsPlaying}
              onLoadedMetadata={handleLoadedMetadata}
            />

            <div className="surface-glass rounded-2xl border border-[#14181F]/10 p-4 shadow-[0_14px_40px_-24px_rgba(20,24,31,0.14)]">
              <MiniTimeline
                sourceDuration={project.duration}
                editedDuration={editedDuration}
                retainedRanges={retainedRanges}
                deletedRanges={editList.deletedRanges}
                currentSourceTime={currentSourceTime}
                onSeekSourceTime={handleSeekToSourceTime}
              />
            </div>

            <VoiceSoothePanel
              config={voiceConfig}
              isRendering={isRendering}
              disabled={allMediaDeleted}
              onChange={handleVoiceConfigChange}
            />

            {toast && (
              <ProcessingStatus
                tone={toast.tone}
                message={toast.message}
                onDismiss={() => setToast(null)}
              />
            )}
          </div>

          {/* Right column: Primary Manuscript Transcript Editor */}
          <div className="lg:col-span-7">
            <TranscriptEditor
              words={words}
              paragraphs={paragraphs}
              languageCode={languageCode}
              activeWordId={activeWordId}
              hasWordTimestamps={hasWordTimestamps}
              onSeekToWord={handleSeekToWord}
              onDeleteWords={handleDeleteWords}
              onRestoreWord={handleRestoreWord}
              onCorrectWordText={handleCorrectWordText}
            />
          </div>
        </div>
      </main>
    </div>
  );
}

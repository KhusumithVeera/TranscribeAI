import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  Eye,
  EyeOff,
  Pencil,
  RotateCcw,
  Scissors,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type { TranscriptParagraph, TranscriptWord } from '../lib/transcriptTypes.ts';
import {
  getSentenceWordIds,
  getVisibleWordSpanIds,
  isFillerWord,
} from '../lib/selectionMapping.ts';
import { formatDurationCompact, formatTimestamp } from '../lib/formatTime.ts';
import { ProcessingStatus } from './ProcessingStatus.tsx';

interface TranscriptEditorProps {
  words: TranscriptWord[];
  paragraphs: TranscriptParagraph[];
  languageCode?: string;
  activeWordId: string | null;
  hasWordTimestamps: boolean;
  onSeekToWord: (word: TranscriptWord) => void;
  onDeleteWords: (wordIds: string[]) => void;
  onRestoreWord: (word: TranscriptWord) => void;
  onCorrectWordText: (wordId: string, correctedText: string) => void;
}

function findWordIdFromNode(node: Node | null): string | null {
  let current: Node | null = node;
  while (current) {
    if (current instanceof HTMLElement) {
      const id = current.dataset.wordId;
      if (id) return id;
    }
    current = current.parentNode;
  }
  return null;
}

export function TranscriptEditor({
  words,
  paragraphs,
  languageCode,
  activeWordId,
  hasWordTimestamps,
  onSeekToWord,
  onDeleteWords,
  onRestoreWord,
  onCorrectWordText,
}: TranscriptEditorProps) {
  const [selectedWordIds, setSelectedWordIds] = useState<string[]>([]);
  const [anchorWordId, setAnchorWordId] = useState<string | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingTypoWordId, setEditingTypoWordId] = useState<string | null>(null);
  const [typoDraft, setTypoDraft] = useState('');
  const [voiceRewriteNotice, setVoiceRewriteNotice] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragHandledRef = useRef(false);

  const wordMap = useMemo(() => {
    const map = new Map<string, TranscriptWord>();
    for (const w of words) {
      map.set(w.id, w);
    }
    return map;
  }, [words]);

  const selectedSet = useMemo(() => new Set(selectedWordIds), [selectedWordIds]);

  const visibleCount = useMemo(
    () => words.reduce((acc, w) => acc + (w.deleted ? 0 : 1), 0),
    [words]
  );
  const deletedCount = words.length - visibleCount;

  useEffect(() => {
    setSelectedWordIds((prev) => {
      const next = prev.filter((id) => {
        const w = wordMap.get(id);
        return w && !w.deleted;
      });
      return next.length === prev.length ? prev : next;
    });
  }, [wordMap]);

  const selectedWords = useMemo(() => {
    return selectedWordIds
      .map((id) => wordMap.get(id))
      .filter((w): w is TranscriptWord => Boolean(w && !w.deleted));
  }, [selectedWordIds, wordMap]);

  const selectedDuration = useMemo(() => {
    if (selectedWords.length === 0) return 0;
    const minStart = Math.min(...selectedWords.map((w) => w.start));
    const maxEnd = Math.max(...selectedWords.map((w) => w.end));
    return Math.max(0, maxEnd - minStart);
  }, [selectedWords]);

  const normalizedSearch = searchQuery.trim().toLowerCase();
  const searchMatchIds = useMemo(() => {
    if (!normalizedSearch) return new Set<string>();
    const matches = new Set<string>();
    for (const w of words) {
      if (w.deleted) continue;
      const display = (w.correctedText ?? w.text).toLowerCase();
      if (display.includes(normalizedSearch)) {
        matches.add(w.id);
      }
    }
    return matches;
  }, [words, normalizedSearch]);

  const handleConfirmDelete = () => {
    if (!hasWordTimestamps || selectedWords.length === 0) return;
    const ids = selectedWords.map((w) => w.id);
    onDeleteWords(ids);
    setSelectedWordIds([]);
    setAnchorWordId(null);
    setEditingTypoWordId(null);
    setVoiceRewriteNotice(false);
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInputFocused =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);

      if (isInputFocused) return;

      if (e.key === 'Escape') {
        setSelectedWordIds([]);
        setEditingTypoWordId(null);
        setVoiceRewriteNotice(false);
        return;
      }

      if ((e.key === 'Backspace' || e.key === 'Delete') && selectedWords.length > 0) {
        e.preventDefault();
        handleConfirmDelete();
        return;
      }

      if (
        selectedWords.length > 0 &&
        e.key.length === 1 &&
        e.key !== ' ' &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        e.preventDefault();
        setVoiceRewriteNotice(true);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedWords, hasWordTimestamps]);

  const handleProseMouseUp = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      dragHandledRef.current = false;
      return;
    }

    const anchorId = findWordIdFromNode(sel.anchorNode);
    const focusId = findWordIdFromNode(sel.focusNode);

    if (anchorId && focusId) {
      const spanIds = getVisibleWordSpanIds(words, anchorId, focusId);
      if (spanIds.length > 0) {
        dragHandledRef.current = true;
        setSelectedWordIds(spanIds);
        setAnchorWordId(spanIds[0]);
        setEditingTypoWordId(null);
        setVoiceRewriteNotice(false);
        sel.removeAllRanges();
        return;
      }
    }
    dragHandledRef.current = false;
  };

  const handleWordClick = (e: ReactMouseEvent<HTMLSpanElement>, word: TranscriptWord) => {
    if (dragHandledRef.current) {
      dragHandledRef.current = false;
      return;
    }

    if (word.deleted) {
      return;
    }

    setEditingTypoWordId(null);
    setVoiceRewriteNotice(false);

    if (e.shiftKey && anchorWordId) {
      e.preventDefault();
      const span = getVisibleWordSpanIds(words, anchorWordId, word.id);
      if (span.length > 0) {
        setSelectedWordIds(span);
      }
      return;
    }

    setAnchorWordId(word.id);
    setSelectedWordIds([word.id]);
    onSeekToWord(word);
  };

  const handleWordDoubleClick = (word: TranscriptWord) => {
    if (word.deleted) return;
    const sentenceIds = getSentenceWordIds(words, word.id);
    if (sentenceIds.length > 0) {
      setSelectedWordIds(sentenceIds);
      setAnchorWordId(sentenceIds[0]);
      setEditingTypoWordId(null);
      setVoiceRewriteNotice(false);
    }
  };

  const openTypoEditor = () => {
    if (selectedWords.length !== 1) return;
    const target = selectedWords[0];
    setEditingTypoWordId(target.id);
    setTypoDraft(target.correctedText ?? target.text);
    setVoiceRewriteNotice(false);
  };

  const saveTypoCorrection = () => {
    if (!editingTypoWordId) return;
    const cleaned = typoDraft.trim();
    if (cleaned) {
      onCorrectWordText(editingTypoWordId, cleaned);
    }
    setEditingTypoWordId(null);
  };

  const editingWord = editingTypoWordId ? wordMap.get(editingTypoWordId) : null;

  const uniqueSpeakers = useMemo(() => {
    const s = new Set<string>();
    for (const w of words) {
      if (w.speakerId) s.add(w.speakerId);
    }
    return s;
  }, [words]);
  const showSpeakerLabels = uniqueSpeakers.size > 1;

  return (
    <section
      aria-label="Editable transcript"
      className="surface-glass flex min-h-[480px] flex-col overflow-hidden rounded-2xl border border-[#14181F]/10 shadow-[0_14px_40px_-24px_rgba(20,24,31,0.16)] lg:h-[calc(100vh-116px)]"
    >
      {/* Transcript header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#14181F]/8 px-6 py-3.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <h2 className="font-serif-editorial text-lg font-medium text-[#14181F] whitespace-nowrap">
            Transcript
          </h2>
          <span aria-hidden="true" className="text-[#CBD2DA]">
            ·
          </span>
          <span className="font-mono text-xs tabular-nums text-[#596370] whitespace-nowrap">
            {visibleCount} {visibleCount === 1 ? 'word' : 'words'}
            {languageCode ? ` · ${languageCode.toUpperCase()}` : ''}
          </span>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="relative flex items-center">
            <Search
              className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-[#7C8694]"
              aria-hidden="true"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder='Find word (e.g. "um")'
              aria-label="Find words in transcript"
              className="w-40 rounded-lg border border-[#14181F]/12 bg-white/80 py-1.5 pl-8 pr-7 text-xs text-[#14181F] placeholder-[#7C8694] transition-colors focus:border-[#0E746B]/60 focus:bg-white focus:outline-none sm:w-44"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                className="absolute right-2 text-[#7C8694] hover:text-[#14181F] cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {normalizedSearch && (
            <span className="font-mono text-xs tabular-nums text-[#9A5B13] whitespace-nowrap">
              {searchMatchIds.size} {searchMatchIds.size === 1 ? 'match' : 'matches'}
            </span>
          )}

          {deletedCount > 0 && (
            <button
              type="button"
              onClick={() => setShowDeleted((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                showDeleted
                  ? 'border-red-300 bg-red-50 text-[#991B1B]'
                  : 'border-[#14181F]/12 bg-white/75 text-[#596370] hover:bg-white hover:text-[#14181F]'
              }`}
            >
              {showDeleted ? (
                <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <Eye className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              <span>
                {showDeleted ? 'Hide cuts' : 'Show cuts'} ({deletedCount})
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Contextual selection toolbar */}
      {selectedWords.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#14181F]/8 bg-[#F2F6F5]/95 px-6 py-2.5">
          <div className="flex items-center gap-2 text-xs text-[#596370]">
            <span className="font-medium text-[#14181F]">
              {selectedWords.length} {selectedWords.length === 1 ? 'word' : 'words'} selected
            </span>
            <span aria-hidden="true" className="text-[#CBD2DA]">
              ·
            </span>
            <span className="font-mono tabular-nums font-medium text-[#0E746B]">
              {formatDurationCompact(selectedDuration)}
            </span>
            <span aria-hidden="true" className="hidden text-[#CBD2DA] sm:inline">
              ·
            </span>
            <span className="hidden font-mono tabular-nums text-[#596370] sm:inline">
              {formatTimestamp(Math.min(...selectedWords.map((w) => w.start)))} –{' '}
              {formatTimestamp(Math.max(...selectedWords.map((w) => w.end)))}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleConfirmDelete}
              disabled={!hasWordTimestamps}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#B91C1C] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#991B1B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Delete from video</span>
            </button>

            {selectedWords.length === 1 && (
              <button
                type="button"
                onClick={openTypoEditor}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#14181F]/15 bg-white px-3 py-1.5 text-xs font-medium text-[#14181F] transition-colors hover:bg-[#FAF8F4] whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Correct typo</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setVoiceRewriteNotice(true)}
              className="hidden rounded-lg border border-[#14181F]/12 bg-white/70 px-2.5 py-1.5 text-xs text-[#596370] transition-colors hover:bg-white hover:text-[#14181F] sm:inline-flex whitespace-nowrap shrink-0 cursor-pointer"
            >
              Rewrite spoken word…
            </button>

            <button
              type="button"
              onClick={() => {
                setSelectedWordIds([]);
                setEditingTypoWordId(null);
                setVoiceRewriteNotice(false);
              }}
              aria-label="Clear selection"
              className="rounded-md p-1.5 text-[#596370] hover:bg-black/5 hover:text-[#14181F] cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Honest MVP notice for voice replacement vs deletion */}
      {voiceRewriteNotice && (
        <div className="border-b border-[#14181F]/8 px-6 py-3">
          <ProcessingStatus
            tone="info"
            title="Voice replacement is not available in this MVP"
            message="Deleting words removes their matching video and audio ranges. To fix a spelling mistake in the text without changing spoken audio, select a single word and click Correct typo."
            onDismiss={() => setVoiceRewriteNotice(false)}
          />
        </div>
      )}

      {/* Explicit transcript-only typo correction drawer */}
      {editingWord && (
        <div className="border-b border-[#14181F]/8 bg-[#FAF8F4]/95 px-6 py-3.5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveTypoCorrection();
            }}
            className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="space-y-1">
              <p className="text-xs font-medium text-[#14181F]">
                Transcript correction only{' '}
                <span className="font-normal text-[#596370]">
                  — spoken audio in the source video stays unchanged
                </span>
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={typoDraft}
                  onChange={(e) => setTypoDraft(e.target.value)}
                  autoFocus
                  aria-label="Corrected transcript text"
                  className="w-56 rounded-lg border border-[#0E746B]/50 bg-white px-3 py-1.5 text-sm text-[#14181F] focus:outline-none focus:ring-2 focus:ring-[#0E746B]/25"
                />
                <span className="text-xs text-[#6B7280]">
                  Original: <span className="text-[#14181F]">{editingWord.text}</span>
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="submit"
                className="rounded-lg bg-[#14181F] px-3 py-1.5 text-xs font-medium text-[#FAF8F4] hover:bg-[#262D38] cursor-pointer whitespace-nowrap shrink-0"
              >
                Save text fix
              </button>
              <button
                type="button"
                onClick={() => setEditingTypoWordId(null)}
                className="rounded-lg border border-[#14181F]/12 bg-white px-3 py-1.5 text-xs text-[#596370] hover:text-[#14181F] cursor-pointer whitespace-nowrap shrink-0"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Document-style scrollable manuscript body */}
      <div
        ref={containerRef}
        onMouseUp={handleProseMouseUp}
        className="flex-1 overflow-y-auto px-7 py-7 sm:px-9"
      >
        {visibleCount === 0 && !showDeleted ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 py-16 text-center">
            <Scissors className="h-6 w-6 text-[#7C8694]" aria-hidden="true" />
            <p className="text-sm font-medium text-[#14181F]">All spoken words have been cut</p>
            <p className="max-w-sm text-xs text-[#596370]">
              Use Undo in the top bar or toggle Show cuts to restore removed segments.
            </p>
            <button
              type="button"
              onClick={() => setShowDeleted(true)}
              className="mt-1 rounded-lg border border-[#14181F]/15 bg-white px-3.5 py-2 text-xs font-medium text-[#14181F] hover:bg-[#FAF8F4] cursor-pointer"
            >
              Show removed cuts ({deletedCount})
            </button>
          </div>
        ) : (
          <div className="max-w-[66ch] space-y-7">
            {paragraphs.map((para) => {
              const paraWords = para.wordIds
                .map((id) => wordMap.get(id))
                .filter((w): w is TranscriptWord => Boolean(w));

              const visibleInPara = paraWords.filter((w) => showDeleted || !w.deleted);
              if (visibleInPara.length === 0) return null;

              const firstTimestamp = visibleInPara[0].start;

              return (
                <div key={para.id} className="space-y-2">
                  <div className="flex items-center gap-2 text-[11px] text-[#7C8694]">
                    <span className="font-mono tabular-nums">
                      {formatTimestamp(firstTimestamp)}
                    </span>
                    {showSpeakerLabels && para.speakerId && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-medium text-[#596370]">{para.speakerId}</span>
                      </>
                    )}
                  </div>

                  <p className="text-[16.5px] leading-[1.95] text-[#1C222B]">
                    {visibleInPara.map((word, index) => {
                      const displayText = word.correctedText ?? word.text;
                      const isSelected = selectedSet.has(word.id);
                      const isActive = activeWordId === word.id;
                      const isSearchMatch = searchMatchIds.has(word.id);
                      const isFiller = !word.deleted && isFillerWord(word.text);
                      const isCorrected = Boolean(
                        word.correctedText && word.correctedText !== word.text
                      );

                      if (word.deleted) {
                        return (
                          <span key={word.id}>
                            <span
                              data-word-id={word.id}
                              onClick={() => onRestoreWord(word)}
                              title={`Cut (${formatTimestamp(word.start)} – ${formatTimestamp(word.end)}) · Click to restore`}
                              className="inline-flex items-baseline gap-1 rounded px-1 py-0.5 text-[#991B1B]/80 line-through decoration-red-500/70 bg-red-500/10 hover:bg-red-500/18 cursor-pointer transition-colors"
                            >
                              <span>{displayText}</span>
                              <span className="text-[10px] font-mono uppercase tracking-wider text-[#991B1B] no-underline inline-flex items-center gap-0.5">
                                <RotateCcw className="h-2.5 w-2.5" aria-hidden="true" />
                                cut
                              </span>
                            </span>
                            {index < visibleInPara.length - 1 ? ' ' : ''}
                          </span>
                        );
                      }

                      let stateClass =
                        'hover:bg-[#14181F]/[0.06] rounded-[4px] px-[2px] py-[1px] -mx-[1px] transition-colors duration-100';

                      if (isSelected) {
                        stateClass =
                          'bg-[#0E746B]/22 text-[#0A2E2B] rounded-[4px] px-[2px] py-[1px] -mx-[1px] ring-1 ring-[#0E746B]/45';
                      } else if (isActive) {
                        stateClass =
                          'bg-[#0E746B]/14 text-[#0A2E2B] rounded-[4px] px-[2px] py-[1px] -mx-[1px]';
                      } else if (isSearchMatch) {
                        stateClass =
                          'bg-amber-300/45 text-[#451A03] rounded-[4px] px-[2px] py-[1px] -mx-[1px] ring-1 ring-amber-500/40';
                      }

                      const decorationClass = isCorrected
                        ? 'underline decoration-dotted decoration-[#0E746B] underline-offset-4'
                        : isFiller
                        ? 'underline decoration-dotted decoration-amber-600/65 underline-offset-4'
                        : '';

                      return (
                        <span key={word.id}>
                          <span
                            data-word-id={word.id}
                            onClick={(e) => handleWordClick(e, word)}
                            onDoubleClick={() => handleWordDoubleClick(word)}
                            title={
                              isCorrected
                                ? `${formatTimestamp(word.start)} – ${formatTimestamp(word.end)} · Transcript corrected (original: "${word.text}")`
                                : `${formatTimestamp(word.start)} – ${formatTimestamp(word.end)}`
                            }
                            className={`cursor-pointer ${stateClass} ${decorationClass}`}
                          >
                            {displayText}
                          </span>
                          {index < visibleInPara.length - 1 ? ' ' : ''}
                        </span>
                      );
                    })}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Quiet editing shortcut reference footer */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#14181F]/8 bg-white/60 px-6 py-2.5 text-[11px] text-[#6B7280]">
        <span>
          Click a word to seek · Drag or Shift-click to select · Double-click for sentence · Press{' '}
          <kbd className="rounded border border-[#14181F]/15 bg-white px-1.5 py-0.5 font-mono text-[10px] text-[#14181F]">
            Delete
          </kbd>{' '}
          to cut video
        </span>
        <span>Dotted amber underline marks filler words</span>
      </div>
    </section>
  );
}

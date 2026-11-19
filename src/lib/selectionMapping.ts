import type { SpokenCueSegment, TranscriptWord } from './transcriptTypes.ts';

/**
 * Return ordered IDs of all non-deleted words between anchorId and focusId (inclusive).
 */
export function getVisibleWordSpanIds(
  words: TranscriptWord[],
  anchorId: string,
  focusId: string
): string[] {
  const anchorIndex = words.findIndex((w) => w.id === anchorId);
  const focusIndex = words.findIndex((w) => w.id === focusId);
  if (anchorIndex === -1 || focusIndex === -1) {
    return [];
  }

  const start = Math.min(anchorIndex, focusIndex);
  const end = Math.max(anchorIndex, focusIndex);

  const ids: string[] = [];
  for (let i = start; i <= end; i++) {
    if (!words[i].deleted) {
      ids.push(words[i].id);
    }
  }
  return ids;
}

const SENTENCE_END_RE = /[.!?]["'”’)\]]*$/;

/**
 * Select the full sentence containing targetWordId among visible (non-deleted) words.
 */
export function getSentenceWordIds(
  words: TranscriptWord[],
  targetWordId: string
): string[] {
  const idx = words.findIndex((w) => w.id === targetWordId);
  if (idx === -1 || words[idx].deleted) {
    return [];
  }

  let start = idx;
  while (start > 0) {
    const prev = words[start - 1];
    if (prev.deleted) {
      break;
    }
    const prevText = (prev.correctedText ?? prev.text).trim();
    if (SENTENCE_END_RE.test(prevText)) {
      break;
    }
    start--;
  }

  let end = idx;
  while (end < words.length - 1) {
    const cur = words[end];
    const curText = (cur.correctedText ?? cur.text).trim();
    if (SENTENCE_END_RE.test(curText)) {
      break;
    }
    if (words[end + 1].deleted) {
      break;
    }
    end++;
  }

  const result: string[] = [];
  for (let i = start; i <= end; i++) {
    if (!words[i].deleted) {
      result.push(words[i].id);
    }
  }
  return result;
}

/**
 * Find the active visible word at the given source playback time (in seconds).
 */
export function findActiveWordId(
  words: TranscriptWord[],
  sourceTime: number
): string | null {
  if (!Number.isFinite(sourceTime) || words.length === 0) {
    return null;
  }

  // Exact match inside [start, end]
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w.deleted) continue;
    if (sourceTime >= w.start && sourceTime <= w.end) {
      return w.id;
    }
  }

  // Small lookback tolerance (within 0.12s after word end) so highlighting feels smooth across micro-pauses
  let candidate: TranscriptWord | null = null;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w.deleted) continue;
    if (w.start <= sourceTime && sourceTime - w.end <= 0.14) {
      candidate = w;
    }
    if (w.start > sourceTime) {
      break;
    }
  }

  return candidate ? candidate.id : null;
}

/**
 * Helper to detect common spoken filler words so users can spot them easily if desired (never auto-deleted!).
 */
const FILLER_WORDS = new Set(['um', 'uh', 'umm', 'uhh', 'erm', 'ah', 'hmm']);

export function isFillerWord(text: string): boolean {
  const normalized = text.toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, '');
  return FILLER_WORDS.has(normalized);
}

/**
 * Group non-deleted words into naturally punctuated, timestamped spoken cue segments
 * so soothing TTS narration aligns cleanly to every kept video moment and cut boundary.
 */
export function buildSpokenCueSegments(words: TranscriptWord[]): SpokenCueSegment[] {
  const cues: SpokenCueSegment[] = [];
  let buffer: TranscriptWord[] = [];

  const flush = () => {
    if (buffer.length === 0) return;
    const text = buffer
      .map((w) => (w.correctedText ?? w.text).trim())
      .filter(Boolean)
      .join(' ')
      .trim();
    if (text) {
      cues.push({
        text,
        sourceStart: buffer[0].start,
        sourceEnd: buffer[buffer.length - 1].end,
      });
    }
    buffer = [];
  };

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (word.deleted) {
      flush();
      continue;
    }

    if (buffer.length > 0) {
      const prev = buffer[buffer.length - 1];
      const prevText = (prev.correctedText ?? prev.text).trim();
      const pauseGap = word.start - prev.end;
      const endedSentence = SENTENCE_END_RE.test(prevText);
      const longClause = buffer.length >= 22 && /[,;:]$/.test(prevText);

      if (endedSentence || pauseGap >= 0.85 || longClause) {
        flush();
      }
    }

    buffer.push(word);
  }

  flush();
  return cues;
}

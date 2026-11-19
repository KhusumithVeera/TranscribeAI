import type { EditDecisionList, TimeRange, TranscriptWord } from './transcriptTypes.ts';
import { normalizeRanges } from './timeRanges.ts';

export function createEmptyEdl(): EditDecisionList {
  return {
    deletedRanges: [],
    version: 0,
  };
}

/**
 * Compute a contiguous deletion range [earliestStart, latestEnd] from selected words.
 */
export function buildDeletionRangeFromWords(
  selectedWords: TranscriptWord[],
  duration: number
): TimeRange | null {
  if (selectedWords.length === 0) {
    return null;
  }

  let minStart = Infinity;
  let maxEnd = -Infinity;

  for (const w of selectedWords) {
    if (Number.isFinite(w.start) && Number.isFinite(w.end)) {
      minStart = Math.min(minStart, w.start);
      maxEnd = Math.max(maxEnd, w.end);
    }
  }

  if (!Number.isFinite(minStart) || !Number.isFinite(maxEnd)) {
    return null;
  }

  const safeStart = Math.max(0, Math.min(duration, minStart));
  const safeEnd = Math.max(safeStart, Math.min(duration, maxEnd));
  if (safeEnd - safeStart < 0.01) {
    return null;
  }

  return {
    start: Number(safeStart.toFixed(4)),
    end: Number(safeEnd.toFixed(4)),
  };
}

/**
 * Add a deletion range to the EDL and normalize overlapping/abutting ranges.
 */
export function addDeletedRangeToEdl(
  edl: EditDecisionList,
  newRange: TimeRange,
  duration: number
): EditDecisionList {
  const nextRanges = normalizeRanges([...edl.deletedRanges, newRange], duration);
  return {
    deletedRanges: nextRanges,
    version: edl.version + 1,
  };
}

/**
 * Remove a deleted range (for restoring a cut inline) and normalize remaining ranges.
 */
export function removeDeletedRangeFromEdl(
  edl: EditDecisionList,
  targetRange: TimeRange,
  duration: number
): EditDecisionList {
  const nextRanges = edl.deletedRanges.filter(
    (r) => Math.abs(r.start - targetRange.start) > 0.02 || Math.abs(r.end - targetRange.end) > 0.02
  );
  return {
    deletedRanges: normalizeRanges(nextRanges, duration),
    version: edl.version + 1,
  };
}

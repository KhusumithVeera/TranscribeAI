import type { TimeRange } from './transcriptTypes.ts';

const MIN_VALID_RANGE_SEC = 0.01;
const MIN_RETAINED_SEGMENT_SEC = 0.04;
const ADJACENT_MERGE_EPSILON_SEC = 0.015;

/**
 * Clamp ranges to [0, duration], discard degenerate ranges, sort by start time,
 * and merge overlapping or directly abutting ranges without merging distinct distant cuts.
 */
export function normalizeRanges(ranges: TimeRange[], duration: number): TimeRange[] {
  if (!Number.isFinite(duration) || duration <= 0 || ranges.length === 0) {
    return [];
  }

  const clamped = ranges
    .map((r) => ({
      start: Math.max(0, Math.min(duration, Number(r.start) || 0)),
      end: Math.max(0, Math.min(duration, Number(r.end) || 0)),
    }))
    .filter((r) => r.end - r.start >= MIN_VALID_RANGE_SEC)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  if (clamped.length === 0) {
    return [];
  }

  const merged: TimeRange[] = [{ ...clamped[0] }];
  for (let i = 1; i < clamped.length; i++) {
    const current = clamped[i];
    const last = merged[merged.length - 1];
    if (current.start <= last.end + ADJACENT_MERGE_EPSILON_SEC) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push({ ...current });
    }
  }

  return merged.map((r) => ({
    start: Number(r.start.toFixed(4)),
    end: Number(r.end.toFixed(4)),
  }));
}

/**
 * Compute retained source segments as the exact complement of deletedRanges within [0, duration].
 */
export function computeRetainedRanges(deletedRanges: TimeRange[], duration: number): TimeRange[] {
  if (!Number.isFinite(duration) || duration <= 0) {
    return [];
  }

  const normalizedDeleted = normalizeRanges(deletedRanges, duration);
  if (normalizedDeleted.length === 0) {
    return [{ start: 0, end: Number(duration.toFixed(4)) }];
  }

  const retained: TimeRange[] = [];
  let cursor = 0;

  for (const cut of normalizedDeleted) {
    if (cut.start - cursor >= MIN_RETAINED_SEGMENT_SEC) {
      retained.push({
        start: Number(cursor.toFixed(4)),
        end: Number(cut.start.toFixed(4)),
      });
    }
    cursor = Math.max(cursor, cut.end);
  }

  if (duration - cursor >= MIN_RETAINED_SEGMENT_SEC) {
    retained.push({
      start: Number(cursor.toFixed(4)),
      end: Number(duration.toFixed(4)),
    });
  }

  return retained;
}

export function calculateTotalDuration(ranges: TimeRange[]): number {
  const sum = ranges.reduce((acc, r) => acc + Math.max(0, r.end - r.start), 0);
  return Number(sum.toFixed(4));
}

/**
 * Map a timestamp in the original source video to its playback position in the edited timeline.
 * If the source time falls inside a deleted cut, returns the nearest cut boundary in edited time.
 */
export function sourceToEditedTime(sourceTime: number, retainedRanges: TimeRange[]): number | null {
  if (retainedRanges.length === 0) {
    return null;
  }

  let editedCursor = 0;
  for (const seg of retainedRanges) {
    if (sourceTime < seg.start) {
      return Number(editedCursor.toFixed(4));
    }
    if (sourceTime >= seg.start && sourceTime <= seg.end) {
      return Number((editedCursor + (sourceTime - seg.start)).toFixed(4));
    }
    editedCursor += seg.end - seg.start;
  }

  return Number(editedCursor.toFixed(4));
}

/**
 * Map a playback timestamp in the rendered edited video back to the original source timestamp.
 */
export function editedToSourceTime(editedTime: number, retainedRanges: TimeRange[]): number {
  if (retainedRanges.length === 0) {
    return 0;
  }

  const target = Math.max(0, editedTime);
  let editedCursor = 0;

  for (const seg of retainedRanges) {
    const segLen = seg.end - seg.start;
    if (target <= editedCursor + segLen) {
      return Number((seg.start + (target - editedCursor)).toFixed(4));
    }
    editedCursor += segLen;
  }

  return retainedRanges[retainedRanges.length - 1].end;
}

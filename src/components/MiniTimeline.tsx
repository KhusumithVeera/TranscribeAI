import type { MouseEvent } from 'react';
import type { TimeRange } from '../lib/transcriptTypes.ts';
import { formatDurationCompact, formatTimestamp } from '../lib/formatTime.ts';

interface MiniTimelineProps {
  sourceDuration: number;
  editedDuration: number;
  retainedRanges: TimeRange[];
  deletedRanges: TimeRange[];
  currentSourceTime: number;
  onSeekSourceTime: (sourceTime: number) => void;
}

export function MiniTimeline({
  sourceDuration,
  editedDuration,
  retainedRanges,
  deletedRanges,
  currentSourceTime,
  onSeekSourceTime,
}: MiniTimelineProps) {
  const safeDuration = Math.max(0.01, sourceDuration);
  const removedDuration = Math.max(0, sourceDuration - editedDuration);
  const playheadPct = Math.max(0, Math.min(100, (currentSourceTime / safeDuration) * 100));

  const handleTrackClick = (e: MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeekSourceTime(ratio * safeDuration);
  };

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-4 text-xs text-[#596370]">
        <span className="font-medium text-[#14181F]">Cut map</span>
        <div className="flex items-center gap-2 font-mono tabular-nums text-[12px]">
          <span>Original {formatTimestamp(sourceDuration)}</span>
          <span aria-hidden="true" className="text-[#CBD2DA]">
            ·
          </span>
          <span className="font-medium text-[#0E746B]">
            Edited {formatTimestamp(editedDuration)}
          </span>
          {deletedRanges.length > 0 && (
            <>
              <span aria-hidden="true" className="text-[#CBD2DA]">
                ·
              </span>
              <span className="text-[#B91C1C]">
                −{formatDurationCompact(removedDuration)} ({deletedRanges.length}{' '}
                {deletedRanges.length === 1 ? 'cut' : 'cuts'})
              </span>
            </>
          )}
        </div>
      </div>

      <div
        role="slider"
        tabIndex={0}
        aria-label="Timeline cut map"
        aria-valuemin={0}
        aria-valuemax={Number(sourceDuration.toFixed(1))}
        aria-valuenow={Number(currentSourceTime.toFixed(1))}
        onClick={handleTrackClick}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') {
            e.preventDefault();
            onSeekSourceTime(Math.min(safeDuration, currentSourceTime + 1));
          } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            onSeekSourceTime(Math.max(0, currentSourceTime - 1));
          }
        }}
        className="relative h-8 w-full cursor-pointer overflow-hidden rounded-lg border border-[#14181F]/10 bg-[#ECEAE5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E746B]"
      >
        {/* Retained footage blocks */}
        {retainedRanges.map((seg, i) => {
          const left = (seg.start / safeDuration) * 100;
          const width = ((seg.end - seg.start) / safeDuration) * 100;
          return (
            <div
              key={`ret-${i}-${seg.start}`}
              style={{ left: `${left}%`, width: `${width}%` }}
              title={`Retained ${formatTimestamp(seg.start)} – ${formatTimestamp(seg.end)}`}
              className="absolute inset-y-1 rounded-[3px] bg-[#0E746B]/22 transition-colors hover:bg-[#0E746B]/32"
            />
          );
        })}

        {/* Deleted cut ranges */}
        {deletedRanges.map((cut, i) => {
          const left = (cut.start / safeDuration) * 100;
          const width = Math.max(0.45, ((cut.end - cut.start) / safeDuration) * 100);
          return (
            <div
              key={`cut-${i}-${cut.start}`}
              style={{ left: `${left}%`, width: `${width}%` }}
              title={`Cut ${formatTimestamp(cut.start)} – ${formatTimestamp(cut.end)} (${formatDurationCompact(cut.end - cut.start)})`}
              className="cut-hatch absolute inset-y-0 border-x border-red-600/50"
            />
          );
        })}

        {/* Playhead */}
        <div
          style={{ left: `${playheadPct}%` }}
          className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-[#14181F]"
        />
      </div>

      <div className="flex items-center justify-between text-[11px] text-[#6B7280]">
        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-3 rounded-[2px] bg-[#0E746B]/25"
              aria-hidden="true"
            />
            Kept footage
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="cut-hatch inline-block h-2.5 w-3 rounded-[2px] border border-red-600/45"
              aria-hidden="true"
            />
            Cut from video
          </span>
        </div>
        <span className="font-mono tabular-nums">Source {formatTimestamp(currentSourceTime)}</span>
      </div>
    </div>
  );
}

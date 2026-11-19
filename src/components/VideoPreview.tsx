import { useEffect, useState, type RefObject } from 'react';
import { Loader2, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { formatTimestamp } from '../lib/formatTime.ts';

interface VideoPreviewProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  videoSrc: string;
  viewMode: 'edited' | 'original';
  hasOutputChanges: boolean;
  voiceEnhanced: boolean;
  isRendering: boolean;
  allMediaDeleted: boolean;
  displayDuration: number;
  currentTime: number;
  isPlaying: boolean;
  onChangeViewMode: (mode: 'edited' | 'original') => void;
  onTogglePlay: () => void;
  onScrub: (time: number) => void;
  onTimeUpdate: (time: number) => void;
  onPlayStateChange: (playing: boolean) => void;
  onLoadedMetadata?: (duration: number) => void;
}

const SPEEDS = [1, 1.25, 1.5];

export function VideoPreview({
  videoRef,
  videoSrc,
  viewMode,
  hasOutputChanges,
  voiceEnhanced,
  isRendering,
  allMediaDeleted,
  displayDuration,
  currentTime,
  isPlaying,
  onChangeViewMode,
  onTogglePlay,
  onScrub,
  onTimeUpdate,
  onPlayStateChange,
  onLoadedMetadata,
}: VideoPreviewProps) {
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.volume = volume;
    el.muted = muted;
  }, [volume, muted, videoRef]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.playbackRate = playbackRate;
  }, [playbackRate, videoRef, videoSrc]);

  const safeDuration = Math.max(0.01, displayDuration);
  const progressPct = Math.max(0, Math.min(100, (currentTime / safeDuration) * 100));

  const cycleSpeed = () => {
    const idx = SPEEDS.indexOf(playbackRate);
    const next = SPEEDS[(idx + 1) % SPEEDS.length];
    setPlaybackRate(next);
  };

  return (
    <div className="surface-glass flex flex-col overflow-hidden rounded-2xl border border-[#14181F]/10 shadow-[0_14px_40px_-24px_rgba(20,24,31,0.16)]">
      {/* Preview mode switcher header */}
      <div className="flex items-center justify-between gap-4 border-b border-[#14181F]/8 px-4 py-2.5">
        <div
          role="tablist"
          aria-label="Video preview source"
          className="inline-flex items-center gap-1 rounded-lg bg-[#14181F]/[0.05] p-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'edited'}
            onClick={() => onChangeViewMode('edited')}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              viewMode === 'edited'
                ? 'bg-white text-[#14181F] shadow-xs'
                : 'text-[#596370] hover:text-[#14181F]'
            }`}
          >
            {hasOutputChanges ? 'Output preview' : 'Preview'}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'original'}
            onClick={() => onChangeViewMode('original')}
            disabled={!hasOutputChanges}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 ${
              viewMode === 'original'
                ? 'bg-white text-[#14181F] shadow-xs'
                : 'text-[#596370] hover:text-[#14181F]'
            }`}
          >
            Original source
          </button>
        </div>

        <div className="text-xs text-[#596370] whitespace-nowrap shrink-0">
          {isRendering ? (
            <span className="inline-flex items-center gap-1.5 text-[#0E746B]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              {voiceEnhanced ? 'Synthesizing voice…' : 'Updating preview…'}
            </span>
          ) : viewMode === 'edited' && voiceEnhanced ? (
            <span className="text-[#0E746B]">Soothing voice active</span>
          ) : viewMode === 'edited' && hasOutputChanges ? (
            <span className="text-[#0E746B]">Synced to cuts</span>
          ) : (
            <span>Unedited original</span>
          )}
        </div>
      </div>

      {/* Cinema dark frame strictly for the video viewport */}
      <div className="relative aspect-video w-full bg-[#0F131A]">
        {allMediaDeleted && viewMode === 'edited' ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-sm font-medium text-[#F5F5F4]">All footage has been cut</p>
            <p className="max-w-sm text-xs text-[#A1A1AA]">
              Use Undo or restore a cut in the transcript to keep playable footage in your video.
            </p>
          </div>
        ) : (
          <video
            ref={videoRef}
            src={videoSrc}
            playsInline
            preload="auto"
            onClick={onTogglePlay}
            onTimeUpdate={(e) => onTimeUpdate(e.currentTarget.currentTime)}
            onPlay={() => onPlayStateChange(true)}
            onPause={() => onPlayStateChange(false)}
            onEnded={() => onPlayStateChange(false)}
            onLoadedMetadata={(e) => {
              const d = e.currentTarget.duration;
              if (Number.isFinite(d) && d > 0 && onLoadedMetadata) {
                onLoadedMetadata(d);
              }
            }}
            className="h-full w-full cursor-pointer object-contain"
          />
        )}

        {isRendering && viewMode === 'edited' && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0F131A]/60 backdrop-blur-[2px]">
            <div className="flex items-center gap-2.5 rounded-xl border border-white/15 bg-white/95 px-4 py-2.5 text-sm font-medium text-[#14181F] shadow-sm">
              <Loader2 className="h-4 w-4 animate-spin text-[#0E746B]" aria-hidden="true" />
              <span>
                {voiceEnhanced
                  ? 'Synthesizing soothing female voice…'
                  : 'Cutting video and audio…'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Transport controls */}
      <div className="space-y-2.5 border-t border-[#14181F]/8 bg-white/65 px-4 py-3">
        <div className="relative flex items-center">
          <input
            type="range"
            aria-label="Seek video playback"
            min={0}
            max={safeDuration}
            step={0.05}
            value={Math.min(currentTime, safeDuration)}
            disabled={allMediaDeleted && viewMode === 'edited'}
            onChange={(e) => onScrub(Number(e.target.value))}
            style={{
              background: `linear-gradient(to right, #0E746B ${progressPct}%, rgba(20,24,31,0.12) ${progressPct}%)`,
            }}
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full accent-[#0E746B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E746B]"
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onTogglePlay}
              disabled={(allMediaDeleted && viewMode === 'edited') || isRendering}
              aria-label={isPlaying ? 'Pause video' : 'Play video'}
              className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#14181F] text-[#FAF8F4] transition-colors hover:bg-[#262D38] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E746B] disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
            >
              {isPlaying ? (
                <Pause className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Play className="h-4 w-4 translate-x-[1px]" aria-hidden="true" />
              )}
            </button>

            <div className="font-mono text-xs tabular-nums text-[#596370]">
              <span className="font-medium text-[#14181F]">{formatTimestamp(currentTime)}</span>
              <span className="mx-1.5 text-[#CBD2DA]">/</span>
              <span>{formatTimestamp(displayDuration)}</span>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={cycleSpeed}
              title="Change playback speed"
              className="rounded-md border border-[#14181F]/12 bg-white/70 px-2.5 py-1.5 font-mono text-xs tabular-nums text-[#27313D] transition-colors hover:bg-white cursor-pointer whitespace-nowrap shrink-0"
            >
              {playbackRate}×
            </button>

            <button
              type="button"
              onClick={() => setMuted((m) => !m)}
              aria-label={muted || volume === 0 ? 'Unmute audio' : 'Mute audio'}
              className="flex h-9 w-9 items-center justify-center rounded-md text-[#596370] transition-colors hover:bg-[#14181F]/[0.06] hover:text-[#14181F] cursor-pointer"
            >
              {muted || volume === 0 ? (
                <VolumeX className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Volume2 className="h-4 w-4" aria-hidden="true" />
              )}
            </button>

            <input
              type="range"
              aria-label="Volume"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(e) => {
                const v = Number(e.target.value);
                setVolume(v);
                if (v > 0 && muted) setMuted(false);
              }}
              className="hidden h-1 w-20 cursor-pointer appearance-none rounded-full bg-[#14181F]/15 accent-[#0E746B] sm:block"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

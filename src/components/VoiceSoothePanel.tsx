import { AudioWaveform, Loader2 } from 'lucide-react';
import type {
  VoiceEnhancementConfig,
  VoiceEnhancementPreset,
} from '../lib/transcriptTypes.ts';

interface VoiceSoothePanelProps {
  config: VoiceEnhancementConfig;
  isRendering: boolean;
  disabled: boolean;
  onChange: (next: VoiceEnhancementConfig) => void;
}

const PRESET_OPTIONS: Array<{
  id: VoiceEnhancementPreset;
  label: string;
  detail: string;
}> = [
  {
    id: 'calm_mild',
    label: 'Young & Calm',
    detail: 'Mild pitch, warm and gentle female voice',
  },
  {
    id: 'soft_studio',
    label: 'Serene & Soft',
    detail: 'Airy, mellow, tranquil storytelling voice',
  },
  {
    id: 'warm_clear',
    label: 'Warm & Clear',
    detail: 'Poised, mild-pitched documentary voice',
  },
];

export function VoiceSoothePanel({
  config,
  isRendering,
  disabled,
  onChange,
}: VoiceSoothePanelProps) {
  const activePreset =
    PRESET_OPTIONS.find((p) => p.id === config.preset) ?? PRESET_OPTIONS[0];

  return (
    <div className="surface-glass rounded-2xl border border-[#14181F]/10 p-4 shadow-[0_14px_40px_-24px_rgba(20,24,31,0.14)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs">
          <AudioWaveform
            className={`h-4 w-4 shrink-0 ${
              config.enabled ? 'text-[#0E746B]' : 'text-[#596370]'
            }`}
            aria-hidden="true"
          />
          <span className="font-medium text-[#14181F]">Output voice</span>
        </div>

        <div
          role="radiogroup"
          aria-label="Output voice mode"
          className="inline-flex items-center gap-1 rounded-lg bg-[#14181F]/[0.05] p-1"
        >
          <button
            type="button"
            role="radio"
            aria-checked={!config.enabled}
            disabled={disabled}
            onClick={() => onChange({ ...config, enabled: false })}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40 ${
              !config.enabled
                ? 'bg-white text-[#14181F] shadow-xs'
                : 'text-[#596370] hover:text-[#14181F]'
            }`}
          >
            Original voice
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={config.enabled}
            disabled={disabled}
            onClick={() => onChange({ ...config, enabled: true })}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40 ${
              config.enabled
                ? 'bg-[#0E746B] text-[#FAF8F4] shadow-xs'
                : 'text-[#596370] hover:text-[#14181F]'
            }`}
          >
            Soothing female
          </button>
        </div>
      </div>

      {config.enabled ? (
        <div className="mt-3.5 space-y-3 border-t border-[#14181F]/8 pt-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#596370]">
            <span>{activePreset.detail} · Applied to preview &amp; MP4</span>
            {isRendering && (
              <span className="inline-flex items-center gap-1.5 font-medium text-[#0E746B] whitespace-nowrap">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Synthesizing voice…
              </span>
            )}
          </div>

          <div
            role="radiogroup"
            aria-label="Soothing female voice tone"
            className="grid grid-cols-3 gap-1.5"
          >
            {PRESET_OPTIONS.map((option) => {
              const selected = config.preset === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={disabled || isRendering}
                  onClick={() => onChange({ enabled: true, preset: option.id })}
                  className={`rounded-lg border px-2.5 py-2 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${
                    selected
                      ? 'border-[#0E746B]/45 bg-[#0E746B]/10 text-[#0B3B37]'
                      : 'border-[#14181F]/10 bg-white/60 text-[#596370] hover:bg-white hover:text-[#14181F]'
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <p className="mt-2.5 text-xs text-[#6B7280]">
          Switch to <span className="font-medium text-[#14181F]">Soothing female</span> to replace
          the final output narration with a young, calm, mild-pitch female human voice.
        </p>
      )}
    </div>
  );
}

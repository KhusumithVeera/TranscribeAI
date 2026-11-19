import { AlertCircle, CheckCircle2, Info, Loader2, X } from 'lucide-react';

export interface StatusNoticeProps {
  tone: 'loading' | 'success' | 'warning' | 'error' | 'info';
  title?: string;
  message: string;
  onDismiss?: () => void;
  actionLabel?: string;
  onAction?: () => void;
}

export function ProcessingStatus({
  tone,
  title,
  message,
  onDismiss,
  actionLabel,
  onAction,
}: StatusNoticeProps) {
  const styles: Record<StatusNoticeProps['tone'], string> = {
    loading: 'bg-white/85 border-[#0E746B]/25 text-[#14181F]',
    success: 'bg-[#EEF7F5]/95 border-[#0E746B]/30 text-[#0F3F3B]',
    warning: 'bg-[#FDF6EA]/95 border-amber-500/35 text-[#66410C]',
    error: 'bg-[#FEF2F2]/95 border-red-400/40 text-[#7F1D1D]',
    info: 'bg-white/85 border-[#14181F]/12 text-[#27313D]',
  };

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex items-start justify-between gap-4 rounded-xl border px-4 py-3 text-sm backdrop-blur-md ${styles[tone]}`}
    >
      <div className="flex items-start gap-3 min-w-0">
        <span className="mt-0.5 shrink-0" aria-hidden="true">
          {tone === 'loading' && <Loader2 className="h-4 w-4 animate-spin text-[#0E746B]" />}
          {tone === 'success' && <CheckCircle2 className="h-4 w-4 text-[#0E746B]" />}
          {tone === 'warning' && <AlertCircle className="h-4 w-4 text-amber-600" />}
          {tone === 'error' && <AlertCircle className="h-4 w-4 text-red-600" />}
          {tone === 'info' && <Info className="h-4 w-4 text-[#0E746B]" />}
        </span>
        <div className="min-w-0 space-y-0.5">
          {title && <p className="font-medium leading-snug">{title}</p>}
          <p className="text-[13px] leading-relaxed opacity-85">{message}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {actionLabel && onAction && (
          <button
            type="button"
            onClick={onAction}
            className="rounded-lg border border-current/25 px-3 py-1 text-xs font-medium hover:bg-black/5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {actionLabel}
          </button>
        )}
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss notification"
            className="rounded-md p-1 opacity-60 hover:opacity-100 hover:bg-black/5 transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

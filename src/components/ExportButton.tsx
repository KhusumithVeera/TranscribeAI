import { Download, Loader2 } from 'lucide-react';

interface ExportButtonProps {
  disabled: boolean;
  disabledReason?: string;
  isExporting: boolean;
  isRendering: boolean;
  onExport: () => void;
}

export function ExportButton({
  disabled,
  disabledReason,
  isExporting,
  isRendering,
  onExport,
}: ExportButtonProps) {
  const busy = isExporting || isRendering;

  return (
    <button
      type="button"
      onClick={onExport}
      disabled={disabled || busy}
      title={disabled ? disabledReason : 'Render and download edited MP4'}
      className="inline-flex items-center gap-2 rounded-lg bg-[#14181F] px-4 py-2 text-sm font-medium text-[#FAF8F4] transition-colors hover:bg-[#262D38] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E746B] focus-visible:ring-offset-2 focus-visible:ring-offset-[#F7F4EF] disabled:cursor-not-allowed disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
    >
      {busy ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          <span>{isExporting ? 'Exporting MP4…' : 'Rendering cut…'}</span>
        </>
      ) : (
        <>
          <Download className="h-4 w-4" aria-hidden="true" />
          <span>Export MP4</span>
        </>
      )}
    </button>
  );
}

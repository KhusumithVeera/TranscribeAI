import { useState } from 'react';
import { Film } from 'lucide-react';

interface EditorialPhotoProps {
  src: string;
  alt: string;
  fallbackLabel: string;
  className?: string;
  imgClassName?: string;
}

export function EditorialPhoto({
  src,
  alt,
  fallbackLabel,
  className = '',
  imgClassName = '',
}: EditorialPhotoProps) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-[#EDE6DD] via-[#E6ECEB] to-[#E5E3EE] text-[#596370] ${className}`}
      >
        <Film className="h-5 w-5 opacity-60" aria-hidden="true" />
        <span className="text-xs font-medium tracking-wide">{fallbackLabel}</span>
      </div>
    );
  }

  return (
    <div className={`overflow-hidden bg-[#EAE5DD] ${className}`}>
      <img
        src={src}
        alt={alt}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={`h-full w-full object-cover ${imgClassName}`}
      />
    </div>
  );
}

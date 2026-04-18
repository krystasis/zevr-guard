import { useState } from 'react';

export interface FlagProps {
  code: string | null;
  size?: number;
  className?: string;
}

function flagUrl(code: string): string {
  try {
    return chrome.runtime.getURL(`assets/flags/${code.toLowerCase()}.svg`);
  } catch {
    return '';
  }
}

export const Flag: React.FC<FlagProps> = ({ code, size = 14, className = '' }) => {
  const [failed, setFailed] = useState(false);

  if (!code || failed) {
    return (
      <span
        className={`inline-flex items-center justify-center rounded-sm bg-gray-800/60 border border-gray-700/50 text-gray-500 font-mono text-[8px] font-bold ${className}`}
        style={{ width: size + 4, height: size - 2, lineHeight: 1 }}
      >
        {code?.toUpperCase() ?? '—'}
      </span>
    );
  }

  const url = flagUrl(code);
  if (!url) {
    return (
      <span
        className={`inline-flex items-center justify-center rounded-sm bg-gray-800/60 border border-gray-700/50 text-gray-500 font-mono text-[8px] font-bold ${className}`}
        style={{ width: size + 4, height: size - 2, lineHeight: 1 }}
      >
        {code.toUpperCase()}
      </span>
    );
  }

  return (
    <img
      src={url}
      width={size + 4}
      height={size + 4}
      alt={code.toUpperCase()}
      className={`inline-block flex-shrink-0 ${className}`}
      style={{ objectFit: 'contain' }}
      onError={() => setFailed(true)}
    />
  );
};

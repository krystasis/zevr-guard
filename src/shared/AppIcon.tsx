import { useState } from 'react';

interface AppIconProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
  alt?: string;
}

function assetUrl(path: string): string {
  try {
    return chrome.runtime.getURL(path);
  } catch {
    return `/${path}`;
  }
}

function pickAppAsset(size: number): string {
  if (size <= 16) return 'public/icons/icon16.png';
  if (size <= 32) return 'public/icons/icon32.png';
  if (size <= 48) return 'public/icons/icon48.png';
  return 'public/icons/icon128.png';
}

export const AppIcon: React.FC<AppIconProps> = ({
  size = 24,
  className = '',
  style,
  alt = 'Zevr Guard',
}) => {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <span className={className}>🛡️</span>;
  }
  return (
    <img
      src={assetUrl(pickAppAsset(size))}
      width={size}
      height={size}
      alt={alt}
      draggable={false}
      className={`inline-block flex-shrink-0 ${className}`}
      style={style}
      onError={() => setFailed(true)}
    />
  );
};

function pickBrandAsset(size: number): string {
  if (size <= 16) return 'public/brand/zevr16.png';
  if (size <= 32) return 'public/brand/zevr32.png';
  if (size <= 48) return 'public/brand/zevr48.png';
  return 'public/brand/zevr128.png';
}

export const BrandMark: React.FC<AppIconProps> = ({
  size = 24,
  className = '',
  style,
  alt = 'Zevr',
}) => {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return null;
  }
  return (
    <img
      src={assetUrl(pickBrandAsset(size))}
      width={size}
      height={size}
      alt={alt}
      draggable={false}
      className={`inline-block flex-shrink-0 ${className}`}
      style={style}
      onError={() => setFailed(true)}
    />
  );
};

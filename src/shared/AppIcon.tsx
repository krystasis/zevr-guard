import { useState } from 'react';
// Imported so Vite copies them into the bundle: publicDir is disabled and
// only manifest-referenced files under public/ reach the package otherwise.
import zevr16Url from '../../public/brand/zevr16.png?url';
import zevr32Url from '../../public/brand/zevr32.png?url';
import zevr48Url from '../../public/brand/zevr48.png?url';
import zevr128Url from '../../public/brand/zevr128.png?url';

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
  if (size <= 16) return zevr16Url;
  if (size <= 32) return zevr32Url;
  if (size <= 48) return zevr48Url;
  return zevr128Url;
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
      src={pickBrandAsset(size)}
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

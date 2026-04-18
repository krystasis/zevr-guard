import { useEffect, useRef } from 'react';
import { WorldMap } from './WorldMap';
import landUrl from '../../../assets/ne_110m_land.geojson?url';

export interface WorldMapCanvasProps {
  className?: string;
  style?: React.CSSProperties;
  onReady?: (map: WorldMap) => void;
  onDispose?: () => void;
}

export const WorldMapCanvas: React.FC<WorldMapCanvasProps> = ({
  className,
  style,
  onReady,
  onDispose,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const onReadyRef = useRef(onReady);
  const onDisposeRef = useRef(onDispose);
  onReadyRef.current = onReady;
  onDisposeRef.current = onDispose;

  useEffect(() => {
    if (!ref.current) return;
    const map = new WorldMap(ref.current, { landUrl });
    map.start();
    onReadyRef.current?.(map);
    return () => {
      onDisposeRef.current?.();
      map.dispose();
    };
  }, []);

  return <div ref={ref} className={className} style={style} />;
};

export { WorldMap } from './WorldMap';
export type { WorldMapArcInput } from './WorldMap';

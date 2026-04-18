import { useEffect, useRef } from 'react';
import { GlobeScene, type GlobeArcInput, type GlobeOptions } from './GlobeScene';
import landUrl from '../../../assets/ne_110m_land.geojson?url';

export interface GlobeCanvasProps {
  className?: string;
  style?: React.CSSProperties;
  autoRotateSpeed?: number;
  showStars?: boolean;
  onReady?: (scene: GlobeScene) => void;
  onDispose?: () => void;
}

export const GlobeCanvas: React.FC<GlobeCanvasProps> = ({
  className,
  style,
  autoRotateSpeed,
  showStars,
  onReady,
  onDispose,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<GlobeScene | null>(null);
  const onReadyRef = useRef(onReady);
  const onDisposeRef = useRef(onDispose);
  onReadyRef.current = onReady;
  onDisposeRef.current = onDispose;

  useEffect(() => {
    if (!ref.current) return;
    const options: GlobeOptions = {
      landUrl,
      autoRotateSpeed,
      background: showStars,
    };
    const scene = new GlobeScene(ref.current, options);
    sceneRef.current = scene;
    scene.start();
    onReadyRef.current?.(scene);
    return () => {
      onDisposeRef.current?.();
      scene.dispose();
      sceneRef.current = null;
    };
  }, [autoRotateSpeed, showStars]);

  return <div ref={ref} className={className} style={style} />;
};

export type { GlobeArcInput, GlobeScene };

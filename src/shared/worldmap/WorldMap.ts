import type { RiskLevel } from '../../types';

export interface WorldMapArcInput {
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  risk: RiskLevel;
  label?: string;
}

interface LiveArc {
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
  color: string;
  bornAt: number;
}

interface PersistentArc {
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
  color: string;
}

interface Pointer {
  lat: number;
  lng: number;
  color: string;
}

const RISK_COLOR: Record<RiskLevel, string> = {
  safe: '#22c55e',
  tracker: '#38bdf8',
  suspicious: '#facc15',
  dangerous: '#ef4444',
};

const ARC_LIFETIME = 3800;
const ARC_STEPS = 40;

interface LandPolygon {
  ring: number[][];
}

export class WorldMap {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private landCanvas: HTMLCanvasElement | null = null;
  private landRings: LandPolygon[] = [];
  private arcs: LiveArc[] = [];
  private persistentArcs: Map<string, PersistentArc> = new Map();
  private pointers: Map<string, Pointer> = new Map();
  private sourceLat: number | null = null;
  private sourceLng: number | null = null;
  private sourceLabel = 'YOU';
  private highlightKey: string | null = null;
  private highlightLabel: string | null = null;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private landUrl: string;
  private running = false;
  private rafId = 0;
  private resizeObserver: ResizeObserver | null = null;
  private needsLandRedraw = false;

  constructor(container: HTMLElement, options: { landUrl: string }) {
    this.container = container;
    this.landUrl = options.landUrl;

    this.canvas = document.createElement('canvas');
    this.canvas.style.display = 'block';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    container.appendChild(this.canvas);

    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D not supported');
    this.ctx = ctx;

    this.resize();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);

    void this.loadLand();
  }

  private resize(): void {
    const rect = this.container.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.dpr = Math.min(window.devicePixelRatio, 2);
    this.canvas.width = this.width * this.dpr;
    this.canvas.height = this.height * this.dpr;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.needsLandRedraw = true;
  }

  private project(lat: number, lng: number): [number, number] {
    return [
      ((lng + 180) / 360) * this.width,
      ((90 - lat) / 180) * this.height,
    ];
  }

  private arcControl(fx: number, fy: number, tx: number, ty: number): [number, number] {
    const dist = Math.hypot(tx - fx, ty - fy);
    const midX = (fx + tx) / 2;
    const midY = (fy + ty) / 2 - Math.min(120, 40 + dist * 0.25);
    return [midX, midY];
  }

  private async loadLand(): Promise<void> {
    try {
      const res = await fetch(this.landUrl);
      const data = (await res.json()) as {
        features: Array<{
          geometry:
            | { type: 'Polygon'; coordinates: number[][][] }
            | { type: 'MultiPolygon'; coordinates: number[][][][] };
        }>;
      };
      const rings: LandPolygon[] = [];
      for (const f of data.features) {
        const g = f.geometry;
        if (g.type === 'Polygon') {
          for (const ring of g.coordinates) rings.push({ ring });
        } else {
          for (const poly of g.coordinates) {
            for (const ring of poly) rings.push({ ring });
          }
        }
      }
      this.landRings = rings;
      this.needsLandRedraw = true;
    } catch (err) {
      console.warn('[Zevr Guard] Failed to load world map:', err);
    }
  }

  private renderLandCanvas(): void {
    if (this.landRings.length === 0) return;
    const canvas = document.createElement('canvas');
    canvas.width = this.width * this.dpr;
    canvas.height = this.height * this.dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(this.dpr, this.dpr);

    ctx.fillStyle = 'rgba(30, 80, 120, 0.28)';
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 0.7;

    for (const { ring } of this.landRings) {
      if (ring.length < 2) continue;
      ctx.beginPath();
      for (let i = 0; i < ring.length; i++) {
        const [lng, lat] = ring[i];
        const [x, y] = this.project(lat, lng);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    this.landCanvas = canvas;
    this.needsLandRedraw = false;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.animate();
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private animate = (): void => {
    if (!this.running) return;
    if (this.needsLandRedraw && this.landRings.length) this.renderLandCanvas();
    this.draw();
    this.rafId = requestAnimationFrame(this.animate);
  };

  private draw(): void {
    const { ctx, width, height } = this;
    ctx.clearRect(0, 0, width, height);

    const bg = ctx.createRadialGradient(
      width / 2,
      height / 2,
      0,
      width / 2,
      height / 2,
      Math.max(width, height) / 1.2,
    );
    bg.addColorStop(0, '#0a1a28');
    bg.addColorStop(1, '#02060c');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = 'rgba(56, 189, 248, 0.06)';
    ctx.lineWidth = 0.5;
    for (let lat = -60; lat <= 60; lat += 30) {
      const y = ((90 - lat) / 180) * height;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    for (let lng = -150; lng <= 150; lng += 30) {
      const x = ((lng + 180) / 360) * width;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    if (this.landCanvas) {
      ctx.drawImage(this.landCanvas, 0, 0, width, height);
    }

    this.drawPersistentArcs();

    const now = performance.now();
    for (let i = this.arcs.length - 1; i >= 0; i--) {
      const arc = this.arcs[i];
      const age = now - arc.bornAt;
      const t = age / ARC_LIFETIME;
      if (t >= 1) {
        this.persistArc(arc);
        this.arcs.splice(i, 1);
        continue;
      }
      this.drawLiveArc(arc, t);
    }

    this.drawPointers(now);
    this.drawSource(now);
  }

  private arcKey(fromLat: number, fromLng: number, toLat: number, toLng: number): string {
    return `${fromLat.toFixed(2)}_${fromLng.toFixed(2)}_${toLat.toFixed(2)}_${toLng.toFixed(2)}`;
  }

  private drawPersistentArcs(): void {
    if (this.persistentArcs.size === 0) return;
    const { ctx } = this;
    const hasHighlight = this.highlightKey !== null;
    ctx.save();
    ctx.lineCap = 'round';
    for (const [key, arc] of this.persistentArcs) {
      const [fx, fy] = this.project(arc.fromLat, arc.fromLng);
      const [tx, ty] = this.project(arc.toLat, arc.toLng);
      const [cx, cy] = this.arcControl(fx, fy, tx, ty);
      const isHi = hasHighlight && key === this.highlightKey;
      const isDim = hasHighlight && !isHi;
      ctx.globalAlpha = isHi ? 1 : isDim ? 0.05 : 0.2;
      ctx.lineWidth = isHi ? 2.4 : 0.9;
      ctx.shadowBlur = isHi ? 16 : 4;
      ctx.strokeStyle = arc.color;
      ctx.shadowColor = arc.color;
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.quadraticCurveTo(cx, cy, tx, ty);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawLiveArc(arc: LiveArc, t: number): void {
    const { ctx } = this;
    const [fx, fy] = this.project(arc.fromLat, arc.fromLng);
    const [tx, ty] = this.project(arc.toLat, arc.toLng);
    const [cx, cy] = this.arcControl(fx, fy, tx, ty);

    const drawT = Math.min(1, t * 1.8);
    const lineFade =
      t < 0.6 ? 0.55 + drawT * 0.45 : 0.55 + (1 - (t - 0.6) / 0.4) * 0.45;

    const key = this.arcKey(arc.fromLat, arc.fromLng, arc.toLat, arc.toLng);
    const hasHighlight = this.highlightKey !== null;
    const isDim = hasHighlight && key !== this.highlightKey;
    const dimFactor = isDim ? 0.1 : 1;

    ctx.save();
    ctx.strokeStyle = arc.color;
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    ctx.shadowBlur = 12;
    ctx.shadowColor = arc.color;
    ctx.globalAlpha = Math.max(0, lineFade) * dimFactor;

    ctx.beginPath();
    ctx.moveTo(fx, fy);
    const maxStep = Math.max(1, Math.floor(ARC_STEPS * drawT));
    for (let s = 1; s <= maxStep; s++) {
      const u = s / ARC_STEPS;
      const mt = 1 - u;
      const x = mt * mt * fx + 2 * mt * u * cx + u * u * tx;
      const y = mt * mt * fy + 2 * mt * u * cy + u * u * ty;
      ctx.lineTo(x, y);
    }
    ctx.stroke();

    const u = drawT;
    const mt = 1 - u;
    const hx = mt * mt * fx + 2 * mt * u * cx + u * u * tx;
    const hy = mt * mt * fy + 2 * mt * u * cy + u * u * ty;
    const headOpacity = t < 0.6 ? 1 : Math.max(0, 1 - (t - 0.6) / 0.4);
    ctx.globalAlpha = headOpacity * dimFactor;
    ctx.fillStyle = arc.color;
    ctx.beginPath();
    ctx.arc(hx, hy, 2.8, 0, Math.PI * 2);
    ctx.fill();

    if (t > 0.46) {
      const ringT = (t - 0.46) / 0.54;
      ctx.globalAlpha = Math.max(0, 0.9 - ringT) * dimFactor;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(tx, ty, 3 + ringT * 16, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawPointers(now: number): void {
    if (this.pointers.size === 0) return;
    const { ctx } = this;
    const pulse = 0.8 + Math.sin(now * 0.005) * 0.4;
    const hasHighlight = this.highlightKey !== null;
    let highlightDest: { x: number; y: number; color: string } | null = null;
    ctx.save();
    ctx.shadowBlur = 8;
    for (const p of this.pointers.values()) {
      const [x, y] = this.project(p.lat, p.lng);
      const isHi =
        hasHighlight &&
        this.highlightKey ===
          this.arcKey(
            this.sourceLat ?? 0,
            this.sourceLng ?? 0,
            p.lat,
            p.lng,
          );
      const isDim = hasHighlight && !isHi;
      if (isHi) highlightDest = { x, y, color: p.color };
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.globalAlpha = isDim ? 0.12 : 0.95;
      ctx.beginPath();
      ctx.arc(x, y, (isHi ? 3.2 : 2.2) * pulse, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    if (highlightDest) {
      this.drawHighlightMarker(highlightDest.x, highlightDest.y, highlightDest.color, now);
      if (this.highlightLabel) {
        this.drawLabel(highlightDest.x, highlightDest.y, this.highlightLabel, highlightDest.color);
      }
    }
  }

  private drawHighlightMarker(x: number, y: number, color: string, now: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.shadowBlur = 10;
    ctx.shadowColor = color;
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 2; i++) {
      const phase = ((now / 900 + i / 2) % 1);
      const radius = 4 + phase * 20;
      ctx.globalAlpha = (1 - phase) * 0.85;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawLabel(x: number, y: number, text: string, color: string): void {
    const { ctx } = this;
    ctx.save();
    ctx.font = 'bold 10px ui-sans-serif, system-ui, -apple-system, "Segoe UI"';
    const metrics = ctx.measureText(text);
    const padX = 6;
    const boxW = metrics.width + padX * 2;
    const boxH = 14;
    const gap = 10;
    let boxX = x - boxW / 2;
    let boxY = y - boxH - gap;
    if (boxY < 2) boxY = y + gap;
    if (boxX < 2) boxX = 2;
    if (boxX + boxW > this.width - 2) boxX = this.width - 2 - boxW;
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(2, 6, 12, 0.92)';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    this.roundRect(ctx, boxX, boxY, boxW, boxH, 3);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, boxX + boxW / 2, boxY + boxH / 2 + 0.5);
    ctx.restore();
  }

  private drawSource(now: number): void {
    if (this.sourceLat == null || this.sourceLng == null) return;
    const { ctx } = this;
    const [sx, sy] = this.project(this.sourceLat, this.sourceLng);

    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#7dd3fc';
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 3; i++) {
      const phase = ((now / 1400 + i / 3) % 1);
      const radius = 5 + phase * 28;
      const alpha = (1 - phase) * 0.55;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(sx, sy, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.shadowBlur = 14;
    ctx.shadowColor = '#ffffff';
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(sx, sy, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.strokeStyle = 'rgba(125, 211, 252, 0.9)';
    ctx.lineWidth = 1;
    const text = this.sourceLabel;
    ctx.font = 'bold 9px ui-sans-serif, system-ui, -apple-system, "Segoe UI"';
    const metrics = ctx.measureText(text);
    const padX = 5;
    const boxW = metrics.width + padX * 2;
    const boxH = 12;
    const boxX = sx - boxW / 2;
    const boxY = sy + 8;
    this.roundRect(ctx, boxX, boxY, boxW, boxH, 3);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#e0f2fe';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, sx, boxY + boxH / 2 + 0.5);
    ctx.restore();
  }

  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  private persistArc(arc: LiveArc): void {
    const key = `${arc.fromLat.toFixed(2)}_${arc.fromLng.toFixed(2)}_${arc.toLat.toFixed(2)}_${arc.toLng.toFixed(2)}`;
    if (!this.persistentArcs.has(key)) {
      this.persistentArcs.set(key, {
        fromLat: arc.fromLat,
        fromLng: arc.fromLng,
        toLat: arc.toLat,
        toLng: arc.toLng,
        color: arc.color,
      });
    }
  }

  addArc(input: WorldMapArcInput): void {
    const color = RISK_COLOR[input.risk];
    this.arcs.push({
      fromLat: input.from.lat,
      fromLng: input.from.lng,
      toLat: input.to.lat,
      toLng: input.to.lng,
      color,
      bornAt: performance.now(),
    });

    const key = `${input.to.lat.toFixed(1)}_${input.to.lng.toFixed(1)}_${input.risk}`;
    if (!this.pointers.has(key)) {
      this.pointers.set(key, { lat: input.to.lat, lng: input.to.lng, color });
    }
  }

  setSource(lat: number, lng: number, label = 'YOU'): void {
    this.sourceLat = lat;
    this.sourceLng = lng;
    this.sourceLabel = label;
  }

  setHighlight(
    fromLat: number,
    fromLng: number,
    toLat: number,
    toLng: number,
    label: string | null = null,
  ): void {
    this.highlightKey = this.arcKey(fromLat, fromLng, toLat, toLng);
    this.highlightLabel = label;
  }

  clearHighlight(): void {
    this.highlightKey = null;
    this.highlightLabel = null;
  }

  clearArcs(): void {
    this.arcs = [];
    this.persistentArcs.clear();
  }

  clearPointers(): void {
    this.pointers.clear();
  }

  dispose(): void {
    this.stop();
    this.resizeObserver?.disconnect();
    this.canvas.remove();
  }
}

import type { RiskLevel } from '../types';
import landUrl from '../../assets/ne_110m_land.geojson?url';

export interface ShareCardPoint {
  lat: number;
  lon: number;
  risk: RiskLevel;
}

export interface ShareCardLabels {
  headline: string;
  brand: string;
  tagline: string;
  statDomains: string;
  statRequests: string;
  statBlocked: string;
  scoreLabel: string;
}

export interface ShareCardData {
  host: string;
  riskScore: number;
  riskLevel: RiskLevel;
  domains: number;
  requests: number;
  blocked: number;
  points: ShareCardPoint[];
  source: { lat: number; lng: number } | null;
  labels: ShareCardLabels;
}

const W = 1200;
const H = 630;

const RISK_COLOR: Record<RiskLevel, string> = {
  safe: '#22c55e',
  tracker: '#38bdf8',
  suspicious: '#facc15',
  dangerous: '#ef4444',
};

const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

function project(lat: number, lng: number): [number, number] {
  return [((lng + 180) / 360) * W, ((90 - lat) / 180) * H];
}

async function drawLand(ctx: CanvasRenderingContext2D): Promise<void> {
  try {
    const res = await fetch(landUrl);
    const data = (await res.json()) as {
      features: Array<{
        geometry:
          | { type: 'Polygon'; coordinates: number[][][] }
          | { type: 'MultiPolygon'; coordinates: number[][][][] };
      }>;
    };
    ctx.fillStyle = 'rgba(30, 80, 120, 0.30)';
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 1;
    const rings: number[][][] = [];
    for (const f of data.features) {
      const g = f.geometry;
      if (g.type === 'Polygon') rings.push(...g.coordinates);
      else for (const poly of g.coordinates) rings.push(...poly);
    }
    for (const ring of rings) {
      if (ring.length < 2) continue;
      ctx.beginPath();
      for (let i = 0; i < ring.length; i++) {
        const [lng, lat] = ring[i];
        const [x, y] = project(lat, lng);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  } catch {
    // card still works without the map
  }
}

function drawArc(
  ctx: CanvasRenderingContext2D,
  fx: number,
  fy: number,
  tx: number,
  ty: number,
  color: string,
): void {
  const dist = Math.hypot(tx - fx, ty - fy);
  const cx = (fx + tx) / 2;
  const cy = (fy + ty) / 2 - Math.min(140, 40 + dist * 0.25);
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.beginPath();
  ctx.moveTo(fx, fy);
  ctx.quadraticCurveTo(cx, cy, tx, ty);
  ctx.stroke();
}

function roundRect(
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

export async function renderShareCard(data: ShareCardData): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D not supported');

  // Background
  const bg = ctx.createRadialGradient(W / 2, H / 3, 0, W / 2, H / 3, W / 1.1);
  bg.addColorStop(0, '#0a1a28');
  bg.addColorStop(1, '#02060c');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Graticule
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.06)';
  ctx.lineWidth = 1;
  for (let lat = -60; lat <= 60; lat += 30) {
    const y = ((90 - lat) / 180) * H;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  for (let lng = -150; lng <= 150; lng += 30) {
    const x = ((lng + 180) / 360) * W;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }

  await drawLand(ctx);

  // Arcs + destination points
  const src = data.source;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = 1.6;
  ctx.shadowBlur = 10;
  ctx.globalAlpha = 0.55;
  if (src) {
    const [sx, sy] = project(src.lat, src.lng);
    for (const p of data.points) {
      const [tx, ty] = project(p.lat, p.lon);
      drawArc(ctx, sx, sy, tx, ty, RISK_COLOR[p.risk]);
    }
  }
  ctx.restore();

  ctx.save();
  ctx.shadowBlur = 8;
  for (const p of data.points) {
    const [x, y] = project(p.lat, p.lon);
    ctx.fillStyle = RISK_COLOR[p.risk];
    ctx.shadowColor = RISK_COLOR[p.risk];
    ctx.globalAlpha = 0.95;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  if (src) {
    const [sx, sy] = project(src.lat, src.lng);
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#7dd3fc';
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.arc(sx, sy, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(sx, sy, 14, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  // Text scrim so the copy stays readable over the map
  const scrim = ctx.createLinearGradient(0, H, 0, H - 320);
  scrim.addColorStop(0, 'rgba(2, 6, 12, 0.94)');
  scrim.addColorStop(1, 'rgba(2, 6, 12, 0)');
  ctx.fillStyle = scrim;
  ctx.fillRect(0, H - 320, W, 320);

  // Brand
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#7dd3fc';
  ctx.font = `bold 26px ${FONT}`;
  ctx.fillText(`🛡 ${data.labels.brand}`, 56, 72);
  ctx.fillStyle = 'rgba(148, 163, 184, 0.85)';
  ctx.font = `500 18px ${FONT}`;
  ctx.fillText(data.labels.tagline, 56, 100);

  // Risk score badge (top right)
  const scoreColor = RISK_COLOR[data.riskLevel];
  ctx.save();
  ctx.strokeStyle = scoreColor;
  ctx.lineWidth = 4;
  ctx.shadowColor = scoreColor;
  ctx.shadowBlur = 18;
  ctx.beginPath();
  ctx.arc(W - 110, 96, 52, 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = scoreColor;
  ctx.font = `900 40px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText(String(data.riskScore), W - 110, 110);
  ctx.fillStyle = 'rgba(148, 163, 184, 0.9)';
  ctx.font = `600 13px ${FONT}`;
  ctx.fillText(data.labels.scoreLabel.toUpperCase(), W - 110, 172);
  ctx.restore();

  // Host + headline
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(226, 232, 240, 0.95)';
  ctx.font = `600 30px ${FONT}`;
  let host = data.host;
  while (host.length > 3 && ctx.measureText(host).width > W - 112) {
    host = host.slice(0, -2);
  }
  if (host !== data.host) host += '…';
  ctx.fillText(host, 56, H - 190);

  ctx.fillStyle = '#f8fafc';
  ctx.font = `900 56px ${FONT}`;
  ctx.fillText(data.labels.headline, 56, H - 120);

  // Stats chips
  const chips: Array<{ value: string; label: string; color: string }> = [
    { value: String(data.domains), label: data.labels.statDomains, color: '#7dd3fc' },
    { value: String(data.requests), label: data.labels.statRequests, color: '#e2e8f0' },
    { value: String(data.blocked), label: data.labels.statBlocked, color: '#f87171' },
  ];
  let cx0 = 56;
  for (const chip of chips) {
    ctx.font = `900 30px ${FONT}`;
    const vw = ctx.measureText(chip.value).width;
    ctx.font = `600 18px ${FONT}`;
    const lw = ctx.measureText(chip.label).width;
    const w = Math.max(vw, lw) + 44;
    ctx.fillStyle = 'rgba(8, 20, 32, 0.85)';
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
    ctx.lineWidth = 1.5;
    roundRect(ctx, cx0, H - 92, w, 64, 10);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = chip.color;
    ctx.font = `900 30px ${FONT}`;
    ctx.fillText(chip.value, cx0 + 22, H - 62);
    ctx.fillStyle = 'rgba(148, 163, 184, 0.9)';
    ctx.font = `600 15px ${FONT}`;
    ctx.fillText(chip.label, cx0 + 22, H - 40);
    cx0 += w + 16;
  }

  // Site URL bottom right
  ctx.fillStyle = 'rgba(125, 211, 252, 0.7)';
  ctx.font = `600 18px ${FONT}`;
  ctx.textAlign = 'right';
  ctx.fillText('zevrhq.com', W - 56, H - 48);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('toBlob failed'));
    }, 'image/png');
  });
}

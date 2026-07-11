import type { RiskLevel } from '../types';
import landUrl from '../../assets/ne_110m_land.geojson?url';
import countryCentroids from '../data/country_centroids.json';

const CENTROIDS = countryCentroids as unknown as Record<string, [number, number]>;

export interface ShareCardPoint {
  domain: string;
  lat: number | null;
  lon: number | null;
  country: string | null;
  risk: RiskLevel;
  count: number;
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

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

interface ResolvedPoint {
  x: number;
  y: number;
  risk: RiskLevel;
  count: number;
}

/**
 * Geo data is country-centroid based, so every domain in the same country
 * lands on the exact same pixel and all their arcs collapse into one line.
 * Fan the domains out deterministically around the centroid so each
 * connection gets its own visible arc.
 */
function resolvePoints(points: ShareCardPoint[]): ResolvedPoint[] {
  const out: ResolvedPoint[] = [];
  for (const p of points) {
    let lat = p.lat;
    let lon = p.lon;
    if ((lat == null || lon == null) && p.country) {
      const c = CENTROIDS[p.country.toUpperCase()];
      if (c) {
        lat = c[0];
        lon = c[1];
      }
    }
    if (lat == null || lon == null) continue;
    const h = hashCode(p.domain);
    const jLat = ((h % 1000) / 1000 - 0.5) * 7;
    const jLon = ((Math.floor(h / 1000) % 1000) / 1000 - 0.5) * 11;
    const [x, y] = project(
      Math.max(-72, Math.min(78, lat + jLat)),
      lon + jLon,
    );
    out.push({ x, y, risk: p.risk, count: p.count });
  }
  return out;
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

function createCardContext(): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D not supported');
  return ctx;
}

function drawBackdrop(ctx: CanvasRenderingContext2D): void {
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
}

function toBlob(ctx: CanvasRenderingContext2D): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    ctx.canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('toBlob failed'));
    }, 'image/png');
  });
}

export async function renderShareCard(data: ShareCardData): Promise<Blob> {
  const ctx = createCardContext();
  drawBackdrop(ctx);

  await drawLand(ctx);

  // Arcs + destination points — one arc per connection. Fall back to a
  // virtual origin near the bottom center when the user location is unknown
  // so the card is never arc-less.
  const src = data.source;
  const [sx, sy] = src
    ? project(src.lat, src.lng)
    : [W / 2, H - 210];
  const resolved = resolvePoints(data.points);

  ctx.save();
  ctx.lineCap = 'round';
  for (const p of resolved) {
    ctx.lineWidth = Math.min(3.2, 1.1 + Math.log2(1 + p.count) * 0.5);
    ctx.shadowBlur = 12;
    ctx.globalAlpha = 0.7;
    drawArc(ctx, sx, sy, p.x, p.y, RISK_COLOR[p.risk]);
  }
  ctx.restore();

  ctx.save();
  for (const p of resolved) {
    ctx.fillStyle = RISK_COLOR[p.risk];
    ctx.shadowColor = RISK_COLOR[p.risk];
    ctx.shadowBlur = 10;
    ctx.globalAlpha = 0.95;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
    // impact ring
    ctx.strokeStyle = RISK_COLOR[p.risk];
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 7.5, 0, Math.PI * 2);
    ctx.stroke();
  }
  // source marker
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = '#7dd3fc';
  ctx.shadowBlur = 18;
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(sx, sy, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.65)';
  ctx.lineWidth = 1.5;
  for (const r of [13, 22]) {
    ctx.globalAlpha = r === 13 ? 0.7 : 0.35;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
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

  return toBlob(ctx);
}

// ---------------------------------------------------------------------------
// Weekly recap card — same visual language as the per-page scan card, but fed
// by the 7-day stats history: one glowing dot per country that tracked the
// user, a big blocked counter, and the week's top watching companies.
// ---------------------------------------------------------------------------

export interface WeeklyCardPoint {
  country: string;
  count: number;
  risk: RiskLevel;
}

export interface WeeklyCardLabels {
  brand: string;
  tagline: string;
  headline: string;
  range: string;
  statBlocked: string;
  statTrackers: string;
  statCompanies: string;
  topWatchers: string;
}

export interface WeeklyCardData {
  blocked: number;
  trackers: number;
  companies: number;
  topCompanies: Array<[string, number]>;
  points: WeeklyCardPoint[];
  labels: WeeklyCardLabels;
}

export async function renderWeeklyCard(data: WeeklyCardData): Promise<Blob> {
  const ctx = createCardContext();
  drawBackdrop(ctx);
  await drawLand(ctx);

  // One dot per country, sized by how often it received tracking traffic.
  ctx.save();
  for (const p of data.points) {
    const c = CENTROIDS[p.country.toUpperCase()];
    if (!c) continue;
    const [x, y] = project(c[0], c[1]);
    const r = Math.min(13, 3 + Math.log2(1 + p.count) * 1.7);
    const color = RISK_COLOR[p.risk];
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, r + 5, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  // Text scrim
  const scrim = ctx.createLinearGradient(0, H, 0, H - 340);
  scrim.addColorStop(0, 'rgba(2, 6, 12, 0.94)');
  scrim.addColorStop(1, 'rgba(2, 6, 12, 0)');
  ctx.fillStyle = scrim;
  ctx.fillRect(0, H - 340, W, 340);

  // Brand + tagline (top left)
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#7dd3fc';
  ctx.font = `bold 26px ${FONT}`;
  ctx.fillText(`🛡 ${data.labels.brand}`, 56, 72);
  ctx.fillStyle = 'rgba(148, 163, 184, 0.85)';
  ctx.font = `500 18px ${FONT}`;
  ctx.fillText(data.labels.tagline, 56, 100);

  // Date range (top right)
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(148, 163, 184, 0.9)';
  ctx.font = `600 20px ${FONT}`;
  ctx.fillText(data.labels.range, W - 56, 72);

  // Top watchers panel (bottom right)
  const panelW = 340;
  const panelX = W - 56 - panelW;
  const panelY = H - 272;
  const rows = data.topCompanies.slice(0, 3);
  const panelH = 56 + rows.length * 36;
  if (rows.length > 0) {
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(8, 20, 32, 0.85)';
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
    ctx.lineWidth = 1.5;
    roundRect(ctx, panelX, panelY, panelW, panelH, 10);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(125, 211, 252, 0.85)';
    ctx.font = `700 13px ${FONT}`;
    ctx.fillText(data.labels.topWatchers.toUpperCase(), panelX + 20, panelY + 32);
    const maxCount = Math.max(1, ...rows.map(([, n]) => n));
    rows.forEach(([name, n], i) => {
      const rowY = panelY + 64 + i * 36;
      ctx.fillStyle = 'rgba(56, 189, 248, 0.18)';
      const barW = Math.max(8, (n / maxCount) * (panelW - 40));
      roundRect(ctx, panelX + 20, rowY - 20, barW, 27, 5);
      ctx.fill();
      ctx.fillStyle = '#e2e8f0';
      ctx.font = `600 17px ${FONT}`;
      let label = name;
      while (label.length > 3 && ctx.measureText(label).width > panelW - 120) {
        label = label.slice(0, -2);
      }
      if (label !== name) label += '…';
      ctx.fillText(label, panelX + 28, rowY);
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(148, 163, 184, 0.9)';
      ctx.font = `700 16px ${FONT}`;
      ctx.fillText(n.toLocaleString(), panelX + panelW - 20, rowY);
      ctx.textAlign = 'left';
    });
  }

  // Headline — shrink to fit the space left of the watchers panel.
  ctx.textAlign = 'left';
  ctx.fillStyle = '#f8fafc';
  const headlineMax = panelX - 56 - 24;
  let headlineSize = 52;
  do {
    ctx.font = `900 ${headlineSize}px ${FONT}`;
    if (ctx.measureText(data.labels.headline).width <= headlineMax) break;
    headlineSize -= 2;
  } while (headlineSize > 30);
  ctx.fillText(data.labels.headline, 56, H - 124);

  // Stats chips
  const chips: Array<{ value: string; label: string; color: string }> = [
    {
      value: data.blocked.toLocaleString(),
      label: data.labels.statBlocked,
      color: '#f87171',
    },
    {
      value: data.trackers.toLocaleString(),
      label: data.labels.statTrackers,
      color: '#7dd3fc',
    },
    {
      value: data.companies.toLocaleString(),
      label: data.labels.statCompanies,
      color: '#34d399',
    },
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
  ctx.fillText('zevrhq.com', W - 56, H - 28);

  return toBlob(ctx);
}

import * as THREE from 'three';
import { latLngToVec3 } from './latLng';

type Polygon = number[][][];
type MultiPolygon = number[][][][];

interface LandFeature {
  type: 'Feature';
  bbox?: [number, number, number, number];
  geometry:
    | { type: 'Polygon'; coordinates: Polygon }
    | { type: 'MultiPolygon'; coordinates: MultiPolygon };
}

interface LandCollection {
  type: 'FeatureCollection';
  features: LandFeature[];
}

function rayInPolygon(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

type PreparedPolygon = {
  bbox: [number, number, number, number];
  outer: number[][];
  holes: number[][][];
};

function prepare(features: LandFeature[]): PreparedPolygon[] {
  const out: PreparedPolygon[] = [];
  const computeBbox = (ring: number[][]): [number, number, number, number] => {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    return [minX, minY, maxX, maxY];
  };
  for (const f of features) {
    const g = f.geometry;
    if (g.type === 'Polygon') {
      out.push({
        bbox: computeBbox(g.coordinates[0]),
        outer: g.coordinates[0],
        holes: g.coordinates.slice(1),
      });
    } else {
      for (const poly of g.coordinates) {
        out.push({
          bbox: computeBbox(poly[0]),
          outer: poly[0],
          holes: poly.slice(1),
        });
      }
    }
  }
  return out;
}

function pointOnLand(lng: number, lat: number, polys: PreparedPolygon[]): boolean {
  for (const p of polys) {
    const [minX, minY, maxX, maxY] = p.bbox;
    if (lng < minX || lng > maxX || lat < minY || lat > maxY) continue;
    if (!rayInPolygon(lng, lat, p.outer)) continue;
    let hole = false;
    for (const h of p.holes) {
      if (rayInPolygon(lng, lat, h)) {
        hole = true;
        break;
      }
    }
    if (!hole) return true;
  }
  return false;
}

export async function loadLandDots(
  url: string,
  radius: number,
  options: { stepDeg?: number } = {},
): Promise<THREE.Points> {
  const step = options.stepDeg ?? 2.5;
  const res = await fetch(url);
  const data = (await res.json()) as LandCollection;
  const polys = prepare(data.features);

  const positions: number[] = [];
  const tmp = new THREE.Vector3();

  for (let lat = -78; lat <= 84; lat += step) {
    const circumference = Math.cos((lat * Math.PI) / 180);
    const lngStep = circumference < 0.05 ? 360 : step / Math.max(circumference, 0.05);
    for (let lng = -180; lng < 180; lng += lngStep) {
      if (pointOnLand(lng, lat, polys)) {
        latLngToVec3(lat, lng, radius, tmp);
        positions.push(tmp.x, tmp.y, tmp.z);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );

  const material = new THREE.PointsMaterial({
    color: 0x38bdf8,
    size: 2.2,
    transparent: true,
    opacity: 0.95,
    sizeAttenuation: false,
    depthWrite: false,
  });

  return new THREE.Points(geometry, material);
}

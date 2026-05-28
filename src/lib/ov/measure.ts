/**
 * OV 量取工具 —— 量高 / 2D 测距 / 3D 测距 / 量面。纯函数。
 */
import * as Cesium from 'cesium';

const EARTH_R = 6378137;
const M_PER_DEG = (Math.PI * EARTH_R) / 180;

export type MeasureMode = 'height' | 'dist2d' | 'dist3d' | 'area';

export interface MeasurePoint {
  lon: number;
  lat: number;
  alt: number;
}

/** 2D 水平距离（米），沿点序累加。 */
export function dist2d(pts: MeasurePoint[]): number {
  if (pts.length < 2) return 0;
  let d = 0;
  for (let i = 1; i < pts.length; i++) {
    const cosLat = Math.cos(Cesium.Math.toRadians((pts[i - 1].lat + pts[i].lat) / 2));
    const dx = (pts[i].lon - pts[i - 1].lon) * M_PER_DEG * cosLat;
    const dy = (pts[i].lat - pts[i - 1].lat) * M_PER_DEG;
    d += Math.hypot(dx, dy);
  }
  return d;
}

/** 3D 距离（含高差），沿点序累加。 */
export function dist3d(pts: MeasurePoint[]): number {
  if (pts.length < 2) return 0;
  let d = 0;
  for (let i = 1; i < pts.length; i++) {
    const cosLat = Math.cos(Cesium.Math.toRadians((pts[i - 1].lat + pts[i].lat) / 2));
    const dx = (pts[i].lon - pts[i - 1].lon) * M_PER_DEG * cosLat;
    const dy = (pts[i].lat - pts[i - 1].lat) * M_PER_DEG;
    const dz = pts[i].alt - pts[i - 1].alt;
    d += Math.hypot(dx, dy, dz);
  }
  return d;
}

/** 量高：首尾两点的高差绝对值。 */
export function heightDiff(pts: MeasurePoint[]): number {
  if (pts.length < 2) return 0;
  return Math.abs(pts[pts.length - 1].alt - pts[0].alt);
}

/** 量面：多边形 XY 投影面积（米²，鞋带公式）。 */
export function area2d(pts: MeasurePoint[]): number {
  if (pts.length < 3) return 0;
  const lat0 = pts[0].lat;
  const cosLat = Math.cos(Cesium.Math.toRadians(lat0));
  const xy = pts.map((p) => ({
    x: p.lon * M_PER_DEG * cosLat,
    y: p.lat * M_PER_DEG,
  }));
  let a = 0;
  for (let i = 0; i < xy.length; i++) {
    const j = (i + 1) % xy.length;
    a += xy[i].x * xy[j].y - xy[j].x * xy[i].y;
  }
  return Math.abs(a) / 2;
}

/** 按模式给出可读结果字符串。 */
export function measureReadout(mode: MeasureMode, pts: MeasurePoint[]): string {
  switch (mode) {
    case 'height':
      return `高差 ${heightDiff(pts).toFixed(2)} m`;
    case 'dist2d':
      return `水平 ${dist2d(pts).toFixed(2)} m`;
    case 'dist3d':
      return `空间 ${dist3d(pts).toFixed(2)} m`;
    case 'area':
      return `面积 ${area2d(pts).toFixed(1)} m²`;
  }
}

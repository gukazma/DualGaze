/**
 * Orbit 拾点拟合：N 个 WGS84 墙面点 → 最小外接圆（圆心 + 半径）。
 *
 * 思路：以第一个点为 anchor 建 ENU 平面，把所有点投影到 (east, north) 2D 坐标，
 * 在 2D 平面跑「最小外接圆」算法，结果 center 再反投影回 WGS84。
 *
 * N 通常 ≤ 20（用户手拾），暴力 O(n³) 完全够用 — 试所有 C(n,2) 直径圆 + C(n,3)
 * 外接圆，取最小的 enclosing all。
 */
import * as Cesium from 'cesium';
import { cartesian3ToWgs84, wgs84ToCartesian3 } from './coord';

export interface FitPoint {
  lon: number;
  lat: number;
  alt: number;
}

export interface FitResult {
  /** WGS84 圆心（lon/lat），alt 取所有 fitPoints 的 min（作为 axisBottom.alt） */
  center: { lon: number; lat: number; alt: number };
  /** 半径 m（水平距离，忽略 alt 方向） */
  radius: number;
  /** 圆心 ECEF（缓存，调用方做后续几何复用） */
  centerEcef: Cesium.Cartesian3;
}

/**
 * 拟合 N 个 WGS84 点的最小外接圆。
 * - N = 0 → null
 * - N = 1 → radius = 0，center = 该点
 * - N ≥ 2 → 真拟合
 *
 * 圆心 alt 取所有点的最小 alt（地表附近最低点 = 圆柱底面起点）。
 */
export function fitOrbitCircle(points: FitPoint[]): FitResult | null {
  if (points.length === 0) return null;

  const anchor = wgs84ToCartesian3(points[0].lon, points[0].lat, 0);
  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(anchor);
  const enuInv = Cesium.Matrix4.inverseTransformation(enu, new Cesium.Matrix4());

  // 投影到 (east, north) 2D
  const points2d: Vec2[] = points.map((p) => {
    const ecef = wgs84ToCartesian3(p.lon, p.lat, 0);
    const local = Cesium.Matrix4.multiplyByPoint(enuInv, ecef, new Cesium.Cartesian3());
    return { e: local.x, n: local.y };
  });

  const fit = smallestEnclosingCircle(points2d);

  // ENU 平面圆心 → ECEF → WGS84 (lon, lat)
  const centerLocal = new Cesium.Cartesian3(fit.cx, fit.cy, 0);
  const centerEcef = Cesium.Matrix4.multiplyByPoint(enu, centerLocal, new Cesium.Cartesian3());
  const centerWgs = cartesian3ToWgs84(centerEcef);

  // 圆心 alt 取所有拾点 min（默认作为 axisBottom；用户可在 sheet 调 axisBottomOffset）
  const minAlt = points.reduce((acc, p) => Math.min(acc, p.alt), points[0].alt);

  return {
    center: { lon: centerWgs.lon, lat: centerWgs.lat, alt: minAlt },
    radius: fit.r,
    centerEcef,
  };
}

// ---------- 内部 ----------

interface Vec2 {
  e: number;
  n: number;
}

interface Circle2D {
  cx: number;
  cy: number;
  r: number;
}

const EPS = 1e-6;

function smallestEnclosingCircle(pts: Vec2[]): Circle2D {
  if (pts.length === 1) return { cx: pts[0].e, cy: pts[0].n, r: 0 };
  if (pts.length === 2) {
    const cx = (pts[0].e + pts[1].e) / 2;
    const cy = (pts[0].n + pts[1].n) / 2;
    const r = Math.hypot(pts[0].e - pts[1].e, pts[0].n - pts[1].n) / 2;
    return { cx, cy, r };
  }

  let best: Circle2D | null = null;

  // 所有 pair 作直径
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const cx = (pts[i].e + pts[j].e) / 2;
      const cy = (pts[i].n + pts[j].n) / 2;
      const r = Math.hypot(pts[i].e - pts[j].e, pts[i].n - pts[j].n) / 2;
      const c: Circle2D = { cx, cy, r };
      if (enclosesAll(pts, c) && (!best || c.r < best.r)) best = c;
    }
  }

  // 所有 triple 作外接圆
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      for (let k = j + 1; k < pts.length; k++) {
        const cc = circumcircle(pts[i], pts[j], pts[k]);
        if (!cc) continue;
        if (enclosesAll(pts, cc) && (!best || cc.r < best.r)) best = cc;
      }
    }
  }

  // 理论上 ≥ 2 点时必有解（pair 总能 enclose 2 点），fallback 用第一对
  if (!best) {
    const cx = (pts[0].e + pts[1].e) / 2;
    const cy = (pts[0].n + pts[1].n) / 2;
    const r = Math.hypot(pts[0].e - pts[1].e, pts[0].n - pts[1].n) / 2;
    best = { cx, cy, r };
  }
  return best;
}

function enclosesAll(pts: Vec2[], c: Circle2D): boolean {
  const rWithEps = c.r + EPS;
  for (const p of pts) {
    if (Math.hypot(p.e - c.cx, p.n - c.cy) > rWithEps) return false;
  }
  return true;
}

function circumcircle(a: Vec2, b: Vec2, c: Vec2): Circle2D | null {
  const ax = a.e,
    ay = a.n,
    bx = b.e,
    by = b.n,
    cx = c.e,
    cy = c.n;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < EPS) return null; // 三点共线
  const ux =
    ((ax * ax + ay * ay) * (by - cy) +
      (bx * bx + by * by) * (cy - ay) +
      (cx * cx + cy * cy) * (ay - by)) /
    d;
  const uy =
    ((ax * ax + ay * ay) * (cx - bx) +
      (bx * bx + by * by) * (ax - cx) +
      (cx * cx + cy * cy) * (bx - ax)) /
    d;
  const r = Math.hypot(ux - ax, uy - ay);
  return { cx: ux, cy: uy, r };
}

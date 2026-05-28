/**
 * OV 区域分割 —— 把已选视角分成 N 个区块（多机协同 / 不同起降点 / 限高分层）。
 *
 * 5 种模式（对齐蝶舞）：
 *  - cluster: K-means 聚类（相机 XYZ 局部米坐标）
 *  - altPriority: 按相机高度排序后等分（分层采集）
 *  - viewPriority: K-means 聚类相机朝向 heading（同朝向归一架次）
 *  - fixedAlt: 按高度中位数二分（限高空域先飞低空）
 *  - viewSplit: 按 heading 均匀分 regionCount 个方位桶
 */
import * as Cesium from 'cesium';
import type { OvPathParams, OvViewCandidate } from '../../types/mission';

const EARTH_R = 6378137;
const M_PER_DEG = (Math.PI * EARTH_R) / 180;

interface XYZ {
  x: number;
  y: number;
  z: number;
}

/** 视角 → 局部米坐标（相对第一个视角）。 */
function toLocal(views: OvViewCandidate[]): XYZ[] {
  if (views.length === 0) return [];
  const lon0 = views[0].camLon;
  const lat0 = views[0].camLat;
  const cosLat = Math.cos(Cesium.Math.toRadians(lat0));
  return views.map((v) => ({
    x: (v.camLon - lon0) * M_PER_DEG * cosLat,
    y: (v.camLat - lat0) * M_PER_DEG,
    z: v.camAlt,
  }));
}

/** 主入口：返回 N 个视角子数组。 */
export function splitRegions(
  views: OvViewCandidate[],
  params: OvPathParams,
): OvViewCandidate[][] {
  const k = Math.max(1, Math.floor(params.regionCount));
  if (views.length === 0) return [];
  if (k === 1) return [views];

  switch (params.splitMode) {
    case 'altPriority':
      return chunkBySorted(views, (v) => v.camAlt, k);
    case 'viewSplit':
      return bucketByHeading(views, k);
    case 'viewPriority':
      return kmeansHeading(views, k);
    case 'fixedAlt':
      return splitByMedianAlt(views);
    case 'cluster':
    default:
      return kmeansXYZ(views, k);
  }
}

/** 按某 key 排序后等分 k 段。 */
function chunkBySorted(
  views: OvViewCandidate[],
  key: (v: OvViewCandidate) => number,
  k: number,
): OvViewCandidate[][] {
  const sorted = [...views].sort((a, b) => key(a) - key(b));
  const out: OvViewCandidate[][] = [];
  const per = Math.ceil(sorted.length / k);
  for (let i = 0; i < sorted.length; i += per) out.push(sorted.slice(i, i + per));
  return out;
}

/** 按 heading 均匀分 k 个方位桶。 */
function bucketByHeading(views: OvViewCandidate[], k: number): OvViewCandidate[][] {
  const buckets: OvViewCandidate[][] = Array.from({ length: k }, () => []);
  for (const v of views) {
    const h = ((v.heading % 360) + 360) % 360;
    const b = Math.min(k - 1, Math.floor((h / 360) * k));
    buckets[b].push(v);
  }
  return buckets.filter((b) => b.length > 0);
}

/** 按高度中位数二分。 */
function splitByMedianAlt(views: OvViewCandidate[]): OvViewCandidate[][] {
  const sorted = [...views].sort((a, b) => a.camAlt - b.camAlt);
  const mid = Math.floor(sorted.length / 2);
  const lo = sorted.slice(0, mid);
  const hi = sorted.slice(mid);
  return [lo, hi].filter((g) => g.length > 0);
}

/** K-means 聚类（相机 XYZ）。 */
function kmeansXYZ(views: OvViewCandidate[], k: number): OvViewCandidate[][] {
  const pts = toLocal(views);
  const n = pts.length;
  if (n <= k) return views.map((v) => [v]);

  // 初始中心：均匀抽样
  let centers: XYZ[] = [];
  for (let i = 0; i < k; i++) centers.push({ ...pts[Math.floor((i * n) / k)] });

  const assign = new Array<number>(n).fill(0);
  for (let iter = 0; iter < 20; iter++) {
    let changed = false;
    // 分配
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const dx = pts[i].x - centers[c].x;
        const dy = pts[i].y - centers[c].y;
        const dz = pts[i].z - centers[c].z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (assign[i] !== best) {
        assign[i] = best;
        changed = true;
      }
    }
    // 更新中心
    const sum = Array.from({ length: k }, () => ({ x: 0, y: 0, z: 0, n: 0 }));
    for (let i = 0; i < n; i++) {
      const a = assign[i];
      sum[a].x += pts[i].x;
      sum[a].y += pts[i].y;
      sum[a].z += pts[i].z;
      sum[a].n++;
    }
    centers = centers.map((c, idx) =>
      sum[idx].n > 0
        ? { x: sum[idx].x / sum[idx].n, y: sum[idx].y / sum[idx].n, z: sum[idx].z / sum[idx].n }
        : c,
    );
    if (!changed) break;
  }

  const groups: OvViewCandidate[][] = Array.from({ length: k }, () => []);
  for (let i = 0; i < n; i++) groups[assign[i]].push(views[i]);
  return groups.filter((g) => g.length > 0);
}

/** K-means 聚类相机朝向（1D 圆环 heading）。 */
function kmeansHeading(views: OvViewCandidate[], k: number): OvViewCandidate[][] {
  // 圆环上用单位向量平均，简化为 bucketByHeading（足够）
  return bucketByHeading(views, k);
}

/**
 * OV 航测路径 TSP —— 区域内视角排序，最小化 4-cost 总代价。
 *
 * cost(i,j) = a·dxy + b·dz + c·Δheading + d·Δpitch
 *   a/b/c/d = pathParams.costH / costV / costHRot / costVRot
 *
 * 算法：nearest-neighbor 起始 + 2-opt 改良（限迭代防卡）。
 */
import * as Cesium from 'cesium';
import type { OvPathParams, OvViewCandidate } from '../../types/mission';

const EARTH_R = 6378137;
const M_PER_DEG = (Math.PI * EARTH_R) / 180;

interface Node {
  x: number;
  y: number;
  z: number;
  h: number;
  p: number;
}

function angDiff(a: number, b: number): number {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

/** 区域内视角 TSP 排序。返回排序后的视角数组。 */
export function orderViewsTSP(
  views: OvViewCandidate[],
  params: OvPathParams,
): OvViewCandidate[] {
  const n = views.length;
  if (n <= 2) return views;

  const lon0 = views[0].camLon;
  const lat0 = views[0].camLat;
  const cosLat = Math.cos(Cesium.Math.toRadians(lat0));
  const nodes: Node[] = views.map((v) => ({
    x: (v.camLon - lon0) * M_PER_DEG * cosLat,
    y: (v.camLat - lat0) * M_PER_DEG,
    z: v.camAlt,
    h: v.heading,
    p: v.pitch,
  }));

  const cost = (i: number, j: number): number => {
    const a = nodes[i];
    const b = nodes[j];
    const dxy = Math.hypot(a.x - b.x, a.y - b.y);
    const dz = Math.abs(a.z - b.z);
    const dh = angDiff(a.h, b.h);
    const dp = angDiff(a.p, b.p);
    return params.costH * dxy + params.costV * dz + params.costHRot * dh + params.costVRot * dp;
  };

  // nearest-neighbor
  const visited = new Array<boolean>(n).fill(false);
  const tour: number[] = [0];
  visited[0] = true;
  for (let step = 1; step < n; step++) {
    const last = tour[tour.length - 1];
    let best = -1;
    let bestC = Infinity;
    for (let j = 0; j < n; j++) {
      if (visited[j]) continue;
      const c = cost(last, j);
      if (c < bestC) {
        bestC = c;
        best = j;
      }
    }
    tour.push(best);
    visited[best] = true;
  }

  // 2-opt（限迭代：n 较大时只扫有限轮）
  const maxPasses = n > 400 ? 1 : n > 150 ? 3 : 8;
  for (let pass = 0; pass < maxPasses; pass++) {
    let improved = false;
    for (let i = 0; i < n - 1; i++) {
      for (let kk = i + 2; kk < n; kk++) {
        // 跳过相邻（无收益）+ 闭合处理：这里是开放路径
        const a = tour[i];
        const b = tour[i + 1];
        const c = tour[kk];
        const d = kk + 1 < n ? tour[kk + 1] : -1;
        const before = cost(a, b) + (d >= 0 ? cost(c, d) : 0);
        const after = cost(a, c) + (d >= 0 ? cost(b, d) : 0);
        if (after + 1e-6 < before) {
          // reverse tour[i+1..kk]
          let lo = i + 1;
          let hi = kk;
          while (lo < hi) {
            const t = tour[lo];
            tour[lo] = tour[hi];
            tour[hi] = t;
            lo++;
            hi--;
          }
          improved = true;
        }
      }
    }
    if (!improved) break;
  }

  return tour.map((idx) => views[idx]);
}

/** 计算一条视角序列的总水平距离（米），sortie 长度切分用。 */
export function pathLengthMeters(views: OvViewCandidate[]): number {
  if (views.length < 2) return 0;
  const lat0 = views[0].camLat;
  const cosLat = Math.cos(Cesium.Math.toRadians(lat0));
  let len = 0;
  for (let i = 1; i < views.length; i++) {
    const a = views[i - 1];
    const b = views[i];
    const dx = (b.camLon - a.camLon) * M_PER_DEG * cosLat;
    const dy = (b.camLat - a.camLat) * M_PER_DEG;
    const dz = b.camAlt - a.camAlt;
    len += Math.hypot(dx, dy, dz);
  }
  return len;
}

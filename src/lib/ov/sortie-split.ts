/**
 * OV 分架次 + waypoint 构造。
 *
 * 两个用途：
 *  1. regionToSortie: 区域 TSP 排序后的视角 → 1 个 OvSortie（删除相近点）
 *  2. resplitSorties: 已有 sorties 按 数量/长度/奇偶 再切 + 进出航线增高
 *
 * View → Waypoint：lon/lat/alt = 相机位；heading/pitch/gimbalYaw 来自 view。
 */
import * as Cesium from 'cesium';
import { createWaypoint } from '../../types/mission';
import type {
  OvSortie,
  OvSplitParams,
  OvViewCandidate,
  Waypoint,
} from '../../types/mission';

const EARTH_R = 6378137;
const M_PER_DEG = (Math.PI * EARTH_R) / 180;

const SORTIE_COLORS = [
  '#38bdf8',
  '#ef4444',
  '#4ade80',
  '#ffd24a',
  '#a78bfa',
  '#ff6b35',
  '#22d3ee',
  '#f472b6',
];

let _sortieIdSeq = 0;
const newSortieId = (): string =>
  `sortie_${Date.now().toString(36)}_${(++_sortieIdSeq).toString(36)}`;

export function sortieColor(index: number): string {
  return SORTIE_COLORS[index % SORTIE_COLORS.length];
}

/** View → Waypoint（含 gimbalYaw）。 */
function viewToWaypoint(v: OvViewCandidate, index: number): Waypoint {
  const wp = createWaypoint({
    lon: v.camLon,
    lat: v.camLat,
    alt: v.camAlt,
    index,
    speed: 0,
    heading: v.heading,
    pitch: v.pitch,
    fov: 60,
  });
  wp.gimbalYaw = v.heading;
  return wp;
}

/** 删除相近点（间距 < minM 的后续点丢弃）。 */
function removeNearWaypoints(wps: Waypoint[], minM: number): Waypoint[] {
  if (minM <= 0 || wps.length < 2) return wps;
  const out: Waypoint[] = [wps[0]];
  const lat0 = wps[0].lat;
  const cosLat = Math.cos(Cesium.Math.toRadians(lat0));
  for (let i = 1; i < wps.length; i++) {
    const prev = out[out.length - 1];
    const cur = wps[i];
    const dx = (cur.lon - prev.lon) * M_PER_DEG * cosLat;
    const dy = (cur.lat - prev.lat) * M_PER_DEG;
    const dz = cur.alt - prev.alt;
    if (Math.hypot(dx, dy, dz) >= minM) out.push(cur);
  }
  return out.map((w, i) => ({ ...w, index: i }));
}

/** 区域有序视角 → 1 个 sortie（path 模式用）。 */
export function regionToSortie(
  orderedViews: OvViewCandidate[],
  colorIndex: number,
  splitParams: OvSplitParams,
): OvSortie {
  let wps = orderedViews.map((v, i) => viewToWaypoint(v, i));
  wps = removeNearWaypoints(wps, splitParams.removeNearM);
  return {
    id: newSortieId(),
    color: sortieColor(colorIndex),
    waypoints: wps,
  };
}

/**
 * 把已有 sorties 按策略再切 + 进出航线增高（sortie 模式用）。
 * 增高：每个新 sortie 首尾各加 1 个抬升 transitHeight 的过渡航点。
 */
export function resplitSorties(
  existing: OvSortie[],
  splitParams: OvSplitParams,
): OvSortie[] {
  // 先把所有 sortie 的 waypoints 摊平按原顺序，再按策略重新切
  const out: OvSortie[] = [];
  let colorIdx = 0;

  for (const sortie of existing) {
    const chunks = chunkWaypoints(sortie.waypoints, splitParams);
    for (const chunk of chunks) {
      const withTransit = addTransitWaypoints(chunk, splitParams.transitHeight);
      out.push({
        id: newSortieId(),
        color: sortieColor(colorIdx++),
        waypoints: withTransit.map((w, i) => ({ ...w, index: i })),
      });
    }
  }
  return out;
}

function chunkWaypoints(wps: Waypoint[], p: OvSplitParams): Waypoint[][] {
  if (wps.length === 0) return [];
  if (p.strategy === 'parity') {
    const even = wps.filter((_, i) => i % 2 === 0);
    const odd = wps.filter((_, i) => i % 2 === 1);
    return [even, odd].filter((c) => c.length > 0);
  }
  if (p.strategy === 'length') {
    const out: Waypoint[][] = [];
    let cur: Waypoint[] = [];
    let acc = 0;
    const lat0 = wps[0].lat;
    const cosLat = Math.cos(Cesium.Math.toRadians(lat0));
    for (let i = 0; i < wps.length; i++) {
      if (cur.length > 0) {
        const prev = cur[cur.length - 1];
        const dx = (wps[i].lon - prev.lon) * M_PER_DEG * cosLat;
        const dy = (wps[i].lat - prev.lat) * M_PER_DEG;
        const dz = wps[i].alt - prev.alt;
        acc += Math.hypot(dx, dy, dz);
      }
      cur.push(wps[i]);
      if (acc >= p.perSortieLengthM && cur.length > 1) {
        out.push(cur);
        cur = [];
        acc = 0;
      }
    }
    if (cur.length > 0) out.push(cur);
    return out;
  }
  // count（默认）
  const per = Math.max(1, Math.floor(p.perSortieCount));
  const out: Waypoint[][] = [];
  for (let i = 0; i < wps.length; i += per) out.push(wps.slice(i, i + per));
  return out;
}

/** 首尾各加 1 个抬升过渡航点（避障）。 */
function addTransitWaypoints(wps: Waypoint[], transitHeight: number): Waypoint[] {
  if (transitHeight <= 0 || wps.length === 0) return wps;
  const first = wps[0];
  const last = wps[wps.length - 1];
  const entry: Waypoint = {
    ...first,
    id: `${first.id}_in`,
    alt: first.alt + transitHeight,
    pitch: -90,
  };
  const exit: Waypoint = {
    ...last,
    id: `${last.id}_out`,
    alt: last.alt + transitHeight,
    pitch: -90,
  };
  return [entry, ...wps, exit];
}

/**
 * OV 补拍工具几何 —— 平扫航线 / 单点环拍 → 生成补充架次（OvSortie）。
 *
 * 这些是主 pipeline 之外的人工补拍：
 *  - 平扫：2 点定水平线段，等间距铺航点（补底部遮挡区）
 *  - 环拍：1 点为圆心，360° 等分 N 张相机绕拍（补单点/小物体）
 *
 * 结果作为普通 OvSortie 追加到 mission.ov.paths，参与渲染/导出/模拟。
 * 注意：重新「生成路径」会覆盖 paths（含补拍），需在主路径后再补。
 */
import * as Cesium from 'cesium';
import { createWaypoint } from '../../types/mission';
import type { OvSortie, Waypoint } from '../../types/mission';

const EARTH_R = 6378137;
const M_PER_DEG = (Math.PI * EARTH_R) / 180;

let _auxSortieSeq = 0;
const newAuxSortieId = (): string =>
  `sortie_aux_${Date.now().toString(36)}_${(++_auxSortieSeq).toString(36)}`;

function bearingDeg(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const cosLat = Math.cos(Cesium.Math.toRadians((lat1 + lat2) / 2));
  const dx = (lon2 - lon1) * cosLat;
  const dy = lat2 - lat1;
  return ((Cesium.Math.toDegrees(Math.atan2(dx, dy)) % 360) + 360) % 360;
}

/** 平扫：2 点水平线段 → 等间距航点（间距 spacingM，pitch 朝下补拍）。 */
export function buildSweepSortie(
  p0: { lon: number; lat: number; alt: number },
  p1: { lon: number; lat: number; alt: number },
  opts: { spacingM?: number; pitch?: number; color?: string } = {},
): OvSortie {
  const spacing = opts.spacingM ?? 8;
  const pitch = opts.pitch ?? -45;
  const cosLat = Math.cos(Cesium.Math.toRadians((p0.lat + p1.lat) / 2));
  const dxM = (p1.lon - p0.lon) * M_PER_DEG * cosLat;
  const dyM = (p1.lat - p0.lat) * M_PER_DEG;
  const lenM = Math.hypot(dxM, dyM);
  const n = Math.max(2, Math.floor(lenM / spacing) + 1);
  const heading = bearingDeg(p0.lon, p0.lat, p1.lon, p1.lat);
  const wps: Waypoint[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const wp = createWaypoint({
      lon: p0.lon + (p1.lon - p0.lon) * t,
      lat: p0.lat + (p1.lat - p0.lat) * t,
      alt: p0.alt + (p1.alt - p0.alt) * t,
      index: i,
      speed: 0,
      heading,
      pitch,
      fov: 60,
    });
    wp.gimbalYaw = heading;
    wps.push(wp);
  }
  return { id: newAuxSortieId(), color: opts.color ?? '#22d3ee', waypoints: wps };
}

/** 环拍：1 点圆心 → 360° 等分 N 张相机，半径 radius，相机朝圆心。 */
export function buildSpotOrbitSortie(
  center: { lon: number; lat: number; alt: number },
  opts: { radiusM?: number; segments?: number; pitch?: number; color?: string } = {},
): OvSortie {
  const radius = opts.radiusM ?? 30;
  const segments = Math.max(4, Math.floor(opts.segments ?? 16));
  const pitch = opts.pitch ?? -30;
  const cosLat = Math.cos(Cesium.Math.toRadians(center.lat));
  const wps: Waypoint[] = [];
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * 360;
    const rad = Cesium.Math.toRadians(angle);
    const eM = Math.sin(rad) * radius;
    const nM = Math.cos(rad) * radius;
    const lon = center.lon + (eM / (M_PER_DEG * cosLat));
    const lat = center.lat + (nM / M_PER_DEG);
    // 相机朝圆心：heading = 反方位
    const heading = ((angle + 180) % 360 + 360) % 360;
    const wp = createWaypoint({
      lon,
      lat,
      alt: center.alt + radius * 0.4, // 略高于圆心斜拍
      index: i,
      speed: 0,
      heading,
      pitch,
      fov: 60,
    });
    wp.gimbalYaw = heading;
    wps.push(wp);
  }
  return { id: newAuxSortieId(), color: opts.color ?? '#f472b6', waypoints: wps };
}

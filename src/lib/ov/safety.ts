/**
 * OV 安全检查 helpers —— per-sample / per-view 调用，纯函数。
 *
 * M31 范围：
 *  - pointInPolygon 检查（用于 AOI / 禁飞区命中）
 *  - isAltInRange（采样高度区间剔除）
 *
 * M35 扩展：
 *  - isCamSafe（safety hull 距离检查，per-view 用 ray-cast 测离 tileset 距离）
 *  - isInsideObstacle（点是否落在插入障碍盒里）
 */

import type { OvAoi, OvNoFlyZone, OvSamplingParams } from '../../types/mission';

export interface Point2D {
  lon: number;
  lat: number;
}

/**
 * Ray-casting point-in-polygon。多边形顶点列表 [{ lon, lat }, ...]，闭合自动处理。
 * 经度（X）+ 纬度（Y）等价于平面坐标做奇偶交叉测试 —— 在小区域内（< 几公里）误差忽略。
 */
export function pointInPolygon(p: Point2D, vertices: Point2D[]): boolean {
  if (vertices.length < 3) return false;
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const xi = vertices[i].lon;
    const yi = vertices[i].lat;
    const xj = vertices[j].lon;
    const yj = vertices[j].lat;
    const intersect =
      yi > p.lat !== yj > p.lat &&
      p.lon < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function isInsideAoi(p: Point2D, aoi: OvAoi | undefined): boolean {
  if (!aoi) return false;
  return pointInPolygon(p, aoi.vertices);
}

export function isInsideAnyNoFly(
  p: Point2D,
  alt: number,
  noFly: OvNoFlyZone[],
): boolean {
  for (const z of noFly) {
    if (
      alt >= z.minHeight &&
      alt <= z.maxHeight &&
      pointInPolygon(p, z.vertices)
    )
      return true;
  }
  return false;
}

export function isAltInRange(alt: number, sampling: OvSamplingParams): boolean {
  return alt >= sampling.minHeight && alt <= sampling.maxHeight;
}

/**
 * AOI 经纬度 bbox 计算（顶点遍历最小最大）。
 */
export function aoiBoundingBox(aoi: OvAoi): {
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
} {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const v of aoi.vertices) {
    if (v.lon < minLon) minLon = v.lon;
    if (v.lon > maxLon) maxLon = v.lon;
    if (v.lat < minLat) minLat = v.lat;
    if (v.lat > maxLat) maxLat = v.lat;
  }
  return { minLon, maxLon, minLat, maxLat };
}

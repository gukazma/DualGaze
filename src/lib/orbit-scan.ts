import * as Cesium from 'cesium';
import { cartesian3ToWgs84, wgs84ToCartesian3 } from './coord';
import { createWaypoint } from '../types/mission';
import type { OrbitDef, OrbitScanParams, Waypoint } from '../types/mission';

/**
 * Orbit 多圈环绕航线生成。
 *
 * 算法：
 *   1. 圈数 ringCount = ⌈H / verticalSpacing⌉ + 1（H = axisTop.alt - axisBottom.alt）
 *      圈高 = bottomAlt + r * (H - bottomOff + topOff) / (ringCount - 1)
 *   2. 实际飞行半径 = orbit.radius + standoff
 *   3. 每圈 pointsPerRing 等分方位角；起始 startAngle；direction 决定 +/−；
 *      flipRingDirection: 偶数圈反向（蛇形上升）
 *   4. 每 wp:
 *        camECEF = axis 中心点 + ENU 偏移 (sin θ, cos θ, 0) × R
 *        heading = atan2(midAxis_local.east, midAxis_local.north) 让相机看向 axis 中点
 *        pitch = atan2(midAxis_local.up, |horiz|)（顶圈 pitch 朝下，底圈朝上）
 *        gimbalYaw = heading
 *
 * 注意：axis 的 axisBottom/axisTop 经纬度可能不严格相同（点云拾取漂移），算法只取
 * axisBottom 作 ENU 原点，alt 单独按 bottom/top 差值取；这是物理塔不存在斜歪的合理假设。
 */
export function generateOrbitScanPath(
  orbit: OrbitDef,
  paramsOverride?: Partial<OrbitScanParams>,
): Waypoint[] {
  const params: OrbitScanParams = { ...orbit.params, ...(paramsOverride ?? {}) };
  const { axisBottom, axisTop, radius } = orbit;

  const totalHeight = axisTop.alt - axisBottom.alt;
  if (totalHeight <= 0 || radius <= 0) return [];
  const effRadius = radius + params.standoff;
  if (effRadius <= 0) return [];

  const usableHeight = Math.max(
    0.1,
    totalHeight - Math.max(0, params.bottomAltOffset) + Math.min(0, params.topAltOffset),
  );
  const ringCount = Math.max(1, Math.ceil(usableHeight / Math.max(0.1, params.verticalSpacing)) + 1);
  const pointsPerRing = Math.max(4, Math.floor(params.pointsPerRing));

  // axis ENU 原点：用 axisBottom 在椭球的位置；ENU 基底相对该点
  const originECEF = wgs84ToCartesian3(axisBottom.lon, axisBottom.lat, axisBottom.alt);
  const enuMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(originECEF);

  // axis 中点（仅供后续可能用；当前 pitch=0 平视不需要）
  void ((axisBottom.alt + axisTop.alt) / 2);

  const waypoints: Waypoint[] = [];
  for (let r = 0; r < ringCount; r++) {
    const t = ringCount === 1 ? 0 : r / (ringCount - 1);
    const alt =
      axisBottom.alt +
      params.bottomAltOffset +
      t * (totalHeight - params.bottomAltOffset + params.topAltOffset);

    // 当前圈高度相对 axis ENU 原点
    const localZ = alt - axisBottom.alt;

    // 方位角列表
    const angleSign = params.direction === 'cw' ? 1 : -1;
    const angles: number[] = [];
    for (let i = 0; i < pointsPerRing; i++) {
      angles.push(params.startAngle + angleSign * (i * 360) / pointsPerRing);
    }
    // flipRingDirection：偶数圈反向
    if (params.flipRingDirection && r % 2 === 1) angles.reverse();

    for (const angleDeg of angles) {
      const angleRad = Cesium.Math.toRadians(angleDeg);
      // ENU local: east = sin θ * R, north = cos θ * R, up = localZ
      const localE = Math.sin(angleRad) * effRadius;
      const localN = Math.cos(angleRad) * effRadius;
      const localPt = new Cesium.Cartesian3(localE, localN, localZ);
      const camECEF = Cesium.Matrix4.multiplyByPoint(
        enuMatrix,
        localPt,
        new Cesium.Cartesian3(),
      );
      const wgs = cartesian3ToWgs84(camECEF);

      // 相机水平看向 axis 中心（DPGO 标准：每圈拍同高度塔身一周环带）
      // heading = atan2(east, north) 让相机水平指向圆心；pitch = 0 平视
      const lookE = 0 - localE;
      const lookN = 0 - localN;
      const headingRad = Math.atan2(lookE, lookN); // 北=0 CW
      const headingDeg = ((Cesium.Math.toDegrees(headingRad) % 360) + 360) % 360;
      const pitchDeg = 0;

      const wp = createWaypoint({
        lon: wgs.lon,
        lat: wgs.lat,
        alt: wgs.alt,
        index: waypoints.length,
        speed: 0,
        heading: headingDeg,
        pitch: pitchDeg,
        fov: 60,
      });
      wp.gimbalYaw = headingDeg;
      waypoints.push(wp);
    }
  }

  return waypoints;
}

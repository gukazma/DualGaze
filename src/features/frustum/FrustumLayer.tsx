import { useEffect, useRef } from 'react';
import * as Cesium from 'cesium';
import { useCesiumViewer } from '../cesium/CesiumContext';
import { useCurrentMission } from '../../store/missions';
import { useSimulationStore } from '../../store/simulation';
import { wgs84ToCartesian3 } from '../../lib/coord';
import { faceCesiumColor } from '../../lib/face-color';
import type { Mission, Waypoint } from '../../types/mission';
import { effectiveWaypoints } from '../simulation/SimulationLoop';

const FAR_METERS = 3;
const ASPECT = 4 / 3;

/**
 * 视锥可视化：
 *
 * - **编辑态**（mode !== 'simulating'）：所有 face 的所有 wp 都显示视锥，颜色按
 *   face index 调色板（一个 facade 一种色，帮用户横向比较拍摄覆盖）。
 *   非 activeFaceId 的 face 视锥半透明，让 active face 一眼看出。
 *
 * - **模拟态**（mode === 'simulating'）：只显示当前架次（activeFaceId 那个 face）
 *   且 reachedWaypointIds 内的 wp，作为飞过的痕迹。这样不会被其它 face 干扰。
 *
 * 历史 bug：编辑时不显示视锥，sim 结束后 reachedIds 还留着才显示全部 → 用户
 * 看不到规划阶段的覆盖情况。现在默认编辑就显示，sim 期间只显示走过的。
 */
export function FrustumLayer() {
  const viewer = useCesiumViewer();
  const mission = useCurrentMission();
  const reachedIds = useSimulationStore((s) => s.reachedWaypointIds);
  const simMode = useSimulationStore((s) => s.mode);
  const dsRef = useRef<Cesium.CustomDataSource | null>(null);

  useEffect(() => {
    if (!viewer) return;
    const ds = new Cesium.CustomDataSource('frustums');
    void viewer.dataSources.add(ds);
    dsRef.current = ds;
    return () => {
      viewer.dataSources.remove(ds, true);
      dsRef.current = null;
    };
  }, [viewer]);

  useEffect(() => {
    const ds = dsRef.current;
    if (!ds) return;
    ds.entities.removeAll();
    if (!mission) return;

    if (simMode === 'simulating') {
      // 模拟中：只画当前架次走过的视锥
      const activeIdx = facadeActiveFaceIndex(mission);
      for (const wp of effectiveWaypoints(mission)) {
        if (!reachedIds.has(wp.id)) continue;
        addFrustum(ds, wp, activeIdx >= 0 ? activeIdx : 0, 1.0);
      }
      return;
    }

    // 编辑：所有 face 全部 wp 都画
    if (mission.type === 'facade') {
      const faces = mission.facadeFaces ?? [];
      const activeId = mission.activeFaceId ?? null;
      faces.forEach((face, idx) => {
        if (!face.enabled || !face.scanPath) return;
        const isActive = activeId === face.id;
        const alpha = isActive ? 1.0 : 0.4;
        for (const wp of face.scanPath) {
          addFrustum(ds, wp, idx, alpha);
        }
      });
      return;
    }

    // patrol / mapping：用整条 path index 当 face index（color 沿路径渐变）
    const wps = effectiveWaypoints(mission);
    for (const wp of wps) {
      addFrustum(ds, wp, wp.index, 1.0);
    }
  }, [mission, reachedIds, simMode]);

  return null;
}

function facadeActiveFaceIndex(mission: Mission): number {
  if (mission.type !== 'facade') return -1;
  const faces = mission.facadeFaces ?? [];
  const id = mission.activeFaceId ?? null;
  return faces.findIndex((f) => f.id === id);
}

function addFrustum(
  ds: Cesium.CustomDataSource,
  wp: Waypoint,
  faceIdx: number,
  alpha: number,
): void {
  const { apex, corners } = frustumGeometry(wp);
  const fill = faceCesiumColor(faceIdx, 0.22 * alpha, 0.5, 0.7);
  const outline = faceCesiumColor(faceIdx, 0.95 * alpha, 0.6, 0.75);

  // 4 三角面（apex + Ci + C(i+1)）。perPositionHeight 保证不被钳地。
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    ds.entities.add({
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy([apex, corners[i], corners[j]]),
        perPositionHeight: true,
        material: fill,
        outline: true,
        outlineColor: outline,
        outlineWidth: 2,
      },
    });
  }

  // 4 corner 围成的"远平面"（独立 polygon，提示视场矩形）
  ds.entities.add({
    polygon: {
      hierarchy: new Cesium.PolygonHierarchy(corners),
      perPositionHeight: true,
      material: Cesium.Color.TRANSPARENT,
      outline: true,
      outlineColor: outline,
      outlineWidth: 1.5,
    },
  });
}

function frustumGeometry(wp: Waypoint): {
  apex: Cesium.Cartesian3;
  corners: Cesium.Cartesian3[];
} {
  const apex = wgs84ToCartesian3(wp.lon, wp.lat, wp.alt);
  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(apex);

  const headingRad = Cesium.Math.toRadians(wp.heading);
  const pitchRad = Cesium.Math.toRadians(wp.pitch);
  const fovRad = Cesium.Math.toRadians(wp.fov);

  const cosH = Math.cos(headingRad);
  const sinH = Math.sin(headingRad);
  const cosP = Math.cos(pitchRad);
  const sinP = Math.sin(pitchRad);

  // forward in ENU：heading=0 → +Y(N)，pitch>0 → +Z（向上）
  const forward = new Cesium.Cartesian3(cosP * sinH, cosP * cosH, sinP);
  // right in ENU 水平面，heading=0 → +X(E)
  const right = new Cesium.Cartesian3(cosH, -sinH, 0);
  // up = right × forward
  const up = new Cesium.Cartesian3();
  Cesium.Cartesian3.cross(right, forward, up);
  Cesium.Cartesian3.normalize(up, up);

  const halfW = Math.tan(fovRad / 2) * FAR_METERS;
  const halfH = halfW / ASPECT;

  // 远端中心点（ENU 局部）
  const center = scale(forward, FAR_METERS);
  const cornersLocal = [
    add(add(center, scale(up, halfH)), scale(right, -halfW)), // TL
    add(add(center, scale(up, halfH)), scale(right, halfW)),  // TR
    add(add(center, scale(up, -halfH)), scale(right, halfW)), // BR
    add(add(center, scale(up, -halfH)), scale(right, -halfW)),// BL
  ];

  const corners = cornersLocal.map((c) =>
    Cesium.Matrix4.multiplyByPoint(enu, c, new Cesium.Cartesian3()),
  );
  return { apex, corners };
}

function add(a: Cesium.Cartesian3, b: Cesium.Cartesian3): Cesium.Cartesian3 {
  return Cesium.Cartesian3.add(a, b, new Cesium.Cartesian3());
}
function scale(a: Cesium.Cartesian3, s: number): Cesium.Cartesian3 {
  return Cesium.Cartesian3.multiplyByScalar(a, s, new Cesium.Cartesian3());
}

import { useCallback, useEffect, useRef } from 'react';
import * as Cesium from 'cesium';
import { useCesiumViewer } from './CesiumContext';
import { useCurrentMission, useMissionsStore } from '../../store/missions';
import { useLocationStore } from '../../store/location';
import { wgs84ToCartesian3 } from '../../lib/coord';
import type { Mission } from '../../types/mission';

const DEFAULT_LON = 116.4074;
const DEFAULT_LAT = 39.9042;
const DEFAULT_ALT = 5000;
const DEFAULT_PITCH_DEG = -55;

/**
 * 当切换 / 选中 mission 时，自动把相机飞到该 mission 的几何中心。
 * - patrol：用 mission.waypoints 算包围球
 * - mapping：用 mission.polygon 算包围球（polygon 有 ≥1 点就够）
 * - 启动时无 mission：飞到 location store 里的 recent（如果有），否则飞北京
 *
 * 启动时 fallback 用 setView 立即就位（不动画），避免用户看到一段
 * "黑屏 → 飞过去" 的过渡（Cesium 默认相机在大西洋上空 12,000km，
 * 视野里几乎全是黑色 + 地球小球，体感是 "找不到地球"）。
 */
export function useFlyToMission(): void {
  const viewer = useCesiumViewer();
  const mission = useCurrentMission();
  const hasInitFlown = useRef(false);
  const lastFlownMissionRef = useRef<string | null>(null);
  const lastAnchorCountRef = useRef<number>(0);

  useEffect(() => {
    if (!viewer) return;

    const anchors = collectAnchors(mission);

    // === 路径 A：有 mission 且有 anchor → 飞 mission ===
    if (mission && anchors.length > 0) {
      const changedMission = mission.id !== lastFlownMissionRef.current;
      const firstAnchor =
        lastFlownMissionRef.current === mission.id &&
        lastAnchorCountRef.current === 0;

      if (changedMission || firstAnchor || !hasInitFlown.current) {
        const positions = anchors.map((p) => wgs84ToCartesian3(p.lon, p.lat, p.alt));
        const sphere = Cesium.BoundingSphere.fromPoints(positions);
        const range = Math.max(sphere.radius * 3, 400);
        viewer.camera.flyToBoundingSphere(sphere, {
          offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-50), range),
          duration: hasInitFlown.current ? 1.2 : 0,
        });
        lastFlownMissionRef.current = mission.id;
        hasInitFlown.current = true;
      }
      lastAnchorCountRef.current = anchors.length;
      return;
    }

    // === 路径 B：没 mission / 没 anchor → 仅启动时飞一次默认 ===
    if (!hasInitFlown.current) {
      const recent = useLocationStore.getState().recent;
      const lon = recent?.lon ?? DEFAULT_LON;
      const lat = recent?.lat ?? DEFAULT_LAT;
      // setView 立即就位 —— 用户首屏直接看到地球，不经历 12000km
      // 飞回 5km 的长动画（飞这种距离 Cesium 内部还会先穿太空，体验差）
      viewer.camera.setView({
        destination: wgs84ToCartesian3(lon, lat, DEFAULT_ALT),
        orientation: {
          heading: 0,
          pitch: Cesium.Math.toRadians(DEFAULT_PITCH_DEG),
          roll: 0,
        },
      });
      hasInitFlown.current = true;
    }
    lastFlownMissionRef.current = mission?.id ?? null;
    lastAnchorCountRef.current = 0;
  }, [viewer, mission?.id, mission?.waypoints.length, mission?.polygon?.length, mission]);
}

function collectAnchors(
  mission: ReturnType<typeof useCurrentMission>,
): Array<{ lon: number; lat: number; alt: number }> {
  if (!mission) return [];
  if (mission.type === 'mapping') {
    return mission.polygon ?? [];
  }
  if (mission.type === 'facade') {
    // 优先 activeFaceId 的角点 + scanPath；都没有就把所有 face 的角点 / scanPath 合并
    const faces = mission.facadeFaces ?? [];
    const active = faces.find((f) => f.id === mission.activeFaceId) ?? faces[0];
    const out: Array<{ lon: number; lat: number; alt: number }> = [];
    const collectFace = (f: typeof faces[number]): void => {
      for (const c of f.corners) out.push({ lon: c.lon, lat: c.lat, alt: c.alt });
      for (const wp of f.scanPath ?? []) {
        out.push({ lon: wp.lon, lat: wp.lat, alt: wp.alt });
      }
    };
    if (active && (active.corners.length > 0 || (active.scanPath?.length ?? 0) > 0)) {
      collectFace(active);
    } else {
      for (const f of faces) collectFace(f);
    }
    return out;
  }
  return mission.waypoints;
}

/**
 * 把相机飞到当前 mission 的"最优视角"。
 *
 * - facade: 当前 activeFaceId 那一面的 corners + scanPath 包围球
 * - mapping: polygon 包围球
 * - patrol: waypoints 包围球
 * - 都没有：location store 的 recent，再没有飞北京默认
 *
 * 由 Home 按钮 / Space 快捷键调用，duration=1.2s 带动画感。
 */
export function flyHome(viewer: Cesium.Viewer): void {
  if (viewer.isDestroyed()) return;
  const mState = useMissionsStore.getState();
  const mission: Mission | null =
    mState.missions.find((m) => m.id === mState.currentMissionId) ?? null;
  const anchors = collectAnchors(mission);

  if (mission && anchors.length > 0) {
    const positions = anchors.map((p) => wgs84ToCartesian3(p.lon, p.lat, p.alt));
    const sphere = Cesium.BoundingSphere.fromPoints(positions);
    // facade 单面跨度通常很小（10-20m），用更紧凑的 range 系数（×2.2）
    // 其它（mapping / patrol）维持 ×3
    const rangeMul = mission.type === 'facade' ? 2.2 : 3;
    const range = Math.max(sphere.radius * rangeMul, 30);
    viewer.camera.flyToBoundingSphere(sphere, {
      offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-50), range),
      duration: 1.2,
    });
    return;
  }

  // 兜底：飞 recent / 北京
  const recent = useLocationStore.getState().recent;
  const lon = recent?.lon ?? DEFAULT_LON;
  const lat = recent?.lat ?? DEFAULT_LAT;
  viewer.camera.flyTo({
    destination: wgs84ToCartesian3(lon, lat, DEFAULT_ALT),
    orientation: {
      heading: 0,
      pitch: Cesium.Math.toRadians(DEFAULT_PITCH_DEG),
      roll: 0,
    },
    duration: 1.2,
  });
}

/**
 * Hook 形式 —— 在 React 组件里拿一个 () => void 直接绑按钮。
 * 内部 useCallback 拿稳定引用，按钮 onClick 不会引发额外重渲。
 */
export function useFlyHome(): () => void {
  const viewer = useCesiumViewer();
  return useCallback(() => {
    if (!viewer) return;
    flyHome(viewer);
  }, [viewer]);
}

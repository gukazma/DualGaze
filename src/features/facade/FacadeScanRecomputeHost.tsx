import { useEffect } from 'react';
import { useCesiumViewer } from '../cesium/CesiumContext';
import { useCurrentMission, useMissionsStore } from '../../store/missions';
import { generateFacadeScanPath } from '../../lib/facade-scan';
import { annotateUnsafe } from '../../lib/facade-safety';
import { flipFacadePlane } from '../../lib/facade-plane';

/**
 * facade mission 的 scanPath 自动重算 host。
 *
 * 触发条件：face.plane 存在 + face.scanPath 为 undefined 或 params 变化 → 重算。
 *
 * 当前实现：每次 mission 变化时扫一遍所有 face，找 plane && !scanPath 的重新算。
 * 这样 updateFacadeFaceParams 把 scanPath 清空后会被这里捡起来重算。
 */
export function FacadeScanRecomputeHost() {
  const viewer = useCesiumViewer();
  const mission = useCurrentMission();
  const setFaceScanResult = useMissionsStore((s) => s.setFaceScanResult);

  useEffect(() => {
    if (!viewer || !mission || mission.type !== 'facade') return;
    const faces = mission.facadeFaces ?? [];
    for (const face of faces) {
      // 有 plane 但 scanPath 为 undefined → 需要算
      if (!face.plane) continue;
      if (face.scanPath !== undefined) continue;
      const plane = face.params.flipNormal ? flipFacadePlane(face.plane) : face.plane;
      const scanPath = generateFacadeScanPath(viewer, plane, face.corners, face.params);
      annotateUnsafe(viewer, plane, scanPath, face.params.standoff);
      setFaceScanResult(face.id, face.plane, scanPath);
    }
  }, [viewer, mission, setFaceScanResult]);

  return null;
}

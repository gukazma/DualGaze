import { useEffect } from 'react';
import { useCurrentMission, useMissionsStore } from '../../store/missions';
import { generateOrbitScanPath } from '../../lib/orbit-scan';

/**
 * orbit mission：当 orbit 几何 or params 变化导致 scanPath=undefined 时重算。
 *
 * 触发链路：
 *   - picker 完成 → setOrbit({ ..., scanPath: undefined }) → 本 host 检出 → 算 scanPath
 *   - updateOrbitParams → 同上
 *
 * 不需要 viewer（orbit 算法纯几何，不 raycast）。
 */
export function OrbitScanRecomputeHost() {
  const mission = useCurrentMission();
  const setOrbitScanResult = useMissionsStore((s) => s.setOrbitScanResult);

  useEffect(() => {
    if (!mission || mission.type !== 'orbit' || !mission.orbit) return;
    if (mission.orbit.scanPath !== undefined) return;
    const scanPath = generateOrbitScanPath(mission.orbit);
    setOrbitScanResult(scanPath);
  }, [mission, setOrbitScanResult]);

  return null;
}

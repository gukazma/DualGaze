import { useEffect } from 'react';
import { toast } from 'sonner';
import { useCurrentMission, useMissionsStore } from '../../store/missions';
import { useOvPathGenStore } from '../../store/ov-pathgen';
import { splitRegions } from '../../lib/ov/region-split';
import { orderViewsTSP } from '../../lib/ov/tsp';
import { regionToSortie, resplitSorties } from '../../lib/ov/sortie-split';

/**
 * OV 路径生成 host —— 监听 useOvPathGenStore.requested。
 *
 * - 'path' 模式：splitRegions(selectedViews) → 每区域 orderViewsTSP → regionToSortie
 *   → setOvPaths（每区域 1 架次）
 * - 'sortie' 模式：resplitSorties(现有 paths) → setOvPaths（按电池再切 + 增高）
 *
 * 纯几何/数组计算，无 viewer 依赖，同步快（136 视角 / 区域 ~34，秒内完成）。
 */
export function OvPathGenHost() {
  const mission = useCurrentMission();
  const requested = useOvPathGenStore((s) => s.requested);
  const setStatus = useOvPathGenStore((s) => s.setStatus);
  const setError = useOvPathGenStore((s) => s.setError);
  const acknowledge = useOvPathGenStore((s) => s.acknowledge);
  const setOvPaths = useMissionsStore((s) => s.setOvPaths);

  useEffect(() => {
    if (!requested) return;
    if (!mission || mission.type !== 'ov' || !mission.ov) {
      setError('未找到 ov mission');
      acknowledge();
      return;
    }
    const ov = mission.ov;
    const mode = requested;
    acknowledge();
    setStatus('running');

    try {
      if (mode === 'path') {
        const views = ov.selectedViews?.length ? ov.selectedViews : ov.candidateViews;
        if (!views || views.length === 0) {
          setError('未生成视角');
          setStatus('error');
          return;
        }
        const regions = splitRegions(views, ov.pathParams);
        const sorties = regions.map((region, i) => {
          const ordered = orderViewsTSP(region, ov.pathParams);
          return regionToSortie(ordered, i, ov.splitParams);
        });
        setOvPaths(sorties);
        setStatus('done');
        const totalWp = sorties.reduce((a, s) => a + s.waypoints.length, 0);
        toast.success('路径生成完成', {
          description: `${sorties.length} 区域 · ${totalWp} 航点`,
        });
      } else {
        // sortie 模式
        if (!ov.paths || ov.paths.length === 0) {
          setError('未生成路径');
          setStatus('error');
          return;
        }
        const resplit = resplitSorties(ov.paths, ov.splitParams);
        setOvPaths(resplit);
        setStatus('done');
        const totalWp = resplit.reduce((a, s) => a + s.waypoints.length, 0);
        toast.success('分架次完成', {
          description: `${resplit.length} 架次 · ${totalWp} 航点`,
        });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`路径生成失败：${msg}`);
      toast.error('路径生成失败', { description: msg });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested]);

  return null;
}

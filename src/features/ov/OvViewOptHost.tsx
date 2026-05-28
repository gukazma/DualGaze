import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useCurrentMission, useMissionsStore } from '../../store/missions';
import { useOvViewOptStore } from '../../store/ov-viewopt';
import { buildVisibility, computeCoverCounts } from '../../lib/ov/visibility';
import { runOvViewOpt } from '../../lib/ov/view-opt';

/**
 * OV 视角优化 host —— 监听 useOvViewOptStore.requested。
 *
 * 触发 → buildVisibility(候选视角×采样) → runOvViewOpt(贪心 set-cover)
 * → computeCoverCounts(用 selected 重算每 sample coverCount，6 色热图用)
 * → setOvSelectedViews + setOvSamples(带 coverCount) + setOvVisibility
 *
 * 不依赖 viewer（纯几何计算），所以即使主 viewer 在忙也能跑。
 */
export function OvViewOptHost() {
  const mission = useCurrentMission();
  const requested = useOvViewOptStore((s) => s.requested);
  const setStatus = useOvViewOptStore((s) => s.setStatus);
  const setProgress = useOvViewOptStore((s) => s.setProgress);
  const setError = useOvViewOptStore((s) => s.setError);
  const acknowledge = useOvViewOptStore((s) => s.acknowledge);
  const setOvSamples = useMissionsStore((s) => s.setOvSamples);
  const setOvSelectedViews = useMissionsStore((s) => s.setOvSelectedViews);
  const setOvVisibility = useMissionsStore((s) => s.setOvVisibility);

  const statusRef = useRef(useOvViewOptStore.getState().status);
  useEffect(() => {
    const unsub = useOvViewOptStore.subscribe((state) => {
      statusRef.current = state.status;
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!requested) return;
    if (!mission || mission.type !== 'ov' || !mission.ov) {
      setError('未找到 ov mission');
      acknowledge();
      return;
    }
    const ov = mission.ov;
    if (!ov.candidateViews || ov.candidateViews.length === 0) {
      setError('未生成候选视角');
      acknowledge();
      return;
    }
    if (!ov.samples || ov.samples.length === 0) {
      setError('未采样');
      acknowledge();
      return;
    }

    acknowledge();
    setStatus('running');
    setProgress({ selected: 0, totalSamples: ov.samples.length, coveredSamples: 0, elapsedMs: 0 });

    const isCancelled = (): boolean => statusRef.current === 'cancelled';

    const samples = ov.samples.map((s) => ({ ...s, normal: [...s.normal] as [number, number, number] }));
    const vis = buildVisibility(ov.candidateViews, samples, ov.samplingParams, ov.cameraParams);

    runOvViewOpt(
      ov.candidateViews,
      samples,
      vis,
      ov.viewOptParams,
      (p) => setProgress(p),
      isCancelled,
    )
      .then((selected) => {
        if (statusRef.current === 'cancelled') return;
        // 用 selected 重算 coverCount → 6 色热图
        computeCoverCounts(samples, selected, vis.viewSees);
        setOvSamples(samples);
        setOvSelectedViews(selected);
        // visibility 汇总（sampleToViews 仅存数量摘要避免体积爆炸）
        const sampleToViews: Record<string, string[]> = {};
        let sumCover = 0;
        for (const s of samples) {
          sumCover += s.coverCount ?? 0;
        }
        setOvVisibility({
          sampleToViews,
          avgCoverage: samples.length ? sumCover / samples.length : 0,
        });
        setStatus('done');
        toast.success('视角优化完成', {
          description: `${ov.candidateViews!.length} → ${selected.length} 视角 · 平均覆盖 ${(sumCover / Math.max(1, samples.length)).toFixed(1)}`,
        });
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        setError(`视角优化失败：${msg}`);
        toast.error('视角优化失败', { description: msg });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested]);

  return null;
}

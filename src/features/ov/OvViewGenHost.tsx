import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useCesiumViewer } from '../cesium/CesiumContext';
import { useCurrentMission, useMissionsStore } from '../../store/missions';
import { useOvViewGenStore } from '../../store/ov-viewgen';
import { estimateNormals } from '../../lib/ov/normals';
import { samplingStepMeters } from '../../lib/ov/sampling';
import { runOvViewGen } from '../../lib/ov/view-gen';

/**
 * OV 视角生成异步 host —— 监听 useOvViewGenStore.requested。
 *
 * 触发 → 先 estimateNormals（替换 M31 占位法向）→ runOvViewGen → 写回 candidateViews。
 * normals 就地改 samples 数组里的 normal 字段，再 setOvSamples 持久化新法向。
 */
export function OvViewGenHost() {
  const viewer = useCesiumViewer();
  const mission = useCurrentMission();
  const requested = useOvViewGenStore((s) => s.requested);
  const setStatus = useOvViewGenStore((s) => s.setStatus);
  const setProgress = useOvViewGenStore((s) => s.setProgress);
  const setError = useOvViewGenStore((s) => s.setError);
  const acknowledge = useOvViewGenStore((s) => s.acknowledge);
  const setOvSamples = useMissionsStore((s) => s.setOvSamples);
  const setOvCandidateViews = useMissionsStore((s) => s.setOvCandidateViews);

  const statusRef = useRef(useOvViewGenStore.getState().status);
  useEffect(() => {
    const unsub = useOvViewGenStore.subscribe((state) => {
      statusRef.current = state.status;
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!requested) return;
    if (!viewer || viewer.isDestroyed()) return;
    if (!mission || mission.type !== 'ov' || !mission.ov) {
      setError('未找到 ov mission');
      acknowledge();
      return;
    }
    const ov = mission.ov;
    if (!ov.samples || ov.samples.length === 0) {
      setError('未采样');
      acknowledge();
      return;
    }

    acknowledge();
    setStatus('running');
    setProgress({ total: ov.samples.length, done: 0, views: 0, elapsedMs: 0 });

    const isCancelled = (): boolean => statusRef.current === 'cancelled';

    // 1. 法向估计（就地改 samples 的 normal）
    const samples = ov.samples.map((s) => ({ ...s, normal: [...s.normal] as [number, number, number] }));
    const stepM = samplingStepMeters(ov.samplingParams, ov.cameraParams);
    estimateNormals(samples, stepM);

    // 2. 视角生成
    runOvViewGen(
      viewer,
      samples,
      ov.viewGenParams,
      ov.samplingParams,
      (p) => setProgress(p),
      isCancelled,
    )
      .then((views) => {
        if (statusRef.current === 'cancelled') return;
        setOvSamples(samples); // 写回带新法向的 samples
        setOvCandidateViews(views);
        setStatus('done');
        toast.success('视角生成完成', {
          description: `${views.length} 个候选视角 · ${samples.length} 采样点`,
        });
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        setError(`视角生成失败：${msg}`);
        toast.error('视角生成失败', { description: msg });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested, viewer]);

  return null;
}

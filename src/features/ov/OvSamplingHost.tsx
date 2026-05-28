import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useCesiumViewer } from '../cesium/CesiumContext';
import { useCurrentMission, useMissionsStore } from '../../store/missions';
import { useOvSamplingStore } from '../../store/ov-sampling';
import { runOvSampling } from '../../lib/ov/sampling';

/**
 * OV 采样异步 host —— 监听 useOvSamplingStore.requested。
 *
 * 触发到位 → 异步跑 runOvSampling（每 128 格让出事件循环 + 刷 progress）
 * → 结束 setOvSamples + setStatus('done') + toast
 *
 * 取消：用户点 [取消] → setStatus('cancelled') → 内层 isCancelled() 立即 return
 */
export function OvSamplingHost() {
  const viewer = useCesiumViewer();
  const mission = useCurrentMission();
  const requested = useOvSamplingStore((s) => s.requested);
  const setStatus = useOvSamplingStore((s) => s.setStatus);
  const setProgress = useOvSamplingStore((s) => s.setProgress);
  const setError = useOvSamplingStore((s) => s.setError);
  const acknowledge = useOvSamplingStore((s) => s.acknowledge);
  const setOvSamples = useMissionsStore((s) => s.setOvSamples);

  // ref 跟踪当前 status —— async loop 内通过 isCancelled() 读
  const statusRef = useRef(useOvSamplingStore.getState().status);
  useEffect(() => {
    const unsub = useOvSamplingStore.subscribe((state) => {
      statusRef.current = state.status;
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!requested) return;
    if (!viewer || viewer.isDestroyed()) return;
    if (!mission || mission.type !== 'ov' || !mission.ov?.aoi) {
      setError('未设置 AOI');
      acknowledge();
      return;
    }
    const ov = mission.ov;
    if (!ov.aoi) return;

    acknowledge();
    setStatus('running');
    setProgress({ total: 0, done: 0, samples: 0, elapsedMs: 0 });

    const isCancelled = (): boolean =>
      statusRef.current === 'cancelled';

    runOvSampling(
      viewer,
      ov.aoi,
      ov.samplingParams,
      ov.cameraParams,
      (p) => setProgress(p),
      isCancelled,
      ov.noFlyZones,
    )
      .then((samples) => {
        if (statusRef.current === 'cancelled') return;
        setOvSamples(samples);
        setStatus('done');
        toast.success('采样完成', {
          description: `${samples.length} 个采样点`,
        });
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        setError(`采样失败：${msg}`);
        toast.error('采样失败', { description: msg });
      });
    // dep 列表故意省略 mission，避免 mission 在 running 时变化重启 sampler；
    // 用户改 AOI / params 会触发新一轮 trigger（store.requested = true）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested, viewer]);

  return null;
}

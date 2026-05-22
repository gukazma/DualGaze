import { create } from 'zustand';

/**
 * OV 采样运行时状态（独立于 mission store，因 progress 体量大不进 persist）。
 *
 * 流程：UI 点 [▶ 开始采样] → trigger() → SamplingHost 检测到 requested 为 true →
 *   异步跑 ray-cast → progress 实时刷新 → 结束写回 mission.ov.samples 并 setStatus('done')
 */
export interface OvSamplingProgress {
  total: number;
  done: number;
  samples: number;
  elapsedMs: number;
}

export type OvSamplingStatus = 'idle' | 'running' | 'done' | 'cancelled' | 'error';

interface OvSamplingStore {
  status: OvSamplingStatus;
  progress: OvSamplingProgress | null;
  error: string | null;
  /** UI 触发：设为 true 让 host 启动一次 run */
  requested: boolean;

  trigger: () => void;
  setStatus: (s: OvSamplingStatus) => void;
  setProgress: (p: OvSamplingProgress) => void;
  setError: (msg: string) => void;
  cancel: () => void;
  reset: () => void;
  /** Host 启动后清掉 requested 标志 */
  acknowledge: () => void;
}

export const useOvSamplingStore = create<OvSamplingStore>((set) => ({
  status: 'idle',
  progress: null,
  error: null,
  requested: false,

  trigger: () => set({ requested: true, error: null }),
  setStatus: (status) => set({ status }),
  setProgress: (progress) => set({ progress }),
  setError: (msg) => set({ error: msg, status: 'error' }),
  cancel: () => set({ status: 'cancelled', requested: false }),
  reset: () =>
    set({ status: 'idle', progress: null, error: null, requested: false }),
  acknowledge: () => set({ requested: false }),
}));

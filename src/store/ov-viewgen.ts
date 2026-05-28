import { create } from 'zustand';

/**
 * OV 视角生成运行时状态（与 ov-sampling 同构）。
 * UI 点 [▶ 生成视角] → trigger() → OvViewGenHost 检测 requested → 异步跑 → 写回 candidateViews。
 */
export interface OvViewGenProgress {
  total: number;
  done: number;
  views: number;
  elapsedMs: number;
}

export type OvViewGenStatus = 'idle' | 'running' | 'done' | 'cancelled' | 'error';

interface OvViewGenStore {
  status: OvViewGenStatus;
  progress: OvViewGenProgress | null;
  error: string | null;
  requested: boolean;

  trigger: () => void;
  setStatus: (s: OvViewGenStatus) => void;
  setProgress: (p: OvViewGenProgress) => void;
  setError: (msg: string) => void;
  cancel: () => void;
  reset: () => void;
  acknowledge: () => void;
}

export const useOvViewGenStore = create<OvViewGenStore>((set) => ({
  status: 'idle',
  progress: null,
  error: null,
  requested: false,

  trigger: () => set({ requested: true, error: null }),
  setStatus: (status) => set({ status }),
  setProgress: (progress) => set({ progress }),
  setError: (msg) => set({ error: msg, status: 'error' }),
  cancel: () => set({ status: 'cancelled', requested: false }),
  reset: () => set({ status: 'idle', progress: null, error: null, requested: false }),
  acknowledge: () => set({ requested: false }),
}));

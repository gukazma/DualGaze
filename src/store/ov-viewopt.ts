import { create } from 'zustand';

/**
 * OV 视角优化运行时状态（与 ov-sampling / ov-viewgen 同构）。
 */
export interface OvViewOptProgress {
  selected: number;
  totalSamples: number;
  coveredSamples: number;
  elapsedMs: number;
}

export type OvViewOptStatus = 'idle' | 'running' | 'done' | 'cancelled' | 'error';

interface OvViewOptStore {
  status: OvViewOptStatus;
  progress: OvViewOptProgress | null;
  error: string | null;
  requested: boolean;

  trigger: () => void;
  setStatus: (s: OvViewOptStatus) => void;
  setProgress: (p: OvViewOptProgress) => void;
  setError: (msg: string) => void;
  cancel: () => void;
  reset: () => void;
  acknowledge: () => void;
}

export const useOvViewOptStore = create<OvViewOptStore>((set) => ({
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

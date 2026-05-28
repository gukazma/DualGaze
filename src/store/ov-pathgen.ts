import { create } from 'zustand';

/**
 * OV 路径生成运行时状态。两种触发：
 *  - 'path'：区域分割 + TSP → 每区域 1 架次
 *  - 'sortie'：对现有 paths 按电池限制再切 + 进出航线增高
 */
export type OvPathGenMode = 'path' | 'sortie';
export type OvPathGenStatus = 'idle' | 'running' | 'done' | 'error';

interface OvPathGenStore {
  status: OvPathGenStatus;
  error: string | null;
  requested: OvPathGenMode | null;

  triggerPath: () => void;
  triggerSortie: () => void;
  setStatus: (s: OvPathGenStatus) => void;
  setError: (msg: string) => void;
  reset: () => void;
  acknowledge: () => void;
}

export const useOvPathGenStore = create<OvPathGenStore>((set) => ({
  status: 'idle',
  error: null,
  requested: null,

  triggerPath: () => set({ requested: 'path', error: null }),
  triggerSortie: () => set({ requested: 'sortie', error: null }),
  setStatus: (status) => set({ status }),
  setError: (msg) => set({ error: msg, status: 'error' }),
  reset: () => set({ status: 'idle', error: null, requested: null }),
  acknowledge: () => set({ requested: null }),
}));

import { create } from 'zustand';

/**
 * OV picker 共享状态（vanilla TS picker 与 React HUD 共用）。
 *
 * 仅 AOI 一种状态机；后续 obstacle / nofly / sweep / spot-orbit picker 再扩。
 * AOI mode：
 *  - drawing：用户在点 / 拖中（vertices 累加）
 *  - preview：≥3 顶点 + 双击 → 等用户按完成或继续编辑
 *  - error：拾取失败（如点到天空）
 */
export type OvAoiVertex = { lon: number; lat: number };

export type OvAoiPickerState =
  | { mode: 'drawing'; vertices: OvAoiVertex[] }
  | { mode: 'preview'; vertices: OvAoiVertex[] }
  | { mode: 'error'; message: string };

interface OvPickerStore {
  aoiState: OvAoiPickerState;
  setAoiState: (s: OvAoiPickerState) => void;
  resetAoi: () => void;
  /** 障碍/禁飞 picker 累加中的临时点（OvLayer 预览用） */
  auxPreview: { lon: number; lat: number; alt: number }[];
  setAuxPreview: (pts: { lon: number; lat: number; alt: number }[]) => void;
}

export const useOvPickerStore = create<OvPickerStore>((set) => ({
  aoiState: { mode: 'drawing', vertices: [] },
  setAoiState: (aoiState) => set({ aoiState }),
  resetAoi: () => set({ aoiState: { mode: 'drawing', vertices: [] } }),
  auxPreview: [],
  setAuxPreview: (auxPreview) => set({ auxPreview }),
}));

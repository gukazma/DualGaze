import { create } from 'zustand';
import type { OrbitPickerState } from '../features/orbit/OrbitPicker';

interface OrbitPickerStore {
  state: OrbitPickerState;
  setState: (s: OrbitPickerState) => void;
  /** picker class mount 时注册的 flip 入口，让 HUD 按钮能调 */
  flipPreviewDirection: (() => void) | null;
  setFlipPreviewDirection: (fn: (() => void) | null) => void;
}

export const useOrbitPickerStore = create<OrbitPickerStore>((set) => ({
  state: { mode: 'building', partial: {}, scanPath: [] },
  setState: (s) => set({ state: s }),
  flipPreviewDirection: null,
  setFlipPreviewDirection: (fn) => set({ flipPreviewDirection: fn }),
}));

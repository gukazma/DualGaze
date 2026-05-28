import { create } from 'zustand';
import type { MeasureMode } from '../lib/ov/measure';

/** OV 量取工具运行时（transient 读数）。 */
interface OvMeasureStore {
  mode: MeasureMode;
  readout: string | null;
  setMode: (m: MeasureMode) => void;
  setReadout: (r: string | null) => void;
}

export const useOvMeasureStore = create<OvMeasureStore>((set) => ({
  mode: 'dist3d',
  readout: null,
  setMode: (mode) => set({ mode }),
  setReadout: (readout) => set({ readout }),
}));

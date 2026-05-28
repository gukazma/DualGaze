import { create } from 'zustand';

/**
 * OV 主视图各图层显示开关（对齐蝶舞"显示功能"）。
 * OvLayer 订阅这些 flag 决定画哪些层；Tab8 提供 toggle UI。
 */
interface OvDisplayStore {
  showAoi: boolean;
  showSamples: boolean;
  showNormals: boolean;
  showViews: boolean;
  showPaths: boolean;
  showSafety: boolean; // 安全罩 / 禁飞 / 障碍物

  toggle: (key: OvDisplayKey) => void;
  setAll: (on: boolean) => void;
}

export type OvDisplayKey =
  | 'showAoi'
  | 'showSamples'
  | 'showNormals'
  | 'showViews'
  | 'showPaths'
  | 'showSafety';

export const useOvDisplayStore = create<OvDisplayStore>((set) => ({
  showAoi: true,
  showSamples: true,
  showNormals: false,
  showViews: true,
  showPaths: true,
  showSafety: true,

  toggle: (key) => set((s) => ({ [key]: !s[key] }) as Partial<OvDisplayStore>),
  setAll: (on) =>
    set({
      showAoi: on,
      showSamples: on,
      showNormals: on,
      showViews: on,
      showPaths: on,
      showSafety: on,
    }),
}));

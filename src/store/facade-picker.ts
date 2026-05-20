import { create } from 'zustand';
import type { FacadePickerState } from '../features/facade/FacadePicker';

interface FacadePickerStore {
  state: FacadePickerState;
  setState: (s: FacadePickerState) => void;
  /**
   * picker class 自己 mount 时注册的 flip 入口 —— 这样 HUD 按钮可以触发
   * picker.flipNormalInPreview()（FacadePicker 是 vanilla class，外部拿不到
   * 实例，必须通过 store 这个间接层）。picker unmount 时清掉。
   */
  flipPreviewNormal: (() => void) | null;
  setFlipPreviewNormal: (fn: (() => void) | null) => void;
}

/**
 * FacadePicker 把 drawing/preview/error 状态广播到这个 zustand store，
 * FacadeLayer / 顶部浮条都从这里订阅渲染。
 *
 * 仅在 pickerMode === 'facade-draw' 时有意义；picker mount 时 subscribe，
 * unmount 时 reset 回空 drawing。
 */
export const useFacadePickerStore = create<FacadePickerStore>((set) => ({
  state: { mode: 'drawing', corners: [] },
  setState: (s) => set({ state: s }),
  flipPreviewNormal: null,
  setFlipPreviewNormal: (fn) => set({ flipPreviewNormal: fn }),
}));

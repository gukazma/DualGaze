import { Crosshair, X } from 'lucide-react';
import { useUiStore } from '../store/ui';

/**
 * Takeoff picker 顶部浮条：1 步拾取提示 + Esc 退出。
 *
 * 触发条件 `pickerMode === 'takeoff-pick'`。命中后由 picker 自行切回 'idle'，HUD 隐去。
 */
export function TakeoffPickerHud() {
  const pickerMode = useUiStore((s) => s.pickerMode);
  const setPickerMode = useUiStore((s) => s.setPickerMode);

  if (pickerMode !== 'takeoff-pick') return null;

  return (
    <div className="pointer-events-none absolute left-1/2 top-4 z-30 -translate-x-1/2">
      <div className="pointer-events-auto flex h-10 items-center gap-2.5 rounded-md border border-[#ffd24a] bg-bg-panel/95 px-3 text-[12px] font-semibold text-text-primary shadow-lg backdrop-blur-sm">
        <Crosshair className="h-4 w-4 text-[#ffd24a]" />
        <span>🎯 在模型上点一处地面 / 楼顶作为起飞位置</span>
        <span className="rounded-sm border border-border bg-bg-input px-1.5 py-0.5 text-[10px] font-mono text-text-secondary">
          Esc
        </span>
        <button
          type="button"
          onClick={() => setPickerMode('idle')}
          className="ml-1 rounded p-0.5 text-text-muted hover:bg-bg-input hover:text-text-primary"
          title="退出起飞点拾取"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

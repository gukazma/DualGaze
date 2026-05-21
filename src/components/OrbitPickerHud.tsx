import { CircleCheck, AlertCircle, X, Check, RotateCw } from 'lucide-react';
import { useOrbitPickerStore } from '../store/orbit-picker';
import { useUiStore } from '../store/ui';
import { useMissionsStore, useCurrentMission } from '../store/missions';
import { cn } from '../lib/utils';

/**
 * Orbit picker 顶部浮条。3 步拾取进度 + preview 状态参数摘要 + 反转/保存 按钮。
 *
 * 紫色品牌 `#ffd24a` 区分 facade 的青色 HUD。
 */
export function OrbitPickerHud() {
  const pickerMode = useUiStore((s) => s.pickerMode);
  const setPickerMode = useUiStore((s) => s.setPickerMode);
  const state = useOrbitPickerStore((s) => s.state);
  const flipPreviewDirection = useOrbitPickerStore((s) => s.flipPreviewDirection);
  const setOrbit = useMissionsStore((s) => s.setOrbit);
  const mission = useCurrentMission();

  if (pickerMode !== 'orbit-draw') return null;

  const pointsCount = state.mode === 'drawing' ? state.points.length : 3;
  const isError = state.mode === 'error';
  const isPreview = state.mode === 'preview';

  const stepText =
    state.mode === 'error'
      ? state.message
      : isPreview
        ? `R=${state.orbit.radius.toFixed(1)}m · H=${(state.orbit.axisTop.alt - state.orbit.axisBottom.alt).toFixed(1)}m · ${state.scanPath.length} wp`
        : pointsCount === 0
          ? '① 点塔底中心'
          : pointsCount === 1
            ? '② 点塔顶中心 · ↕ 决定高度'
            : '③ 点塔侧任意墙面 · → 决定半径';

  const handleSave = (): void => {
    if (state.mode !== 'preview' || mission?.type !== 'orbit') return;
    setOrbit({ ...state.orbit, scanPath: state.scanPath });
    setPickerMode('idle');
  };

  return (
    <div className="pointer-events-none absolute left-1/2 top-4 z-30 -translate-x-1/2">
      <div
        className={cn(
          'pointer-events-auto flex h-10 items-center gap-2.5 rounded-md border bg-bg-panel/95 px-3 text-[12px] font-semibold shadow-lg backdrop-blur-sm',
          isError
            ? 'border-accent-danger text-accent-danger'
            : 'border-[#ffd24a] text-text-primary',
        )}
      >
        {!isPreview && !isError && (
          <div className="flex items-center gap-1">
            {[0, 1, 2].map((i) => {
              const done = i < pointsCount;
              const active = i === pointsCount;
              return (
                <span
                  key={i}
                  className={cn(
                    'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold',
                    done
                      ? 'bg-[#ffd24a]/80 text-bg'
                      : active
                        ? 'bg-accent text-bg'
                        : 'bg-bg-input text-text-muted',
                  )}
                >
                  {i + 1}
                </span>
              );
            })}
          </div>
        )}

        {isPreview && <CircleCheck className="h-4 w-4 text-[#ffd24a]" />}
        {isError && <AlertCircle className="h-4 w-4" />}

        <span>{stepText}</span>

        <span className="ml-1 flex items-center gap-1">
          {isPreview && (
            <>
              <button
                type="button"
                onClick={() => flipPreviewDirection?.()}
                className="flex items-center gap-1 rounded-sm border border-[#ffd24a] bg-[#ffd24a]/10 px-2 py-0.5 text-[11px] font-bold text-[#ffd24a] hover:bg-[#ffd24a]/20"
                title="反转飞行方向 cw↔ccw（F 同效）"
              >
                <RotateCw className="h-3 w-3" />
                反转
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="flex items-center gap-1 rounded-sm border border-accent bg-accent/10 px-2 py-0.5 text-[11px] font-bold text-accent hover:bg-accent/20"
                title="保存环绕（Enter 同效）"
              >
                <Check className="h-3 w-3" />
                保存
              </button>
              <ShortcutChip label="F" />
              <ShortcutChip label="Enter" />
            </>
          )}
          <ShortcutChip label="Esc" />
        </span>

        <button
          type="button"
          onClick={() => {
            if (isPreview && !window.confirm('当前有未保存的环绕 preview，确认丢弃？')) return;
            setPickerMode('idle');
          }}
          className="ml-1 rounded p-0.5 text-text-muted hover:bg-bg-input hover:text-text-primary"
          title="退出环绕拾取"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function ShortcutChip({ label }: { label: string }) {
  return (
    <span className="rounded-sm border border-border bg-bg-input px-1.5 py-0.5 text-[10px] font-mono text-text-secondary">
      {label}
    </span>
  );
}

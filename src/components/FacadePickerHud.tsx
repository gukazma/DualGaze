import { CheckCircle2, AlertCircle, TriangleAlert, X, Check, RefreshCw } from 'lucide-react';
import { useFacadePickerStore } from '../store/facade-picker';
import { useUiStore } from '../store/ui';
import { useMissionsStore } from '../store/missions';
import { cn } from '../lib/utils';

/**
 * Facade picker 的顶部浮条，pencil FrameD3 系列。
 *
 * - 只在 pickerMode === 'facade-draw' 显示
 * - 依据 picker state 展示当前 step (1/2/3/4) 或 preview / error 状态
 * - 提供 Esc / Enter / F 快捷键提示
 * - 右侧 X 按钮：退出 picker（setPickerMode='idle'）
 */
export function FacadePickerHud() {
  const pickerMode = useUiStore((s) => s.pickerMode);
  const setPickerMode = useUiStore((s) => s.setPickerMode);
  const commitFacadePreviewIfAny = useMissionsStore((s) => s.commitFacadePreviewIfAny);
  const state = useFacadePickerStore((s) => s.state);
  const flipPreviewNormal = useFacadePickerStore((s) => s.flipPreviewNormal);

  if (pickerMode !== 'facade-draw') return null;

  const cornersCount = state.corners.length;
  const isError = state.mode === 'error';
  const isPreview = state.mode === 'preview';
  const unsafeCount = isPreview ? state.unsafeCount : 0;
  const planeW = isPreview ? state.plane.width : 0;
  const planeH = isPreview ? state.plane.height : 0;

  return (
    <div className="pointer-events-none absolute left-1/2 top-4 z-30 -translate-x-1/2">
      <div
        className={cn(
          'pointer-events-auto flex h-10 items-center gap-2.5 rounded-md border bg-bg-panel/95 px-3 text-[12px] font-semibold shadow-lg backdrop-blur-sm',
          isError
            ? 'border-accent-danger text-accent-danger'
            : isPreview
              ? 'border-accent-cyan text-text-primary'
              : 'border-accent text-text-primary',
        )}
      >
        {/* step indicators (only in drawing mode) */}
        {!isPreview && !isError && (
          <div className="flex items-center gap-1">
            {[0, 1, 2, 3].map((i) => {
              const done = i < cornersCount;
              const active = i === cornersCount;
              return (
                <span
                  key={i}
                  className={cn(
                    'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold',
                    done
                      ? 'bg-accent-cyan/80 text-bg'
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

        {isPreview && <CheckCircle2 className="h-4 w-4 text-accent-cyan" />}
        {isError && <AlertCircle className="h-4 w-4" />}

        <span>
          {isError
            ? state.message
            : isPreview
              ? `立面已拟合 ${planeW.toFixed(1)}×${planeH.toFixed(1)}m · 法向 ↑`
              : cornersCount === 0
                ? '① 点立面左上角'
                : cornersCount === 1
                  ? '② 点立面左下角'
                  : cornersCount === 2
                    ? '③ 点右下角'
                    : '④ 点右上角（自动投影到前 3 点平面以保证共面）'}
        </span>

        {isPreview && unsafeCount > 0 && (
          <>
            <span className="h-4 w-px bg-border" />
            <span className="flex items-center gap-1 text-accent-danger">
              <TriangleAlert className="h-3.5 w-3.5" />
              {unsafeCount}/{state.scanPath.length} 离障碍过近
            </span>
          </>
        )}

        <span className="ml-1 flex items-center gap-1">
          {isPreview && (
            <>
              <button
                type="button"
                onClick={() => flipPreviewNormal?.()}
                className="flex items-center gap-1 rounded-sm border border-accent-cyan bg-accent-cyan/10 px-2 py-0.5 text-[11px] font-bold text-accent-cyan hover:bg-accent-cyan/20"
                title="反转法向（F 快捷键同效）"
              >
                <RefreshCw className="h-3 w-3" />
                反转
              </button>
              <button
                type="button"
                onClick={() => {
                  commitFacadePreviewIfAny();
                }}
                className="flex items-center gap-1 rounded-sm border border-accent bg-accent/10 px-2 py-0.5 text-[11px] font-bold text-accent hover:bg-accent/20"
                title="保存当前立面（Enter 同效）"
              >
                <Check className="h-3 w-3" />
                保存
              </button>
              <ShortcutChip label="F" hint="翻转法向" />
              <ShortcutChip label="Enter" hint="保存" />
            </>
          )}
          <ShortcutChip label="Esc" hint={isPreview || isError ? '重画' : '清空'} />
        </span>

        <button
          type="button"
          onClick={() => {
            if (isPreview) {
              const ok = window.confirm('当前有未保存的立面 preview，确认丢弃？');
              if (!ok) return;
            }
            setPickerMode('idle');
          }}
          className="ml-1 rounded p-0.5 text-text-muted hover:bg-bg-input hover:text-text-primary"
          title="退出立面拾取（preview 状态会丢弃）"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function ShortcutChip({ label, hint }: { label: string; hint: string }) {
  return (
    <span
      className="rounded-sm border border-border bg-bg-input px-1.5 py-0.5 text-[10px] font-mono text-text-secondary"
      title={hint}
    >
      {label}
    </span>
  );
}

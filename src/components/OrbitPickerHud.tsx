import { CircleCheck, AlertCircle, X, Check, RotateCw } from 'lucide-react';
import { useOrbitPickerStore } from '../store/orbit-picker';
import { useUiStore } from '../store/ui';
import { useMissionsStore, useCurrentMission } from '../store/missions';
import { stepOf, type BuildStep } from '../features/orbit/OrbitPicker';
import { cn } from '../lib/utils';

/**
 * Orbit picker 顶部浮条（v3.5 4 步累积）。
 *
 * 状态 → 文案：
 *   step axis     "Step 1/4 · 单击设轴位置 (lon/lat)"
 *   step bottom   "Step 2/4 · 单击设底高（塔脚附近）"
 *   step top      "Step 3/4 · 单击设顶高（塔顶 / 避雷针）"
 *   step radius   "Step 4/4 · 按住拖出半径"
 *   step done     "R=X.Xm · H=Y.Ym · Zwp · 拖任何 handle 微调"
 */
export function OrbitPickerHud() {
  const pickerMode = useUiStore((s) => s.pickerMode);
  const setPickerMode = useUiStore((s) => s.setPickerMode);
  const state = useOrbitPickerStore((s) => s.state);
  const flipPreviewDirection = useOrbitPickerStore((s) => s.flipPreviewDirection);
  const setOrbit = useMissionsStore((s) => s.setOrbit);
  const mission = useCurrentMission();

  if (pickerMode !== 'orbit-draw') return null;

  const isError = state.mode === 'error';
  const isBuilding = state.mode === 'building';
  const step: BuildStep | null = isBuilding ? stepOf(state.partial) : null;
  const isDone = step === 'done';

  const stepText =
    state.mode === 'error'
      ? state.message
      : !isBuilding
        ? ''
        : step === 'axis'
          ? 'Step 1/4 · 单击模型设轴位置 (lon/lat)'
          : step === 'bottom'
            ? 'Step 2/4 · 单击模型设底高（塔脚附近）'
            : step === 'top'
              ? 'Step 3/4 · 单击模型设顶高（塔顶 / 避雷针）'
              : step === 'radius'
                ? `Step 4/4 · 按住拖出半径 ${
                    state.partial.radius != null
                      ? `· R=${state.partial.radius.toFixed(1)}m`
                      : ''
                  }`
                : `R=${state.partial.radius?.toFixed(1)}m · H=${(
                    (state.partial.topAlt ?? 0) - (state.partial.bottomAlt ?? 0)
                  ).toFixed(1)}m · ${state.scanPath.length} wp · 拖任何 handle 微调`;

  const handleSave = (): void => {
    if (!isBuilding || !isDone || mission?.type !== 'orbit') return;
    const p = state.partial;
    if (
      p.axisLon == null ||
      p.axisLat == null ||
      p.bottomAlt == null ||
      p.topAlt == null ||
      p.radius == null
    )
      return;
    setOrbit({
      axisBottom: { lon: p.axisLon, lat: p.axisLat, alt: p.bottomAlt },
      axisTop: { lon: p.axisLon, lat: p.axisLat, alt: p.topAlt },
      radius: p.radius,
      params: {
        standoff: 8,
        verticalSpacing: 3,
        pointsPerRing: 16,
        startAngle: 0,
        direction: 'cw',
        bottomAltOffset: 1,
        topAltOffset: -1,
        flipRingDirection: true,
        totalH: p.topAlt - p.bottomAlt,
      },
      scanPath: state.scanPath,
    });
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
        {isBuilding && !isDone && (
          <span className="flex h-5 items-center justify-center rounded-full bg-[#ffd24a]/80 px-2 text-[10px] font-bold text-bg">
            {step === 'axis'
              ? '1/4'
              : step === 'bottom'
                ? '2/4'
                : step === 'top'
                  ? '3/4'
                  : '4/4'}
          </span>
        )}
        {isDone && <CircleCheck className="h-4 w-4 text-[#ffd24a]" />}
        {isError && <AlertCircle className="h-4 w-4" />}

        <span>{stepText}</span>

        <span className="ml-1 flex items-center gap-1">
          {isDone && (
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
            if (
              isBuilding &&
              step !== 'axis' &&
              !window.confirm('当前有未保存的环绕拾取，确认丢弃？')
            )
              return;
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

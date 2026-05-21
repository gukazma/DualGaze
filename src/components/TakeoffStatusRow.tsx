import { Home, MapPin, Pencil } from 'lucide-react';
import { useCurrentMission, useMissionsStore } from '../store/missions';
import { useUiStore } from '../store/ui';
import { cn } from '../lib/utils';

/**
 * RightSheet 顶部的「起飞点」状态行。
 *
 * 仅 facade / orbit mission 显示：
 *  - 未设：黄色边框 + 「未设置起飞点」+ 「📍 拾取」按钮
 *  - 已设：常规边框 + 坐标 + 高度 + 「重设」按钮
 *
 * 按钮点击 → setPickerMode('takeoff-pick')。
 */
export function TakeoffStatusRow() {
  const mission = useCurrentMission();
  const setPickerMode = useUiStore((s) => s.setPickerMode);
  const setTakeOff = useMissionsStore((s) => s.setTakeOffPoint);

  const isApplicable = mission?.type === 'facade' || mission?.type === 'orbit';
  if (!isApplicable) return null;

  const t = mission.takeOffPoint;

  return (
    <div
      className={cn(
        'flex h-9 items-center gap-2 border-b border-border-subtle px-3 text-[11px]',
        t ? 'bg-bg-surface' : 'bg-[#ffd24a]/10',
      )}
    >
      <Home
        className={cn(
          'h-3.5 w-3.5 shrink-0',
          t ? 'text-[#ffd24a]' : 'text-[#ffd24a]',
        )}
      />
      {t ? (
        <span className="flex flex-1 items-center gap-1.5 truncate text-text-secondary">
          <span className="font-semibold text-text-primary">起飞</span>
          <span className="font-mono text-text-muted">
            {t.lon.toFixed(5)}, {t.lat.toFixed(5)}
          </span>
          <span className="text-text-muted">·</span>
          <span className="font-mono">{t.alt.toFixed(1)} m</span>
        </span>
      ) : (
        <span className="flex-1 font-semibold text-[#ffd24a]">
          未设置起飞点 · 必填才能新建航线
        </span>
      )}
      <button
        type="button"
        onClick={() => setPickerMode('takeoff-pick')}
        className={cn(
          'flex h-6 items-center gap-1 rounded border px-1.5 text-[10px] font-semibold transition',
          t
            ? 'border-border bg-bg-input text-text-secondary hover:border-[#ffd24a] hover:text-[#ffd24a]'
            : 'border-[#ffd24a] bg-[#ffd24a] text-[#0c0d10] hover:bg-[#ffd24a]/90',
        )}
      >
        {t ? <Pencil className="h-3 w-3" /> : <MapPin className="h-3 w-3" />}
        {t ? '重设' : '拾取'}
      </button>
      {t && (
        <button
          type="button"
          onClick={() => setTakeOff(undefined)}
          className="text-[10px] text-text-muted hover:text-accent-danger"
          title="清除起飞点（KMZ 退回 WGS84 模式）"
        >
          清除
        </button>
      )}
    </div>
  );
}

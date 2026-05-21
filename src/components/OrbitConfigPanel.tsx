import { RotateCw, RotateCcw, Target } from 'lucide-react';
import { useCurrentMission, useMissionsStore } from '../store/missions';
import { ScrollArea } from './ui/scroll-area';
import { cn } from '../lib/utils';

/**
 * Orbit mission 「环绕配置」右 sheet tab —— 一个 orbit 一组参数（不像 facade 的多面列表）。
 *
 * 展示摘要 + 7 个调节项（standoff / verticalSpacing / pointsPerRing / startAngle /
 * direction / flipRingDirection / 高度偏移）。speed 走 globalSpeed（在「任务配置」tab）。
 */
export function OrbitConfigPanel() {
  const mission = useCurrentMission();
  const updateOrbitParams = useMissionsStore((s) => s.updateOrbitParams);

  if (!mission || mission.type !== 'orbit') return null;

  if (!mission.orbit) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="rounded-md border border-dashed border-border-subtle p-4 text-center text-[11px] text-text-muted">
          还没有环绕几何 · 在主视图点{' '}
          <span className="font-bold text-[#ffd24a]">+ 开始绘制环绕</span>{' '}
          按 3 点定塔轴 + 半径
        </div>
      </div>
    );
  }

  const { orbit } = mission;
  const { params } = orbit;
  const totalH = orbit.axisTop.alt - orbit.axisBottom.alt;
  const ringCount = Math.max(
    1,
    Math.ceil(
      Math.max(0.1, totalH - Math.max(0, params.bottomAltOffset) + Math.min(0, params.topAltOffset)) /
        Math.max(0.1, params.verticalSpacing),
    ) + 1,
  );
  const wpCount = ringCount * params.pointsPerRing;

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-3 p-3">
        {/* 摘要卡 */}
        <div className="rounded-md border border-[#ffd24a]/30 bg-[#2a2113]/40 p-3">
          <div className="flex items-center gap-2 text-[12px] font-bold text-text-primary">
            <Target className="h-4 w-4 text-[#ffd24a]" />
            圆柱 R={orbit.radius.toFixed(1)}m · H={totalH.toFixed(1)}m
          </div>
          <div className="mt-1 text-[11px] text-text-secondary">
            {ringCount} 圈 × {params.pointsPerRing} wp = {wpCount} 航点
          </div>
          <div className="mt-1 text-[10px] text-text-muted">
            实际飞行半径 {(orbit.radius + params.standoff).toFixed(1)}m （含 standoff）
          </div>
        </div>

        {/* 安全距 */}
        <RangeRow
          label="安全距 standoff"
          value={`${params.standoff.toFixed(1)} m`}
        >
          <input
            type="range"
            min={0}
            max={30}
            step={0.5}
            value={params.standoff}
            onChange={(e) => updateOrbitParams({ standoff: parseFloat(e.target.value) })}
            className="w-full accent-[#ffd24a]"
          />
        </RangeRow>

        {/* 圈高间距 */}
        <RangeRow
          label="圈高间距 verticalSpacing"
          value={`${params.verticalSpacing.toFixed(1)} m · ${ringCount} 圈`}
        >
          <input
            type="range"
            min={1}
            max={20}
            step={0.5}
            value={params.verticalSpacing}
            onChange={(e) =>
              updateOrbitParams({ verticalSpacing: parseFloat(e.target.value) })
            }
            className="w-full accent-[#ffd24a]"
          />
        </RangeRow>

        {/* 每圈点数 */}
        <RangeRow
          label="每圈点数 pointsPerRing"
          value={`${params.pointsPerRing} · ${(360 / params.pointsPerRing).toFixed(1)}° 间隔`}
        >
          <input
            type="range"
            min={4}
            max={48}
            step={1}
            value={params.pointsPerRing}
            onChange={(e) =>
              updateOrbitParams({ pointsPerRing: parseInt(e.target.value, 10) })
            }
            className="w-full accent-[#ffd24a]"
          />
        </RangeRow>

        {/* 起始方位 */}
        <RangeRow
          label="起始方位 startAngle"
          value={`${params.startAngle}° (${dirLabel(params.startAngle)})`}
        >
          <input
            type="range"
            min={0}
            max={359}
            step={1}
            value={params.startAngle}
            onChange={(e) => updateOrbitParams({ startAngle: parseInt(e.target.value, 10) })}
            className="w-full accent-[#ffd24a]"
          />
        </RangeRow>

        {/* direction segmented */}
        <Row label="飞行方向 direction">
          <div className="inline-flex rounded-md border border-border bg-bg-input p-0.5">
            <button
              type="button"
              onClick={() => updateOrbitParams({ direction: 'cw' })}
              className={cn(
                'flex items-center gap-1 rounded px-2 py-1 text-[11px] font-semibold',
                params.direction === 'cw'
                  ? 'bg-[#ffd24a] text-bg'
                  : 'text-text-secondary hover:text-text-primary',
              )}
            >
              <RotateCw className="h-3 w-3" /> 顺时针
            </button>
            <button
              type="button"
              onClick={() => updateOrbitParams({ direction: 'ccw' })}
              className={cn(
                'flex items-center gap-1 rounded px-2 py-1 text-[11px] font-semibold',
                params.direction === 'ccw'
                  ? 'bg-[#ffd24a] text-bg'
                  : 'text-text-secondary hover:text-text-primary',
              )}
            >
              <RotateCcw className="h-3 w-3" /> 逆时针
            </button>
          </div>
        </Row>

        {/* flipRingDirection toggle */}
        <Row label="蛇形上升 flipRingDirection">
          <button
            type="button"
            onClick={() =>
              updateOrbitParams({ flipRingDirection: !params.flipRingDirection })
            }
            className={cn(
              'relative h-5 w-9 rounded-full transition-colors',
              params.flipRingDirection ? 'bg-[#ffd24a]' : 'bg-bg-input',
            )}
            aria-pressed={params.flipRingDirection}
          >
            <span
              className={cn(
                'absolute top-0.5 h-4 w-4 rounded-full bg-text-primary transition-transform',
                params.flipRingDirection ? 'translate-x-4' : 'translate-x-0.5',
              )}
            />
          </button>
        </Row>

        {/* 高度偏移区 */}
        <div className="rounded-md bg-bg-input/40 p-3">
          <div className="mb-2 text-[10px] font-bold text-text-secondary">
            高度偏移（高级）
          </div>
          <RangeRow
            label="底圈偏移 bottomAltOffset"
            value={`${params.bottomAltOffset.toFixed(1)} m`}
            inline
          >
            <input
              type="range"
              min={0}
              max={20}
              step={0.5}
              value={params.bottomAltOffset}
              onChange={(e) =>
                updateOrbitParams({ bottomAltOffset: parseFloat(e.target.value) })
              }
              className="w-full accent-[#ffd24a]"
            />
          </RangeRow>
          <RangeRow
            label="顶圈偏移 topAltOffset"
            value={`${params.topAltOffset.toFixed(1)} m`}
            inline
          >
            <input
              type="range"
              min={-20}
              max={0}
              step={0.5}
              value={params.topAltOffset}
              onChange={(e) =>
                updateOrbitParams({ topAltOffset: parseFloat(e.target.value) })
              }
              className="w-full accent-[#ffd24a]"
            />
          </RangeRow>
        </div>

        {/* 反转方向 CTA */}
        <button
          type="button"
          onClick={() =>
            updateOrbitParams({
              direction: params.direction === 'cw' ? 'ccw' : 'cw',
            })
          }
          className="mt-2 flex h-9 items-center justify-center gap-2 rounded-md border border-[#ffd24a] bg-[#2a2113] text-[12px] font-bold text-[#ffd24a] hover:bg-[#2a2113]/70"
        >
          <RotateCw className="h-3.5 w-3.5" />
          反转方向（cw ↔ ccw）
        </button>
      </div>
    </ScrollArea>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 text-[11px]">
      <span className="font-semibold text-text-secondary">{label}</span>
      {children}
    </div>
  );
}

function RangeRow({
  label,
  value,
  children,
  inline,
}: {
  label: string;
  value: string;
  children: React.ReactNode;
  inline?: boolean;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', inline && 'mt-2')}>
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-semibold text-text-secondary">{label}</span>
        <span className="font-bold text-text-primary">{value}</span>
      </div>
      {children}
    </div>
  );
}

function dirLabel(deg: number): string {
  const d = ((deg % 360) + 360) % 360;
  if (d < 22.5 || d >= 337.5) return '正北';
  if (d < 67.5) return '东北';
  if (d < 112.5) return '正东';
  if (d < 157.5) return '东南';
  if (d < 202.5) return '正南';
  if (d < 247.5) return '西南';
  if (d < 292.5) return '正西';
  return '西北';
}

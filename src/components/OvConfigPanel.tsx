/**
 * 优视航线 (OV) 配置面板 —— M30 骨架版（8 阶段卡片栈）。
 *
 * M30 范围：
 * - 8 阶段标题 + 状态 badge（按当前 ov 数据计算）
 * - 阶段 1：起飞点 + AOI placeholder + 6 个相机参数（已可调）
 * - 阶段 2-7：占位「等 M31-M34 实施」
 * - 阶段 8：占位「等 M36/M37 实施」
 *
 * 现有 MissionConfigPanel 在本组件上方已渲染 TilesetSourcePicker，
 * 所以这里阶段 1 的「模型」部分不重复，只放 takeoff + AOI + 相机。
 */
import {
  Compass,
  ShieldCheck,
  Layers3,
  Eye,
  Wand2,
  Route as RouteIcon,
  Boxes,
  Send,
  Plane,
  MapPin,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useCurrentMission, useMissionsStore } from '../store/missions';
import { useUiStore } from '../store/ui';
import type { OvCameraSpec, OvDef } from '../types/mission';

type BadgeState = 'pending' | 'configured' | 'computing' | 'done' | 'invalid';

interface BadgeInfo {
  state: BadgeState;
  label: string;
}

export function OvConfigPanel() {
  const mission = useCurrentMission();
  const updateOvCameraParams = useMissionsStore((s) => s.updateOvCameraParams);
  const setPickerMode = useUiStore((s) => s.setPickerMode);
  const pickerMode = useUiStore((s) => s.pickerMode);

  if (!mission || mission.type !== 'ov' || !mission.ov) return null;
  const ov = mission.ov;

  const stage1Badge = computeStage1Badge(mission, ov);
  const stage2Badge = computeStage2Badge(ov);
  const stage3Badge = computeStage3Badge(ov);
  const stage4Badge = computeStage4Badge(ov);
  const stage5Badge = computeStage5Badge(ov);
  const stage6Badge = computeStage6Badge(ov);
  const stage7Badge = computeStage7Badge(ov);
  const stage8Badge: BadgeInfo = { state: 'pending', label: '待 M36/M37' };

  const setCam = <K extends keyof OvCameraSpec>(key: K, value: OvCameraSpec[K]): void => {
    updateOvCameraParams({ [key]: value } as Partial<OvCameraSpec>);
  };

  const isPickingTakeoff = pickerMode === 'takeoff-pick';
  const isPickingAoi = pickerMode === 'ov-aoi-pick';

  return (
    <div className="flex flex-col gap-2.5">
      {/* M30 · 1 数据&基准 */}
      <Card icon={<Compass className="h-3 w-3 text-accent" />} title="1 数据&基准" badge={stage1Badge}>
        {/* takeoff 起飞点 */}
        <Row label="起飞点 (M22)">
          {mission.takeOffPoint ? (
            <button
              type="button"
              onClick={() =>
                setPickerMode(isPickingTakeoff ? 'idle' : 'takeoff-pick')
              }
              className="flex items-center gap-1 rounded border border-border bg-bg-input px-2 py-1 text-[11px] font-mono text-text-primary hover:border-accent"
            >
              <MapPin className="h-3 w-3 text-mint" />
              {mission.takeOffPoint.lon.toFixed(4)}, {mission.takeOffPoint.lat.toFixed(4)}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setPickerMode('takeoff-pick')}
              className={cn(
                'flex items-center gap-1 rounded border px-2 py-1 text-[11px] font-semibold',
                isPickingTakeoff
                  ? 'border-accent bg-[#2a2113] text-accent'
                  : 'border-dashed border-mint/60 bg-bg-input text-mint hover:bg-[#0e2920]',
              )}
            >
              <Plane className="h-3 w-3" />
              {isPickingTakeoff ? '点击模型设起飞' : '+ 拾取起飞点'}
            </button>
          )}
        </Row>

        {/* AOI 多边形 */}
        <Row label="AOI 多边形">
          {ov.aoi && ov.aoi.vertices.length >= 3 ? (
            <span className="rounded border border-accent bg-[#2a2113] px-2 py-1 text-[11px] font-mono text-accent">
              {ov.aoi.vertices.length} 顶点
            </span>
          ) : (
            <button
              type="button"
              disabled
              title="M31 待实施 · 启用 ov-aoi-pick 后可拾取"
              onClick={() => setPickerMode(isPickingAoi ? 'idle' : 'ov-aoi-pick')}
              className={cn(
                'flex items-center gap-1 rounded border border-dashed px-2 py-1 text-[11px] font-semibold opacity-60',
                isPickingAoi
                  ? 'border-accent bg-[#2a2113] text-accent'
                  : 'border-border bg-bg-input text-text-secondary',
              )}
            >
              + AOI 多边形 (M31)
            </button>
          )}
        </Row>

        {/* 相机 6 参数 */}
        <SectionLabel>相机参数</SectionLabel>
        <Row label="35mm 等效焦距">
          <NumField
            value={ov.cameraParams.focalLength35mm}
            unit="mm"
            step={1}
            min={8}
            max={200}
            onChange={(v) => setCam('focalLength35mm', v)}
          />
        </Row>
        <Row label="水平画幅">
          <NumField
            value={ov.cameraParams.sensorWidthMm}
            unit="mm"
            step={0.1}
            min={1}
            max={50}
            onChange={(v) => setCam('sensorWidthMm', v)}
          />
        </Row>
        <Row label="竖直画幅">
          <NumField
            value={ov.cameraParams.sensorHeightMm}
            unit="mm"
            step={0.1}
            min={1}
            max={50}
            onChange={(v) => setCam('sensorHeightMm', v)}
          />
        </Row>
        <Row label="渲染分辨率">
          <NumField
            value={ov.cameraParams.renderResolution}
            unit="px"
            step={50}
            min={100}
            max={2000}
            onChange={(v) => setCam('renderResolution', v)}
          />
        </Row>
        <Row label="多线程并发">
          <NumField
            value={ov.cameraParams.threadCount}
            unit=""
            step={1}
            min={1}
            max={32}
            onChange={(v) => setCam('threadCount', v)}
          />
        </Row>
        <Row label="视角优化重叠">
          <NumField
            value={ov.cameraParams.optimizeOverlap}
            unit="%"
            step={1}
            min={0}
            max={100}
            onChange={(v) => setCam('optimizeOverlap', v)}
          />
        </Row>
      </Card>

      {/* M31a · 2 安全&禁飞 */}
      <Card icon={<ShieldCheck className="h-3 w-3 text-accent-cyan" />} title="2 安全&禁飞" badge={stage2Badge}>
        <Placeholder text="M31a · 待实施" detail="安全距离/高度 · 障碍物 · 禁飞区" />
      </Card>

      {/* M31b · 3 采样 */}
      <Card icon={<Layers3 className="h-3 w-3 text-accent" />} title="3 采样" badge={stage3Badge}>
        <Placeholder text="M31b · 待实施" detail="ray-cast 表面采样 · 法向估计" />
      </Card>

      {/* M32 · 4 视角生成 */}
      <Card icon={<Eye className="h-3 w-3 text-accent" />} title="4 视角生成" badge={stage4Badge}>
        <Placeholder text="M32 · 待实施" detail="9 视角变体 · 7 调整策略 · 遮挡测试" />
      </Card>

      {/* M33 · 5 视角优化 */}
      <Card icon={<Wand2 className="h-3 w-3 text-accent-cyan" />} title="5 视角优化" badge={stage5Badge}>
        <Placeholder text="M33 · 待实施" detail="set cover · 角度法 / 半球法" />
      </Card>

      {/* M34 · 6 路径生成 */}
      <Card icon={<RouteIcon className="h-3 w-3 text-accent" />} title="6 路径生成" badge={stage6Badge}>
        <Placeholder text="M34 · 待实施" detail="5 种区域分割 · TSP NN+2-opt · 4 代价" />
      </Card>

      {/* M34b · 7 分架次 */}
      <Card icon={<Boxes className="h-3 w-3 text-accent" />} title="7 分架次" badge={stage7Badge}>
        <Placeholder text="M34b · 待实施" detail="数量 / 长度 / 奇偶 · 增高 · 删除相近点" />
      </Card>

      {/* M36/M37 · 8 模拟&导出 */}
      <Card icon={<Send className="h-3 w-3 text-accent-cyan" />} title="8 模拟&导出" badge={stage8Badge}>
        <Placeholder text="M36/M37 · 待实施" detail="模拟飞行 · KMZ round-trip · 多格式" />
      </Card>
    </div>
  );
}

// ============ Badge 计算 ============

function computeStage1Badge(
  mission: { tilesetSource?: unknown; takeOffPoint?: unknown },
  ov: OvDef,
): BadgeInfo {
  const hasTileset = !!mission.tilesetSource;
  const hasTakeoff = !!mission.takeOffPoint;
  const hasAoi = !!ov.aoi && ov.aoi.vertices.length >= 3;
  const count = (hasTileset ? 1 : 0) + (hasTakeoff ? 1 : 0) + (hasAoi ? 1 : 0);
  if (count === 3) return { state: 'configured', label: '已配置' };
  if (count > 0) return { state: 'pending', label: `${count}/3 配置中` };
  return { state: 'pending', label: '待配置' };
}

function computeStage2Badge(ov: OvDef): BadgeInfo {
  const safetyOk = ov.safetyHull.safetyDistance > 0 && ov.safetyHull.safetyHeight > 0;
  if (!safetyOk) return { state: 'pending', label: '待配置' };
  return { state: 'configured', label: '默认值' };
}

function computeStage3Badge(ov: OvDef): BadgeInfo {
  if (!ov.aoi) return { state: 'pending', label: '待 AOI' };
  if (ov.samples && ov.samples.length > 0) {
    return { state: 'done', label: `${ov.samples.length} 采样点` };
  }
  return { state: 'pending', label: '待采样' };
}

function computeStage4Badge(ov: OvDef): BadgeInfo {
  if (!ov.samples || ov.samples.length === 0) return { state: 'pending', label: '待 samples' };
  if (ov.candidateViews && ov.candidateViews.length > 0) {
    return { state: 'done', label: `${ov.candidateViews.length} 候选视角` };
  }
  return { state: 'pending', label: '待生成视角' };
}

function computeStage5Badge(ov: OvDef): BadgeInfo {
  if (!ov.candidateViews || ov.candidateViews.length === 0) {
    return { state: 'pending', label: '待 candidate' };
  }
  if (ov.selectedViews && ov.selectedViews.length > 0) {
    return { state: 'done', label: `${ov.selectedViews.length} 选中` };
  }
  return { state: 'pending', label: '待优化' };
}

function computeStage6Badge(ov: OvDef): BadgeInfo {
  if (!ov.selectedViews || ov.selectedViews.length === 0) {
    return { state: 'pending', label: '待 selected' };
  }
  if (ov.paths && ov.paths.length > 0) {
    return { state: 'done', label: `${ov.paths.length} 架次` };
  }
  return { state: 'pending', label: '待路径生成' };
}

function computeStage7Badge(ov: OvDef): BadgeInfo {
  if (!ov.paths || ov.paths.length === 0) return { state: 'pending', label: '待路径' };
  return { state: 'done', label: `${ov.paths.length} 架次` };
}

// ============ 子组件 ============

function Card({
  icon,
  title,
  badge,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  badge: BadgeInfo;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5 rounded-lg border border-border bg-[#131720] p-3.5">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {icon}
          <h3 className="text-[11px] font-bold tracking-wider text-text-primary">{title}</h3>
        </div>
        <Badge badge={badge} />
      </header>
      <div className="flex flex-col gap-1.5">{children}</div>
    </section>
  );
}

function Badge({ badge }: { badge: BadgeInfo }) {
  const colors: Record<BadgeState, string> = {
    pending: 'border-border bg-[#1a1d24] text-text-muted',
    configured: 'border-mint/30 bg-[#0e2920] text-mint',
    computing: 'border-accent/40 bg-[#2c1308] text-[#ffaa4a]',
    done: 'border-mint/30 bg-[#0e2920] text-mint',
    invalid: 'border-accent-danger/40 bg-[#1a0d0d] text-accent-danger',
  };
  const icons: Record<BadgeState, string> = {
    pending: '○',
    configured: '✓',
    computing: '⚡',
    done: '✓',
    invalid: '⚠',
  };
  return (
    <span
      className={cn(
        'flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold',
        colors[badge.state],
      )}
    >
      <span>{icons[badge.state]}</span>
      {badge.label}
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex h-7 items-center justify-between">
      <span className="text-[11px] text-text-secondary">{label}</span>
      {children}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
      {children}
    </span>
  );
}

function NumField({
  value,
  unit,
  step,
  min,
  max,
  onChange,
}: {
  value: number;
  unit: string;
  step: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-1 rounded border border-border bg-bg-input px-2 py-1">
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) onChange(Math.max(min, Math.min(max, v)));
        }}
        className="w-14 bg-transparent text-right text-[12px] font-semibold text-text-primary outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:hidden [&::-webkit-outer-spin-button]:hidden"
      />
      {unit && <span className="text-[10px] text-text-muted">{unit}</span>}
    </label>
  );
}

function Placeholder({ text, detail }: { text: string; detail: string }) {
  return (
    <div className="flex flex-col gap-1 rounded border border-dashed border-border bg-bg-input px-3 py-2.5">
      <span className="text-[11px] font-semibold text-text-secondary">{text}</span>
      <span className="text-[10px] text-text-muted">{detail}</span>
    </div>
  );
}

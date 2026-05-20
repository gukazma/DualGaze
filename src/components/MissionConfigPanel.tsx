import {
  SlidersHorizontal,
  PlaneTakeoff,
  Flag,
  ShieldAlert,
  Camera,
  Grid3x3,
  RotateCcw,
} from 'lucide-react';
import { ScrollArea } from './ui/scroll-area';
import { Button } from './ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { useCurrentMission, useMissionsStore } from '../store/missions';
import { TilesetSourcePicker } from './TilesetSourcePicker';
import { FacadeConfigPanel } from './FacadeConfigPanel';
import {
  MAPPING_DEFAULTS,
  MISSION_DEFAULTS,
  type ExitOnRCLost,
  type FinishAction,
  type FlyToWaylineMode,
  type GlobalCameraAction,
  type HeightMode,
  type MappingScanParams,
  type Mission,
  type RCLostAction,
} from '../types/mission';
import { cn } from '../lib/utils';

/**
 * 任务配置面板 —— 跟 pencil 原型 FrameB2-MissionConfig 对齐。
 *
 * 5 张 card：基础 / 起降 / 结束动作 / 失控保护 / 全局动作。
 * 所有 onChange 直接走 updateMission（reactive，不需要单独 save 按钮）；
 * 底部留 重置默认 还原到 MISSION_DEFAULTS。
 */
export function MissionConfigPanel() {
  const mission = useCurrentMission();
  const updateMission = useMissionsStore((s) => s.updateMission);
  const updateScanParams = useMissionsStore((s) => s.updateScanParams);

  if (!mission) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-[12px] text-text-secondary">
        从左侧选择或新建任务
      </div>
    );
  }

  const isMapping = mission.type === 'mapping';
  const isFacade = mission.type === 'facade';
  const isOrbit = mission.type === 'orbit';
  const needsTileset = isFacade || isOrbit;
  const scanParams = mission.scanParams ?? MAPPING_DEFAULTS;

  const set = <K extends keyof Mission>(key: K, value: Mission[K]): void => {
    updateMission(mission.id, { [key]: value } as Pick<Mission, K>);
  };

  const setScan = <K extends keyof MappingScanParams>(
    key: K,
    value: MappingScanParams[K],
  ): void => {
    updateScanParams({ [key]: value } as Partial<MappingScanParams>);
  };

  const resetDefaults = (): void => {
    updateMission(mission.id, { ...MISSION_DEFAULTS });
    if (isMapping) updateScanParams({ ...MAPPING_DEFAULTS });
  };

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-2.5 p-3">
          <Card icon={<SlidersHorizontal className="h-3 w-3 text-accent" />} title="基础">
            <RowInline label="全局飞行速度">
              <NumField
                value={mission.globalSpeed}
                unit="m/s"
                step={0.5}
                min={1}
                max={15}
                onChange={(v) => set('globalSpeed', v)}
              />
            </RowInline>
            <RowStack label="航点高度模式">
              <RadioGroup<HeightMode>
                value={mission.heightMode}
                onChange={(v) => set('heightMode', v)}
                options={[
                  { value: 'WGS84', label: '海拔' },
                  { value: 'relativeToStartPoint', label: '相对起飞点' },
                  { value: 'realTimeFollowSurface', label: '相对地形' },
                ]}
              />
            </RowStack>
          </Card>

          {needsTileset && <TilesetSourcePicker />}
          {isFacade && <FacadeConfigPanel />}

          {isMapping && (
            <Card
              icon={<Grid3x3 className="h-3 w-3 text-accent-cyan" />}
              title="扫描参数"
            >
              <RowInline label="航线间距">
                <NumField
                  value={scanParams.spacing}
                  unit="m"
                  step={1}
                  min={5}
                  max={200}
                  onChange={(v) => setScan('spacing', v)}
                />
              </RowInline>
              <RowInline label="朝向角">
                <NumField
                  value={scanParams.direction}
                  unit="°"
                  step={1}
                  min={0}
                  max={359}
                  onChange={(v) => setScan('direction', v)}
                />
              </RowInline>
              <RowInline label="边距">
                <NumField
                  value={scanParams.margin}
                  unit="m"
                  step={1}
                  min={0}
                  max={50}
                  onChange={(v) => setScan('margin', v)}
                />
              </RowInline>
              <RowInline label="云台俯仰">
                <NumField
                  value={scanParams.gimbalPitchAngle}
                  unit="°"
                  step={1}
                  min={-90}
                  max={30}
                  onChange={(v) => setScan('gimbalPitchAngle', v)}
                />
              </RowInline>
              <RowInline label="横向重叠">
                <NumField
                  value={Math.round(scanParams.overlapH * 100)}
                  unit="%"
                  step={1}
                  min={0}
                  max={90}
                  onChange={(v) => setScan('overlapH', v / 100)}
                />
              </RowInline>
              <RowInline label="纵向重叠">
                <NumField
                  value={Math.round(scanParams.overlapW * 100)}
                  unit="%"
                  step={1}
                  min={0}
                  max={90}
                  onChange={(v) => setScan('overlapW', v / 100)}
                />
              </RowInline>
            </Card>
          )}

          <Card icon={<PlaneTakeoff className="h-3 w-3 text-accent" />} title="起降">
            <RowInline label="安全起飞高度">
              <NumField
                value={mission.takeOffSecurityHeight}
                unit="m"
                step={1}
                min={0}
                max={200}
                onChange={(v) => set('takeOffSecurityHeight', v)}
              />
            </RowInline>
            <RowInline label="飞向首航点">
              <SelectField<FlyToWaylineMode>
                value={mission.flyToWaylineMode}
                onChange={(v) => set('flyToWaylineMode', v)}
                options={[
                  { value: 'safely', label: '安全模式' },
                  { value: 'pointToPoint', label: '点对点' },
                ]}
              />
            </RowInline>
          </Card>

          <Card icon={<Flag className="h-3 w-3 text-accent" />} title="结束动作">
            <RowInline label="完成动作">
              <SelectField<FinishAction>
                value={mission.finishAction}
                onChange={(v) => set('finishAction', v)}
                options={[
                  { value: 'goHome', label: '自动返航' },
                  { value: 'autoLand', label: '自动降落' },
                  { value: 'hover', label: '原地悬停' },
                  { value: 'backToStart', label: '返回首航点' },
                ]}
              />
            </RowInline>
            <RowStack label="航线模式">
              <RadioGroup<boolean>
                value={mission.isClosedLoop}
                onChange={(v) => set('isClosedLoop', v)}
                options={[
                  { value: true, label: '闭合巡逻' },
                  { value: false, label: '单程航线' },
                ]}
              />
            </RowStack>
          </Card>

          <Card icon={<ShieldAlert className="h-3 w-3 text-accent-danger" />} title="失控保护">
            <RowInline label="失控动作">
              <SelectField<RCLostAction>
                value={mission.executeRCLostAction}
                onChange={(v) => set('executeRCLostAction', v)}
                options={[
                  { value: 'goBack', label: '自动返航' },
                  { value: 'hover', label: '原地悬停' },
                  { value: 'landing', label: '自动降落' },
                ]}
              />
            </RowInline>
            <RowInline label="失联行为">
              <SelectField<ExitOnRCLost>
                value={mission.exitOnRCLost}
                onChange={(v) => set('exitOnRCLost', v)}
                options={[
                  { value: 'executeLostAction', label: '执行失联动作' },
                  { value: 'goContinue', label: '继续航线' },
                ]}
              />
            </RowInline>
          </Card>

          <Card icon={<Camera className="h-3 w-3 text-accent-cyan" />} title="全局动作">
            <RowStack label="拍照动作">
              <RadioGroup<GlobalCameraAction>
                value={mission.globalAction}
                onChange={(v) => set('globalAction', v)}
                options={[
                  { value: 'none', label: '无' },
                  { value: 'takePhoto', label: '拍照' },
                  { value: 'startRecord', label: '录像' },
                ]}
              />
            </RowStack>
          </Card>
        </div>
      </ScrollArea>
      <div className="border-t border-border-subtle p-2.5">
        <Button
          variant="outline"
          size="sm"
          onClick={resetDefaults}
          className="w-full gap-1.5"
        >
          <RotateCcw className="h-3 w-3" />
          重置默认
        </Button>
      </div>
    </div>
  );
}

// ============ 小组件 ============

function Card({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-[#131720] p-3.5">
      <header className="flex items-center gap-1.5">
        {icon}
        <h3 className="text-[11px] font-bold tracking-wider text-text-primary">{title}</h3>
      </header>
      {children}
    </section>
  );
}

function RowInline({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-7 items-center justify-between">
      <span className="text-[11px] text-text-secondary">{label}</span>
      {children}
    </div>
  );
}

function RowStack({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] text-text-secondary">{label}</span>
      {children}
    </div>
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
        className="w-12 bg-transparent text-right text-[12px] font-semibold text-text-primary outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:hidden [&::-webkit-outer-spin-button]:hidden"
      />
      <span className="text-[10px] text-text-muted">{unit}</span>
    </label>
  );
}

function SelectField<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as T)}>
      <SelectTrigger className="h-7 w-36 border-border bg-bg-input text-[12px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="border-border bg-bg-panel">
        {options.map((opt) => (
          <SelectItem key={String(opt.value)} value={opt.value} className="text-[12px]">
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function RadioGroup<T extends string | boolean>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
}) {
  return (
    <div className="flex w-full overflow-hidden rounded border border-border bg-bg">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              'flex h-7 flex-1 items-center justify-center text-[11px] transition',
              active
                ? 'bg-bg-input font-semibold text-accent'
                : 'text-text-secondary hover:bg-bg-surface',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

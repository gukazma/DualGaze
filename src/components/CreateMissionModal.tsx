import { useMemo, useState } from 'react';
import { ArrowRight, Info, Route, Grid3x3, Spline, ScanEye, Target, ScanSearch, type LucideIcon } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { useUiStore } from '../store/ui';
import { useMissionsStore } from '../store/missions';
import {
  DRONE_CATALOG,
  MISSION_TYPE_CATALOG,
  PAYLOAD_CATALOG,
  type MissionType,
} from '../types/mission';
import { cn } from '../lib/utils';

const ICON_MAP: Record<string, LucideIcon> = {
  route: Route,
  'grid-3x3': Grid3x3,
  spline: Spline,
  'scan-eye': ScanEye,
  target: Target,
  'scan-search': ScanSearch,
};

export function CreateMissionModal() {
  const open = useUiStore((s) => s.createModalOpen);
  const closeModal = useUiStore((s) => s.closeCreateModal);
  const createMission = useMissionsStore((s) => s.createMission);

  const [type, setType] = useState<MissionType>('patrol');
  const [droneId, setDroneId] = useState<string>('m3e');
  const [payloadId, setPayloadId] = useState<string>('m3e-cam');
  const [name, setName] = useState<string>('');

  const compatiblePayloads = useMemo(() => {
    const drone = DRONE_CATALOG.find((d) => d.id === droneId);
    if (!drone) return [];
    return PAYLOAD_CATALOG.filter((p) => drone.compatiblePayloads.includes(p.id));
  }, [droneId]);

  const handleDroneChange = (newDroneId: string): void => {
    setDroneId(newDroneId);
    const drone = DRONE_CATALOG.find((d) => d.id === newDroneId);
    if (drone && !drone.compatiblePayloads.includes(payloadId)) {
      setPayloadId(drone.compatiblePayloads[0] ?? '');
    }
  };

  const handleSubmit = (): void => {
    if (!name.trim()) return;
    createMission({
      name: name.trim(),
      type,
      droneId,
      payloadId,
    });
    setName('');
    setType('patrol');
    setDroneId('m3e');
    setPayloadId('m3e-cam');
    closeModal();
  };

  const canSubmit = name.trim().length > 0 && type && droneId && payloadId;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) closeModal();
      }}
    >
      <DialogContent className="max-w-[640px] gap-5 border-border bg-bg-panel text-text-primary">
        <DialogHeader className="space-y-1">
          <DialogTitle className="text-[18px] text-text-primary">新建任务</DialogTitle>
          <DialogDescription className="text-[12px] text-text-secondary">
            选择航线类型并配置飞行器
          </DialogDescription>
        </DialogHeader>

        {/* 航线类型 4 卡片 */}
        <div className="space-y-2.5">
          <Label className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
            航线类型
          </Label>
          <div className="grid grid-cols-2 gap-3">
            {MISSION_TYPE_CATALOG.map((meta) => (
              <RouteTypeCard
                key={meta.id}
                meta={meta}
                selected={type === meta.id}
                onSelect={() => {
                  if (!meta.disabled) setType(meta.id);
                }}
              />
            ))}
          </div>
        </div>

        {/* 飞行器 + 挂载 */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
              飞行器型号
            </Label>
            <Select value={droneId} onValueChange={handleDroneChange}>
              <SelectTrigger className="h-9 border-border bg-bg-input text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-border bg-bg-panel">
                {DRONE_CATALOG.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
              挂载相机
            </Label>
            <Select value={payloadId} onValueChange={setPayloadId}>
              <SelectTrigger className="h-9 border-border bg-bg-input text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-border bg-bg-panel">
                {compatiblePayloads.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* 名称 */}
        <div className="space-y-1.5">
          <Label className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
            航线名称
          </Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：Bavaria 屋顶巡检 #01"
            className="h-9 border-border bg-bg-input text-[13px]"
          />
        </div>

        <DialogFooter className="flex items-center justify-between border-t border-border-subtle pt-4 sm:justify-between">
          <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
            <Info className="h-3 w-3" />
            创建后进入编辑器逐点添加航点
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={closeModal}>
              取消
            </Button>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="gap-1.5"
            >
              创建任务
              <ArrowRight className="h-3 w-3" />
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface RouteTypeCardProps {
  meta: (typeof MISSION_TYPE_CATALOG)[number];
  selected: boolean;
  onSelect: () => void;
}

function RouteTypeCard({ meta, selected, onSelect }: RouteTypeCardProps) {
  const Icon = ICON_MAP[meta.iconName] ?? Route;
  const isActive = selected && !meta.disabled;

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={meta.disabled}
      className={cn(
        'flex flex-col gap-1.5 rounded-md border bg-bg-input p-3.5 text-left transition',
        isActive
          ? 'border-accent ring-1 ring-accent/50'
          : 'border-border-subtle',
        meta.disabled
          ? 'cursor-not-allowed opacity-55'
          : 'cursor-pointer hover:border-border',
      )}
    >
      <div className="flex items-center justify-between">
        <Icon
          className={cn(
            'h-[18px] w-[18px]',
            isActive ? 'text-accent' : meta.disabled ? 'text-text-muted' : 'text-text-secondary',
          )}
        />
        {isActive ? (
          <span className="rounded-full bg-[#3a2f0d] px-2 py-0.5 text-[10px] font-semibold text-accent">
            已选
          </span>
        ) : meta.disabled ? (
          <span className="rounded-full bg-[#1f2330] px-2 py-0.5 text-[10px] text-text-muted">
            开发中
          </span>
        ) : null}
      </div>
      <span
        className={cn(
          'text-[14px] font-semibold',
          isActive
            ? 'text-text-primary'
            : meta.disabled
              ? 'text-[#9aa0b0]'
              : 'text-text-primary',
        )}
      >
        {meta.label}
      </span>
      <span
        className={cn(
          'text-[11px]',
          meta.disabled ? 'text-text-muted' : 'text-text-secondary',
        )}
      >
        {meta.description}
      </span>
    </button>
  );
}

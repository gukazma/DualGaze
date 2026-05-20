import { useRef } from 'react';
import { Pencil, Plus, Download, Upload, Play, Radio } from 'lucide-react';
import { Button } from './ui/button';
import { useCurrentMission, useMissionsStore } from '../store/missions';
import { useUiStore } from '../store/ui';
import { useSimulationStore } from '../store/simulation';
import { prepareSimulation } from '../features/simulation/SimulationLoop';
import { DRONE_CATALOG, PAYLOAD_CATALOG } from '../types/mission';
import { exportMissionToKmz } from '../lib/kmz-export';
import { importKmzToMission } from '../lib/kmz-import';
import { effectiveWaypoints } from '../features/simulation/SimulationLoop';
import { cn } from '../lib/utils';
import { toast } from 'sonner';
import { TilesetChip } from './TilesetChip';

export function TopBar() {
  const mission = useCurrentMission();
  const openCreateModal = useUiStore((s) => s.openCreateModal);
  const setPickerMode = useUiStore((s) => s.setPickerMode);
  const commitFacadePreviewIfAny = useMissionsStore((s) => s.commitFacadePreviewIfAny);
  const mode = useSimulationStore((s) => s.mode);
  const enterSim = useSimulationStore((s) => s.enterSim);
  const exitSim = useSimulationStore((s) => s.exitSim);
  const importKmzInputRef = useRef<HTMLInputElement>(null);

  const drone = mission ? DRONE_CATALOG.find((d) => d.id === mission.droneId) : null;
  const payload = mission ? PAYLOAD_CATALOG.find((p) => p.id === mission.payloadId) : null;

  const canSimulate =
    !!mission && effectiveWaypoints(mission).length >= 2 && mode === 'editing';
  const isSimulating = mode === 'simulating';

  const handleSimClick = (): void => {
    if (isSimulating) {
      exitSim();
      return;
    }
    // facade mission：进 sim 前先把 picker preview 落地（避免 picker 卸载丢 preview），
    // 然后退出 picker 模式（避免 keyboard listener 与 sim 状态机冲突）
    commitFacadePreviewIfAny();
    setPickerMode('idle');
    const prep = prepareSimulation();
    if (prep.startState && prep.totalDurationMs > 0) {
      enterSim(prep.totalDurationMs, prep.startState);
    }
  };

  const handleExportKmz = async (): Promise<void> => {
    if (!mission) return;
    try {
      const blob = await exportMissionToKmz(mission);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${mission.name || 'mission'}.kmz`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('已导出 KMZ', {
        description: `${mission.name} · ${effectiveWaypoints(mission).length} 航点`,
      });
    } catch (err) {
      console.error('[KMZ] export failed', err);
      toast.error('导出失败', {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleImportKmz = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 让同名文件可以再次触发 change
    if (!file) return;
    try {
      const { mission: imported, warnings } = await importKmzToMission(file);
      // 写入 store：addMission + selectMission
      useMissionsStore.setState((s) => ({
        missions: [imported, ...s.missions],
        currentMissionId: imported.id,
        selectedWaypointId: null,
      }));
      if (warnings.length > 0) {
        console.warn('[KMZ] import warnings:', warnings);
        toast.warning(`导入成功（${warnings.length} 个警告）`, {
          description: `${imported.name} · ${imported.waypoints.length} 航点；详见 console`,
        });
      } else {
        toast.success('已导入 KMZ', {
          description: `${imported.name} · ${imported.waypoints.length} 航点`,
        });
      }
    } catch (err) {
      console.error('[KMZ] import failed', err);
      toast.error('导入失败', {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <header className="flex h-14 items-center justify-between border-b border-border-subtle bg-bg-surface px-5">
      <div className="flex items-center gap-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-[11px] font-bold text-bg">
          DG
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[13px] font-semibold leading-none">DualGaze</span>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-text-secondary">
              {mission ? mission.name : '尚未选择任务'}
            </span>
            {mission && (
              <MissionTypeChip type={mission.type} />
            )}
            {mission?.type === 'facade' && <TilesetChip />}
          </div>
        </div>
      </div>

      <div
        className={cn(
          'flex items-center gap-1.5 rounded-full px-3 py-1.5',
          isSimulating
            ? 'border border-accent-cyan bg-[#0a3c39]'
            : 'bg-bg-input',
        )}
      >
        {isSimulating ? (
          <Radio className="h-3 w-3 animate-pulse text-accent-cyan" />
        ) : (
          <Pencil className="h-3 w-3 text-accent" />
        )}
        <span
          className={cn(
            'text-[11px] font-semibold',
            isSimulating ? 'text-accent-cyan' : 'text-accent',
          )}
        >
          {isSimulating ? '模拟飞行中' : '编辑模式'}
        </span>
      </div>

      <div className="flex items-center gap-2">
        {drone && payload && (
          <span className="hidden items-center gap-1.5 rounded-md border border-border bg-bg-input px-2.5 py-1.5 text-[11px] text-text-secondary md:inline-flex">
            <span className="font-semibold text-text-primary">{drone.label.replace('DJI Matrice ', 'M')}</span>
            <span className="text-text-muted">+</span>
            <span>{payload.label.split(' ')[0]}</span>
          </span>
        )}
        <Button size="sm" variant="outline" onClick={openCreateModal} className="gap-1.5" disabled={isSimulating}>
          <Plus className="h-3 w-3" />
          新建
        </Button>
        <input
          ref={importKmzInputRef}
          type="file"
          accept=".kmz"
          className="hidden"
          onChange={handleImportKmz}
        />
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() => importKmzInputRef.current?.click()}
          disabled={isSimulating}
        >
          <Download className="h-3 w-3" />
          导入 KMZ
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() => void handleExportKmz()}
          disabled={isSimulating || !mission || effectiveWaypoints(mission).length < 1}
        >
          <Upload className="h-3 w-3" />
          导出 KMZ
        </Button>
        <Button
          size="sm"
          onClick={handleSimClick}
          disabled={!isSimulating && !canSimulate}
          className={cn(
            'gap-1.5',
            isSimulating
              ? 'bg-accent-danger text-bg hover:bg-accent-danger/90'
              : 'bg-accent-cyan text-bg hover:bg-accent-cyan/90',
          )}
        >
          {isSimulating ? <Radio className="h-3 w-3" /> : <Play className="h-3 w-3" />}
          {isSimulating ? '退出模拟' : '模拟飞行'}
        </Button>
      </div>
    </header>
  );
}

function MissionTypeChip({ type }: { type: 'patrol' | 'mapping' | 'strip' | 'facade' | 'orbit' }) {
  if (type === 'mapping') {
    return (
      <span className="rounded-sm bg-[#0a2b22] px-1.5 py-0.5 text-[9px] font-semibold text-accent-cyan">
        面状航线
      </span>
    );
  }
  if (type === 'facade') {
    return (
      <span className="rounded-sm bg-[#0a2b3c] px-1.5 py-0.5 text-[9px] font-semibold text-accent-cyan">
        贴近航线
      </span>
    );
  }
  if (type === 'orbit') {
    return (
      <span className="rounded-sm bg-[#1c0a3c] px-1.5 py-0.5 text-[9px] font-semibold text-[#a64aff]">
        环绕航线
      </span>
    );
  }
  if (type === 'strip') {
    return (
      <span className="rounded-sm bg-[#2a2113] px-1.5 py-0.5 text-[9px] font-semibold text-text-muted">
        带状航线
      </span>
    );
  }
  return (
    <span className="rounded-sm bg-[#2a2113] px-1.5 py-0.5 text-[9px] font-semibold text-accent">
      巡逻航线
    </span>
  );
}

import { useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { WaypointList } from './WaypointList';
import { MissionConfigPanel } from './MissionConfigPanel';
import { WaypointActionsPanel } from './WaypointActionsPanel';
import { MappingScanList } from './MappingScanList';
import { FacadeFaceList } from './FacadeFaceList';
import { FacadeScanList } from './FacadeScanList';
import { OrbitConfigPanel } from './OrbitConfigPanel';
import { TakeoffStatusRow } from './TakeoffStatusRow';
import { useCurrentMission } from '../store/missions';
import { useUiStore, type RightSheetTab } from '../store/ui';
import { cn } from '../lib/utils';

const TAB_CLS =
  'h-full rounded-none border-b-2 border-transparent text-[12px] data-[state=active]:border-accent data-[state=active]:bg-transparent data-[state=active]:text-accent data-[state=active]:shadow-none';
const TAB_CLS_ORBIT =
  'h-full rounded-none border-b-2 border-transparent text-[12px] data-[state=active]:border-[#ffd24a] data-[state=active]:bg-transparent data-[state=active]:text-[#ffd24a] data-[state=active]:shadow-none';

export function RightSheet() {
  const mission = useCurrentMission();
  const tab = useUiStore((s) => s.rightSheetTab);
  const setTab = useUiStore((s) => s.setRightSheetTab);
  const isMapping = mission?.type === 'mapping';
  const isFacade = mission?.type === 'facade';
  const isOrbit = mission?.type === 'orbit';
  const isOv = mission?.type === 'ov';

  // 不同 mission type 下不合法的 tab 自动回退
  useEffect(() => {
    if (isFacade) {
      if (tab !== 'faces' && tab !== 'config' && tab !== 'scan') setTab('faces');
      return;
    }
    if (isOrbit) {
      if (tab !== 'orbit' && tab !== 'config' && tab !== 'scan') setTab('orbit' as RightSheetTab);
      return;
    }
    if (isOv) {
      // ov 复用 config tab（OvConfigPanel 在 MissionConfigPanel 内分发渲染）
      if (tab !== 'config') setTab('config');
      return;
    }
    if (isMapping) {
      if (tab === 'actions' || tab === 'faces' || tab === 'orbit') setTab('waypoints');
      return;
    }
    // patrol
    if (tab === 'scan' || tab === 'faces' || tab === 'orbit') setTab('waypoints');
  }, [isMapping, isFacade, isOrbit, isOv, tab, setTab]);

  const facadeFaceCount = mission?.facadeFaces?.length ?? 0;
  const facadeWaypointCount =
    mission?.facadeFaces?.reduce((sum, f) => sum + (f.enabled ? (f.scanPath?.length ?? 0) : 0), 0) ?? 0;
  const orbitWpCount = mission?.orbit?.scanPath?.length ?? 0;
  const ovSampleCount = mission?.type === 'ov' ? mission.ov?.samples?.length ?? 0 : 0;
  const ovSortieCount = mission?.type === 'ov' ? mission.ov?.paths?.length ?? 0 : 0;
  const headerCount = isMapping
    ? `${mission?.polygon?.length ?? 0} 顶点 · ${mission?.scanPath?.length ?? 0} 扫描点`
    : isFacade
      ? `${facadeFaceCount} 面 · ${facadeWaypointCount} 航点`
      : isOrbit
        ? mission?.orbit
          ? `R=${mission.orbit.radius.toFixed(1)}m · ${orbitWpCount} 航点`
          : '未拾取'
        : isOv
          ? `${ovSampleCount} samples · ${ovSortieCount} 架次`
          : `${mission?.waypoints.length ?? 0} 航点`;

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex h-12 items-center justify-between border-b border-border-subtle px-4">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold">
            {mission ? mission.name : '航线详情'}
          </span>
          {mission && (
            <span className="rounded-full bg-bg-input px-2 py-0.5 text-[10px] font-semibold text-text-secondary">
              {headerCount}
            </span>
          )}
        </div>
      </div>

      {(isFacade || isOrbit || isOv) && <TakeoffStatusRow />}

      {mission ? (
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as typeof tab)}
          className="flex flex-1 flex-col overflow-hidden"
        >
          <TabsList
            className={cn(
              'grid h-9 w-full gap-0 rounded-none border-b border-border-subtle bg-transparent p-0',
              'grid-cols-3',
            )}
          >
            {isFacade ? (
              <>
                <TabsTrigger value="faces" className={TAB_CLS}>
                  立面
                </TabsTrigger>
                <TabsTrigger value="config" className={TAB_CLS}>
                  任务配置
                </TabsTrigger>
                <TabsTrigger value="scan" className={TAB_CLS}>
                  扫描列表
                </TabsTrigger>
              </>
            ) : isOrbit ? (
              <>
                <TabsTrigger value="orbit" className={TAB_CLS_ORBIT}>
                  环绕配置
                </TabsTrigger>
                <TabsTrigger value="config" className={TAB_CLS_ORBIT}>
                  任务配置
                </TabsTrigger>
                <TabsTrigger value="scan" className={TAB_CLS_ORBIT}>
                  扫描列表
                </TabsTrigger>
              </>
            ) : (
              <>
                <TabsTrigger value="waypoints" className={TAB_CLS}>
                  {isMapping ? '顶点' : '航点'}
                </TabsTrigger>
                <TabsTrigger value="config" className={TAB_CLS}>
                  任务配置
                </TabsTrigger>
                {isMapping ? (
                  <TabsTrigger value="scan" className={TAB_CLS}>
                    扫描列表
                  </TabsTrigger>
                ) : (
                  <TabsTrigger value="actions" className={TAB_CLS}>
                    动作组
                  </TabsTrigger>
                )}
              </>
            )}
          </TabsList>
          {!isFacade && (
            <TabsContent value="waypoints" className="mt-0 flex-1 overflow-hidden">
              <WaypointList />
            </TabsContent>
          )}
          {isFacade && (
            <TabsContent value="faces" className="mt-0 flex-1 overflow-hidden">
              <FacadeFaceList />
            </TabsContent>
          )}
          <TabsContent value="config" className="mt-0 flex-1 overflow-hidden">
            <MissionConfigPanel />
          </TabsContent>
          {!isMapping && !isFacade && (
            <TabsContent value="actions" className="mt-0 flex-1 overflow-hidden">
              <WaypointActionsPanel />
            </TabsContent>
          )}
          {isMapping && (
            <TabsContent value="scan" className="mt-0 flex-1 overflow-hidden">
              <MappingScanList />
            </TabsContent>
          )}
          {isFacade && (
            <TabsContent value="scan" className="mt-0 flex-1 overflow-hidden">
              <FacadeScanList />
            </TabsContent>
          )}
          {isOrbit && (
            <TabsContent value="orbit" className="mt-0 flex-1 overflow-hidden">
              <OrbitConfigPanel />
            </TabsContent>
          )}
          {isOrbit && (
            <TabsContent value="scan" className="mt-0 flex-1 overflow-hidden">
              <FacadeScanList />
            </TabsContent>
          )}
        </Tabs>
      ) : (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-[12px] text-text-secondary">
          从左侧选择或新建一个任务
        </div>
      )}
    </div>
  );
}

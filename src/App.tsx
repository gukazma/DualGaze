import { useEffect } from 'react';
import { CesiumViewer } from './features/cesium/CesiumViewer';
import { useCesiumViewer } from './features/cesium/CesiumContext';
import { useFlyToMission } from './features/cesium/useFlyToMission';
import { WaypointLayer } from './features/waypoint/WaypointLayer';
import { DroneLayer } from './features/simulation/DroneLayer';
import { FrustumLayer } from './features/frustum/FrustumLayer';
import { MappingLayer } from './features/mapping/MappingLayer';
import { TilesetLoaderHost } from './features/facade/TilesetLoaderHost';
import { FacadeLayer } from './features/facade/FacadeLayer';
import { FacadePicker } from './features/facade/FacadePicker';
import { FacadeScanRecomputeHost } from './features/facade/FacadeScanRecomputeHost';
import { useFacadePickerStore } from './store/facade-picker';
import { useUiStore } from './store/ui';
import { FacadePickerHud } from './components/FacadePickerHud';
import { FacadeEmptyGuide } from './components/FacadeEmptyGuide';
import { FacadeLoadingOverlay } from './components/FacadeLoadingOverlay';
import { FacadeStartCta } from './components/FacadeStartCta';
import { FacadeQuickAddButton } from './components/FacadeQuickAddButton';
import { FacadeSafetyBadge } from './components/FacadeSafetyBadge';
import { useTilesetLoadingStore } from './store/tileset-loading';
import { useSimulationLoop } from './features/simulation/SimulationLoop';
import { TopBar } from './components/TopBar';
import { MissionLibrary } from './components/MissionLibrary';
import { CreateMissionModal } from './components/CreateMissionModal';
import { RightSheet } from './components/RightSheet';
import { PlaybackBar } from './components/PlaybackBar';
import { FpvWindow } from './components/FpvWindow';
import { ViewToggle } from './components/ViewToggle';
import { LocationSearchTab } from './components/LocationSearchTab';
import { HomeButton } from './components/HomeButton';
import { Toaster } from './components/ui/sonner';
import { useMapViewSync } from './features/cesium/useMapViewSync';
import { useCurrentMission } from './store/missions';
import { useSimulationStore } from './store/simulation';

export function App() {
  useSimulationLoop();
  useFlyToMission();
  useMapViewSync();
  const mode = useSimulationStore((s) => s.mode);
  const isSimulating = mode === 'simulating';
  const mission = useCurrentMission();
  const isMapping = mission?.type === 'mapping';
  const isFacade = mission?.type === 'facade';
  const pickerMode = useUiStore((s) => s.pickerMode);
  const tilesetStatus = useTilesetLoadingStore((s) => s.status);
  const facadeFaceCount = mission?.type === 'facade' ? mission.facadeFaces?.length ?? 0 : 0;
  const hasTilesetSource = mission?.type === 'facade' && !!mission.tilesetSource;
  const showEmptyGuide = isFacade && !hasTilesetSource;
  const showLoadingOverlay = isFacade && tilesetStatus === 'loading';
  const showStartCta =
    isFacade && hasTilesetSource && facadeFaceCount === 0 && pickerMode !== 'facade-draw' && tilesetStatus !== 'loading';
  const showQuickAdd =
    isFacade && facadeFaceCount >= 1 && pickerMode !== 'facade-draw';

  // v3 以后不再自动 seed Bavaria 演示 mission：新用户首启进入纯净空状态，
  // 演示由 MissionLibrary 顶部的两个 demo 按钮显式触发（用户主动）。
  // (旧逻辑保留在 git log 里，需要重新启用就把 if-empty → loadBavariaDemo 加回来)

  return (
    <div className="flex h-full w-full flex-col bg-bg text-text-primary">
      <TopBar />

      <main className="flex flex-1 overflow-hidden">
        <aside className="w-[280px] border-r border-border-subtle bg-bg-surface">
          <MissionLibrary />
        </aside>

        <div className="relative flex-1 overflow-hidden bg-bg">
          <CesiumViewer />
          {isFacade && <TilesetLoaderHost />}
          {isFacade && <FacadeLayer />}
          {isFacade && <FacadePickerMount />}
          {isFacade && <FacadeScanRecomputeHost />}
          {isMapping ? <MappingLayer /> : isFacade ? null : <WaypointLayer />}
          <DroneLayer />
          <FrustumLayer />
          {isFacade && !isSimulating && <FacadePickerHud />}
          {!isSimulating && showEmptyGuide && <FacadeEmptyGuide />}
          {!isSimulating && showLoadingOverlay && <FacadeLoadingOverlay />}
          {!isSimulating && showStartCta && <FacadeStartCta />}
          {!isSimulating && showQuickAdd && <FacadeQuickAddButton />}
          {!isSimulating && isFacade && <FacadeSafetyBadge />}
          {!isSimulating && <ViewToggle />}
          {!isSimulating && <HomeButton />}
          {!isSimulating && <LocationSearchTab />}
          {isSimulating && <FpvWindow />}
        </div>

        <aside className="w-[340px] border-l border-border-subtle bg-bg-surface">
          <RightSheet />
        </aside>
      </main>

      {isSimulating ? (
        <PlaybackBar />
      ) : (
        <footer className="flex h-9 items-center justify-between border-t border-border-subtle bg-bg-surface px-4 text-[11px] text-text-secondary">
          <span className="flex items-center gap-2">
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-accent-cyan" />
            ArcGIS World Imagery
            <span className="text-text-muted">· WGS84 原生 · 全球 z=19</span>
          </span>
          <span className="text-text-muted">M5 加 FPV 真渲染</span>
        </footer>
      )}

      <CreateMissionModal />
      <Toaster position="bottom-right" richColors closeButton />
    </div>
  );
}

/**
 * 当 ui.pickerMode === 'facade-draw' 时挂载 FacadePicker；其它情况卸载。
 * 切 mission 也会自动卸载（viewer 不变，但 picker 上次绑的 keydown listener 跟着 unmount 走）。
 */
function FacadePickerMount() {
  const viewer = useCesiumViewer();
  const pickerMode = useUiStore((s) => s.pickerMode);
  const setPickerMode = useUiStore((s) => s.setPickerMode);
  const setPickerState = useFacadePickerStore((s) => s.setState);
  const setFlipPreviewNormal = useFacadePickerStore((s) => s.setFlipPreviewNormal);

  useEffect(() => {
    if (!viewer) return;
    if (pickerMode !== 'facade-draw') {
      // reset preview state when picker not active
      setPickerState({ mode: 'drawing', corners: [] });
      setFlipPreviewNormal(null);
      return;
    }
    const picker = new FacadePicker(viewer);
    const unsub = picker.onStateChange((s) => setPickerState(s));
    // 把 picker 的 flip 入口注册到 store，让 HUD 按钮能调
    setFlipPreviewNormal(() => picker.flipNormalInPreview());
    return () => {
      unsub();
      picker.destroy();
      setPickerState({ mode: 'drawing', corners: [] });
      setFlipPreviewNormal(null);
    };
  }, [viewer, pickerMode, setPickerState, setFlipPreviewNormal]);

  // 切到非 facade mission 时强制退出 picker
  const mission = useCurrentMission();
  useEffect(() => {
    if (mission?.type !== 'facade' && pickerMode === 'facade-draw') {
      setPickerMode('idle');
    }
  }, [mission?.type, pickerMode, setPickerMode]);

  return null;
}

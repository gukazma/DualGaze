import { create } from 'zustand';

export type RightSheetTab = 'waypoints' | 'config' | 'actions' | 'scan' | 'faces' | 'orbit';
export type LibrarySort = 'updated_desc' | 'updated_asc' | 'name';
export type MapView = '3d' | '2d';
/**
 * 当前主场景的拾取交互模式：
 *  - 'idle': 默认（WaypointPicker / PolygonPicker 由各自的 layer 自行接管）
 *  - 'facade-draw': facade mission 内点 "新建立面" 进入 4 角拾取
 *  - 'orbit-draw': orbit mission 3 点拾取（底心 + 顶心 + 侧点）
 *  - 'takeoff-pick': v3.2 起飞点单点拾取（facade / orbit / ov 强制流程）
 *  - 'ov-aoi-pick': v3.3 ov AOI 多边形拾取
 *  - 'ov-obstacle-pick': v3.3 ov 3 点矩形障碍物
 *  - 'ov-nofly-pick': v3.3 ov 禁飞空域多边形
 *  - 'ov-sweep-pick': v3.3 ov 2 点平扫航线
 *  - 'ov-spot-orbit-pick': v3.3 ov 单点环拍
 */
export type PickerMode =
  | 'idle'
  | 'facade-draw'
  | 'orbit-draw'
  | 'takeoff-pick'
  | 'ov-aoi-pick'
  | 'ov-obstacle-pick'
  | 'ov-nofly-pick'
  | 'ov-sweep-pick'
  | 'ov-spot-orbit-pick'
  | 'ov-measure-pick';

interface UiState {
  createModalOpen: boolean;
  rightSheetTab: RightSheetTab;
  leftSheetCollapsed: boolean;
  /** 航线库筛选 drone id，null = 全部机型 */
  libraryFilterDrone: string | null;
  /** 航线库排序 */
  librarySort: LibrarySort;
  /** 主场景视图模式：3d 自由旋转 / 2d 锁定俯视（仅 pan + zoom） */
  mapView: MapView;
  /** facade 拾取交互模式 */
  pickerMode: PickerMode;

  openCreateModal: () => void;
  closeCreateModal: () => void;
  setRightSheetTab: (tab: RightSheetTab) => void;
  toggleLeftSheet: () => void;
  setLibraryFilterDrone: (id: string | null) => void;
  setLibrarySort: (s: LibrarySort) => void;
  setMapView: (v: MapView) => void;
  setPickerMode: (m: PickerMode) => void;
}

export const useUiStore = create<UiState>((set) => ({
  createModalOpen: false,
  rightSheetTab: 'waypoints',
  leftSheetCollapsed: false,
  libraryFilterDrone: null,
  librarySort: 'updated_desc',
  mapView: '3d',
  pickerMode: 'idle',

  openCreateModal: () => set({ createModalOpen: true }),
  closeCreateModal: () => set({ createModalOpen: false }),
  setRightSheetTab: (tab) => set({ rightSheetTab: tab }),
  toggleLeftSheet: () => set((s) => ({ leftSheetCollapsed: !s.leftSheetCollapsed })),
  setLibraryFilterDrone: (id) => set({ libraryFilterDrone: id }),
  setLibrarySort: (s) => set({ librarySort: s }),
  setMapView: (v) => set({ mapView: v }),
  setPickerMode: (m) => set({ pickerMode: m }),
}));

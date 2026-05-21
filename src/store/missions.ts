import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  createAction as buildAction,
  createBlankMission,
  createWaypoint as buildWaypoint,
  FACADE_DEFAULTS,
  MAPPING_DEFAULTS,
  migrateMissionToLatest,
  type FacadeFace,
  type FacadePlane,
  type FacadeScanParams,
  type MappingScanParams,
  type Mission,
  type MissionType,
  type OrbitDef,
  type OrbitScanParams,
  type PolygonVertex,
  type TilesetSource,
  type Waypoint,
  type WaypointAction,
  type WaypointActionType,
} from '../types/mission';
import { generateScanPath } from '../lib/mapping-scan';
import { flipFacadePlane } from '../lib/facade-plane';
import { useFacadePickerStore } from './facade-picker';

interface MissionsState {
  missions: Mission[];
  currentMissionId: string | null;
  selectedWaypointId: string | null;

  // mission CRUD
  createMission: (init: {
    name: string;
    type: MissionType;
    droneId: string;
    payloadId: string;
  }) => string;
  selectMission: (id: string | null) => void;
  renameMission: (id: string, name: string) => void;
  duplicateMission: (id: string) => string | null;
  deleteMission: (id: string) => void;
  updateMission: (id: string, patch: Partial<Omit<Mission, 'id' | 'createdAt'>>) => void;

  // waypoint CRUD（针对 currentMission）
  addWaypoint: (init: { lon: number; lat: number; alt: number; heading?: number; pitch?: number; speed?: number; fov?: number }) => string | null;
  updateWaypoint: (waypointId: string, patch: Partial<Omit<Waypoint, 'id' | 'index'>>) => void;
  removeWaypoint: (waypointId: string) => void;
  reverseWaypoints: () => void;
  clearWaypoints: () => void;
  selectWaypoint: (id: string | null) => void;
  /** 拖拽重排：fromIdx 移到 toIdx；重排后 index 字段自动 reindex */
  reorderWaypoints: (fromIdx: number, toIdx: number) => void;

  // waypoint actions CRUD
  addAction: (waypointId: string, type: WaypointActionType) => string | null;
  updateAction: (waypointId: string, actionId: string, patch: Partial<Omit<WaypointAction, 'id'>>) => void;
  removeAction: (waypointId: string, actionId: string) => void;

  // mapping CRUD（针对 currentMission；要求 mission.type === 'mapping'）
  /** 设置多边形顶点，自动触发扫描路径重算 */
  setPolygon: (polygon: PolygonVertex[]) => void;
  /** 追加一个多边形顶点（用于地图画图） */
  addPolygonVertex: (v: PolygonVertex) => void;
  /** 更新单个顶点（用于拖动） */
  updatePolygonVertex: (idx: number, v: Partial<PolygonVertex>) => void;
  /** 删除单个顶点 */
  removePolygonVertex: (idx: number) => void;
  /** 更新扫描参数；自动触发扫描路径重算 */
  updateScanParams: (patch: Partial<MappingScanParams>) => void;
  /** 手动触发重算（一般 set/update 时自动；外部调用兜底） */
  recomputeScanPath: () => void;

  // facade CRUD（针对 currentMission；要求 mission.type === 'facade'）
  /** 设置 tileset 数据源（HTTP URL 或本地目录 session） */
  setTilesetSource: (src: TilesetSource | undefined) => void;
  /** 新增一个 face，传入 4 个角点 + 名字；params 默认 FACADE_DEFAULTS */
  addFacadeFace: (init: { name: string; corners: FacadeFace['corners']; params?: Partial<FacadeScanParams> }) => string | null;
  /** 更新某 face（如 name/enabled/corners/params 修改） */
  updateFacadeFace: (faceId: string, patch: Partial<Omit<FacadeFace, 'id'>>) => void;
  /** 仅更新某 face 的 params（自动触发该 face 重算） */
  updateFacadeFaceParams: (faceId: string, patch: Partial<FacadeScanParams>) => void;
  /** 删除某 face */
  removeFacadeFace: (faceId: string) => void;
  /**
   * 设置当前选中的 face（同时是模拟飞行 / 单架次导出 / FrustumLayer active highlight 的来源）。
   * 传 null 取消选中（不会自动跳到下一个，但 effectiveWaypoints 会 fallback 到第一个 enabled face）。
   */
  setActiveFaceId: (faceId: string | null) => void;
  /**
   * React 层（FacadePicker）算完 plane + scanPath 后写回。
   * 因为 store 拿不到 viewer，所以算法在 React 层跑；store 这里只负责落地。
   */
  setFaceScanResult: (faceId: string, plane: FacadePlane | undefined, scanPath: Waypoint[] | undefined) => void;
  /**
   * 翻转某 face 的法向 —— 把 plane 取反 + 清空 scanPath（让 FacadeScanRecomputeHost
   * 用新 plane 重算航点）。HUD / FacadeFaceList 的「反转」按钮调这个。
   */
  flipFaceNormal: (faceId: string) => void;
  /**
   * 把 facade-picker store 当前的 preview 状态 commit 成一个新 face。
   * 如果当前不是 preview 状态（drawing/error），不动；返回 false。
   *
   * 由外部按钮（FacadeFaceList 完成 / TopBar 进 sim）调，确保 preview 不被 picker
   * 卸载时悄悄丢弃。逻辑与 FacadePicker.commit() 重复，但 picker 是 vanilla class，
   * 外部拿不到实例，所以重新走 store API 实现。
   */
  commitFacadePreviewIfAny: () => boolean;

  // ---------- takeoff (v3.2) ----------
  /**
   * 设置 / 清除当前 mission 的起飞点。
   * 仅在 facade / orbit 类型有意义；其它类型调用静默 no-op（保留旧 WGS84 行为）。
   * undefined = 清除（场景里 home icon 消失，KMZ 退回 WGS84）。
   */
  setTakeOffPoint: (pt: { lon: number; lat: number; alt: number } | undefined) => void;

  // ---------- orbit ----------
  /** 设置 / 替换当前 mission 的 orbit 几何（picker 完成后调）；params 用默认或现有 */
  setOrbit: (orbit: OrbitDef | undefined) => void;
  /** 更新 orbit 参数（清 scanPath 让 OrbitScanRecomputeHost 重算） */
  updateOrbitParams: (patch: Partial<OrbitScanParams>) => void;
  /** 直接写回 orbit.scanPath（由 OrbitScanRecomputeHost 算完调） */
  setOrbitScanResult: (scanPath: Waypoint[] | undefined) => void;
}

const reindex = (waypoints: Waypoint[]): Waypoint[] =>
  waypoints.map((w, i) => (w.index === i ? w : { ...w, index: i }));

/**
 * mapping mission：根据当前 polygon + scanParams 重新生成 scanPath。
 * 非 mapping 类型直接返回原对象。
 */
const withRecomputedScan = (m: Mission): Mission => {
  if (m.type !== 'mapping') return m;
  const polygon = m.polygon ?? [];
  const params = m.scanParams ?? MAPPING_DEFAULTS;
  if (polygon.length < 3) return { ...m, scanPath: [] };
  const path = generateScanPath(polygon, params, {
    alt: m.globalHeight,
    speed: m.globalSpeed,
  });
  return { ...m, scanPath: path };
};

let _faceIdSeq = 0;
const newFaceId = (): string => `face_${Date.now().toString(36)}_${(++_faceIdSeq).toString(36)}`;

/**
 * facade mission：face 的 plane + scanPath 由 React 层（FacadePicker）算后通过
 * `setFaceScanResult` 写回。store 本身不算（拿不到 viewer 做 raycast）。
 *
 * 这里只在 corners 变化等场景将 plane / scanPath 清空，提示 React 层重算。
 * 对单纯 params/enabled/name 改动不动 scanPath（保留旧数据）。
 */
const invalidateFaceGeometry = (m: Mission, faceId: string): Mission => {
  if (m.type !== 'facade') return m;
  const faces = m.facadeFaces ?? [];
  return {
    ...m,
    facadeFaces: faces.map((f) =>
      f.id === faceId ? { ...f, plane: undefined, scanPath: undefined } : f,
    ),
  };
};

const touch = (m: Mission): Mission => ({ ...m, updatedAt: Date.now() });

const updateById = <T extends { id: string }>(arr: T[], id: string, updater: (item: T) => T): T[] =>
  arr.map((x) => (x.id === id ? updater(x) : x));

const updateCurrentMission =
  (set: (fn: (state: MissionsState) => Partial<MissionsState>) => void) =>
  (updater: (m: Mission) => Mission): void => {
    set((state) => {
      if (!state.currentMissionId) return {};
      const next = updateById(state.missions, state.currentMissionId, (m) => touch(updater(m)));
      return { missions: next };
    });
  };

export const useMissionsStore = create<MissionsState>()(
  persist(
    (set, get) => {
      const updCurrent = updateCurrentMission(set);
      return {
        missions: [],
        currentMissionId: null,
        selectedWaypointId: null,

        createMission: (init) => {
          const m = createBlankMission(init);
          set((s) => ({
            missions: [m, ...s.missions],
            currentMissionId: m.id,
            selectedWaypointId: null,
          }));
          return m.id;
        },

        selectMission: (id) => set({ currentMissionId: id, selectedWaypointId: null }),

        renameMission: (id, name) =>
          set((s) => ({ missions: updateById(s.missions, id, (m) => touch({ ...m, name })) })),

        duplicateMission: (id) => {
          const src = get().missions.find((m) => m.id === id);
          if (!src) return null;
          const copy = createBlankMission({
            name: `${src.name} (副本)`,
            type: src.type,
            droneId: src.droneId,
            payloadId: src.payloadId,
          });
          copy.waypoints = src.waypoints.map((w, i) => ({ ...w, id: `${copy.id}_wp_${i}`, index: i }));
          copy.globalSpeed = src.globalSpeed;
          copy.globalHeight = src.globalHeight;
          copy.heightMode = src.heightMode;
          set((s) => ({
            missions: [copy, ...s.missions],
            currentMissionId: copy.id,
            selectedWaypointId: null,
          }));
          return copy.id;
        },

        deleteMission: (id) =>
          set((s) => {
            const missions = s.missions.filter((m) => m.id !== id);
            const currentMissionId =
              s.currentMissionId === id ? (missions[0]?.id ?? null) : s.currentMissionId;
            return { missions, currentMissionId, selectedWaypointId: null };
          }),

        updateMission: (id, patch) =>
          set((s) => ({ missions: updateById(s.missions, id, (m) => touch({ ...m, ...patch })) })),

        addWaypoint: (init) => {
          const current = get().missions.find((m) => m.id === get().currentMissionId);
          if (!current) return null;
          const wp = buildWaypoint({
            ...init,
            index: current.waypoints.length,
          });
          updCurrent((m) => ({ ...m, waypoints: [...m.waypoints, wp] }));
          return wp.id;
        },

        updateWaypoint: (waypointId, patch) =>
          updCurrent((m) => ({
            ...m,
            waypoints: m.waypoints.map((w) =>
              w.id === waypointId ? { ...w, ...patch } : w,
            ),
          })),

        removeWaypoint: (waypointId) =>
          updCurrent((m) => ({
            ...m,
            waypoints: reindex(m.waypoints.filter((w) => w.id !== waypointId)),
          })),

        reverseWaypoints: () =>
          updCurrent((m) => ({ ...m, waypoints: reindex([...m.waypoints].reverse()) })),

        clearWaypoints: () => updCurrent((m) => ({ ...m, waypoints: [] })),

        selectWaypoint: (id) => set({ selectedWaypointId: id }),

        reorderWaypoints: (fromIdx, toIdx) =>
          updCurrent((m) => {
            if (fromIdx === toIdx) return m;
            if (fromIdx < 0 || fromIdx >= m.waypoints.length) return m;
            if (toIdx < 0 || toIdx >= m.waypoints.length) return m;
            const next = [...m.waypoints];
            const [moved] = next.splice(fromIdx, 1);
            next.splice(toIdx, 0, moved);
            return { ...m, waypoints: reindex(next) };
          }),

        addAction: (waypointId, type) => {
          const action = buildAction(type);
          updCurrent((m) => ({
            ...m,
            waypoints: m.waypoints.map((w) =>
              w.id === waypointId ? { ...w, actions: [...w.actions, action] } : w,
            ),
          }));
          return action.id;
        },

        updateAction: (waypointId, actionId, patch) =>
          updCurrent((m) => ({
            ...m,
            waypoints: m.waypoints.map((w) =>
              w.id === waypointId
                ? {
                    ...w,
                    actions: w.actions.map((a) =>
                      a.id === actionId ? { ...a, ...patch } : a,
                    ),
                  }
                : w,
            ),
          })),

        removeAction: (waypointId, actionId) =>
          updCurrent((m) => ({
            ...m,
            waypoints: m.waypoints.map((w) =>
              w.id === waypointId
                ? { ...w, actions: w.actions.filter((a) => a.id !== actionId) }
                : w,
            ),
          })),

        // ===== mapping =====

        setPolygon: (polygon) =>
          updCurrent((m) => withRecomputedScan({ ...m, polygon })),

        addPolygonVertex: (v) =>
          updCurrent((m) => withRecomputedScan({ ...m, polygon: [...(m.polygon ?? []), v] })),

        updatePolygonVertex: (idx, patch) =>
          updCurrent((m) => {
            const poly = m.polygon ?? [];
            if (idx < 0 || idx >= poly.length) return m;
            const next = poly.map((v, i) => (i === idx ? { ...v, ...patch } : v));
            return withRecomputedScan({ ...m, polygon: next });
          }),

        removePolygonVertex: (idx) =>
          updCurrent((m) => {
            const poly = m.polygon ?? [];
            if (idx < 0 || idx >= poly.length) return m;
            return withRecomputedScan({
              ...m,
              polygon: poly.filter((_, i) => i !== idx),
            });
          }),

        updateScanParams: (patch) =>
          updCurrent((m) => {
            const params = { ...(m.scanParams ?? MAPPING_DEFAULTS), ...patch };
            return withRecomputedScan({ ...m, scanParams: params });
          }),

        recomputeScanPath: () =>
          updCurrent((m) => withRecomputedScan(m)),

        // ===== facade =====

        setTilesetSource: (src) =>
          updCurrent((m) => ({ ...m, tilesetSource: src })),

        addFacadeFace: (init) => {
          const id = newFaceId();
          const face: FacadeFace = {
            id,
            name: init.name,
            corners: init.corners,
            plane: undefined,
            params: { ...FACADE_DEFAULTS, ...(init.params ?? {}) },
            scanPath: undefined,
            enabled: true,
          };
          updCurrent((m) => {
            if (m.type !== 'facade') return m;
            const facadeFaces = [...(m.facadeFaces ?? []), face];
            // 首个 face 自动设为 active；后续新加不抢占（用户可能在编辑别的 face）
            const activeFaceId = m.activeFaceId ?? face.id;
            return { ...m, facadeFaces, activeFaceId };
          });
          return id;
        },

        updateFacadeFace: (faceId, patch) =>
          updCurrent((m) => {
            if (m.type !== 'facade') return m;
            const faces = m.facadeFaces ?? [];
            const next = {
              ...m,
              facadeFaces: faces.map((f) => (f.id === faceId ? { ...f, ...patch } : f)),
            };
            // corners 变化 → invalidate plane/scanPath，等 React 层重算；
            // 其它字段（name/enabled）不动 plane/scanPath。
            return 'corners' in patch ? invalidateFaceGeometry(next, faceId) : next;
          }),

        updateFacadeFaceParams: (faceId, patch) =>
          updCurrent((m) => {
            if (m.type !== 'facade') return m;
            const faces = m.facadeFaces ?? [];
            const next = {
              ...m,
              facadeFaces: faces.map((f) =>
                f.id === faceId ? { ...f, params: { ...f.params, ...patch } } : f,
              ),
            };
            // params 改动 → scanPath 失效（plane 仍可复用，因为 corners 没动）
            return {
              ...next,
              facadeFaces: next.facadeFaces!.map((f) =>
                f.id === faceId ? { ...f, scanPath: undefined } : f,
              ),
            };
          }),

        removeFacadeFace: (faceId) =>
          updCurrent((m) => {
            if (m.type !== 'facade') return m;
            const faces = m.facadeFaces ?? [];
            const nextFaces = faces.filter((f) => f.id !== faceId);
            // 删的恰好是 active → 跳到剩余第一个；都没了就 null
            const nextActive =
              m.activeFaceId === faceId
                ? (nextFaces[0]?.id ?? null)
                : (m.activeFaceId ?? null);
            return { ...m, facadeFaces: nextFaces, activeFaceId: nextActive };
          }),

        setActiveFaceId: (faceId) =>
          updCurrent((m) => {
            if (m.type !== 'facade') return m;
            return { ...m, activeFaceId: faceId };
          }),

        setFaceScanResult: (faceId, plane, scanPath) =>
          updCurrent((m) => {
            if (m.type !== 'facade') return m;
            const faces = m.facadeFaces ?? [];
            return {
              ...m,
              facadeFaces: faces.map((f) =>
                f.id === faceId ? { ...f, plane, scanPath } : f,
              ),
            };
          }),

        flipFaceNormal: (faceId) =>
          updCurrent((m) => {
            if (m.type !== 'facade') return m;
            const faces = m.facadeFaces ?? [];
            return {
              ...m,
              facadeFaces: faces.map((f) => {
                if (f.id !== faceId || !f.plane) return f;
                // 翻 plane.normal + vAxis（保持右手系），清 scanPath 让 RecomputeHost 重算
                return { ...f, plane: flipFacadePlane(f.plane), scanPath: undefined };
              }),
            };
          }),

        commitFacadePreviewIfAny: () => {
          const pickerState = useFacadePickerStore.getState().state;
          if (pickerState.mode !== 'preview') return false;
          const state = get();
          const mission = state.missions.find((m) => m.id === state.currentMissionId);
          if (!mission || mission.type !== 'facade') return false;
          const idx = (mission.facadeFaces?.length ?? 0) + 1;
          const id = state.addFacadeFace({
            name: `立面 ${idx}`,
            corners: pickerState.corners,
          });
          if (!id) return false;
          state.setFaceScanResult(id, pickerState.plane, pickerState.scanPath);
          useFacadePickerStore.getState().setState({ mode: 'drawing', corners: [] });
          return true;
        },

        // ---------- takeoff (v3.2) ----------
        setTakeOffPoint: (pt) =>
          updCurrent((m) => {
            if (m.type !== 'facade' && m.type !== 'orbit') return m;
            return { ...m, takeOffPoint: pt };
          }),

        // ---------- orbit ----------
        setOrbit: (orbit) =>
          updCurrent((m) => {
            if (m.type !== 'orbit') return m;
            return { ...m, orbit };
          }),

        updateOrbitParams: (patch) =>
          updCurrent((m) => {
            if (m.type !== 'orbit' || !m.orbit) return m;
            return {
              ...m,
              orbit: {
                ...m.orbit,
                params: { ...m.orbit.params, ...patch },
                scanPath: undefined, // 清空让 RecomputeHost 重算
              },
            };
          }),

        setOrbitScanResult: (scanPath) =>
          updCurrent((m) => {
            if (m.type !== 'orbit' || !m.orbit) return m;
            return { ...m, orbit: { ...m.orbit, scanPath } };
          }),
      };
    },
    {
      name: 'dualgaze.missions',
      version: 7,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        missions: state.missions,
        currentMissionId: state.currentMissionId,
      }),
      migrate: (persisted, _version) => {
        const p = persisted as { missions?: unknown; currentMissionId?: string | null } | undefined;
        if (!p || !Array.isArray(p.missions)) return p as never;
        return {
          ...p,
          missions: p.missions.map((m) => migrateMissionToLatest(m as Parameters<typeof migrateMissionToLatest>[0])),
        } as never;
      },
    },
  ),
);

// Selector helpers
export const useCurrentMission = (): Mission | null => {
  const id = useMissionsStore((s) => s.currentMissionId);
  const missions = useMissionsStore((s) => s.missions);
  if (!id) return null;
  return missions.find((m) => m.id === id) ?? null;
};

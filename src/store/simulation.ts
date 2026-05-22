import { create } from 'zustand';

export type SimMode = 'editing' | 'simulating';
export type SimSpeed = 1 | 2 | 5 | 10;

export interface DroneState {
  lon: number;
  lat: number;
  alt: number;
  heading: number; // ° 0=正北（drone 飞行方向）
  /** 当前段内进度 0..1（FPV 相机用来 lerp wp 间的 gimbalYaw/pitch） */
  segProgress?: number;
}

interface SimulationState {
  mode: SimMode;
  running: boolean; // play / pause（仅 simulating 时有意义）
  speed: SimSpeed;
  elapsedMs: number; // 自模拟开始的累计时间（受 speed 影响）
  droneState: DroneState | null;
  /** 已到达航点的 id 集合 */
  reachedWaypointIds: Set<string>;
  /** 当前段索引：drone 正从 waypoint[currentSegmentIndex] 飞向 waypoint[currentSegmentIndex+1] */
  currentSegmentIndex: number;
  /** 总时长 ms（基于 waypoints + speeds 算出来，进入 sim 时 freeze） */
  totalDurationMs: number;

  enterSim: (totalDurationMs: number, startState: DroneState) => void;
  exitSim: () => void;
  play: () => void;
  pause: () => void;
  stop: () => void;
  setSpeed: (s: SimSpeed) => void;
  /** 由 SimulationLoop 每帧调一次 —— tick 已经按 speed 缩放过的 dtMs */
  tick: (
    elapsedMs: number,
    droneState: DroneState,
    currentSegmentIndex: number,
  ) => void;
  markReached: (waypointId: string) => void;
}

export const useSimulationStore = create<SimulationState>((set, get) => ({
  mode: 'editing',
  running: false,
  speed: 1,
  elapsedMs: 0,
  droneState: null,
  reachedWaypointIds: new Set(),
  currentSegmentIndex: 0,
  totalDurationMs: 0,

  enterSim: (totalDurationMs, startState) =>
    set({
      mode: 'simulating',
      running: true,
      elapsedMs: 0,
      droneState: startState,
      reachedWaypointIds: new Set(),
      currentSegmentIndex: 0,
      totalDurationMs,
    }),

  exitSim: () =>
    set({
      mode: 'editing',
      running: false,
      elapsedMs: 0,
      droneState: null,
      reachedWaypointIds: new Set(),
      currentSegmentIndex: 0,
      totalDurationMs: 0,
    }),

  play: () => set({ running: true }),
  pause: () => set({ running: false }),
  stop: () =>
    set({
      running: false,
      elapsedMs: 0,
      droneState: null,
      reachedWaypointIds: new Set(),
      currentSegmentIndex: 0,
    }),

  setSpeed: (speed) => set({ speed }),

  tick: (elapsedMs, droneState, currentSegmentIndex) =>
    set({ elapsedMs, droneState, currentSegmentIndex }),

  markReached: (waypointId) => {
    // dedup：已 reached 直接返回，避免每帧 new Set() 引发 FrustumLayer 重绘闪烁
    if (get().reachedWaypointIds.has(waypointId)) return;
    set((s) => {
      const next = new Set(s.reachedWaypointIds);
      next.add(waypointId);
      return { reachedWaypointIds: next };
    });
  },
}));

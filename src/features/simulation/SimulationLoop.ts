import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useCurrentMission, useMissionsStore } from '../../store/missions';
import { useSimulationStore, type DroneState, type SimSpeed } from '../../store/simulation';
import type { Mission, Waypoint } from '../../types/mission';

/**
 * 模拟飞行 RAF 循环。
 *
 * 在 mode === 'simulating' 且 running 时启动 requestAnimationFrame；
 * 每帧按 speed × wall-clock dt 累计 elapsedMs，沿 waypoints 顺序做线性插值；
 * 抵达一个 waypoint 时调 markReached。
 */
export function useSimulationLoop(): void {
  const mission = useCurrentMission();
  const missionRef = useRef<Mission | null>(mission);
  missionRef.current = mission;

  // 把 store 用 ref 写进，避免每帧重新订阅
  useEffect(() => {
    let raf = 0;
    let lastTs: number | null = null;

    const step = (ts: number): void => {
      const state = useSimulationStore.getState();
      if (state.mode !== 'simulating' || !state.running) {
        lastTs = null;
        raf = requestAnimationFrame(step);
        return;
      }
      const m = missionRef.current;
      if (!m || effectiveWaypoints(m).length < 2) {
        lastTs = null;
        raf = requestAnimationFrame(step);
        return;
      }
      if (lastTs === null) {
        lastTs = ts;
        raf = requestAnimationFrame(step);
        return;
      }
      const wallDtMs = ts - lastTs;
      lastTs = ts;
      const dtMs = wallDtMs * (state.speed as SimSpeed);

      const segments = buildSegments(m);
      const total = segments.reduce((a, s) => a + s.durationMs, 0);
      const elapsed = Math.min(state.elapsedMs + dtMs, total);

      // 找当前段
      let acc = 0;
      let segIdx = 0;
      for (let i = 0; i < segments.length; i++) {
        if (elapsed <= acc + segments[i].durationMs) {
          segIdx = i;
          break;
        }
        acc += segments[i].durationMs;
        segIdx = i + 1;
      }
      if (segIdx >= segments.length) {
        segIdx = segments.length - 1;
      }

      const seg = segments[segIdx];
      const localElapsed = elapsed - acc;
      const t = seg.durationMs > 0 ? Math.min(localElapsed / seg.durationMs, 1) : 1;

      const droneState: DroneState = {
        lon: lerp(seg.from.lon, seg.to.lon, t),
        lat: lerp(seg.from.lat, seg.to.lat, t),
        alt: lerp(seg.from.alt, seg.to.alt, t),
        heading: bearingDeg(seg.from.lon, seg.from.lat, seg.to.lon, seg.to.lat),
        segProgress: t,
      };

      // 抵达逻辑：每帧无条件 mark seg.from（idempotent Set；drone 在它身上即"到过"），
      // 段终点的 t 接近 1 时再 mark seg.to。这样 WP1 也会从 sim 起始就被标记。
      useSimulationStore.getState().markReached(seg.from.id);
      const reachedThisFrame = t >= 1 - 1e-6;
      if (reachedThisFrame) useSimulationStore.getState().markReached(seg.to.id);

      useSimulationStore.getState().tick(elapsed, droneState, segIdx);

      // 到尽头自动停
      if (elapsed >= total - 1e-6) {
        const finalState = useSimulationStore.getState();
        if (finalState.running) {
          finalState.pause();
          const wpCount = effectiveWaypoints(m).length;
          const reachedCount = finalState.reachedWaypointIds.size;
          toast.success('模拟飞行完成', {
            description: `${wpCount} 航点 · ${reachedCount} 视锥`,
          });
        }
      }

      raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);
}

interface Segment {
  from: Waypoint;
  to: Waypoint;
  durationMs: number;
}

/**
 * 取 mission 实际飞行航点：
 *   - mapping → scanPath（多边形扫描算出来的）
 *   - facade → 所有 enabled face.scanPath 拼接
 *   - patrol → waypoints
 *
 * Sim 全链路（buildSegments / DroneLayer / WaypointLayer reach 标记 / 视锥）
 * 都用这个 helper，三种 mission 共用一套播放代码。
 */
export function effectiveWaypoints(mission: Mission): Waypoint[] {
  if (mission.type === 'mapping') return mission.scanPath ?? [];
  if (mission.type === 'orbit') {
    return (mission.orbit?.scanPath ?? []).map((wp, idx) => ({ ...wp, index: idx }));
  }
  if (mission.type === 'facade') {
    // 对齐 DPGO：1 face = 1 wayline = 1 架次。模拟飞行 / 段时序 / sim 入口 disabled
    // 判定都基于 activeFaceId 那一面，不再 concat 所有 face。
    const faces = mission.facadeFaces ?? [];
    if (faces.length === 0) return [];
    const activeId = mission.activeFaceId ?? null;
    const active =
      (activeId ? faces.find((f) => f.id === activeId) : null) ??
      faces.find((f) => f.enabled !== false) ??
      faces[0];
    if (!active || !active.enabled) return [];
    return (active.scanPath ?? []).map((wp, idx) => ({ ...wp, index: idx }));
  }
  return mission.waypoints;
}

/** 按 mission.globalSpeed (或 waypoint.speed 覆盖) 算每段耗时 */
function buildSegments(mission: Mission): Segment[] {
  const out: Segment[] = [];
  const wps = effectiveWaypoints(mission);
  for (let i = 0; i < wps.length - 1; i++) {
    const a = wps[i];
    const b = wps[i + 1];
    const speed = a.speed > 0 ? a.speed : mission.globalSpeed;
    const distM = haversineMeters(a.lon, a.lat, b.lon, b.lat);
    const durationMs = (distM / Math.max(speed, 0.1)) * 1000;
    out.push({ from: a, to: b, durationMs });
  }
  return out;
}

export function totalMissionDurationMs(mission: Mission): number {
  return buildSegments(mission).reduce((a, s) => a + s.durationMs, 0);
}

export function missionStartState(mission: Mission): DroneState | null {
  const wps = effectiveWaypoints(mission);
  if (wps.length === 0) return null;
  const first = wps[0];
  const second = wps[1];
  return {
    lon: first.lon,
    lat: first.lat,
    alt: first.alt,
    heading: second ? bearingDeg(first.lon, first.lat, second.lon, second.lat) : 0,
  };
}

/** 在 RightSheet / store 外部需要时用：拿当前 mission 的总距离（米） */
export function missionTotalDistanceMeters(mission: Mission): number {
  let d = 0;
  const wps = effectiveWaypoints(mission);
  for (let i = 0; i < wps.length - 1; i++) {
    d += haversineMeters(wps[i].lon, wps[i].lat, wps[i + 1].lon, wps[i + 1].lat);
  }
  return d;
}

// ----- math helpers -----

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

const EARTH_R = 6378137;

function toRad(d: number): number {
  return (d * Math.PI) / 180;
}

function toDeg(r: number): number {
  return (r * 180) / Math.PI;
}

function haversineMeters(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingDeg(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** 工具：进入 sim 时一键算 totalDurationMs + 起始 state */
export function prepareSimulation(): {
  totalDurationMs: number;
  startState: DroneState | null;
} {
  const store = useMissionsStore.getState();
  const mission = store.missions.find((m) => m.id === store.currentMissionId) ?? null;
  if (!mission || effectiveWaypoints(mission).length < 2) {
    return { totalDurationMs: 0, startState: null };
  }
  return {
    totalDurationMs: totalMissionDurationMs(mission),
    startState: missionStartState(mission),
  };
}

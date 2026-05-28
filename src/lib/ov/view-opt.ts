/**
 * OV 视角优化 —— 贪心 set-cover 从候选视角里挑最小冗余子集。
 *
 * 目标：每个采样点被 K 个"互不冗余"的视角覆盖。
 *   - 角度法：两视角对同一采样点的方向夹角 > alpha 即视为不冗余
 *   - 半球法：两视角落在采样点上半球不同分桶即视为不冗余（桶数由 halfDecayFaces 决定）
 *
 * 贪心：每轮选"边际增益"最大的候选视角（能给最多欠覆盖采样点补一个不冗余视角），
 * 直到所有采样点达 K、或无增益、或达终止数。
 *
 * 性能：每轮重算全部候选增益（submodular，简单实现）；每 20 选让出事件循环 + 报进度。
 */
import * as Cesium from 'cesium';
import type {
  OvSamplePoint,
  OvViewCandidate,
  OvViewOptParams,
} from '../../types/mission';
import { wgs84ToCartesian3 } from '../coord';
import type { VisibilityResultRaw } from './visibility';

export interface ViewOptProgress {
  selected: number;
  totalSamples: number;
  coveredSamples: number; // 已达 K 的采样点数
  elapsedMs: number;
}

export type ViewOptProgressCallback = (p: ViewOptProgress) => void;

type Vec3 = [number, number, number];

/** 主入口：返回选中的视角子集。 */
export async function runOvViewOpt(
  candidateViews: OvViewCandidate[],
  samples: OvSamplePoint[],
  visibility: VisibilityResultRaw,
  params: OvViewOptParams,
  onProgress: ViewOptProgressCallback,
  isCancelled: () => boolean,
): Promise<OvViewCandidate[]> {
  const t0 = performance.now();
  const K = Math.max(1, Math.floor(params.viewCount));
  const alphaCos = Math.cos(Cesium.Math.toRadians(params.alpha));
  const totalSamples = samples.length;
  if (candidateViews.length === 0 || totalSamples === 0) return [];

  // 预备：sample ECEF + view 对每个可见 sample 的方向（s→cam，单位）
  const sampleEcef = new Map<string, Cesium.Cartesian3>();
  for (const s of samples) sampleEcef.set(s.id, wgs84ToCartesian3(s.lon, s.lat, s.alt));

  // dirByViewSample: viewId → (sampleId → Vec3 方向)
  const dirByView = new Map<string, Map<string, Vec3>>();
  for (const v of candidateViews) {
    const camECEF = wgs84ToCartesian3(v.camLon, v.camLat, v.camAlt);
    const seen = visibility.viewSees.get(v.id) ?? [];
    const m = new Map<string, Vec3>();
    for (const sid of seen) {
      const sE = sampleEcef.get(sid);
      if (!sE) continue;
      const d = Cesium.Cartesian3.subtract(camECEF, sE, new Cesium.Cartesian3());
      Cesium.Cartesian3.normalize(d, d);
      m.set(sid, [d.x, d.y, d.z]);
    }
    dirByView.set(v.id, m);
  }

  // covered: sampleId → 已选视角对它的方向列表（用于 distinctness 判定）
  const covered = new Map<string, Vec3[]>();
  for (const s of samples) covered.set(s.id, []);

  const selected: OvViewCandidate[] = [];
  const selectedIds = new Set<string>();
  const terminate = params.terminationCount > 0 ? params.terminationCount : Infinity;

  // distinctness：方向 d 是否与已有 dirs 都"不冗余"
  const isDistinct = (d: Vec3, dirs: Vec3[]): boolean => {
    if (params.method === 'hemisphere') {
      const bin = hemisphereBin(d, params.halfDecayFaces);
      for (const e of dirs) {
        if (hemisphereBin(e, params.halfDecayFaces) === bin) return false;
      }
      return true;
    }
    // 角度法
    for (const e of dirs) {
      const dot = d[0] * e[0] + d[1] * e[1] + d[2] * e[2];
      if (dot > alphaCos) return false; // 夹角 < alpha → 冗余
    }
    return true;
  };

  let coveredSamples = 0;
  let iter = 0;

  while (selected.length < terminate) {
    if (isCancelled()) break;

    // 选边际增益最大的候选
    let best: OvViewCandidate | null = null;
    let bestGain = 0;
    let bestNewDirs: Array<{ sid: string; dir: Vec3 }> | null = null;

    for (const v of candidateViews) {
      if (selectedIds.has(v.id)) continue;
      const dirs = dirByView.get(v.id);
      if (!dirs || dirs.size === 0) continue;
      let gain = 0;
      const newDirs: Array<{ sid: string; dir: Vec3 }> = [];
      for (const [sid, d] of dirs) {
        const cov = covered.get(sid);
        if (!cov || cov.length >= K) continue;
        if (isDistinct(d, cov)) {
          gain++;
          newDirs.push({ sid, dir: d });
        }
      }
      if (gain > bestGain) {
        bestGain = gain;
        best = v;
        bestNewDirs = newDirs;
      }
    }

    if (!best || bestGain === 0 || !bestNewDirs) break;

    selected.push(best);
    selectedIds.add(best.id);
    for (const { sid, dir } of bestNewDirs) {
      const cov = covered.get(sid);
      if (cov) {
        cov.push(dir);
        if (cov.length === K) coveredSamples++;
      }
    }

    iter++;
    if (iter % 20 === 0) {
      onProgress({
        selected: selected.length,
        totalSamples,
        coveredSamples,
        elapsedMs: performance.now() - t0,
      });
      await new Promise((r) => setTimeout(r, 0));
    }

    if (coveredSamples >= totalSamples) break;
  }

  onProgress({
    selected: selected.length,
    totalSamples,
    coveredSamples,
    elapsedMs: performance.now() - t0,
  });
  return selected;
}

/**
 * 上半球分桶 id（半球法 distinctness 用）。
 * faces = 方位分段数（azimuth bins）；elevation 固定 3 段。
 */
function hemisphereBin(d: Vec3, faces: number): number {
  // d = s→cam 方向（ECEF 近似当作局部，简化用 d 本身的方位/仰角）
  const az = Math.atan2(d[1], d[0]); // -π..π
  const el = Math.asin(Math.max(-1, Math.min(1, d[2]))); // -π/2..π/2
  const nAz = Math.max(3, Math.floor(faces));
  const azBin = Math.floor(((az + Math.PI) / (2 * Math.PI)) * nAz) % nAz;
  const elBin = Math.min(2, Math.floor(((el + Math.PI / 2) / Math.PI) * 3));
  return elBin * nAz + azBin;
}

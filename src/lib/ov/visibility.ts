/**
 * OV 可见性矩阵 —— 几何法判每个候选视角能看到哪些采样点。
 *
 * 不做 per-pair ray-cast（1615×323 太慢），改用几何判据：
 *   view v 看得到 sample s 当且仅当：
 *     1. dist(cam_v, s) ∈ [0.3·D, 2·D]
 *     2. s 落在 v 的视锥锥内：angle(lookDir_v, dir(cam→s)) < halfFov
 *     3. s 表面朝向相机：dot(s.normal_enu, dir(s→cam)_enu) > cos(facingMaxDeg)
 *
 * spatial hash 按经纬度网格索引 samples；每个 view 只查目标采样点附近格子。
 *
 * 产物：
 *   - viewSees: Map<viewId, sampleId[]>
 *   - coverCount 写回（优化后传 selectedViews 重算，用于 6 色热图）
 */
import * as Cesium from 'cesium';
import type {
  OvSamplePoint,
  OvSamplingParams,
  OvCameraSpec,
  OvViewCandidate,
} from '../../types/mission';
import { wgs84ToCartesian3 } from '../coord';

const EARTH_R = 6378137;
const DEG_PER_METER = 1 / ((Math.PI * EARTH_R) / 180);
const FACING_MAX_DEG = 75; // 表面法向与"指向相机"夹角上限

interface PreparedView {
  view: OvViewCandidate;
  camECEF: Cesium.Cartesian3;
  lookDir: Cesium.Cartesian3; // cam → target，单位向量
}

interface PreparedSample {
  s: OvSamplePoint;
  ecef: Cesium.Cartesian3;
  enuInv: Cesium.Matrix4;
}

function horizontalFovDeg(focalLength35mm: number): number {
  return 2 * Cesium.Math.toDegrees(Math.atan(18 / focalLength35mm));
}

/** 经纬度网格 spatial hash（样本）。 */
function buildSampleHash(
  prepared: PreparedSample[],
  cellDegLon: number,
  cellDegLat: number,
): Map<string, PreparedSample[]> {
  const cells = new Map<string, PreparedSample[]>();
  for (const p of prepared) {
    const key = `${Math.floor(p.s.lon / cellDegLon)},${Math.floor(p.s.lat / cellDegLat)}`;
    let arr = cells.get(key);
    if (!arr) {
      arr = [];
      cells.set(key, arr);
    }
    arr.push(p);
  }
  return cells;
}

export interface VisibilityResultRaw {
  /** viewId → 它能看到的 sampleId 列表 */
  viewSees: Map<string, string[]>;
}

/**
 * 构建可见性矩阵。
 */
export function buildVisibility(
  views: OvViewCandidate[],
  samples: OvSamplePoint[],
  sampling: OvSamplingParams,
  camera: OvCameraSpec,
): VisibilityResultRaw {
  const D = Math.max(1, sampling.viewDistance);
  const minD = 0.3 * D;
  const maxD = 2 * D;
  const halfFovRad = Cesium.Math.toRadians(horizontalFovDeg(camera.focalLength35mm) / 2);
  const cosFov = Math.cos(halfFovRad);
  const cosFacing = Math.cos(Cesium.Math.toRadians(FACING_MAX_DEG));

  // 预备 samples
  const preparedSamples: PreparedSample[] = samples.map((s) => {
    const ecef = wgs84ToCartesian3(s.lon, s.lat, s.alt);
    const enu = Cesium.Transforms.eastNorthUpToFixedFrame(ecef);
    const enuInv = Cesium.Matrix4.inverseTransformation(enu, new Cesium.Matrix4());
    return { s, ecef, enuInv };
  });

  // hash cell ≈ maxD 跨度
  const midLat = samples.length ? samples[0].lat : 0;
  const cosLat = Math.max(Math.cos(Cesium.Math.toRadians(midLat)), 0.01);
  const cellDegLat = maxD * DEG_PER_METER;
  const cellDegLon = (maxD * DEG_PER_METER) / cosLat;
  const hash = buildSampleHash(preparedSamples, cellDegLon, cellDegLat);

  // 预备 views
  const sampleById = new Map<string, PreparedSample>();
  for (const ps of preparedSamples) sampleById.set(ps.s.id, ps);

  const viewSees = new Map<string, string[]>();

  const tmpDir = new Cesium.Cartesian3();
  const tmpEnuDir = new Cesium.Cartesian3();

  for (const v of views) {
    const camECEF = wgs84ToCartesian3(v.camLon, v.camLat, v.camAlt);
    const target = sampleById.get(v.targetSampleId);
    if (!target) {
      viewSees.set(v.id, []);
      continue;
    }
    const lookDir = Cesium.Cartesian3.subtract(target.ecef, camECEF, new Cesium.Cartesian3());
    Cesium.Cartesian3.normalize(lookDir, lookDir);

    const pv: PreparedView = { view: v, camECEF, lookDir };

    // 查目标附近 3×3 格子的 samples
    const cx = Math.floor(v.camLon / cellDegLon);
    const cy = Math.floor(v.camLat / cellDegLat);
    const seen: string[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const arr = hash.get(`${cx + dx},${cy + dy}`);
        if (!arr) continue;
        for (const ps of arr) {
          if (canSee(pv, ps, minD, maxD, cosFov, cosFacing, tmpDir, tmpEnuDir)) {
            seen.push(ps.s.id);
          }
        }
      }
    }
    viewSees.set(v.id, seen);
  }

  return { viewSees };
}

function canSee(
  pv: PreparedView,
  ps: PreparedSample,
  minD: number,
  maxD: number,
  cosFov: number,
  cosFacing: number,
  tmpDir: Cesium.Cartesian3,
  tmpEnuDir: Cesium.Cartesian3,
): boolean {
  // 1. 距离
  const dist = Cesium.Cartesian3.distance(pv.camECEF, ps.ecef);
  if (dist < minD || dist > maxD) return false;
  // 2. frustum 锥（dir cam→s 与 lookDir 夹角）
  const dirCamToS = Cesium.Cartesian3.subtract(ps.ecef, pv.camECEF, tmpDir);
  Cesium.Cartesian3.normalize(dirCamToS, dirCamToS);
  const dotFov = Cesium.Cartesian3.dot(dirCamToS, pv.lookDir);
  if (dotFov < cosFov) return false;
  // 3. 法向朝相机：dir s→cam（= -dirCamToS）转 ENU，dot normal
  const dirSToCamEcef = Cesium.Cartesian3.negate(dirCamToS, tmpDir);
  const dirEnu = Cesium.Matrix4.multiplyByPointAsVector(ps.enuInv, dirSToCamEcef, tmpEnuDir);
  const n = ps.s.normal;
  const dotFacing = dirEnu.x * n[0] + dirEnu.y * n[1] + dirEnu.z * n[2];
  if (dotFacing < cosFacing) return false;
  return true;
}

/**
 * 给定已选视角集，重算每个 sample 的 coverCount（被多少 selected view 看到）。
 * 就地写 samples[i].coverCount。
 */
export function computeCoverCounts(
  samples: OvSamplePoint[],
  selectedViews: OvViewCandidate[],
  viewSees: Map<string, string[]>,
): void {
  const count = new Map<string, number>();
  for (const v of selectedViews) {
    const seen = viewSees.get(v.id);
    if (!seen) continue;
    for (const sid of seen) count.set(sid, (count.get(sid) ?? 0) + 1);
  }
  for (const s of samples) s.coverCount = count.get(s.id) ?? 0;
}

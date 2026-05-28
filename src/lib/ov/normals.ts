/**
 * OV 采样点法向估计 —— 局部平面最小二乘拟合。
 *
 * M31 采样时 normal 占位 [0,0,1]；这里在 ENU 局部系内对每个点的邻居拟合平面
 *   z = a·e + b·n + c
 * 法向 = normalize(-a, -b, 1)（ENU），朝上为正（顶视/地面），斜坡也能正确倾斜。
 *
 * 邻居查找用经纬度网格 spatial hash，cellSize = 邻域半径（≈ 2.5× 采样步长）。
 * 邻居 < 4 个时退回 [0,0,1]。
 *
 * 注意：top-down 采样以屋顶/地面为主，法向多近垂直；墙面样本少（需 M31 加侧向 ray-cast）。
 * 但平面拟合对斜屋顶 / 缓坡同样有效，足以驱动 M32 视角生成。
 */
import * as Cesium from 'cesium';
import type { OvSamplePoint } from '../../types/mission';
import { wgs84ToCartesian3 } from '../coord';

const EARTH_R = 6378137;
const DEG_PER_METER = 1 / ((Math.PI * EARTH_R) / 180);

interface HashIndex {
  cells: Map<string, OvSamplePoint[]>;
  cellDegLon: number;
  cellDegLat: number;
}

function buildHash(
  samples: OvSamplePoint[],
  cellDegLon: number,
  cellDegLat: number,
): HashIndex {
  const cells = new Map<string, OvSamplePoint[]>();
  for (const s of samples) {
    const key = cellKey(s.lon, s.lat, cellDegLon, cellDegLat);
    let arr = cells.get(key);
    if (!arr) {
      arr = [];
      cells.set(key, arr);
    }
    arr.push(s);
  }
  return { cells, cellDegLon, cellDegLat };
}

function cellKey(lon: number, lat: number, cdLon: number, cdLat: number): string {
  return `${Math.floor(lon / cdLon)},${Math.floor(lat / cdLat)}`;
}

function queryNeighbors(
  index: HashIndex,
  s: OvSamplePoint,
  radiusM: number,
): OvSamplePoint[] {
  const cx = Math.floor(s.lon / index.cellDegLon);
  const cy = Math.floor(s.lat / index.cellDegLat);
  const out: OvSamplePoint[] = [];
  const cosLat = Math.cos(Cesium.Math.toRadians(s.lat));
  const radiusMSq = radiusM * radiusM;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const arr = index.cells.get(`${cx + dx},${cy + dy}`);
      if (!arr) continue;
      for (const n of arr) {
        // 近似平面距离（米）
        const dLonM = ((n.lon - s.lon) / DEG_PER_METER) * cosLat;
        const dLatM = (n.lat - s.lat) / DEG_PER_METER;
        const dAltM = n.alt - s.alt;
        if (dLonM * dLonM + dLatM * dLatM + dAltM * dAltM <= radiusMSq) {
          out.push(n);
        }
      }
    }
  }
  return out;
}

/**
 * 就地为每个 sample 写 normal（ENU [e,n,u] 单位向量）。
 * @param stepM 采样步长（米），用于推邻域半径。
 */
export function estimateNormals(samples: OvSamplePoint[], stepM: number): void {
  if (samples.length === 0) return;
  const radiusM = Math.max(2, stepM * 2.5);
  // cell 大小取邻域半径对应的经纬度跨度
  const midLat = samples[0].lat;
  const cosLat = Math.max(Math.cos(Cesium.Math.toRadians(midLat)), 0.01);
  const cellDegLat = radiusM * DEG_PER_METER;
  const cellDegLon = (radiusM * DEG_PER_METER) / cosLat;
  const index = buildHash(samples, cellDegLon, cellDegLat);

  for (const s of samples) {
    const neighbors = queryNeighbors(index, s, radiusM);
    if (neighbors.length < 4) {
      s.normal = [0, 0, 1];
      continue;
    }
    const normal = fitPlaneNormalEnu(s, neighbors);
    s.normal = normal;
  }
}

/**
 * 在 s 处的 ENU 系内拟合 z = a·e + b·n + c，返回 normalize(-a,-b,1)。
 * 退化（行列式 ≈ 0）时返回 [0,0,1]。
 */
function fitPlaneNormalEnu(
  s: OvSamplePoint,
  neighbors: OvSamplePoint[],
): [number, number, number] {
  const originECEF = wgs84ToCartesian3(s.lon, s.lat, s.alt);
  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(originECEF);
  const enuInv = Cesium.Matrix4.inverseTransformation(enu, new Cesium.Matrix4());

  // 法方程矩阵 M (3×3 对称) 和右端 rhs (3)，未知 [a,b,c]
  // 行基 [e, n, 1]，目标 u
  let Mee = 0;
  let Men = 0;
  let Me1 = 0;
  let Mnn = 0;
  let Mn1 = 0;
  let M11 = 0;
  let be = 0;
  let bn = 0;
  let b1 = 0;
  const tmp = new Cesium.Cartesian3();
  for (const nb of neighbors) {
    const ecef = wgs84ToCartesian3(nb.lon, nb.lat, nb.alt);
    const local = Cesium.Matrix4.multiplyByPoint(enuInv, ecef, tmp);
    const e = local.x;
    const n = local.y;
    const u = local.z;
    Mee += e * e;
    Men += e * n;
    Me1 += e;
    Mnn += n * n;
    Mn1 += n;
    M11 += 1;
    be += e * u;
    bn += n * u;
    b1 += u;
  }

  // 解 3×3 线性方程 [Mee Men Me1; Men Mnn Mn1; Me1 Mn1 M11] [a b c]^T = [be bn b1]^T
  const sol = solve3x3(
    Mee, Men, Me1,
    Men, Mnn, Mn1,
    Me1, Mn1, M11,
    be, bn, b1,
  );
  if (!sol) return [0, 0, 1];
  const [a, b] = sol;
  // 平面 z = a e + b n + c → 法向 (-a, -b, 1)
  const nx = -a;
  const ny = -b;
  const nz = 1;
  const len = Math.hypot(nx, ny, nz);
  if (!Number.isFinite(len) || len < 1e-9) return [0, 0, 1];
  return [nx / len, ny / len, nz / len];
}

/** Cramer 法解 3×3；行列式接近 0 返回 null。 */
function solve3x3(
  a11: number, a12: number, a13: number,
  a21: number, a22: number, a23: number,
  a31: number, a32: number, a33: number,
  b1: number, b2: number, b3: number,
): [number, number, number] | null {
  const det =
    a11 * (a22 * a33 - a23 * a32) -
    a12 * (a21 * a33 - a23 * a31) +
    a13 * (a21 * a32 - a22 * a31);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return null;
  const invDet = 1 / det;
  const x =
    (b1 * (a22 * a33 - a23 * a32) -
      a12 * (b2 * a33 - a23 * b3) +
      a13 * (b2 * a32 - a22 * b3)) *
    invDet;
  const y =
    (a11 * (b2 * a33 - a23 * b3) -
      b1 * (a21 * a33 - a23 * a31) +
      a13 * (a21 * b3 - b2 * a31)) *
    invDet;
  const z =
    (a11 * (a22 * b3 - b2 * a32) -
      a12 * (a21 * b3 - b2 * a31) +
      b1 * (a21 * a32 - a22 * a31)) *
    invDet;
  return [x, y, z];
}

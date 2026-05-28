/**
 * OV 视角生成 —— 每采样点按法向生成多角度拍摄机位（候选视角）。
 *
 * 流程（对齐蝶舞）：
 *  1. 按 normal 判 surface 类型：|n·up| > 0.5 → 顶视（屋顶/地面）；否则 侧视（墙面）
 *  2. 顶视 5 变体：原（天顶）+ 北/东/南/西（45° 斜拍）
 *     侧视 4 变体：原 / 平视（压平 pitch=0）/ 左移 / 右移（绕竖轴 ±20°）
 *  3. 每变体推相机 ECEF → 算 heading/pitch → 检 alt 区间 + pitch 区间 + 遮挡
 *  4. 检查失败 → 依次试 7 调整策略（分层/水平环/拉近/抬高/拉远/垂直环/球形），
 *     每策略从 step 递增到 limit；首个通过即采纳；全失败则放弃该视角
 *
 * 遮挡检测：从相机朝采样点射线 pickFromRay，命中距离 < D − 1m 视为被挡。
 * 无 tileset 时 pickFromRay 不命中 → 视为无遮挡（globe 仅做地形遮挡）。
 */
import * as Cesium from 'cesium';
import type {
  OvSamplePoint,
  OvSamplingParams,
  OvViewCandidate,
  OvViewGenParams,
} from '../../types/mission';
import { wgs84ToCartesian3, cartesian3ToWgs84 } from '../coord';

export interface ViewGenProgress {
  total: number;
  done: number;
  views: number;
  elapsedMs: number;
}

export type ViewGenProgressCallback = (p: ViewGenProgress) => void;

let _viewIdSeq = 0;
const newViewId = (): string =>
  `view_${Date.now().toString(36)}_${(++_viewIdSeq).toString(36)}`;

const OBLIQUE_DEG = 45; // 顶视斜拍角（离天顶）
const SHIFT_DEG = 20; // 侧视左右移角

interface VariantSpec {
  name: string;
  /** ENU 相机方向（从采样点指向相机的单位向量，未乘距离） */
  dir: [number, number, number];
  /** 是否强制压平 pitch 到 0（平视变体） */
  flatten?: boolean;
}

/** 主入口：生成候选视角。samples 须已含估计好的 normal。 */
export async function runOvViewGen(
  viewer: Cesium.Viewer,
  samples: OvSamplePoint[],
  viewGen: OvViewGenParams,
  sampling: OvSamplingParams,
  onProgress: ViewGenProgressCallback,
  isCancelled: () => boolean,
): Promise<OvViewCandidate[]> {
  const t0 = performance.now();
  const out: OvViewCandidate[] = [];
  const D = Math.max(1, sampling.viewDistance);
  const total = samples.length;
  if (total === 0) return out;

  const sceneAny = viewer.scene as unknown as {
    pickFromRay: (
      ray: Cesium.Ray,
      exclude?: object[],
    ) => { position?: Cesium.Cartesian3 } | undefined;
  };

  const batchSize = 64;
  let done = 0;

  for (const s of samples) {
    if (isCancelled()) return out;
    const variants = variantsForSample(s, viewGen);
    const sampleECEF = wgs84ToCartesian3(s.lon, s.lat, s.alt);
    const enuMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(sampleECEF);
    const enuInv = Cesium.Matrix4.inverseTransformation(enuMatrix, new Cesium.Matrix4());

    for (const variant of variants) {
      const view = tryGenerateView(
        s,
        sampleECEF,
        enuMatrix,
        enuInv,
        variant,
        D,
        viewGen,
        sampling,
        sceneAny,
      );
      if (view) out.push(view);
    }

    done++;
    if (done % batchSize === 0) {
      onProgress({ total, done, views: out.length, elapsedMs: performance.now() - t0 });
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  onProgress({ total, done, views: out.length, elapsedMs: performance.now() - t0 });
  return out;
}

/** 按 surface 类型 + enabled 开关给出变体列表。 */
function variantsForSample(
  s: OvSamplePoint,
  viewGen: OvViewGenParams,
): VariantSpec[] {
  const [ne, nn, nu] = s.normal;
  const isTop = Math.abs(nu) > 0.5;
  const out: VariantSpec[] = [];

  if (isTop) {
    const t = viewGen.topVariants;
    const up: [number, number, number] = [0, 0, 1];
    if (t.original) out.push({ name: 'top-original', dir: up });
    if (t.north) out.push({ name: 'top-north', dir: tiltToward(up, [0, 1, 0], OBLIQUE_DEG) });
    if (t.east) out.push({ name: 'top-east', dir: tiltToward(up, [1, 0, 0], OBLIQUE_DEG) });
    if (t.south) out.push({ name: 'top-south', dir: tiltToward(up, [0, -1, 0], OBLIQUE_DEG) });
    if (t.west) out.push({ name: 'top-west', dir: tiltToward(up, [-1, 0, 0], OBLIQUE_DEG) });
  } else {
    const sv = viewGen.sideVariants;
    // 侧视基方向 = 法向投影到水平面后单位化
    const horiz = normalize3([ne, nn, 0]);
    const base = horiz[0] === 0 && horiz[1] === 0 ? ([0, 1, 0] as [number, number, number]) : horiz;
    if (sv.original) out.push({ name: 'side-original', dir: base });
    if (sv.horizontal) out.push({ name: 'side-horizontal', dir: base, flatten: true });
    if (sv.leftShift) out.push({ name: 'side-left', dir: rotateAroundUp(base, SHIFT_DEG), flatten: true });
    if (sv.rightShift) out.push({ name: 'side-right', dir: rotateAroundUp(base, -SHIFT_DEG), flatten: true });
  }
  return out;
}

/**
 * 尝试为一个变体生成视角：基位检查 → 失败走 7 策略。
 * 全失败返回 null。
 */
function tryGenerateView(
  s: OvSamplePoint,
  sampleECEF: Cesium.Cartesian3,
  enuMatrix: Cesium.Matrix4,
  enuInv: Cesium.Matrix4,
  variant: VariantSpec,
  D: number,
  viewGen: OvViewGenParams,
  sampling: OvSamplingParams,
  sceneAny: { pickFromRay: (ray: Cesium.Ray, exclude?: object[]) => { position?: Cesium.Cartesian3 } | undefined },
): OvViewCandidate | null {
  // 基位
  const base = evalView(sampleECEF, enuMatrix, enuInv, variant.dir, D, variant.flatten ?? false);
  if (base && passesChecks(base, sampleECEF, viewGen, sampling, sceneAny, D)) {
    return makeCandidate(s, base, variant.name);
  }

  // 7 策略（每策略 step 递增到 limit）
  const strat = viewGen.strategies;
  const tryStrategy = (
    enabled: boolean,
    step: number,
    limit: number,
    transform: (stepVal: number) => { dir: [number, number, number]; dist: number; flatten: boolean },
    tag: string,
  ): OvViewCandidate | null => {
    if (!enabled || step <= 0) return null;
    for (let v = step; v <= limit; v += step) {
      const t = transform(v);
      const ev = evalView(sampleECEF, enuMatrix, enuInv, t.dir, t.dist, t.flatten);
      if (ev && passesChecks(ev, sampleECEF, viewGen, sampling, sceneAny, t.dist)) {
        return makeCandidate(s, ev, `${variant.name}+${tag}`);
      }
    }
    return null;
  };

  const baseDir = variant.dir;
  const flat = variant.flatten ?? false;

  return (
    tryStrategy(strat.layer.enabled, strat.layer.step, strat.layer.limit,
      (v) => ({ dir: addUp(baseDir, v / D), dist: D, flatten: flat }), 'layer') ||
    tryStrategy(strat.liftHeight.enabled, strat.liftHeight.step, strat.liftHeight.limit,
      (v) => ({ dir: addUp(baseDir, v / D), dist: D, flatten: flat }), 'lift') ||
    tryStrategy(strat.pullNear.enabled, strat.pullNear.step, strat.pullNear.limit,
      (v) => ({ dir: baseDir, dist: Math.max(1, D - v), flatten: flat }), 'near') ||
    tryStrategy(strat.pushFar.enabled, strat.pushFar.step, strat.pushFar.limit,
      (v) => ({ dir: baseDir, dist: D + v, flatten: flat }), 'far') ||
    tryStrategy(strat.horizontalRing.enabled, strat.horizontalRing.step, strat.horizontalRing.limit,
      (v) => ({ dir: rotateAroundUp(baseDir, v), dist: D, flatten: flat }), 'hring') ||
    tryStrategy(strat.verticalRing.enabled, strat.verticalRing.step, strat.verticalRing.limit,
      (v) => ({ dir: tiltToward(baseDir, [0, 0, 1], v), dist: D, flatten: flat }), 'vring') ||
    tryStrategy(strat.sphere.enabled, strat.sphere.step, strat.sphere.limit,
      (v) => ({ dir: tiltToward(rotateAroundUp(baseDir, v), [0, 0, 1], v / 2), dist: D, flatten: flat }), 'sphere')
  );
}

interface EvalResult {
  camLon: number;
  camLat: number;
  camAlt: number;
  heading: number;
  pitch: number;
  camECEF: Cesium.Cartesian3;
}

/** 由 ENU 方向 + 距离推相机 WGS84 + heading/pitch。 */
function evalView(
  sampleECEF: Cesium.Cartesian3,
  enuMatrix: Cesium.Matrix4,
  enuInv: Cesium.Matrix4,
  dir: [number, number, number],
  dist: number,
  flatten: boolean,
): EvalResult | null {
  const nd = normalize3(dir);
  const camENU = new Cesium.Cartesian3(nd[0] * dist, nd[1] * dist, nd[2] * dist);
  const camECEF = Cesium.Matrix4.multiplyByPoint(enuMatrix, camENU, new Cesium.Cartesian3());
  if (!Number.isFinite(camECEF.x)) return null;
  const camWgs = cartesian3ToWgs84(camECEF);

  // lookDir ECEF（相机 → 采样点）
  const lookEcef = Cesium.Cartesian3.subtract(sampleECEF, camECEF, new Cesium.Cartesian3());
  Cesium.Cartesian3.normalize(lookEcef, lookEcef);
  // 转到采样点 ENU（小尺度近似可用 sample 的 enuInv）
  const lookEnu = Cesium.Matrix4.multiplyByPointAsVector(enuInv, lookEcef, new Cesium.Cartesian3());
  const e = lookEnu.x;
  const n = lookEnu.y;
  const u = lookEnu.z;
  const headingDeg = ((Cesium.Math.toDegrees(Math.atan2(e, n)) % 360) + 360) % 360;
  let pitchDeg = flatten ? 0 : Cesium.Math.toDegrees(Math.atan2(u, Math.hypot(e, n)));

  return {
    camLon: camWgs.lon,
    camLat: camWgs.lat,
    camAlt: camWgs.alt,
    heading: headingDeg,
    pitch: pitchDeg,
    camECEF,
  };
}

/** 检查 alt 区间 + pitch 区间 + 遮挡。 */
function passesChecks(
  ev: EvalResult,
  sampleECEF: Cesium.Cartesian3,
  viewGen: OvViewGenParams,
  sampling: OvSamplingParams,
  sceneAny: { pickFromRay: (ray: Cesium.Ray, exclude?: object[]) => { position?: Cesium.Cartesian3 } | undefined },
  dist: number,
): boolean {
  // alt 区间（相机不能超出采样高度范围太多 —— 用 sampling 的 max + 余量）
  if (ev.camAlt > sampling.maxHeight + 50 || ev.camAlt < sampling.minHeight - 5) return false;
  // pitch 区间
  const [pMin, pMax] = viewGen.pitchRange;
  if (ev.pitch < pMin - 0.5 || ev.pitch > pMax + 0.5) return false;
  // 遮挡：从相机朝采样点射线
  const dirEcef = Cesium.Cartesian3.subtract(sampleECEF, ev.camECEF, new Cesium.Cartesian3());
  Cesium.Cartesian3.normalize(dirEcef, dirEcef);
  const ray = new Cesium.Ray(ev.camECEF, dirEcef);
  const hit = sceneAny.pickFromRay(ray);
  if (hit?.position && Number.isFinite(hit.position.x)) {
    const hitDist = Cesium.Cartesian3.distance(ev.camECEF, hit.position);
    if (hitDist < dist - 1.0) return false; // 命中物在采样点之前 → 被挡
  }
  return true;
}

function makeCandidate(s: OvSamplePoint, ev: EvalResult, variant: string): OvViewCandidate {
  return {
    id: newViewId(),
    camLon: ev.camLon,
    camLat: ev.camLat,
    camAlt: ev.camAlt,
    targetSampleId: s.id,
    heading: ev.heading,
    pitch: ev.pitch,
    variant,
  };
}

// ---------- 向量 helpers（ENU [e,n,u]） ----------

function normalize3(v: [number, number, number]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (!Number.isFinite(len) || len < 1e-9) return [0, 0, 1];
  return [v[0] / len, v[1] / len, v[2] / len];
}

/** 把向量 a 朝水平/任意单位方向 t 倾斜 deg 度（绕 a×t 轴）。 */
function tiltToward(
  a: [number, number, number],
  t: [number, number, number],
  deg: number,
): [number, number, number] {
  const rad = Cesium.Math.toRadians(deg);
  const an = normalize3(a);
  const tn = normalize3(t);
  const c = Math.cos(rad);
  const sLen = Math.sin(rad);
  // 结果 = a*cos + t*sin（近似 slerp，足够用）
  return normalize3([
    an[0] * c + tn[0] * sLen,
    an[1] * c + tn[1] * sLen,
    an[2] * c + tn[2] * sLen,
  ]);
}

/** 绕 up 轴（+u）旋转 deg 度。 */
function rotateAroundUp(
  v: [number, number, number],
  deg: number,
): [number, number, number] {
  const rad = Cesium.Math.toRadians(deg);
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  // 绕 z（up）旋转：e' = e c - n s; n' = e s + n c
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]];
}

/** 给方向加一点 up 分量（用于分层/抬高策略）。 */
function addUp(v: [number, number, number], deltaU: number): [number, number, number] {
  return normalize3([v[0], v[1], v[2] + deltaU]);
}

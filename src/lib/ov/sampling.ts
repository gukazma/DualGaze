/**
 * OV 采样核心 —— AOI bbox 内 ray-cast 网格化采样。
 *
 * M31 MVP 实现：
 *  - 顶向下 ray-cast（从 maxHeight + 50m 高空往下射）
 *  - 命中即 1 个 sample；normal 先用 [0,0,1] 占位（M32 通过 3 邻居 finite-diff 重算）
 *  - 'sides' / 'full' surfaceMode 在 M31 暂时同效（待 M32 加侧向 ray-cast）
 *  - 可视范围采样 toggle 也 M31 暂忽略
 *
 * 步长：用 viewDistance + 视场角推水平投影直径 D，乘 (1-overlap) 得格子边长。
 *   step = D × (1 - overlapRatio)
 *   D = 2 × viewDistance × tan(halfFovDeg)
 * 24mm 35mm-eq 焦距 → fov 水平 ≈ 74°，垂直 ≈ 53°；取水平作 D。
 *
 * 性能：单帧同步跑；500 sample 应在 < 500ms。后续 M32 加 requestIdleCallback 批量。
 */
import * as Cesium from 'cesium';
import type {
  OvAoi,
  OvCameraSpec,
  OvNoFlyZone,
  OvSamplePoint,
  OvSamplingParams,
} from '../../types/mission';
import { wgs84ToCartesian3, cartesian3ToWgs84 } from '../coord';
import { aoiBoundingBox, isAltInRange, isInsideAnyNoFly, isInsideAoi } from './safety';

export interface SamplingProgress {
  total: number;
  done: number;
  samples: number;
  /** 已耗时 ms */
  elapsedMs: number;
}

export type SamplingProgressCallback = (p: SamplingProgress) => void;

const EARTH_R = 6378137;
const DEG_PER_METER = 1 / ((Math.PI * EARTH_R) / 180);

let _sampleIdSeq = 0;
const newSampleId = (): string =>
  `smp_${Date.now().toString(36)}_${(++_sampleIdSeq).toString(36)}`;

/**
 * 35mm 等效焦距 → 水平视场角度（°）。
 * 35mm 全画幅水平宽 36mm；fov = 2*atan(18 / focal)
 */
function horizontalFovDeg(focalLength35mm: number): number {
  return 2 * Cesium.Math.toDegrees(Math.atan(18 / focalLength35mm));
}

/** 步长（米）。 */
export function samplingStepMeters(
  sampling: OvSamplingParams,
  camera: OvCameraSpec,
): number {
  const fovDeg = horizontalFovDeg(camera.focalLength35mm);
  const halfFovRad = Cesium.Math.toRadians(fovDeg / 2);
  const footprintM = 2 * sampling.viewDistance * Math.tan(halfFovRad);
  const step = footprintM * Math.max(0.05, 1 - sampling.overlapRatio);
  // 防止极小步长导致几何爆炸：下限 0.5m，上限 100m
  return Math.max(0.5, Math.min(100, step));
}

/**
 * 主入口：跑一遍 ray-cast 采样，返回 OvSamplePoint[]。
 *
 * 设计为 async：内部每 batchSize 个格子让出事件循环（setTimeout(0)）
 * 给 UI 一个机会响应进度条 + ESC 取消。
 */
export async function runOvSampling(
  viewer: Cesium.Viewer,
  aoi: OvAoi,
  sampling: OvSamplingParams,
  camera: OvCameraSpec,
  onProgress: SamplingProgressCallback,
  isCancelled: () => boolean,
  noFlyZones: OvNoFlyZone[] = [],
): Promise<OvSamplePoint[]> {
  const t0 = performance.now();
  const samples: OvSamplePoint[] = [];

  const bbox = aoiBoundingBox(aoi);
  const stepM = samplingStepMeters(sampling, camera);

  // step (米) → deg。lat 接近常数 = stepM / EARTH_R；lon 要除以 cos(lat)
  const midLat = (bbox.minLat + bbox.maxLat) / 2;
  const cosLat = Math.cos(Cesium.Math.toRadians(midLat));
  const stepDegLat = stepM * DEG_PER_METER;
  const stepDegLon = stepM * DEG_PER_METER / Math.max(cosLat, 0.01);

  // 含 AOI 外扩 expandDistance
  const expandDegLat = sampling.expandDistance * DEG_PER_METER;
  const expandDegLon = sampling.expandDistance * DEG_PER_METER / Math.max(cosLat, 0.01);

  const lonStart = bbox.minLon - expandDegLon;
  const lonEnd = bbox.maxLon + expandDegLon;
  const latStart = bbox.minLat - expandDegLat;
  const latEnd = bbox.maxLat + expandDegLat;

  // ray 起始高度：max(maxHeight, AOI 估顶) + 50m
  const sky = (sampling.maxHeight || 100) + 50;

  // pickFromRay 类型 cast（Cesium 1.124 d.ts 未完全覆盖）
  const sceneAny = viewer.scene as unknown as {
    pickFromRay: (
      ray: Cesium.Ray,
      exclude?: object[],
    ) => { position?: Cesium.Cartesian3 } | undefined;
  };

  // 估算 total 格子数（外圈 bbox / step）
  const nLon = Math.ceil((lonEnd - lonStart) / stepDegLon);
  const nLat = Math.ceil((latEnd - latStart) / stepDegLat);
  const total = nLon * nLat;
  if (total === 0) return [];

  const batchSize = 128; // 每 batch 让出一次事件循环
  let done = 0;

  const downDir = new Cesium.Cartesian3(0, 0, 0); // placeholder; will set per ray

  for (let iy = 0; iy < nLat; iy++) {
    const lat = latStart + iy * stepDegLat;
    for (let ix = 0; ix < nLon; ix++) {
      if (isCancelled()) return samples;
      const lon = lonStart + ix * stepDegLon;
      // 跳过 AOI 外的格子（含 expand 区域不严格 reject）
      // ray 起点：(lon, lat, sky) ECEF；方向：朝下（朝椭球中心方向的反向）
      const rayOrigin = wgs84ToCartesian3(lon, lat, sky);
      // 方向 = -normalize(rayOrigin)（指向地心方向）
      const negOriginNorm = Cesium.Cartesian3.normalize(
        rayOrigin,
        new Cesium.Cartesian3(),
      );
      Cesium.Cartesian3.negate(negOriginNorm, downDir);
      const ray = new Cesium.Ray(rayOrigin, downDir);
      const hit = sceneAny.pickFromRay(ray);
      let cart: Cesium.Cartesian3 | undefined = hit?.position;
      // 无 tileset 时 fallback 到 globe.pick，让用户至少看到地面采样点
      if (!cart || !Number.isFinite(cart.x)) {
        const cartGlobe = viewer.scene.globe.pick(ray, viewer.scene);
        if (cartGlobe && Number.isFinite(cartGlobe.x)) cart = cartGlobe;
      }
      if (cart && Number.isFinite(cart.x)) {
        const wgs = cartesian3ToWgs84(cart);
        if (
          isInsideAoi({ lon: wgs.lon, lat: wgs.lat }, aoi) &&
          isAltInRange(wgs.alt, sampling) &&
          !isInsideAnyNoFly({ lon: wgs.lon, lat: wgs.lat }, wgs.alt, noFlyZones)
        ) {
          samples.push({
            id: newSampleId(),
            lon: wgs.lon,
            lat: wgs.lat,
            alt: wgs.alt,
            normal: [0, 0, 1], // M31 占位；M32 通过 3 邻居 finite-diff 重算
          });
        }
      }
      done++;
      if (done % batchSize === 0) {
        onProgress({
          total,
          done,
          samples: samples.length,
          elapsedMs: performance.now() - t0,
        });
        // 让出事件循环
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  }

  onProgress({
    total,
    done,
    samples: samples.length,
    elapsedMs: performance.now() - t0,
  });
  return samples;
}

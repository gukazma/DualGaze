import { useEffect, useRef } from 'react';
import * as Cesium from 'cesium';
import { useCesiumViewer } from '../cesium/CesiumContext';
import { useCurrentMission } from '../../store/missions';
import { useOrbitPickerStore } from '../../store/orbit-picker';
import { useUiStore } from '../../store/ui';
import { wgs84ToCartesian3 } from '../../lib/coord';
import { AXIS_ABOVE, AXIS_BELOW, type OrbitPartial } from './OrbitPicker';
import type { OrbitDef, Waypoint } from '../../types/mission';

const COLOR_ORBIT = Cesium.Color.fromCssColorString('#ffd24a');
const COLOR_CURSOR = Cesium.Color.fromCssColorString('#ffd24a');
const COLOR_FIT = Cesium.Color.fromCssColorString('#e8e8e8');

/**
 * Orbit mission 渲染：
 *
 *  - 已保存的 mission.orbit：黄 axis 线 + 圆柱外环 + scanPath 采样点
 *  - picker building（v3.5 4 步累积）：随 partial 字段累积渲染轴线 / bottom marker /
 *    top marker / 拟合圆 + 圆柱 / radius handle
 *
 * 所有元素参与深度测试（被前景挡住时隐藏，避免穿墙干扰）。
 */
export function OrbitLayer() {
  const viewer = useCesiumViewer();
  const mission = useCurrentMission();
  const missionId = mission?.id;
  const missionType = mission?.type;
  const pickerMode = useUiStore((s) => s.pickerMode);
  const pickerState = useOrbitPickerStore((s) => s.state);
  const dsRef = useRef<Cesium.CustomDataSource | null>(null);

  // dataSource lifecycle
  useEffect(() => {
    if (!viewer) return;
    if (missionType !== 'orbit') {
      if (dsRef.current) {
        viewer.dataSources.remove(dsRef.current, true);
        dsRef.current = null;
      }
      return;
    }
    const ds = new Cesium.CustomDataSource(`orbit-${missionId}`);
    void viewer.dataSources.add(ds);
    dsRef.current = ds;
    return () => {
      viewer.dataSources.remove(ds, true);
      dsRef.current = null;
    };
  }, [viewer, missionId, missionType]);

  // 已保存的 mission.orbit 渲染
  useEffect(() => {
    const ds = dsRef.current;
    if (!ds) return;
    ds.entities.removeAll();
    if (!mission || mission.type !== 'orbit') return;

    // 1. 已 commit 的 orbit
    if (mission.orbit) {
      renderOrbit(ds, mission.orbit, mission.orbit.scanPath ?? [], 1.0);
    }

    // 2. picker 进行中（v3.5 4 步累积 building）
    if (pickerMode === 'orbit-draw' && pickerState.mode === 'building') {
      renderBuilding(ds, pickerState.partial, pickerState.scanPath);
    }
  }, [mission, pickerMode, pickerState]);

  return null;
}

/**
 * v3.5 building 渲染：根据 partial 已设的字段逐步画 axis / bottom / top / radius / cylinder。
 *
 * 渲染层次（z-order ascending）：
 *  1. axis 长虚线（总是画，alt 范围根据 partial 推断）
 *  2. axis 实线段（bottom..top 段，bottom+top 都设时）
 *  3. 拟合圆 + 圆柱外环 + scanPath（partial 全齐 即 step=done）
 *  4. handles: axis center handle, bottom marker, top marker, radius handle
 */
function renderBuilding(
  ds: Cesium.CustomDataSource,
  p: OrbitPartial,
  scanPath: Waypoint[],
): void {
  if (p.axisLon == null || p.axisLat == null) return;
  const lon = p.axisLon;
  const lat = p.axisLat;

  // 轴可视的 alt 范围
  // - 都没设：以 0 为中心 ±AXIS_BELOW
  // - 只设了 bottom：bottom-200 到 bottom+200
  // - 都设了：bottom-AXIS_BELOW 到 top+AXIS_ABOVE
  const bMaybe = p.bottomAlt;
  const tMaybe = p.topAlt;
  const lineMin =
    bMaybe != null ? bMaybe - AXIS_BELOW : tMaybe != null ? tMaybe - AXIS_BELOW : -AXIS_BELOW;
  const lineMax =
    tMaybe != null ? tMaybe + AXIS_ABOVE : bMaybe != null ? bMaybe + AXIS_ABOVE : AXIS_ABOVE;

  // axis 长虚线（picker- 前缀让 drillPickFromRay 拖拽时跳过）
  ds.entities.add({
    name: 'orbit-picker-axis',
    polyline: {
      positions: [
        wgs84ToCartesian3(lon, lat, lineMin),
        wgs84ToCartesian3(lon, lat, lineMax),
      ],
      width: 2,
      material: new Cesium.PolylineDashMaterialProperty({
        color: COLOR_ORBIT.withAlpha(0.55),
        dashLength: 8,
      }),
      arcType: Cesium.ArcType.NONE,
    },
  });

  // axis 实线段（圆柱长度）
  if (bMaybe != null && tMaybe != null && tMaybe > bMaybe) {
    ds.entities.add({
      name: 'orbit-picker-axis-solid',
      polyline: {
        positions: [
          wgs84ToCartesian3(lon, lat, bMaybe),
          wgs84ToCartesian3(lon, lat, tMaybe),
        ],
        width: 3,
        material: COLOR_ORBIT.withAlpha(0.95),
        arcType: Cesium.ArcType.NONE,
      },
    });
  }

  // 完整 orbit 时画圆柱 + scanPath
  if (
    p.axisLon != null &&
    p.axisLat != null &&
    bMaybe != null &&
    tMaybe != null &&
    p.radius != null
  ) {
    const orbit: OrbitDef = {
      axisBottom: { lon, lat, alt: bMaybe },
      axisTop: { lon, lat, alt: tMaybe },
      radius: p.radius,
      params: { ...DEFAULT_PARAMS_FOR_LAYER, totalH: tMaybe - bMaybe },
    };
    renderOrbit(ds, orbit, scanPath, 1.0);
  } else if (p.radius != null && bMaybe != null) {
    // 没设 top 但设了 radius：画一圈拟合圆（在 bottom 高度上）
    const ringPositions = sampleCirclePositions(lon, lat, bMaybe, p.radius, 48);
    ds.entities.add({
      name: 'orbit-picker-fit-ring',
      polyline: {
        positions: ringPositions,
        width: 1.5,
        material: COLOR_FIT.withAlpha(0.75),
        arcType: Cesium.ArcType.NONE,
      },
    });
  }

  // ===== Handles =====
  // axis 中心 handle 的代表 alt
  const axisRepAlt =
    bMaybe != null && tMaybe != null ? (bMaybe + tMaybe) / 2 : bMaybe ?? 0;
  const axisCenterECEF = wgs84ToCartesian3(lon, lat, axisRepAlt);
  ds.entities.add({
    name: 'orbit-picker-handle-axis',
    position: axisCenterECEF,
    point: {
      pixelSize: 12,
      color: COLOR_CURSOR,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2.5,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    label: {
      text: '⌖ 轴 (拖)',
      font: 'bold 10px sans-serif',
      fillColor: COLOR_CURSOR,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new Cesium.Cartesian2(14, -2),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });

  if (bMaybe != null) {
    ds.entities.add({
      name: 'orbit-picker-handle-bottom',
      position: wgs84ToCartesian3(lon, lat, bMaybe),
      point: {
        pixelSize: 13,
        color: COLOR_CURSOR,
        outlineColor: Cesium.Color.fromCssColorString('#0c0d10'),
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: `▽ 底高 ${bMaybe.toFixed(1)}m`,
        font: 'bold 10px sans-serif',
        fillColor: COLOR_CURSOR,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(14, 2),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  }

  if (tMaybe != null) {
    ds.entities.add({
      name: 'orbit-picker-handle-top',
      position: wgs84ToCartesian3(lon, lat, tMaybe),
      point: {
        pixelSize: 13,
        color: COLOR_CURSOR,
        outlineColor: Cesium.Color.fromCssColorString('#0c0d10'),
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: `△ 顶高 ${tMaybe.toFixed(1)}m`,
        font: 'bold 10px sans-serif',
        fillColor: COLOR_CURSOR,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(14, -2),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  }

  if (p.radius != null && bMaybe != null) {
    const enu = Cesium.Transforms.eastNorthUpToFixedFrame(
      wgs84ToCartesian3(lon, lat, bMaybe),
    );
    const local = new Cesium.Cartesian3(0, p.radius, 0); // 北侧
    const edgeECEF = Cesium.Matrix4.multiplyByPoint(enu, local, new Cesium.Cartesian3());
    ds.entities.add({
      name: 'orbit-picker-handle-radius',
      position: edgeECEF,
      point: {
        pixelSize: 11,
        color: COLOR_CURSOR,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: `R=${p.radius.toFixed(1)}m (拖)`,
        font: 'bold 10px sans-serif',
        fillColor: COLOR_CURSOR,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -14),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  }
}

const DEFAULT_PARAMS_FOR_LAYER = {
  standoff: 8,
  verticalSpacing: 3,
  pointsPerRing: 16,
  startAngle: 0,
  direction: 'cw' as const,
  bottomAltOffset: 1,
  topAltOffset: -1,
  flipRingDirection: true,
  totalH: 30,
};

function renderOrbit(
  ds: Cesium.CustomDataSource,
  orbit: OrbitDef,
  scanPath: Waypoint[],
  alphaScale: number,
): void {
  const { axisBottom, axisTop, radius, params } = orbit;
  const effR = radius + params.standoff;

  // axis 线
  ds.entities.add({
    polyline: {
      positions: [
        wgs84ToCartesian3(axisBottom.lon, axisBottom.lat, axisBottom.alt),
        wgs84ToCartesian3(axisTop.lon, axisTop.lat, axisTop.alt),
      ],
      width: 2,
      material: COLOR_ORBIT.withAlpha(0.7 * alphaScale),
      arcType: Cesium.ArcType.NONE,
    },
  });

  // 拟合圆（在 axisBottom 高度上，radius = orbit.radius 不含 standoff）+ 圆心
  // 区别于"飞行外环"（半径 radius + standoff），让用户看出物体 vs 飞行轨迹
  const fitRingPositions = sampleCirclePositions(
    axisBottom.lon,
    axisBottom.lat,
    axisBottom.alt,
    radius,
    48,
  );
  ds.entities.add({
    polyline: {
      positions: fitRingPositions,
      width: 1,
      material: COLOR_FIT.withAlpha(0.7 * alphaScale),
      arcType: Cesium.ArcType.NONE,
    },
  });
  ds.entities.add({
    position: wgs84ToCartesian3(axisBottom.lon, axisBottom.lat, axisBottom.alt),
    point: {
      pixelSize: 7,
      color: COLOR_ORBIT.withAlpha(0.95 * alphaScale),
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 1.5,
    },
    label: {
      text: '+ 圆心',
      font: 'bold 10px sans-serif',
      fillColor: COLOR_ORBIT,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new Cesium.Cartesian2(10, 0),
    },
  });

  // 圆柱外环（顶 + 底 + 中间均匀几道）
  const totalH = axisTop.alt - axisBottom.alt;
  const ringPreviewCount = Math.max(2, Math.min(6, Math.floor(totalH / 8) + 2));
  for (let r = 0; r < ringPreviewCount; r++) {
    const t = ringPreviewCount === 1 ? 0 : r / (ringPreviewCount - 1);
    const alt = axisBottom.alt + t * totalH;
    const ringPositions = sampleCirclePositions(
      axisBottom.lon,
      axisBottom.lat,
      alt,
      effR,
      48,
    );
    ds.entities.add({
      polyline: {
        positions: ringPositions,
        width: 1.5,
        material: new Cesium.PolylineDashMaterialProperty({
          color: COLOR_ORBIT.withAlpha((0.35 + 0.6 * t) * alphaScale),
          dashLength: 5,
        }),
        arcType: Cesium.ArcType.NONE,
      },
    });
  }

  // scanPath polyline（连成蛇形）
  if (scanPath.length >= 2) {
    ds.entities.add({
      polyline: {
        positions: scanPath.map((wp) => wgs84ToCartesian3(wp.lon, wp.lat, wp.alt)),
        width: 1.5,
        material: COLOR_ORBIT.withAlpha(0.85 * alphaScale),
        arcType: Cesium.ArcType.NONE,
      },
    });
  }

  // scanPath waypoint 点
  for (const wp of scanPath) {
    ds.entities.add({
      position: wgs84ToCartesian3(wp.lon, wp.lat, wp.alt),
      point: {
        pixelSize: 4,
        color: COLOR_ORBIT.withAlpha(0.95 * alphaScale),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 1,
      },
    });
  }
}

/** 在 (lon, lat, alt) 的水平圆上等间隔取 N 个点，闭合（最后一个 = 第一个） */
function sampleCirclePositions(
  lon: number,
  lat: number,
  alt: number,
  radiusM: number,
  segments: number,
): Cesium.Cartesian3[] {
  const originECEF = wgs84ToCartesian3(lon, lat, alt);
  const enuMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(originECEF);
  const out: Cesium.Cartesian3[] = [];
  for (let i = 0; i <= segments; i++) {
    const θ = (i / segments) * Math.PI * 2;
    const localPt = new Cesium.Cartesian3(
      Math.sin(θ) * radiusM,
      Math.cos(θ) * radiusM,
      0,
    );
    out.push(Cesium.Matrix4.multiplyByPoint(enuMatrix, localPt, new Cesium.Cartesian3()));
  }
  return out;
}

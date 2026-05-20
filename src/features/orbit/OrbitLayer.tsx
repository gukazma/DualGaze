import { useEffect, useRef } from 'react';
import * as Cesium from 'cesium';
import { useCesiumViewer } from '../cesium/CesiumContext';
import { useCurrentMission } from '../../store/missions';
import { useOrbitPickerStore } from '../../store/orbit-picker';
import { useUiStore } from '../../store/ui';
import { wgs84ToCartesian3 } from '../../lib/coord';
import type { OrbitDef, Waypoint } from '../../types/mission';

const COLOR_ORBIT = Cesium.Color.fromCssColorString('#a64aff');
const COLOR_AXIS_PICK = Cesium.Color.fromCssColorString('#a64aff');
const COLOR_CURSOR = Cesium.Color.fromCssColorString('#ffd24a');

/**
 * Orbit mission 渲染：
 *
 *  - 已保存的 mission.orbit：紫色 axis 线 + 圆柱外环（每圈 polyline）+ scanPath 采样点
 *  - picker preview 时的 OrbitPicker state.preview：同上 + 高亮当前轴 / 半径
 *  - picker drawing 时的中间点：① ② 紫点 + ③ 黄虚线占位
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

    // 2. picker 进行中的状态（drawing/preview/error）
    if (pickerMode === 'orbit-draw') {
      if (pickerState.mode === 'drawing') {
        renderDrawingPoints(ds, pickerState.points);
      } else if (pickerState.mode === 'preview') {
        renderOrbit(ds, pickerState.orbit, pickerState.scanPath, 1.0);
      }
    }
  }, [mission, pickerMode, pickerState]);

  return null;
}

function renderDrawingPoints(
  ds: Cesium.CustomDataSource,
  points: { lon: number; lat: number; alt: number }[],
): void {
  const labels = ['① 底心', '② 顶心', '③ 侧点'];
  points.forEach((p, i) => {
    ds.entities.add({
      position: wgs84ToCartesian3(p.lon, p.lat, p.alt),
      point: {
        pixelSize: 11,
        color: COLOR_AXIS_PICK,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 1.5,
      },
      label: {
        text: labels[i],
        font: 'bold 11px sans-serif',
        fillColor: COLOR_AXIS_PICK,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -16),
      },
    });
  });
  // 已有 ≥2 点：画 axis 线（底↔顶）
  if (points.length >= 2) {
    ds.entities.add({
      polyline: {
        positions: [
          wgs84ToCartesian3(points[0].lon, points[0].lat, points[0].alt),
          wgs84ToCartesian3(points[1].lon, points[1].lat, points[1].alt),
        ],
        width: 3,
        material: COLOR_AXIS_PICK,
        arcType: Cesium.ArcType.NONE,
      },
    });
  }
  // 已有 3 点：画半径辅助线（顶/底中点 → ③）
  if (points.length === 3) {
    ds.entities.add({
      polyline: {
        positions: [
          wgs84ToCartesian3(points[0].lon, points[0].lat, points[0].alt),
          wgs84ToCartesian3(points[2].lon, points[2].lat, points[0].alt),
        ],
        width: 2,
        material: new Cesium.PolylineDashMaterialProperty({
          color: COLOR_CURSOR,
          dashLength: 6,
        }),
        arcType: Cesium.ArcType.NONE,
      },
    });
  }
}

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

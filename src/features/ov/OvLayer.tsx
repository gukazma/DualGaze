import { useEffect, useState } from 'react';
import * as Cesium from 'cesium';
import { useCesiumViewer } from '../cesium/CesiumContext';
import { useCurrentMission } from '../../store/missions';
import { useOvPickerStore } from '../../store/ov-picker';
import { wgs84ToCartesian3 } from '../../lib/coord';
import type { OvAoi, OvSamplePoint, OvSortie, OvViewCandidate } from '../../types/mission';

/** 候选视角箭头渲染上限，防止上万个 polyline 卡顿 */
const MAX_VIEW_ARROWS = 1500;

/**
 * OV 主视图渲染层 —— AOI 多边形 + 采样点。
 *
 * M31 渲染范围：
 *  - 已 commit 的 AOI 多边形（黄色虚线）
 *  - picker 实时绘制中的 AOI（drawing/preview state）+ 顶点小点
 *  - 采样点散布（按 visibility coverCount 染色；M33 之前全部白色）
 *
 * M33+ 扩展：candidate/selected views 箭头、安全罩、障碍盒、禁飞区。
 *
 * 全部 entity name 前缀 `ov-layer-` / `ov-aoi-picker-` 以让 raycast skip 跳过自身。
 */
export function OvLayer() {
  const viewer = useCesiumViewer();
  const mission = useCurrentMission();
  const aoiPickerState = useOvPickerStore((s) => s.aoiState);
  // 用 state 而非 ref —— ds 准备好后 setDs 会触发 render effect 重跑
  // （viewer 异步初始化时 ref 不会触发依赖更新，会导致初载入 AOI 不画）
  const [ds, setDs] = useState<Cesium.CustomDataSource | null>(null);

  // dataSource lifecycle
  useEffect(() => {
    if (!viewer) return;
    const d = new Cesium.CustomDataSource('ov-layer');
    viewer.dataSources.add(d);
    setDs(d);
    return () => {
      if (!viewer.isDestroyed()) viewer.dataSources.remove(d, true);
      setDs(null);
    };
  }, [viewer]);

  // 重画：mission.ov.aoi / samples / picker 中的 vertices 变化时
  useEffect(() => {
    if (!ds) return;
    ds.entities.removeAll();
    if (!mission || mission.type !== 'ov' || !mission.ov) return;

    // 1. 已 commit AOI（黄色虚线 + 顶点小点）
    if (mission.ov.aoi && mission.ov.aoi.vertices.length >= 3) {
      renderAoi(ds, mission.ov.aoi, 'ov-layer-aoi', '#ffd24a', false);
    }

    // 2. picker 实时绘制中的 vertices
    if (
      aoiPickerState.mode === 'drawing' ||
      aoiPickerState.mode === 'preview'
    ) {
      const vs = aoiPickerState.vertices;
      if (vs.length > 0) {
        // 顶点小点
        vs.forEach((v, i) => {
          ds.entities.add({
            name: `ov-aoi-picker-vertex-${i}`,
            position: wgs84ToCartesian3(v.lon, v.lat, 0),
            point: {
              pixelSize: 9,
              color: Cesium.Color.fromCssColorString('#ffd24a'),
              outlineColor: Cesium.Color.fromCssColorString('#0c0d10'),
              outlineWidth: 1,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            },
            label: {
              text: String(i + 1),
              font: '10px Inter',
              fillColor: Cesium.Color.fromCssColorString('#0c0d10'),
              showBackground: false,
              pixelOffset: new Cesium.Cartesian2(0, -14),
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          });
        });
        // 实时多边形预览
        if (vs.length >= 2) {
          const ringPositions = vs.map((v) => wgs84ToCartesian3(v.lon, v.lat, 0));
          if (vs.length >= 3) ringPositions.push(ringPositions[0]); // 闭合
          ds.entities.add({
            name: 'ov-aoi-picker-line',
            polyline: {
              positions: ringPositions,
              width: 2,
              material: new Cesium.PolylineDashMaterialProperty({
                color: Cesium.Color.fromCssColorString(
                  aoiPickerState.mode === 'preview' ? '#ffd24a' : '#ffaa4a',
                ),
                dashLength: 12,
              }),
              clampToGround: true,
            },
          });
        }
      }
    }

    // 3. 采样点散布
    if (mission.ov.samples && mission.ov.samples.length > 0) {
      renderSamples(ds, mission.ov.samples);
    }

    // 4. 路径优先：有 paths 画多架次航线折线；否则画候选/已选视角箭头
    if (mission.ov.paths && mission.ov.paths.length > 0) {
      renderPaths(ds, mission.ov.paths);
    } else {
      const views = mission.ov.selectedViews?.length
        ? mission.ov.selectedViews
        : mission.ov.candidateViews;
      if (views && views.length > 0 && mission.ov.samples) {
        renderViews(ds, views, mission.ov.samples);
      }
    }
  }, [ds, mission, aoiPickerState]);

  return null;
}

function renderAoi(
  ds: Cesium.CustomDataSource,
  aoi: OvAoi,
  namePrefix: string,
  colorHex: string,
  filled: boolean,
): void {
  const positions = aoi.vertices.map((v) => wgs84ToCartesian3(v.lon, v.lat, 0));
  const closed = [...positions, positions[0]];
  ds.entities.add({
    name: `${namePrefix}-line`,
    polyline: {
      positions: closed,
      width: 2,
      material: new Cesium.PolylineDashMaterialProperty({
        color: Cesium.Color.fromCssColorString(colorHex),
        dashLength: 14,
      }),
      clampToGround: true,
    },
  });
  if (filled) {
    ds.entities.add({
      name: `${namePrefix}-fill`,
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(positions),
        material: Cesium.Color.fromCssColorString(colorHex).withAlpha(0.1),
        outline: false,
      },
    });
  }
  // 顶点小点
  aoi.vertices.forEach((_v, i) => {
    ds.entities.add({
      name: `${namePrefix}-vertex-${i}`,
      position: positions[i],
      point: {
        pixelSize: 6,
        color: Cesium.Color.fromCssColorString(colorHex),
        outlineColor: Cesium.Color.fromCssColorString('#0c0d10'),
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
    });
  });
}

function renderSamples(
  ds: Cesium.CustomDataSource,
  samples: OvSamplePoint[],
): void {
  for (const s of samples) {
    const color = visibilityColor(s.coverCount);
    ds.entities.add({
      name: `ov-layer-sample-${s.id}`,
      position: wgs84ToCartesian3(s.lon, s.lat, s.alt),
      point: {
        pixelSize: 6,
        color: Cesium.Color.fromCssColorString(color),
        outlineColor: Cesium.Color.fromCssColorString('#0c0d10'),
        outlineWidth: 0.5,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  }
}

/**
 * 候选/已选视角箭头：相机位 → 采样点的短线 + 相机端小点。
 * 超过 MAX_VIEW_ARROWS 时按步长抽稀，避免上万 polyline 卡顿。
 */
function renderViews(
  ds: Cesium.CustomDataSource,
  views: OvViewCandidate[],
  samples: OvSamplePoint[],
): void {
  const sampleMap = new Map<string, OvSamplePoint>();
  for (const s of samples) sampleMap.set(s.id, s);

  const stride = views.length > MAX_VIEW_ARROWS ? Math.ceil(views.length / MAX_VIEW_ARROWS) : 1;
  for (let i = 0; i < views.length; i += stride) {
    const v = views[i];
    const target = sampleMap.get(v.targetSampleId);
    if (!target) continue;
    const camPos = wgs84ToCartesian3(v.camLon, v.camLat, v.camAlt);
    const tgtPos = wgs84ToCartesian3(target.lon, target.lat, target.alt);
    ds.entities.add({
      name: `ov-layer-view-${v.id}`,
      polyline: {
        positions: [camPos, tgtPos],
        width: 1,
        material: Cesium.Color.fromCssColorString('#38bdf8').withAlpha(0.5),
        arcType: Cesium.ArcType.NONE,
      },
    });
    ds.entities.add({
      name: `ov-layer-viewcam-${v.id}`,
      position: camPos,
      point: {
        pixelSize: 3,
        color: Cesium.Color.fromCssColorString('#38bdf8'),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  }
}

/**
 * 多架次航线折线：每架次按其颜色画连线 + 起点大点 + 中间航点小点。
 */
function renderPaths(ds: Cesium.CustomDataSource, paths: OvSortie[]): void {
  paths.forEach((sortie, si) => {
    if (sortie.waypoints.length === 0) return;
    const color = Cesium.Color.fromCssColorString(sortie.color);
    const positions = sortie.waypoints.map((w) => wgs84ToCartesian3(w.lon, w.lat, w.alt));
    if (positions.length >= 2) {
      ds.entities.add({
        name: `ov-layer-path-${si}`,
        polyline: {
          positions,
          width: 2,
          material: color,
          arcType: Cesium.ArcType.NONE,
        },
      });
    }
    // 起点大点
    ds.entities.add({
      name: `ov-layer-path-${si}-start`,
      position: positions[0],
      point: {
        pixelSize: 9,
        color,
        outlineColor: Cesium.Color.fromCssColorString('#0c0d10'),
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: `架次 ${si + 1}`,
        font: '10px Inter',
        fillColor: color,
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString('#0c0d10').withAlpha(0.7),
        pixelOffset: new Cesium.Cartesian2(0, -16),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    // 中间航点小点
    for (let i = 1; i < positions.length; i++) {
      ds.entities.add({
        name: `ov-layer-path-${si}-wp-${i}`,
        position: positions[i],
        point: {
          pixelSize: 4,
          color,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    }
  });
}

/**
 * 蝶舞 6 色 visibility ramp（黑 → 红 → 黄 → 绿 → 青 → 蓝）。
 * coverCount 未计算（undefined）走中性 yellow。
 */
function visibilityColor(coverCount: number | undefined): string {
  if (coverCount === undefined) return '#ffd24a';
  if (coverCount === 0) return '#0c0d10';
  if (coverCount <= 7) return '#ef4444';
  if (coverCount <= 14) return '#ffd24a';
  if (coverCount <= 24) return '#4ade80';
  if (coverCount <= 34) return '#38bdf8';
  return '#6366f1';
}

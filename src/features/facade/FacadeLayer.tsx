import { useEffect, useRef } from 'react';
import * as Cesium from 'cesium';
import { useCesiumViewer } from '../cesium/CesiumContext';
import { useCurrentMission, useMissionsStore } from '../../store/missions';
import { useFacadePickerStore } from '../../store/facade-picker';
import { wgs84ToCartesian3 } from '../../lib/coord';
import { faceColorTriple } from '../../lib/face-color';
import type {
  FacadeCorner,
  FacadeFace,
  FacadePlane,
  Waypoint,
} from '../../types/mission';

const COLOR_NORMAL_ARROW = Cesium.Color.fromCssColorString('#7cc78a');
const COLOR_PREVIEW_FILL = Cesium.Color.fromCssColorString('#ffd24a').withAlpha(0.18);
const COLOR_PREVIEW_OUTLINE = Cesium.Color.fromCssColorString('#ffd24a');
const COLOR_UNSAFE = Cesium.Color.fromCssColorString('#e57373');
const COLOR_PREVIEW_SCANPATH = Cesium.Color.fromCssColorString('#00d2c0');

function cornerToCart(c: FacadeCorner): Cesium.Cartesian3 {
  return wgs84ToCartesian3(c.lon, c.lat, c.alt);
}

function waypointToCart(w: Waypoint): Cesium.Cartesian3 {
  return wgs84ToCartesian3(w.lon, w.lat, w.alt);
}

/** 法向箭头终点（从 plane.origin 沿 normal 拉 5m） */
function normalArrowEnd(plane: FacadePlane, lengthM = 5): Cesium.Cartesian3 {
  return new Cesium.Cartesian3(
    plane.origin.x + plane.normal.x * lengthM,
    plane.origin.y + plane.normal.y * lengthM,
    plane.origin.z + plane.normal.z * lengthM,
  );
}

/**
 * Facade mission 图层：
 *
 *   - 已保存的 face：4 角点 + 矩形边框 + 法向箭头 + scanPath polyline + 采样点 + label
 *   - 正在画的 picker：preview corners（少于 4 个 → 仅画点；4 个齐 → 矩形 + 法向 + scanPath）
 *
 * 所有 Entity 用 CallbackProperty 读最新数据，确保 store / picker 更新自动反映。
 */
export function FacadeLayer() {
  const viewer = useCesiumViewer();
  const mission = useCurrentMission();
  const missionId = mission?.id;
  const missionType = mission?.type;

  const dsRef = useRef<Cesium.CustomDataSource | null>(null);
  // 每个 face 一个 sub-set of entities：用 face.id → entity[] map 管理
  const faceEntitiesRef = useRef<Map<string, Cesium.Entity[]>>(new Map());
  // 采样点缓存：face.id → entity[]
  const sampleEntitiesRef = useRef<Map<string, Cesium.Entity[]>>(new Map());
  // picker preview 实体（drawing/preview/error 状态用）
  const previewEntitiesRef = useRef<Cesium.Entity[]>([]);

  // ----- dataSource lifecycle -----
  useEffect(() => {
    if (!viewer) return;
    if (missionType !== 'facade') {
      // 不是 facade mission，把 ds 清掉
      if (dsRef.current) {
        viewer.dataSources.remove(dsRef.current, true);
        dsRef.current = null;
        faceEntitiesRef.current.clear();
        sampleEntitiesRef.current.clear();
        previewEntitiesRef.current = [];
      }
      return;
    }
    const ds = new Cesium.CustomDataSource(`facade-${missionId}`);
    void viewer.dataSources.add(ds);
    dsRef.current = ds;

    return () => {
      viewer.dataSources.remove(ds, true);
      dsRef.current = null;
      faceEntitiesRef.current.clear();
      sampleEntitiesRef.current.clear();
      previewEntitiesRef.current = [];
    };
  }, [viewer, missionId, missionType]);

  // ----- 同步已保存的 faces -----
  useEffect(() => {
    const ds = dsRef.current;
    if (!ds) return;
    const faces = (mission?.type === 'facade' ? mission.facadeFaces : []) ?? [];

    // 1. 清理已删除的 face
    const aliveIds = new Set(faces.map((f) => f.id));
    for (const [fid, entities] of faceEntitiesRef.current) {
      if (!aliveIds.has(fid)) {
        for (const e of entities) ds.entities.remove(e);
        faceEntitiesRef.current.delete(fid);
      }
    }
    for (const [fid, entities] of sampleEntitiesRef.current) {
      if (!aliveIds.has(fid)) {
        for (const e of entities) ds.entities.remove(e);
        sampleEntitiesRef.current.delete(fid);
      }
    }

    // 2. 为新 face 建实体
    const missionIdLocal = mission?.id;
    const readFace = (id: string): FacadeFace | undefined => {
      const m = useMissionsStore.getState().missions.find((x) => x.id === missionIdLocal);
      if (!m || m.type !== 'facade') return undefined;
      return (m.facadeFaces ?? []).find((f) => f.id === id);
    };

    faces.forEach((face, idx) => {
      const hue = faceColorTriple(idx);
      const existing = faceEntitiesRef.current.get(face.id);
      if (existing) {
        // 已有 entity，仅在 enabled 变化时调透明度（其它字段 CallbackProperty 自动跟）
        const alphaScale = face.enabled ? 1.0 : 0.35;
        for (const e of existing) {
          if (e.point) {
            e.point.color = new Cesium.ConstantProperty(hue.vertex.withAlpha(alphaScale));
          }
        }
        return;
      }
      const list: Cesium.Entity[] = [];

      // 4 角小球 + label "1/2/3/4"
      for (let i = 0; i < 4; i++) {
        const e = ds.entities.add({
          position: new Cesium.CallbackPositionProperty(() => {
            const f = readFace(face.id);
            if (!f || !f.corners[i]) return Cesium.Cartesian3.ZERO;
            return cornerToCart(f.corners[i]);
          }, false),
          point: {
            pixelSize: 9,
            color: hue.vertex,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 1,
            // 参与深度测试：被前景几何挡住时隐藏，避免穿墙干扰
          },
          label: {
            text: String(i + 1),
            font: '10px sans-serif',
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -14),
            // 参与深度测试：被前景几何挡住时隐藏，避免穿墙干扰
          },
        });
        list.push(e);
      }

      // 矩形闭合边框
      list.push(
        ds.entities.add({
          polyline: {
            positions: new Cesium.CallbackProperty(() => {
              const f = readFace(face.id);
              if (!f || f.corners.length < 2) return [];
              const cs = f.corners.map(cornerToCart);
              if (f.corners.length >= 3) cs.push(cs[0]);
              return cs;
            }, false),
            width: 2,
            material: hue.outline,
            arcType: Cesium.ArcType.NONE,
          },
        }),
      );

      // 法向箭头：from plane.origin → +N×5m
      list.push(
        ds.entities.add({
          polyline: {
            positions: new Cesium.CallbackProperty(() => {
              const f = readFace(face.id);
              if (!f?.plane) return [];
              const origin = new Cesium.Cartesian3(f.plane.origin.x, f.plane.origin.y, f.plane.origin.z);
              return [origin, normalArrowEnd(f.plane, 5)];
            }, false),
            width: 4,
            material: new Cesium.PolylineArrowMaterialProperty(COLOR_NORMAL_ARROW),
            arcType: Cesium.ArcType.NONE,
          },
        }),
      );

      // face 名字 label（贴在 plane.origin）
      list.push(
        ds.entities.add({
          position: new Cesium.CallbackPositionProperty(() => {
            const f = readFace(face.id);
            if (!f?.plane) return Cesium.Cartesian3.ZERO;
            return new Cesium.Cartesian3(f.plane.origin.x, f.plane.origin.y, f.plane.origin.z);
          }, false),
          label: {
            text: new Cesium.CallbackProperty(() => {
              const f = readFace(face.id);
              return f?.name ?? '';
            }, false) as unknown as Cesium.Property,
            font: 'bold 12px sans-serif',
            fillColor: hue.vertex,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -24),
            showBackground: true,
            backgroundColor: Cesium.Color.fromCssColorString('#131720').withAlpha(0.7),
            // 参与深度测试：被前景几何挡住时隐藏，避免穿墙干扰
          },
        }),
      );

      // scanPath polyline —— 用 face 的 outline 色（不再是全局青）
      list.push(
        ds.entities.add({
          polyline: {
            positions: new Cesium.CallbackProperty(() => {
              const f = readFace(face.id);
              if (!f?.enabled || !f.scanPath || f.scanPath.length < 2) return [];
              return f.scanPath.map(waypointToCart);
            }, false),
            width: 2,
            material: new Cesium.PolylineDashMaterialProperty({
              color: hue.outline,
              dashLength: 10,
            }),
            arcType: Cesium.ArcType.NONE,
          },
        }),
      );

      faceEntitiesRef.current.set(face.id, list);
    });

    // 3. 同步采样点（scanPath waypoints）—— face 内 enabled 才显示
    faces.forEach((face, idx) => {
      const hue = faceColorTriple(idx);
      const samples = sampleEntitiesRef.current.get(face.id) ?? [];
      const path = face.enabled ? face.scanPath ?? [] : [];
      while (samples.length < path.length) {
        const wpIdx = samples.length;
        const e = ds.entities.add({
          position: new Cesium.CallbackPositionProperty(() => {
            const f = readFace(face.id);
            const p = f?.scanPath?.[wpIdx];
            if (!p) return Cesium.Cartesian3.ZERO;
            return waypointToCart(p);
          }, false),
          point: {
            pixelSize: new Cesium.CallbackProperty(() => {
              const f = readFace(face.id);
              return f?.scanPath?.[wpIdx]?.unsafe ? 7 : 4;
            }, false) as unknown as Cesium.Property,
            color: new Cesium.CallbackProperty(() => {
              const f = readFace(face.id);
              return f?.scanPath?.[wpIdx]?.unsafe ? COLOR_UNSAFE : hue.vertex;
            }, false) as unknown as Cesium.Property,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 1,
            // 不禁用深度测试 —— 航点被其它墙挡住时应该看不到，否则画下一面时被
            // 上一面的点穿透干扰视线
          },
        });
        samples.push(e);
      }
      while (samples.length > path.length) {
        const e = samples.pop();
        if (e) ds.entities.remove(e);
      }
      sampleEntitiesRef.current.set(face.id, samples);
    });
  }, [mission, mission?.facadeFaces, mission?.id]);

  // ----- picker preview -----
  const pickerState = useFacadePickerStore((s) => s.state);
  useEffect(() => {
    const ds = dsRef.current;
    if (!ds) return;
    // 清掉旧 preview
    for (const e of previewEntitiesRef.current) ds.entities.remove(e);
    previewEntitiesRef.current = [];

    if (missionType !== 'facade') return;

    // drawing/preview/error 都画已点的角点。在 preview 模式下，最后 cornerInferredCount
    // 个角点是 picker 自动推断的，用虚线轮廓 + "★" 标签区分
    const corners = pickerState.corners;
    const inferredCount =
      pickerState.mode === 'preview' ? pickerState.cornerInferredCount : 0;
    corners.forEach((c, i) => {
      const isInferred = i >= corners.length - inferredCount;
      previewEntitiesRef.current.push(
        ds.entities.add({
          position: cornerToCart(c),
          point: {
            pixelSize: isInferred ? 9 : 11,
            color: isInferred
              ? COLOR_PREVIEW_OUTLINE.withAlpha(0.15)
              : COLOR_PREVIEW_OUTLINE,
            outlineColor: COLOR_PREVIEW_OUTLINE,
            outlineWidth: isInferred ? 2 : 1,
            // 参与深度测试：被前景几何挡住时隐藏，避免穿墙干扰
          },
          label: {
            text: isInferred ? `${i + 1}★` : String(i + 1),
            font: 'bold 11px sans-serif',
            fillColor: Cesium.Color.BLACK,
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -16),
            // 参与深度测试：被前景几何挡住时隐藏，避免穿墙干扰
          },
        }),
      );
    });

    // 连线（>= 2 角时把已点的角连起来）
    if (corners.length >= 2) {
      previewEntitiesRef.current.push(
        ds.entities.add({
          polyline: {
            positions: corners.map(cornerToCart),
            width: 2,
            material: COLOR_PREVIEW_OUTLINE.withAlpha(0.8),
            arcType: Cesium.ArcType.NONE,
          },
        }),
      );
    }

    if (pickerState.mode === 'preview') {
      // 闭合矩形 fill + outline
      const cs = pickerState.corners.map(cornerToCart);
      previewEntitiesRef.current.push(
        ds.entities.add({
          polyline: {
            positions: [...cs, cs[0]],
            width: 3,
            material: COLOR_PREVIEW_OUTLINE,
            arcType: Cesium.ArcType.NONE,
          },
        }),
      );
      previewEntitiesRef.current.push(
        ds.entities.add({
          polygon: {
            hierarchy: new Cesium.PolygonHierarchy(cs),
            material: COLOR_PREVIEW_FILL,
            perPositionHeight: true,
            outline: false,
          },
        }),
      );

      // 法向箭头
      const plane = pickerState.plane;
      const originCart = new Cesium.Cartesian3(plane.origin.x, plane.origin.y, plane.origin.z);
      previewEntitiesRef.current.push(
        ds.entities.add({
          polyline: {
            positions: [originCart, normalArrowEnd(plane, 5)],
            width: 5,
            material: new Cesium.PolylineArrowMaterialProperty(COLOR_NORMAL_ARROW),
            arcType: Cesium.ArcType.NONE,
          },
        }),
      );

      // scanPath preview polyline
      if (pickerState.scanPath.length >= 2) {
        previewEntitiesRef.current.push(
          ds.entities.add({
            polyline: {
              positions: pickerState.scanPath.map(waypointToCart),
              width: 2,
              material: new Cesium.PolylineDashMaterialProperty({
                color: COLOR_PREVIEW_SCANPATH,
                dashLength: 10,
              }),
              arcType: Cesium.ArcType.NONE,
            },
          }),
        );
        // 采样点小球；unsafe 的点用红色更大的点（区分一目了然）
        for (const wp of pickerState.scanPath) {
          const unsafe = !!wp.unsafe;
          previewEntitiesRef.current.push(
            ds.entities.add({
              position: waypointToCart(wp),
              point: {
                pixelSize: unsafe ? 7 : 3,
                color: unsafe ? COLOR_UNSAFE : COLOR_PREVIEW_SCANPATH,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 1,
                // 不禁用深度，同 saved face 航点：被墙挡住就该看不到
              },
            }),
          );
        }
      }
    }
  }, [pickerState, missionType]);

  return null;
}

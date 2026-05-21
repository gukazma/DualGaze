import { useEffect, useRef } from 'react';
import * as Cesium from 'cesium';
import { useCesiumViewer } from '../cesium/CesiumContext';
import { useCurrentMission } from '../../store/missions';
import { wgs84ToCartesian3 } from '../../lib/coord';

/**
 * 起飞点场景渲染（v3.2）。
 *
 * 只在 facade / orbit mission 且 mission.takeOffPoint 存在时渲染：
 *  - 黄色 house icon billboard（地面位置）
 *  - 「🏠 起飞 · lon, lat · 高度 Xm」label（icon 下方）
 *  - 一根细线 alt → alt+5 表示安全高度（可选辅助）
 *
 * 不参与点击（pure visual）。
 */
export function TakeoffLayer() {
  const viewer = useCesiumViewer();
  const mission = useCurrentMission();
  const missionId = mission?.id;
  const dsRef = useRef<Cesium.CustomDataSource | null>(null);

  const isApplicable =
    mission?.type === 'facade' || mission?.type === 'orbit';
  const takeOff = isApplicable ? mission?.takeOffPoint : undefined;

  // dataSource lifecycle
  useEffect(() => {
    if (!viewer) return;
    const ds = new Cesium.CustomDataSource(`takeoff-${missionId ?? 'none'}`);
    void viewer.dataSources.add(ds);
    dsRef.current = ds;
    return () => {
      viewer.dataSources.remove(ds, true);
      dsRef.current = null;
    };
  }, [viewer, missionId]);

  // 实体渲染
  useEffect(() => {
    const ds = dsRef.current;
    if (!ds) return;
    ds.entities.removeAll();
    if (!takeOff) return;

    const pos = wgs84ToCartesian3(takeOff.lon, takeOff.lat, takeOff.alt);
    const labelText = `🏠 起飞 · ${takeOff.lon.toFixed(5)}, ${takeOff.lat.toFixed(5)} · ${takeOff.alt.toFixed(1)} m`;

    ds.entities.add({
      position: pos,
      billboard: {
        image: HOME_ICON_DATA_URL,
        scale: 1,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        heightReference: Cesium.HeightReference.NONE,
      },
      label: {
        text: labelText,
        font: 'bold 11px sans-serif',
        fillColor: Cesium.Color.fromCssColorString('#ffd24a'),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, 14),
        verticalOrigin: Cesium.VerticalOrigin.TOP,
        backgroundColor: Cesium.Color.fromCssColorString('#0c0d10cc'),
        showBackground: true,
        backgroundPadding: new Cesium.Cartesian2(6, 4),
      },
    });
  }, [takeOff?.lon, takeOff?.lat, takeOff?.alt]);

  return null;
}

/**
 * Lucide `house` 图标 SVG → data URL；黄色 #ffd24a，黑底圆角矩形衬底便于在任何背景上识别。
 * 28×28 居中显示。
 */
const HOME_ICON_DATA_URL =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">` +
      `<rect x="2" y="2" width="28" height="28" rx="6" fill="#0c0d10" stroke="#ffd24a" stroke-width="2"/>` +
      `<path d="M9 16 L16 9 L23 16 L23 22 A1 1 0 0 1 22 23 L18 23 L18 19 L14 19 L14 23 L10 23 A1 1 0 0 1 9 22 Z" ` +
      `fill="none" stroke="#ffd24a" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` +
      `</svg>`,
  );

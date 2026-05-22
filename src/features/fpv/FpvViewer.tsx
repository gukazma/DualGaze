import { useEffect, useRef } from 'react';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { useSimulationStore } from '../../store/simulation';
import { useCurrentMission } from '../../store/missions';
import { arcgisWorldImageryOptions } from '../../lib/amap';
import { wgs84ToCartesian3 } from '../../lib/coord';
import { effectiveWaypoints } from '../simulation/SimulationLoop';
import { loadTileset, unloadTileset } from '../../lib/tileset-source';

/**
 * 独立 Cesium scene 渲染无人机第一人称视角。
 *
 * - ArcGIS 卫星底图 + globe + skyBox + skyAtmosphere（drone 视角看真实地表）
 * - 订阅 simulation store 每帧 setView 到 drone 位置/朝向
 * - 取当前 waypoint 的 gimbal pitch 作为相机俯仰
 * - 锁相机：不接受用户拖拽/缩放，纯播放
 */
export function FpvViewer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const mission = useCurrentMission();
  const missionRef = useRef(mission);
  missionRef.current = mission;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const imagery = new Cesium.UrlTemplateImageryProvider(arcgisWorldImageryOptions());

    const viewer = new Cesium.Viewer(container, {
      timeline: false,
      animation: false,
      homeButton: false,
      geocoder: false,
      sceneModePicker: false,
      baseLayerPicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      requestRenderMode: false,
      baseLayer: new Cesium.ImageryLayer(imagery),
    });
    viewer.scene.globe.show = true;
    viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#0c0d10');
    if (viewer.scene.skyBox) viewer.scene.skyBox.show = true;
    if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = true;
    viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#0c0d10');
    // FPV 窗虽然小但用户最关心清晰度（近距离俯瞰），SSE 设更激进
    viewer.scene.globe.maximumScreenSpaceError = 1.0;
    viewer.scene.globe.preloadAncestors = true;
    // 完全锁定相机：FPV 只接受 store 驱动
    const ctrl = viewer.scene.screenSpaceCameraController;
    ctrl.enableRotate = false;
    ctrl.enableTranslate = false;
    ctrl.enableZoom = false;
    ctrl.enableTilt = false;
    ctrl.enableLook = false;
    // 隐藏 credit container
    const creditEl = viewer.cesiumWidget.creditContainer as HTMLElement;
    if (creditEl) creditEl.style.display = 'none';

    // FPV 视场角 75°（比默认 60° 稍宽，更像无人机相机）
    if (viewer.scene.camera.frustum instanceof Cesium.PerspectiveFrustum) {
      viewer.scene.camera.frustum.fov = Cesium.Math.toRadians(75);
    }

    viewerRef.current = viewer;
    if (import.meta.env.DEV) {
      (window as unknown as { __fpvViewer?: Cesium.Viewer }).__fpvViewer = viewer;
    }

    return () => {
      viewer.destroy();
      viewerRef.current = null;
    };
  }, []);

  // 加载 facade tileset 到 FPV scene（独立于主 viewer）—— 否则 FPV 看不到 3DTiles 模型
  // facade + orbit 都要 tileset 才能在 FPV 看到塔 / 楼
  const tilesetSource =
    mission?.type === 'facade' || mission?.type === 'orbit'
      ? mission.tilesetSource
      : undefined;
  const sourceKey = tilesetSource
    ? `${tilesetSource.kind}::${tilesetSource.url ?? ''}::${tilesetSource.sessionId ?? ''}`
    : '';
  useEffect(() => {
    const v = viewerRef.current;
    if (!v || !tilesetSource) return;
    let cancelled = false;
    let tileset: Cesium.Cesium3DTileset | null = null;
    loadTileset(v, tilesetSource)
      .then((ts) => {
        // 加载完成时 viewer 可能已被销毁（用户进/退 sim 太快 / 多次切 face）
        if (cancelled || v.isDestroyed()) {
          unloadTileset(v, ts);
          return;
        }
        tileset = ts;
      })
      .catch(() => {
        // FPV 加载失败静默 —— 主 viewer 会弹 toast，不重复
      });
    return () => {
      cancelled = true;
      if (tileset) unloadTileset(v, tileset);
    };
  }, [sourceKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // 订阅 drone 位置 → setView
  useEffect(() => {
    const apply = (): void => {
      const v = viewerRef.current;
      if (!v || v.isDestroyed()) return;
      const state = useSimulationStore.getState();
      const d = state.droneState;
      if (!d) return;
      // 取当前段 wp[i] → wp[i+1] 两端 gimbal/pitch，按段内进度 lerp，避免 wp 切换瞬时跳变
      // - patrol/mapping：wp.heading 通常 = 飞行方向
      // - facade：wp.heading 是相机看墙方向（gimbalYaw 同步）
      // - orbit：wp.gimbalYaw 指向 axis 中心（每个 wp 不同，必须 lerp 才不闪）
      const m = missionRef.current;
      const segIdx = state.currentSegmentIndex;
      const wps = m ? effectiveWaypoints(m) : [];
      const fromWp = wps[segIdx];
      const toWp = wps[segIdx + 1] ?? wps[segIdx];
      const t = d.segProgress ?? 1;
      const fromHd = fromWp?.gimbalYaw ?? fromWp?.heading ?? d.heading;
      const toHd = toWp?.gimbalYaw ?? toWp?.heading ?? d.heading;
      const fromPt = fromWp?.pitch ?? -10;
      const toPt = toWp?.pitch ?? -10;
      const headingDeg = lerpAngleDeg(fromHd, toHd, t);
      const pitchDeg = fromPt + (toPt - fromPt) * t;
      v.camera.setView({
        destination: wgs84ToCartesian3(d.lon, d.lat, d.alt),
        orientation: {
          heading: Cesium.Math.toRadians(headingDeg),
          pitch: Cesium.Math.toRadians(pitchDeg),
          roll: 0,
        },
      });
    };
    apply();
    const unsub = useSimulationStore.subscribe(apply);
    return unsub;
  }, []);

  return <div ref={containerRef} className="absolute inset-0" />;
}

/** 角度 lerp（° 单位）：跨 360° 边界走最短弧 */
function lerpAngleDeg(a: number, b: number, t: number): number {
  let diff = ((b - a + 540) % 360) - 180;
  return (a + diff * t + 360) % 360;
}

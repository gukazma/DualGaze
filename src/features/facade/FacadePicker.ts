import * as Cesium from 'cesium';
import { pickWgs84At } from '../../lib/cesium-pick';
import { fitPlaneFromCorners, flipFacadePlane } from '../../lib/facade-plane';
import { generateFacadeScanPath } from '../../lib/facade-scan';
import { annotateUnsafe, ensureNormalOutward } from '../../lib/facade-safety';
import { cartesian3ToWgs84, wgs84ToCartesian3 } from '../../lib/coord';
import { useMissionsStore } from '../../store/missions';
import { FACADE_DEFAULTS } from '../../types/mission';
import type { FacadeCorner, FacadePlane, Waypoint } from '../../types/mission';

/**
 * Facade 4 角拾取器，vanilla TS class（参考 PolygonPicker）。
 *
 * 交互流程：
 *   drawing-1..4: 用户依次点 4 个角点（左键命中 tileset 即落点）
 *                 第 4 点落下后会**强制投影到前 3 点决定的平面**上，保证拟合出
 *                 的矩形 4 角严格共面（不靠拾取精度运气）。
 *   preview : 显示 plane / scanPath；按
 *             F → 翻转法向（plane + scanPath 重算）
 *             Enter → 保存（store.addFacadeFace + setFaceScanResult）→ 重置 drawing-1
 *             Esc → 抛弃，回 drawing-1
 *   退出 picker（外部 setPickerMode('idle')）由 useFacadePicker 上层 effect 处理。
 *
 * 状态对外通过 onStateChange 暴露，给 FacadeLayer / 顶部浮条 overlay 订阅渲染 preview。
 */

export type FacadePickerState =
  | { mode: 'drawing'; corners: FacadeCorner[] }
  | {
      mode: 'preview';
      corners: FacadeCorner[];
      /**
       * 第 4 点是否被"投影到平面"过（用户原始点与最终点的偏移 ≥ 0.05m 即标记 true）。
       * UI 上对此角点画一个虚线轮廓提示，告知"已自动校正到共面"。
       */
      cornerInferredCount: number;
      plane: FacadePlane;
      scanPath: Waypoint[];
      /** 该 plane 下不安全的航点数（raycast 验距 < standoff） */
      unsafeCount: number;
    }
  | { mode: 'error'; corners: FacadeCorner[]; message: string };

export class FacadePicker {
  private viewer: Cesium.Viewer;
  private handler: Cesium.ScreenSpaceEventHandler;
  private state: FacadePickerState = { mode: 'drawing', corners: [] };
  private listeners: Array<(s: FacadePickerState) => void> = [];

  private keyDown = (e: KeyboardEvent): void => this.onKey(e);
  private contextMenuBlocker = (e: MouseEvent): void => e.preventDefault();

  constructor(viewer: Cesium.Viewer) {
    this.viewer = viewer;
    this.handler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
    this.handler.setInputAction(
      (e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => this.onLeftClick(e.position),
      Cesium.ScreenSpaceEventType.LEFT_CLICK,
    );
    window.addEventListener('keydown', this.keyDown);
    viewer.canvas.addEventListener('contextmenu', this.contextMenuBlocker);
  }

  destroy(): void {
    window.removeEventListener('keydown', this.keyDown);
    this.viewer.canvas.removeEventListener('contextmenu', this.contextMenuBlocker);
    this.handler.destroy();
    this.listeners = [];
  }

  getState(): FacadePickerState {
    return this.state;
  }

  onStateChange(cb: (s: FacadePickerState) => void): () => void {
    this.listeners.push(cb);
    cb(this.state);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  private setState(next: FacadePickerState): void {
    this.state = next;
    for (const cb of this.listeners) cb(next);
  }

  // ----- 鼠标 -----

  private onLeftClick(screenPos: Cesium.Cartesian2): void {
    if (this.state.mode !== 'drawing') return;
    const wgs = pickWgs84At(this.viewer, screenPos);
    if (!wgs) return;
    const corner: FacadeCorner = { lon: wgs.lon, lat: wgs.lat, alt: wgs.alt };
    const corners = [...this.state.corners, corner];
    if (corners.length < 4) {
      this.setState({ mode: 'drawing', corners });
      return;
    }
    // 4 角齐了 —— 把第 4 角强制投影到前 3 角决定的平面上，再拟合。
    // 这是 UX 关键：墙面有起伏 / picking 有误差 → 4 点不一定真共面，
    // 后端 SVD 会硬挤一个平面但歪斜。projected 4th 让 4 点严格共面，矩形拟合稳。
    const { projected, dCorrectionM } = projectFourthOntoPlane(
      corners[0],
      corners[1],
      corners[2],
      corners[3],
    );
    const finalCorners: FacadeCorner[] = [corners[0], corners[1], corners[2], projected];
    // 偏移 ≥ 0.05m 才标"已校正"（picking 误差通常 < 0.05m，不算偏）
    const correctedCount = dCorrectionM >= 0.05 ? 1 : 0;
    this.computeAndPreview(finalCorners, correctedCount);
  }

  // ----- 键盘 -----

  private onKey(e: KeyboardEvent): void {
    // Esc：抛弃，回到 drawing 空状态
    if (e.key === 'Escape') {
      e.preventDefault();
      this.setState({ mode: 'drawing', corners: [] });
      return;
    }
    // F：preview 状态下翻转法向
    if ((e.key === 'f' || e.key === 'F') && this.state.mode === 'preview') {
      e.preventDefault();
      this.flipNormalInPreview();
      return;
    }
    // Enter：preview 状态下保存
    if (e.key === 'Enter' && this.state.mode === 'preview') {
      e.preventDefault();
      this.commit();
    }
  }

  private computeAndPreview(corners: FacadeCorner[], cornerInferredCount: number): void {
    const rawPlane = fitPlaneFromCorners(corners);
    if (!rawPlane || !Number.isFinite(rawPlane.width) || rawPlane.width < 0.1 || rawPlane.height < 0.1) {
      this.setState({
        mode: 'error',
        corners,
        message: '点共线或退化，无法拟合平面 · 请重新拾取（按 L 形拾取 3 角即可）',
      });
      setTimeout(() => {
        if (this.state.mode === 'error') {
          this.setState({ mode: 'drawing', corners: [] });
        }
      }, 1500);
      return;
    }
    // 法向自动朝外：拿 tileset 中心，N 指向中心则取反
    const tilesetCenter = findFirstTilesetCenter(this.viewer);
    const plane = ensureNormalOutward(rawPlane, tilesetCenter);
    const scanPath = generateFacadeScanPath(this.viewer, plane, corners, { ...FACADE_DEFAULTS });
    const { unsafeCount } = annotateUnsafe(this.viewer, plane, scanPath, FACADE_DEFAULTS.standoff);
    this.setState({
      mode: 'preview',
      corners,
      cornerInferredCount,
      plane,
      scanPath,
      unsafeCount,
    });
  }

  /**
   * 在 preview 状态翻转法向 —— F 键 / HUD「反转法向」按钮共用。
   * plane / scanPath / unsafeCount 全重算。
   */
  flipNormalInPreview(): void {
    if (this.state.mode !== 'preview') return;
    const flipped = flipFacadePlane(this.state.plane);
    const scanPath = generateFacadeScanPath(this.viewer, flipped, this.state.corners, {
      ...FACADE_DEFAULTS,
    });
    const { unsafeCount } = annotateUnsafe(
      this.viewer,
      flipped,
      scanPath,
      FACADE_DEFAULTS.standoff,
    );
    this.setState({
      mode: 'preview',
      corners: this.state.corners,
      cornerInferredCount: this.state.cornerInferredCount,
      plane: flipped,
      scanPath,
      unsafeCount,
    });
  }

  private commit(): void {
    if (this.state.mode !== 'preview') return;
    const { corners, plane, scanPath } = this.state;
    const store = useMissionsStore.getState();
    const mission = store.missions.find((m) => m.id === store.currentMissionId);
    if (!mission || mission.type !== 'facade') return;
    const idx = (mission.facadeFaces?.length ?? 0) + 1;
    const id = store.addFacadeFace({
      name: `立面 ${idx}`,
      corners,
    });
    if (!id) return;
    store.setFaceScanResult(id, plane, scanPath);
    // 保存后回到空 drawing，可连续画下一个面；用户想结束自己点 HUD X 切 pickerMode='idle'
    // 不主动切右 Sheet tab（避免抢用户视线）
    this.setState({ mode: 'drawing', corners: [] });
  }
}

/**
 * 从 viewer.scene.primitives 找第一个 Cesium3DTileset，返回其 boundingSphere.center。
 * 没找到返回 null（picker 在没 tileset 时 ensureNormalOutward 直接 noop）。
 */
function findFirstTilesetCenter(viewer: Cesium.Viewer): Cesium.Cartesian3 | null {
  const prims = viewer.scene.primitives;
  for (let i = 0; i < prims.length; i++) {
    const p = prims.get(i);
    // Cesium3DTileset 有 boundingSphere 属性；用 duck typing 避免 instanceof 跨模块实例问题
    const ts = p as { boundingSphere?: { center?: Cesium.Cartesian3 } };
    if (ts.boundingSphere?.center && Number.isFinite(ts.boundingSphere.center.x)) {
      return ts.boundingSphere.center;
    }
  }
  return null;
}

/**
 * 把第 4 角点投影到由前 3 角点决定的平面上，保证 4 点严格共面。
 *
 * 计算在 ECEF 笛卡尔系（wgs84ToCartesian3）下做：
 *   1. p0/p1/p2 三点定义平面：normal = (p1-p0) × (p2-p0) 归一化
 *   2. p3' = p3 - ((p3 - p0) · normal) * normal  ← 投影
 *   3. 转回 WGS84 经纬度 + alt
 *
 * 返回投影后的 corner + 原始 p3 与 p3' 的距离（用来判定 UI 是否提示 "已校正"）。
 */
function projectFourthOntoPlane(
  p0: FacadeCorner,
  p1: FacadeCorner,
  p2: FacadeCorner,
  p3: FacadeCorner,
): { projected: FacadeCorner; dCorrectionM: number } {
  const a = wgs84ToCartesian3(p0.lon, p0.lat, p0.alt);
  const b = wgs84ToCartesian3(p1.lon, p1.lat, p1.alt);
  const c = wgs84ToCartesian3(p2.lon, p2.lat, p2.alt);
  const d = wgs84ToCartesian3(p3.lon, p3.lat, p3.alt);

  const e1 = Cesium.Cartesian3.subtract(b, a, new Cesium.Cartesian3());
  const e2 = Cesium.Cartesian3.subtract(c, a, new Cesium.Cartesian3());
  const n = Cesium.Cartesian3.cross(e1, e2, new Cesium.Cartesian3());
  const nLen = Cesium.Cartesian3.magnitude(n);
  if (nLen < 1e-9) {
    // 前 3 角共线 → 不能投影，原样返回（下游 fitPlaneFromCorners 会报 degenerate）
    return { projected: p3, dCorrectionM: 0 };
  }
  Cesium.Cartesian3.divideByScalar(n, nLen, n);

  const da = Cesium.Cartesian3.subtract(d, a, new Cesium.Cartesian3());
  const signedDist = Cesium.Cartesian3.dot(da, n);
  const dProj = new Cesium.Cartesian3(
    d.x - signedDist * n.x,
    d.y - signedDist * n.y,
    d.z - signedDist * n.z,
  );
  const dCorrectionM = Math.abs(signedDist);
  const w = cartesian3ToWgs84(dProj);
  return {
    projected: { lon: w.lon, lat: w.lat, alt: w.alt },
    dCorrectionM,
  };
}

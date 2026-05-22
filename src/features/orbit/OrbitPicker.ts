import * as Cesium from 'cesium';
import { pickWgs84At } from '../../lib/cesium-pick';
import { wgs84ToCartesian3 } from '../../lib/coord';
import { generateOrbitScanPath } from '../../lib/orbit-scan';
import { useMissionsStore } from '../../store/missions';
import { ORBIT_DEFAULTS } from '../../types/mission';
import type { OrbitDef, Waypoint } from '../../types/mission';

/**
 * v3.5 4 步累积环绕拾取（轴 → 底高 → 顶高 → 半径），每步设完都可继续拖拽微调。
 *
 *   Step 1 · axis    单击模型任意位置 → 取 lon/lat 作为轴的水平位置（一根无限长黄线）
 *   Step 2 · bottom  单击模型任意位置 → 取该 alt 作为底高（轴上加 ▽ marker）
 *   Step 3 · top     单击模型任意位置 → 取该 alt 作为顶高（轴上加 △ marker，圆柱段确定）
 *   Step 4 · radius  按住任意位置拖出半径 → 松手锁定（圆柱完整出来）
 *   完成后所有 4 个 handle (axis 中心 / bottom / top / radius) 都可继续拖
 *
 * Handles:
 *   axis handle    黄圆点（轴线交叉点）→ 拖改 lon/lat（整条轴 ENU 平移）
 *   bottom handle  黄三角（▽ 朝下）→ 拖时 pickWgs84At 取命中 alt
 *   top handle     黄三角（△ 朝上）→ 拖时 pickWgs84At 取命中 alt
 *   radius handle  北侧黄圆点 → 拖时算水平距给 radius
 *
 * 快捷键：Esc/Backspace 重置；Enter (step=done) 保存；F (step=done) 反转方向
 */

const MIN_RADIUS = 0.5;
const HIT_PX = 16;
const AXIS_LINE_BELOW = 200; // 轴下端延伸 m（相对 bottom 或地表）
const AXIS_LINE_ABOVE = 200; // 轴上端延伸 m

export type DragHandle = 'axis' | 'bottom' | 'top' | 'radius';
export type BuildStep = 'axis' | 'bottom' | 'top' | 'radius' | 'done';

export interface OrbitPartial {
  axisLon?: number;
  axisLat?: number;
  bottomAlt?: number;
  topAlt?: number;
  radius?: number;
}

export type OrbitPickerState =
  | { mode: 'building'; partial: OrbitPartial; scanPath: Waypoint[] }
  | { mode: 'error'; message: string };

export function stepOf(p: OrbitPartial): BuildStep {
  if (p.axisLon == null || p.axisLat == null) return 'axis';
  if (p.bottomAlt == null) return 'bottom';
  if (p.topAlt == null) return 'top';
  if (p.radius == null) return 'radius';
  return 'done';
}

export class OrbitPicker {
  private viewer: Cesium.Viewer;
  private handler: Cesium.ScreenSpaceEventHandler;
  private state: OrbitPickerState = { mode: 'building', partial: {}, scanPath: [] };
  private listeners: Array<(s: OrbitPickerState) => void> = [];
  private dragMode: DragHandle | null = null;
  private savedCamCtrl: {
    rot: boolean;
    trans: boolean;
    zoom: boolean;
    tilt: boolean;
    look: boolean;
  } | null = null;

  private keyDown = (e: KeyboardEvent): void => this.onKey(e);
  private contextMenuBlocker = (e: MouseEvent): void => e.preventDefault();

  constructor(viewer: Cesium.Viewer) {
    this.viewer = viewer;
    this.handler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
    this.handler.setInputAction(
      (e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => this.onLeftDown(e.position),
      Cesium.ScreenSpaceEventType.LEFT_DOWN,
    );
    this.handler.setInputAction(
      (e: Cesium.ScreenSpaceEventHandler.MotionEvent) => this.onMouseMove(e.endPosition),
      Cesium.ScreenSpaceEventType.MOUSE_MOVE,
    );
    this.handler.setInputAction(
      (e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => this.onLeftUp(e.position),
      Cesium.ScreenSpaceEventType.LEFT_UP,
    );
    window.addEventListener('keydown', this.keyDown);
    viewer.canvas.addEventListener('contextmenu', this.contextMenuBlocker);
  }

  destroy(): void {
    window.removeEventListener('keydown', this.keyDown);
    this.viewer.canvas.removeEventListener('contextmenu', this.contextMenuBlocker);
    this.handler.destroy();
    this.restoreCameraControl();
    this.viewer.canvas.style.cursor = '';
    this.listeners = [];
  }

  getState(): OrbitPickerState {
    return this.state;
  }

  onStateChange(cb: (s: OrbitPickerState) => void): () => void {
    this.listeners.push(cb);
    cb(this.state);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  private setState(next: OrbitPickerState): void {
    this.state = next;
    for (const cb of this.listeners) cb(next);
  }

  /** done 状态下翻转方向（cw ↔ ccw）。building 未完时无效。 */
  flipDirectionInPreview(): void {
    if (this.state.mode !== 'building') return;
    if (stepOf(this.state.partial) !== 'done') return;
    const orbit = this.buildOrbit(this.state.partial);
    if (!orbit) return;
    const newDir = orbit.params.direction === 'cw' ? 'ccw' : 'cw';
    const next: OrbitDef = { ...orbit, params: { ...orbit.params, direction: newDir } };
    const scanPath = generateOrbitScanPath(next);
    // partial 不变（partial 本身没存 direction，direction 在 ORBIT_DEFAULTS 默认；
    // 走完整 commit 流程会用默认。这里只是预览翻转，保存到 store 后才生效）
    // 为了让 preview 也即时反映翻转，把翻转后的 direction 暂存到一个内部字段
    // 简化：把整个 orbit 当成"materialized partial"重设
    this.materializedOrbit = next;
    this.setState({ ...this.state, scanPath });
  }

  // 翻转方向后的 materialized 副本，commit 时用；未翻则用默认 direction
  private materializedOrbit: OrbitDef | null = null;

  // ===== 鼠标 =====

  private onLeftDown(screenPos: Cesium.Cartesian2): void {
    if (this.state.mode !== 'building') return;
    const step = stepOf(this.state.partial);

    // 优先命中已有 handle → 拖拽模式
    const hit = this.hitTestHandles(screenPos);
    if (hit) {
      this.dragMode = hit;
      this.disableCameraControl();
      // 拖 axis/bottom/top 时立即用当前鼠标位置 update（让用户感觉跟手）
      this.applyDragAt(screenPos);
      return;
    }

    // 否则按当前 step 单击拾取
    const wgs = pickWgs84At(this.viewer, screenPos);
    if (!wgs) return;

    if (step === 'axis') {
      this.applyPartial({ axisLon: wgs.lon, axisLat: wgs.lat });
      return;
    }
    if (step === 'bottom') {
      this.applyPartial({ bottomAlt: wgs.alt });
      return;
    }
    if (step === 'top') {
      // 强制 top > bottom，否则提示
      if (this.state.partial.bottomAlt != null && wgs.alt <= this.state.partial.bottomAlt) {
        this.flashError('顶高必须大于底高 · 请再点');
        return;
      }
      this.applyPartial({ topAlt: wgs.alt });
      return;
    }
    if (step === 'radius') {
      // 直接进入拖半径模式（按住即拖）
      this.dragMode = 'radius';
      this.disableCameraControl();
      this.applyMouseToRadius(screenPos);
      return;
    }
    // step === 'done' 单击不做事，等用户拖 handle 或按 Enter
  }

  private onMouseMove(screenPos: Cesium.Cartesian2): void {
    if (this.dragMode) {
      this.applyDragAt(screenPos);
      return;
    }
    this.updateHoverCursor(screenPos);
  }

  private onLeftUp(_screenPos: Cesium.Cartesian2): void {
    if (!this.dragMode) return;
    this.dragMode = null;
    this.restoreCameraControl();
  }

  private applyDragAt(screenPos: Cesium.Cartesian2): void {
    if (!this.dragMode || this.state.mode !== 'building') return;
    if (this.dragMode === 'radius') {
      this.applyMouseToRadius(screenPos);
      return;
    }
    // 拖 axis / bottom / top 时，跳过 picker 自己画的 axis polyline + markers
    // 否则 ray 会命中 axis 长虚线本身，让 alt 卡在 axis 上某个值
    const wgs = pickWgs84At(this.viewer, screenPos, 'orbit-picker-');
    if (!wgs) return;
    if (this.dragMode === 'axis') {
      this.applyPartial({ axisLon: wgs.lon, axisLat: wgs.lat });
    } else if (this.dragMode === 'bottom') {
      this.applyPartial({ bottomAlt: wgs.alt });
    } else if (this.dragMode === 'top') {
      this.applyPartial({ topAlt: wgs.alt });
    }
  }

  private applyMouseToRadius(screenPos: Cesium.Cartesian2): void {
    if (this.state.mode !== 'building') return;
    const p = this.state.partial;
    if (p.axisLon == null || p.axisLat == null || p.bottomAlt == null) return;
    // 拖半径也跳过 picker 自身（避免 ray 命中 axis 虚线导致水平距错乱）
    const wgs = pickWgs84At(this.viewer, screenPos, 'orbit-picker-');
    if (!wgs) return;
    const centerECEF = wgs84ToCartesian3(p.axisLon, p.axisLat, p.bottomAlt);
    const mouseECEF = wgs84ToCartesian3(wgs.lon, wgs.lat, p.bottomAlt); // 强制对齐 alt 算水平距
    const r = Cesium.Cartesian3.distance(centerECEF, mouseECEF);
    if (r < MIN_RADIUS) return;
    this.applyPartial({ radius: r });
  }

  private applyPartial(patch: Partial<OrbitPartial>): void {
    if (this.state.mode !== 'building') return;
    const partial = { ...this.state.partial, ...patch };
    // partial 变化时丢弃 materialized direction 翻转（避免拖完一遍 R 后 direction 错乱）
    if (patch.radius != null || patch.axisLon != null || patch.bottomAlt != null || patch.topAlt != null) {
      this.materializedOrbit = null;
    }
    const orbit = this.buildOrbit(partial);
    const scanPath = orbit ? generateOrbitScanPath(orbit) : [];
    this.setState({ mode: 'building', partial, scanPath });
  }

  /** partial 全齐时构造完整 OrbitDef；否则 null */
  private buildOrbit(p: OrbitPartial): OrbitDef | null {
    if (
      p.axisLon == null ||
      p.axisLat == null ||
      p.bottomAlt == null ||
      p.topAlt == null ||
      p.radius == null
    )
      return null;
    const baseDir =
      this.materializedOrbit?.params.direction ?? ORBIT_DEFAULTS.direction;
    const totalH = p.topAlt - p.bottomAlt;
    const params = { ...ORBIT_DEFAULTS, totalH, direction: baseDir };
    return {
      axisBottom: { lon: p.axisLon, lat: p.axisLat, alt: p.bottomAlt },
      axisTop: { lon: p.axisLon, lat: p.axisLat, alt: p.topAlt },
      radius: p.radius,
      params,
    };
  }

  // ===== 键盘 =====

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape' || e.key === 'Backspace') {
      e.preventDefault();
      this.setState({ mode: 'building', partial: {}, scanPath: [] });
      this.materializedOrbit = null;
      this.dragMode = null;
      this.restoreCameraControl();
      this.viewer.canvas.style.cursor = '';
      return;
    }
    if (this.state.mode !== 'building') return;
    const step = stepOf(this.state.partial);
    if (step !== 'done') return;
    if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      this.flipDirectionInPreview();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      this.commit();
    }
  }

  // ===== Hit test =====

  /** 命中检测：检查屏幕距 < HIT_PX 的 handle，优先顺序 axis > bottom > top > radius */
  private hitTestHandles(screenPos: Cesium.Cartesian2): DragHandle | null {
    if (this.state.mode !== 'building') return null;
    const p = this.state.partial;
    if (p.axisLon == null || p.axisLat == null) return null;

    // axis handle：用 bottom alt（或 0 兜底）作 representative point
    const axisAlt =
      p.bottomAlt != null && p.topAlt != null
        ? (p.bottomAlt + p.topAlt) / 2
        : (p.bottomAlt ?? 0);
    const axisECEF = wgs84ToCartesian3(p.axisLon, p.axisLat, axisAlt);
    const axisScreen = this.viewer.scene.cartesianToCanvasCoordinates(axisECEF);
    // 但 axis handle 只在轴中心可拖；当 step >= radius 时优先命中其它 handles
    const candidates: Array<{ handle: DragHandle; pos: Cesium.Cartesian3 }> = [];

    if (p.bottomAlt != null) {
      candidates.push({
        handle: 'bottom',
        pos: wgs84ToCartesian3(p.axisLon, p.axisLat, p.bottomAlt),
      });
    }
    if (p.topAlt != null) {
      candidates.push({
        handle: 'top',
        pos: wgs84ToCartesian3(p.axisLon, p.axisLat, p.topAlt),
      });
    }
    if (p.radius != null && p.bottomAlt != null) {
      const enu = Cesium.Transforms.eastNorthUpToFixedFrame(
        wgs84ToCartesian3(p.axisLon, p.axisLat, p.bottomAlt),
      );
      const local = new Cesium.Cartesian3(0, p.radius, 0); // 北侧
      candidates.push({
        handle: 'radius',
        pos: Cesium.Matrix4.multiplyByPoint(enu, local, new Cesium.Cartesian3()),
      });
    }
    // axis 整体（中央点）放最后：避免与 bottom/top 重叠时优先 bottom/top
    candidates.push({ handle: 'axis', pos: axisECEF });

    for (const c of candidates) {
      const sp = this.viewer.scene.cartesianToCanvasCoordinates(c.pos);
      if (sp && screenDist(screenPos, sp) < HIT_PX) return c.handle;
    }
    // 防 axisScreen 完全为 null
    if (axisScreen && screenDist(screenPos, axisScreen) < HIT_PX) return 'axis';
    return null;
  }

  private updateHoverCursor(screenPos: Cesium.Cartesian2): void {
    const c = this.viewer.canvas;
    if (this.state.mode !== 'building') {
      c.style.cursor = '';
      return;
    }
    const hit = this.hitTestHandles(screenPos);
    if (hit) {
      c.style.cursor = 'grab';
      return;
    }
    const step = stepOf(this.state.partial);
    c.style.cursor = step === 'done' ? '' : 'crosshair';
  }

  // ===== Camera 控制开关 =====

  private disableCameraControl(): void {
    const ctrl = this.viewer.scene.screenSpaceCameraController;
    this.savedCamCtrl = {
      rot: ctrl.enableRotate,
      trans: ctrl.enableTranslate,
      zoom: ctrl.enableZoom,
      tilt: ctrl.enableTilt,
      look: ctrl.enableLook,
    };
    ctrl.enableRotate = false;
    ctrl.enableTranslate = false;
    ctrl.enableZoom = false;
    ctrl.enableTilt = false;
    ctrl.enableLook = false;
    this.viewer.canvas.style.cursor = 'grabbing';
  }

  private restoreCameraControl(): void {
    const ctrl = this.viewer.scene.screenSpaceCameraController;
    if (this.savedCamCtrl) {
      ctrl.enableRotate = this.savedCamCtrl.rot;
      ctrl.enableTranslate = this.savedCamCtrl.trans;
      ctrl.enableZoom = this.savedCamCtrl.zoom;
      ctrl.enableTilt = this.savedCamCtrl.tilt;
      ctrl.enableLook = this.savedCamCtrl.look;
    }
    this.savedCamCtrl = null;
  }

  private flashError(message: string): void {
    const prev = this.state;
    this.setState({ mode: 'error', message });
    setTimeout(() => {
      if (this.state.mode === 'error') this.setState(prev);
    }, 1200);
  }

  // ===== 提交 =====

  private commit(): void {
    if (this.state.mode !== 'building') return;
    if (stepOf(this.state.partial) !== 'done') return;
    const orbit = this.buildOrbit(this.state.partial);
    if (!orbit) return;
    const store = useMissionsStore.getState();
    const mission = store.missions.find((m) => m.id === store.currentMissionId);
    if (!mission || mission.type !== 'orbit') return;
    const scanPath = generateOrbitScanPath(orbit);
    store.setOrbit({ ...orbit, scanPath });
    this.setState({ mode: 'building', partial: {}, scanPath: [] });
    this.materializedOrbit = null;
    this.viewer.canvas.style.cursor = '';
  }
}

function screenDist(a: Cesium.Cartesian2, b: Cesium.Cartesian2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// ===== 工具 (Layer 用) =====
export const AXIS_BELOW = AXIS_LINE_BELOW;
export const AXIS_ABOVE = AXIS_LINE_ABOVE;

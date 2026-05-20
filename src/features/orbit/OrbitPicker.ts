import * as Cesium from 'cesium';
import { pickWgs84At } from '../../lib/cesium-pick';
import { wgs84ToCartesian3 } from '../../lib/coord';
import { generateOrbitScanPath } from '../../lib/orbit-scan';
import { useMissionsStore } from '../../store/missions';
import { ORBIT_DEFAULTS } from '../../types/mission';
import type { OrbitDef, Waypoint } from '../../types/mission';

/**
 * 3 点环绕拾取：底心 → 顶心 → 侧点定半径。
 *
 *   drawing-1: 等 ① 底心
 *   drawing-2: 等 ② 顶心（高度差决定 H）
 *   drawing-3: 等 ③ 侧点（水平距离决定 radius）
 *   preview:   场景里画圆柱 + scanPath；按 Enter 保存 / Esc 重画 / F 反转方向
 *
 * preview 数据通过 onStateChange 暴露给 React 渲染（OrbitLayer / HUD）。
 */

export type OrbitPickerState =
  | { mode: 'drawing'; points: { lon: number; lat: number; alt: number }[] }
  | {
      mode: 'preview';
      orbit: OrbitDef;
      scanPath: Waypoint[];
    }
  | { mode: 'error'; message: string };

export class OrbitPicker {
  private viewer: Cesium.Viewer;
  private handler: Cesium.ScreenSpaceEventHandler;
  private state: OrbitPickerState = { mode: 'drawing', points: [] };
  private listeners: Array<(s: OrbitPickerState) => void> = [];

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

  /** preview 状态下翻转飞行方向（cw ↔ ccw）；HUD 按钮 + F 键共用 */
  flipDirectionInPreview(): void {
    if (this.state.mode !== 'preview') return;
    const cur = this.state.orbit;
    const newDir = cur.params.direction === 'cw' ? 'ccw' : 'cw';
    const next: OrbitDef = {
      ...cur,
      params: { ...cur.params, direction: newDir },
    };
    const scanPath = generateOrbitScanPath(next);
    this.setState({ mode: 'preview', orbit: next, scanPath });
  }

  // ----- 鼠标 -----

  private onLeftClick(screenPos: Cesium.Cartesian2): void {
    if (this.state.mode !== 'drawing') return;
    const wgs = pickWgs84At(this.viewer, screenPos);
    if (!wgs) return;
    const next = [...this.state.points, { lon: wgs.lon, lat: wgs.lat, alt: wgs.alt }];
    if (next.length < 3) {
      this.setState({ mode: 'drawing', points: next });
      return;
    }
    // 3 点齐 → 算 orbit
    this.computeAndPreview(next as [
      { lon: number; lat: number; alt: number },
      { lon: number; lat: number; alt: number },
      { lon: number; lat: number; alt: number },
    ]);
  }

  // ----- 键盘 -----

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.setState({ mode: 'drawing', points: [] });
      return;
    }
    if ((e.key === 'f' || e.key === 'F') && this.state.mode === 'preview') {
      e.preventDefault();
      this.flipDirectionInPreview();
      return;
    }
    if (e.key === 'Enter' && this.state.mode === 'preview') {
      e.preventDefault();
      this.commit();
    }
  }

  private computeAndPreview(
    points: [
      { lon: number; lat: number; alt: number },
      { lon: number; lat: number; alt: number },
      { lon: number; lat: number; alt: number },
    ],
  ): void {
    const [p0, p1, p2] = points;
    // p0 = 底心；p1 = 顶心；p2 = 侧点
    // 半径 = p2 到 axis（垂直线）的水平距离 = √((p2-p0)·horiz)²
    // axisBottom 取 p0；axisTop 取 (p0.lon, p0.lat, p1.alt)（强制垂直）
    if (p1.alt - p0.alt < 1) {
      this.setState({
        mode: 'error',
        message: '② 顶心高度需大于 ① 底心至少 1m · 请重新拾取',
      });
      setTimeout(() => {
        if (this.state.mode === 'error') {
          this.setState({ mode: 'drawing', points: [] });
        }
      }, 1500);
      return;
    }
    const radius = horizDistMeters(p0, p2);
    if (radius < 0.5) {
      this.setState({
        mode: 'error',
        message: '③ 侧点离主轴太近（< 0.5m）· 请点远一些',
      });
      setTimeout(() => {
        if (this.state.mode === 'error') {
          this.setState({ mode: 'drawing', points: [] });
        }
      }, 1500);
      return;
    }
    const orbit: OrbitDef = {
      axisBottom: p0,
      axisTop: { lon: p0.lon, lat: p0.lat, alt: p1.alt },
      radius,
      params: { ...ORBIT_DEFAULTS },
    };
    const scanPath = generateOrbitScanPath(orbit);
    this.setState({ mode: 'preview', orbit, scanPath });
  }

  private commit(): void {
    if (this.state.mode !== 'preview') return;
    const { orbit, scanPath } = this.state;
    const store = useMissionsStore.getState();
    const mission = store.missions.find((m) => m.id === store.currentMissionId);
    if (!mission || mission.type !== 'orbit') return;
    store.setOrbit({ ...orbit, scanPath });
    // 保存后退出 picker（由 React 层 setPickerMode('idle')）。设个 sentinel error
    // 让外层 effect 检出并切 idle
    this.setState({ mode: 'drawing', points: [] });
  }
}

/** 两点的地表水平距离（忽略 alt 差），以 axisBottom 所在纬度展开 ENU 投影。 */
function horizDistMeters(
  a: { lon: number; lat: number; alt: number },
  b: { lon: number; lat: number; alt: number },
): number {
  const ac = wgs84ToCartesian3(a.lon, a.lat, a.alt);
  const bc = wgs84ToCartesian3(b.lon, b.lat, a.alt); // 强制对齐 a 的 alt 算水平距离
  return Cesium.Cartesian3.distance(ac, bc);
}

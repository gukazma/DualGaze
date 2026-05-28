import * as Cesium from 'cesium';
import { pickWgs84At } from '../../lib/cesium-pick';
import { useMissionsStore } from '../../store/missions';
import { useUiStore } from '../../store/ui';
import { useOvMeasureStore } from '../../store/ov-measure';
import { buildSweepSortie, buildSpotOrbitSortie } from '../../lib/ov/aux-capture';
import { measureReadout } from '../../lib/ov/measure';

/**
 * OV 辅助 picker —— 障碍物 / 禁飞区 / 平扫 / 环拍 / 量取。
 *
 * 统一累加点 + 按 kind 分别提交：
 *  - obstacle: 3 点矩形 → addOvObstacle（满 3 点自动提交）
 *  - nofly: 多边形 → addOvNoFly（双击/Enter 提交）
 *  - sweep: 2 点 → buildSweepSortie → appendOvSortie（满 2 点自动提交）
 *  - spotOrbit: 1 点 → buildSpotOrbitSortie → appendOvSortie（满 1 点自动提交）
 *  - measure: 累加 + 实时读数（双击/Enter 结束，不提交几何）
 *
 * 自身实体用 ov-aux-picker- 前缀让 raycast 跳过。
 */

export type AuxPickKind = 'obstacle' | 'nofly' | 'sweep' | 'spotOrbit' | 'measure';

export interface AuxPickListener {
  (pts: { lon: number; lat: number; alt: number }[]): void;
}

export class OvAuxPicker {
  private viewer: Cesium.Viewer;
  private kind: AuxPickKind;
  private pts: { lon: number; lat: number; alt: number }[] = [];
  private listener: AuxPickListener;
  private handler: Cesium.ScreenSpaceEventHandler;
  private keyDown = (e: KeyboardEvent): void => this.onKey(e);
  private ctxBlock = (e: MouseEvent): void => e.preventDefault();

  constructor(viewer: Cesium.Viewer, kind: AuxPickKind, listener: AuxPickListener) {
    this.viewer = viewer;
    this.kind = kind;
    this.listener = listener;
    this.handler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
    this.handler.setInputAction(
      (e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => this.onLeftClick(e.position),
      Cesium.ScreenSpaceEventType.LEFT_CLICK,
    );
    this.handler.setInputAction(
      () => this.finish(),
      Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK,
    );
    window.addEventListener('keydown', this.keyDown);
    viewer.canvas.addEventListener('contextmenu', this.ctxBlock);
  }

  destroy(): void {
    window.removeEventListener('keydown', this.keyDown);
    this.viewer.canvas.removeEventListener('contextmenu', this.ctxBlock);
    this.handler.destroy();
  }

  private exit(): void {
    this.pts = [];
    this.listener([]);
    useUiStore.getState().setPickerMode('idle');
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      if (this.kind === 'measure') useOvMeasureStore.getState().setReadout(null);
      this.exit();
    } else if (e.key === 'Enter') {
      this.finish();
    }
  }

  private onLeftClick(screenPos: Cesium.Cartesian2): void {
    const wgs = pickWgs84At(this.viewer, screenPos, 'ov-aux-picker-');
    if (!wgs) return;
    this.pts.push(wgs);
    this.listener([...this.pts]);

    if (this.kind === 'measure') {
      const mode = useOvMeasureStore.getState().mode;
      useOvMeasureStore.getState().setReadout(measureReadout(mode, this.pts));
      return;
    }
    if (this.kind === 'obstacle' && this.pts.length >= 3) this.finish();
    if (this.kind === 'sweep' && this.pts.length >= 2) this.finish();
    if (this.kind === 'spotOrbit' && this.pts.length >= 1) this.finish();
  }

  /** 双击 / Enter / 满点数：按 kind 提交。 */
  private finish(): void {
    const store = useMissionsStore.getState();
    switch (this.kind) {
      case 'obstacle':
        if (this.pts.length >= 3) store.addOvObstacle({ corners: this.pts.slice(0, 3), height: 30 });
        break;
      case 'nofly':
        if (this.pts.length >= 3)
          store.addOvNoFly({
            vertices: this.pts.map((p) => ({ lon: p.lon, lat: p.lat })),
            minHeight: 0,
            maxHeight: 200,
          });
        break;
      case 'sweep':
        if (this.pts.length >= 2)
          store.appendOvSortie(buildSweepSortie(this.pts[0], this.pts[1]));
        break;
      case 'spotOrbit':
        if (this.pts.length >= 1) store.appendOvSortie(buildSpotOrbitSortie(this.pts[0]));
        break;
      case 'measure': {
        const mode = useOvMeasureStore.getState().mode;
        if (this.pts.length >= 2) useOvMeasureStore.getState().setReadout(measureReadout(mode, this.pts));
        // measure 不退出 picker，让用户继续量；只在 Esc 退出
        return;
      }
    }
    this.exit();
  }
}

import * as Cesium from 'cesium';
import { pickWgs84At } from '../../lib/cesium-pick';
import { useMissionsStore } from '../../store/missions';
import { useUiStore } from '../../store/ui';

/**
 * OV 辅助 picker —— 障碍物（3 点矩形）+ 禁飞区（多边形）。
 *
 * 两者都是临时点累加 + 完成提交，复用 pickWgs84At（跳过 ov-aux-picker- 自身实体）。
 * 临时点存在各 picker 实例里；OvAuxPickerMount 通过回调把累加点传给 OvLayer 预览。
 */

export type AuxPickKind = 'obstacle' | 'nofly';

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
      () => this.commit(),
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

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.pts = [];
      this.listener([]);
      useUiStore.getState().setPickerMode('idle');
    } else if (e.key === 'Enter') {
      this.commit();
    }
  }

  private onLeftClick(screenPos: Cesium.Cartesian2): void {
    const wgs = pickWgs84At(this.viewer, screenPos, 'ov-aux-picker-');
    if (!wgs) return;
    this.pts.push(wgs);
    this.listener([...this.pts]);
    // 障碍物：满 3 点自动提交
    if (this.kind === 'obstacle' && this.pts.length >= 3) {
      this.commit();
    }
  }

  private commit(): void {
    const store = useMissionsStore.getState();
    if (this.kind === 'obstacle') {
      if (this.pts.length < 3) return;
      store.addOvObstacle({
        corners: this.pts.slice(0, 3),
        height: 30,
      });
    } else {
      if (this.pts.length < 3) return;
      store.addOvNoFly({
        vertices: this.pts.map((p) => ({ lon: p.lon, lat: p.lat })),
        minHeight: 0,
        maxHeight: 200,
      });
    }
    this.pts = [];
    this.listener([]);
    useUiStore.getState().setPickerMode('idle');
  }
}

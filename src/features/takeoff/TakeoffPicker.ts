import * as Cesium from 'cesium';
import { pickWgs84At } from '../../lib/cesium-pick';
import { useMissionsStore } from '../../store/missions';
import { useUiStore } from '../../store/ui';

/**
 * 起飞点单点拾取（v3.2 takeoff gate）。
 *
 * 进入条件：UI 切到 `pickerMode === 'takeoff-pick'`（由 TakeoffStartCta 触发）。
 * 行为：
 *  - 左键：在 3DTiles / globe 表面拾 1 个 WGS84 点；命中即写入 store + 退出 picker
 *  - Esc：取消，退出 picker（不改 mission.takeOffPoint）
 *
 * 命中失败（点到天空 / globe 关闭）静默忽略，等用户再点。
 */
export class TakeoffPicker {
  private viewer: Cesium.Viewer;
  private handler: Cesium.ScreenSpaceEventHandler;
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
  }

  private onLeftClick(screenPos: Cesium.Cartesian2): void {
    const wgs = pickWgs84At(this.viewer, screenPos);
    if (!wgs) return;
    useMissionsStore.getState().setTakeOffPoint({
      lon: wgs.lon,
      lat: wgs.lat,
      alt: wgs.alt,
    });
    useUiStore.getState().setPickerMode('idle');
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      useUiStore.getState().setPickerMode('idle');
    }
  }
}

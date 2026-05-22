import * as Cesium from 'cesium';
import { pickWgs84At } from '../../lib/cesium-pick';
import { useMissionsStore } from '../../store/missions';
import { useUiStore } from '../../store/ui';
import { useOvPickerStore, type OvAoiVertex } from '../../store/ov-picker';

/**
 * OV AOI 多边形拾取。
 *
 * 交互：
 *   - 左键：在 tileset / globe 拾点，加 1 个 AOI 顶点
 *   - 双击 / Enter：≥3 顶点时进入 preview 模式
 *   - 右键 / preview 后再单击 [✓ 完成]（外部 HUD 触发）→ 提交 setOvAoi + 退出
 *   - Esc：清空当前 vertices 列表
 *
 * 自身画的线 / 顶点点用 entity name 前缀 `ov-aoi-picker-` 标记，
 * 让 raycast `drillPickFromRay` 跳过它们，避免拾点时打到自己的可视化。
 */
export class OvAoiPicker {
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
    this.handler.setInputAction(
      () => this.onDoubleClick(),
      Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK,
    );
    window.addEventListener('keydown', this.keyDown);
    viewer.canvas.addEventListener('contextmenu', this.contextMenuBlocker);
  }

  destroy(): void {
    window.removeEventListener('keydown', this.keyDown);
    this.viewer.canvas.removeEventListener('contextmenu', this.contextMenuBlocker);
    this.handler.destroy();
  }

  /**
   * 外部 HUD「完成」按钮调：把 preview 状态的 vertices commit 到 mission.ov.aoi，
   * 退出 picker，并复位 picker store。
   */
  static commitPreview(): boolean {
    const s = useOvPickerStore.getState().aoiState;
    if (s.mode !== 'preview') return false;
    const missions = useMissionsStore.getState();
    const m = missions.missions.find((x) => x.id === missions.currentMissionId);
    if (!m || m.type !== 'ov' || !m.ov) return false;
    missions.setOvAoi({
      vertices: s.vertices.map((v) => ({ lon: v.lon, lat: v.lat })),
      minHeight: m.ov.samplingParams.minHeight,
      maxHeight: m.ov.samplingParams.maxHeight,
    });
    useOvPickerStore.getState().resetAoi();
    useUiStore.getState().setPickerMode('idle');
    return true;
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      useOvPickerStore.getState().resetAoi();
      useUiStore.getState().setPickerMode('idle');
    } else if (e.key === 'Enter') {
      OvAoiPicker.commitPreview();
    }
  }

  private onLeftClick(screenPos: Cesium.Cartesian2): void {
    const wgs = pickWgs84At(this.viewer, screenPos, 'ov-aoi-picker-');
    if (!wgs) {
      useOvPickerStore.getState().setAoiState({
        mode: 'error',
        message: '拾取失败（点到天空 / globe 未启用）',
      });
      return;
    }
    const cur = useOvPickerStore.getState().aoiState;
    const existing: OvAoiVertex[] =
      cur.mode === 'drawing' || cur.mode === 'preview' ? cur.vertices : [];
    const next: OvAoiVertex[] = [...existing, { lon: wgs.lon, lat: wgs.lat }];
    useOvPickerStore.getState().setAoiState({
      mode: next.length >= 3 ? 'preview' : 'drawing',
      vertices: next,
    });
  }

  private onDoubleClick(): void {
    // 双击会先触发一次 LEFT_CLICK 加点；本回调只负责升级到 preview。
    const s = useOvPickerStore.getState().aoiState;
    if (s.mode === 'drawing' && s.vertices.length >= 3) {
      useOvPickerStore.getState().setAoiState({ mode: 'preview', vertices: s.vertices });
    }
  }
}

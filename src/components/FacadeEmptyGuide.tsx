import { ScanEye, Target, ScanSearch } from 'lucide-react';
import { TilesetSourcePicker } from './TilesetSourcePicker';
import { useCurrentMission } from '../store/missions';

/**
 * Facade / Orbit / OV mission 无 tileset 时的主视图中央引导卡片。
 *
 * 条件：`(facade || orbit || ov) && !tilesetSource`。
 * 文案 + 图标 + 边框颜色根据 mission.type 切换：
 *   - facade: 青色边框 + ScanEye 图标 + "贴近摄影需要在三维模型上指定立面"
 *   - orbit:  黄色边框 + Target 图标 + "环绕摄影需要在三维模型上拾取塔轴"
 *   - ov:     黄色边框 + ScanSearch 图标 + "优视航线需要在三维模型上规划采样区域"
 */
export function FacadeEmptyGuide() {
  const mission = useCurrentMission();
  const isOrbit = mission?.type === 'orbit';
  const isOv = mission?.type === 'ov';
  const borderClass = isOrbit || isOv ? 'border-[#ffd24a]' : 'border-accent';
  const Icon = isOv ? ScanSearch : isOrbit ? Target : ScanEye;
  const iconColor = isOrbit || isOv ? 'text-[#ffd24a]' : 'text-accent-cyan';
  const subtitle = isOv
    ? '优视航线需要在三维模型上规划采样区域'
    : isOrbit
      ? '环绕摄影需要在三维模型上拾取塔轴'
      : '贴近摄影需要在三维模型上指定立面';
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
      <div
        className={`pointer-events-auto w-[480px] rounded-xl border bg-bg-panel/95 p-6 shadow-2xl backdrop-blur-sm ${borderClass}`}
      >
        <div className="mb-4 flex justify-center">
          <Icon className={`h-7 w-7 ${iconColor}`} />
        </div>
        <h2 className="mb-2 text-center text-[18px] font-bold text-text-primary">
          还没有 3D Tiles 模型
        </h2>
        <p className="mb-5 text-center text-[12px] text-text-secondary">{subtitle}</p>
        <TilesetSourcePicker variant="card" />
        <p className="mt-3 text-center text-[10px] text-text-muted">
          ⚠ HTTP 起 `python -m http.server` 指向 tileset 目录；或选本地目录直接加载
        </p>
      </div>
    </div>
  );
}

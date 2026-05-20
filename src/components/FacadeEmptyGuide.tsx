import { ScanEye, Target } from 'lucide-react';
import { TilesetSourcePicker } from './TilesetSourcePicker';
import { useCurrentMission } from '../store/missions';

/**
 * Facade / Orbit mission 无 tileset 时的主视图中央引导卡片。
 *
 * 条件：`(facade || orbit) && !tilesetSource`。
 * 文案 + 图标 + 边框颜色根据 mission.type 切换：
 *   - facade: 青色边框 + ScanEye 图标 + "贴近摄影需要在三维模型上指定立面"
 *   - orbit:  紫色边框 + Target 图标 + "环绕摄影需要在三维模型上拾取塔轴"
 */
export function FacadeEmptyGuide() {
  const mission = useCurrentMission();
  const isOrbit = mission?.type === 'orbit';
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
      <div
        className={`pointer-events-auto w-[480px] rounded-xl border bg-bg-panel/95 p-6 shadow-2xl backdrop-blur-sm ${
          isOrbit ? 'border-[#a64aff]' : 'border-accent'
        }`}
      >
        <div className="mb-4 flex justify-center">
          {isOrbit ? (
            <Target className="h-7 w-7 text-[#a64aff]" />
          ) : (
            <ScanEye className="h-7 w-7 text-accent-cyan" />
          )}
        </div>
        <h2 className="mb-2 text-center text-[18px] font-bold text-text-primary">
          还没有 3D Tiles 模型
        </h2>
        <p className="mb-5 text-center text-[12px] text-text-secondary">
          {isOrbit ? '环绕摄影需要在三维模型上拾取塔轴' : '贴近摄影需要在三维模型上指定立面'}
        </p>
        <TilesetSourcePicker variant="card" />
        <p className="mt-3 text-center text-[10px] text-text-muted">
          ⚠ HTTP 起 `python -m http.server` 指向 tileset 目录；或选本地目录直接加载
        </p>
      </div>
    </div>
  );
}

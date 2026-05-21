import { ArrowRight, Target } from 'lucide-react';
import { useUiStore } from '../store/ui';

/**
 * Orbit mission 有 tileset 但 orbit 未拾取时的主视图 CTA。
 * 紫色品牌色区分 facade 青色 CTA。
 */
export function OrbitStartCta() {
  const setPickerMode = useUiStore((s) => s.setPickerMode);

  return (
    <button
      type="button"
      onClick={() => setPickerMode('orbit-draw')}
      className="group absolute bottom-4 right-4 z-20 flex h-[72px] w-[260px] items-center gap-3 rounded-xl bg-[#ffd24a] px-4 text-left shadow-2xl shadow-[#ffd24a]/40 transition-transform hover:scale-[1.02]"
    >
      <Target className="h-6 w-6 shrink-0 text-bg" />
      <div className="flex-1">
        <div className="text-[14px] font-bold text-bg">+ 开始绘制环绕</div>
        <div className="text-[11px] font-medium text-bg/75">3 点定塔轴和半径</div>
      </div>
      <ArrowRight className="h-4 w-4 text-bg transition-transform group-hover:translate-x-1" />
    </button>
  );
}

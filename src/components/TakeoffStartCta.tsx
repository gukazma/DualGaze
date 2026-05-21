import { ArrowRight, Home } from 'lucide-react';
import { useUiStore } from '../store/ui';

/**
 * Facade / Orbit mission 加载了 tileset，但还没设 takeOffPoint 时的强制 CTA。
 *
 * 黄→橙渐变 + 必填语义 + 提示文案区分 Facade/Orbit 的常规 CTA。
 * 没设 takeoff，FacadeStartCta / OrbitStartCta 都不出现。
 */
export function TakeoffStartCta() {
  const setPickerMode = useUiStore((s) => s.setPickerMode);

  return (
    <button
      type="button"
      onClick={() => setPickerMode('takeoff-pick')}
      className="group absolute bottom-4 right-4 z-20 flex h-[72px] w-[280px] items-center gap-3 rounded-xl px-4 text-left shadow-2xl transition-transform hover:scale-[1.02]"
      style={{
        background: 'linear-gradient(135deg, #ffd24a 0%, #ff8b4a 100%)',
        boxShadow: '0 10px 30px -8px #ffd24a66',
      }}
    >
      <Home className="h-6 w-6 shrink-0 text-[#0c0d10]" />
      <div className="flex-1">
        <div className="text-[14px] font-bold text-[#0c0d10]">📍 先设置起飞点</div>
        <div className="text-[11px] font-medium text-[#0c0d10]/75">
          必填 · 决定相对高度基准
        </div>
      </div>
      <ArrowRight className="h-4 w-4 text-[#0c0d10] transition-transform group-hover:translate-x-1" />
    </button>
  );
}

import { useEffect } from 'react';
import { Home } from 'lucide-react';
import { useFlyHome } from '../features/cesium/useFlyToMission';

/**
 * 右上角 Home 按钮 —— 飞到当前 mission 的最优视角（facade 取 active face 包围球；
 * mapping 取 polygon；patrol 取 waypoints；空就回 location.recent / 北京默认）。
 *
 * 同时绑 Space 快捷键（避开 input/textarea/contenteditable 焦点场景）。
 *
 * 位置：right-4 top-14（避开 ViewToggle 在 top-4 的位置），单独一行不挤。
 */
export function HomeButton() {
  const flyHome = useFlyHome();

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.code !== 'Space') return;
      // 用户正在输入框 / textarea / contenteditable 里打字 → 让 Space 走默认（空格字符）
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        if (t.isContentEditable) return;
      }
      e.preventDefault();
      flyHome();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flyHome]);

  return (
    <button
      type="button"
      onClick={flyHome}
      title="回到最优视角（Space）"
      className="absolute right-4 top-14 z-20 flex h-8 w-8 items-center justify-center rounded-md border border-border bg-bg-surface text-text-secondary shadow-lg transition hover:border-accent hover:text-accent"
    >
      <Home className="h-3.5 w-3.5" />
    </button>
  );
}

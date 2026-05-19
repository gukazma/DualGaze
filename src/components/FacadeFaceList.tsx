import { useState } from 'react';
import { Plus, Trash2, Eye, EyeOff, Pencil, Plane } from 'lucide-react';
import { ScrollArea } from './ui/scroll-area';
import { Input } from './ui/input';
import { useCurrentMission, useMissionsStore } from '../store/missions';
import { useUiStore } from '../store/ui';
import { faceCssColor } from '../lib/face-color';
import { cn } from '../lib/utils';

/**
 * 立面（faces）列表。Right Sheet 的 facade 模式 Tab 1。
 *
 * - 每行一个 face：色块 + name（双击改）+ waypoint 数 + enabled switch + 删除按钮
 * - 顶部 "+ 新建立面" 按钮 → 切 pickerMode='facade-draw' 进入 4 角拾取流程
 * - 当处于 picker 模式时，按钮变成 "✓ 完成新建（Esc 退出）" 切回 idle
 */
export function FacadeFaceList() {
  const mission = useCurrentMission();
  const updateFacadeFace = useMissionsStore((s) => s.updateFacadeFace);
  const removeFacadeFace = useMissionsStore((s) => s.removeFacadeFace);
  const setActiveFaceId = useMissionsStore((s) => s.setActiveFaceId);
  const setTilesetSource = useMissionsStore((s) => s.setTilesetSource);
  const pickerMode = useUiStore((s) => s.pickerMode);
  const setPickerMode = useUiStore((s) => s.setPickerMode);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  if (!mission || mission.type !== 'facade') return null;
  const faces = mission.facadeFaces ?? [];
  const hasTileset = !!mission.tilesetSource;
  const activeId = mission.activeFaceId ?? null;

  const commitFacadePreviewIfAny = useMissionsStore((s) => s.commitFacadePreviewIfAny);
  const startNew = (): void => {
    if (!hasTileset) return;
    setPickerMode('facade-draw');
  };
  const finishPicker = (): void => {
    // 若当前 picker 在 preview 状态，先保存 preview 再退出；否则直接退出
    commitFacadePreviewIfAny();
    setPickerMode('idle');
  };

  const commitName = (faceId: string): void => {
    const name = editName.trim();
    if (name) updateFacadeFace(faceId, { name });
    setEditingId(null);
  };

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-1.5 p-3">
          {faces.length === 0 ? (
            <div className="rounded-md border border-dashed border-border-subtle p-4 text-center text-[11px] text-text-muted">
              还没有立面 ·{' '}
              {hasTileset
                ? '点主视图右下角浮动按钮 "+ 开始绘制立面" 开始'
                : '请在主视图中央卡片选择 3D Tiles 数据源'}
            </div>
          ) : (
            faces.map((f, idx) => {
              const hue = faceCssColor(idx);
              const isEditing = editingId === f.id;
              const isActive = activeId === f.id;
              return (
                <div
                  key={f.id}
                  onClick={() => {
                    if (!isEditing) setActiveFaceId(f.id);
                  }}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-md border p-2 transition-colors',
                    isActive
                      ? 'border-accent bg-accent/10 ring-1 ring-accent/40'
                      : 'border-border bg-bg-input hover:border-border-subtle hover:bg-bg-panel',
                    !f.enabled && 'opacity-50',
                  )}
                >
                  <span
                    className="h-6 w-1.5 shrink-0 rounded-sm"
                    style={{ backgroundColor: hue }}
                  />
                  <div className="flex flex-1 flex-col gap-0.5 overflow-hidden">
                    {isEditing ? (
                      <Input
                        autoFocus
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onBlur={() => commitName(f.id)}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitName(f.id);
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        className="h-6 text-[12px]"
                      />
                    ) : (
                      <button
                        type="button"
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          setEditingId(f.id);
                          setEditName(f.name);
                        }}
                        className="flex items-center gap-1.5 truncate text-left text-[12px] font-semibold text-text-primary hover:text-accent"
                        title="双击改名 · 单击选中为当前架次"
                      >
                        <span
                          className="rounded-sm bg-bg-surface px-1 py-0.5 font-mono text-[9px] text-text-muted"
                          title="DJI Pilot 2 中作为单独架次（wayline）执行"
                        >
                          架次 {idx + 1}
                        </span>
                        <span className="truncate">{f.name}</span>
                        {isActive && <Plane className="h-3 w-3 shrink-0 text-accent" />}
                      </button>
                    )}
                    <span className="truncate text-[10px] text-text-muted">
                      {f.scanPath?.length ?? 0} 航点 · standoff {f.params.standoff}m · {f.params.spacingH}×{f.params.spacingV}m
                    </span>
                    {(() => {
                      const unsafe = f.scanPath?.filter((wp) => wp.unsafe).length ?? 0;
                      return unsafe > 0 ? (
                        <span className="truncate text-[10px] font-semibold text-accent-danger">
                          ⚠ {unsafe} 不安全
                        </span>
                      ) : null;
                    })()}
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      updateFacadeFace(f.id, { enabled: !f.enabled });
                    }}
                    className="text-text-secondary hover:text-accent"
                    title={f.enabled ? '关闭此立面' : '启用此立面'}
                  >
                    {f.enabled ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingId(f.id);
                      setEditName(f.name);
                    }}
                    className="text-text-secondary hover:text-accent"
                    title="改名"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm(`删除立面 "${f.name}"？`)) removeFacadeFace(f.id);
                    }}
                    className="text-text-secondary hover:text-accent-danger"
                    title="删除立面"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>

      <div className="border-t border-border-subtle p-2.5">
        {!hasTileset ? (
          <button
            type="button"
            disabled
            className="flex h-8 w-full cursor-not-allowed items-center justify-center gap-1.5 rounded-md border border-border-subtle bg-bg-input text-[12px] text-text-muted opacity-60"
            title="请先在 任务配置 添加 tileset 数据源"
          >
            <Plus className="h-3.5 w-3.5" />
            新建立面（需先加载 tileset）
          </button>
        ) : pickerMode === 'facade-draw' ? (
          <button
            type="button"
            onClick={finishPicker}
            className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-accent bg-accent/10 text-[12px] font-semibold text-accent hover:bg-accent/20"
          >
            ✓ 完成新建立面
          </button>
        ) : (
          <button
            type="button"
            onClick={startNew}
            className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-border bg-bg-input text-[12px] font-semibold text-text-primary hover:bg-bg-panel hover:text-accent"
          >
            <Plus className="h-3.5 w-3.5" />
            新建立面
          </button>
        )}
        {/* localDir session 失效时给个清除入口 */}
        {mission.tilesetSource?.kind === 'localDir' &&
          mission.tilesetSource.sessionId &&
          typeof window !== 'undefined' &&
          !window.__tilesetSessions?.[mission.tilesetSource.sessionId] && (
            <button
              type="button"
              onClick={() => setTilesetSource(undefined)}
              className="mt-1.5 flex h-7 w-full items-center justify-center text-[10px] text-text-muted hover:text-text-primary"
            >
              清除失效的 tileset 引用
            </button>
          )}
      </div>
    </div>
  );
}

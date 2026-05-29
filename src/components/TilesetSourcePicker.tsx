import { useRef, useState } from 'react';
import { CheckCircle2, AlertCircle, Loader2, FolderOpen } from 'lucide-react';
import { useCurrentMission, useMissionsStore } from '../store/missions';
import { probeTilesetUrl } from '../lib/tileset-source';
import { prepareLocalDirSession } from '../lib/tileset-loader-dir';
import { cn } from '../lib/utils';

type ProbeState =
  | { kind: 'idle' }
  | { kind: 'probing' }
  | { kind: 'ok' }
  | { kind: 'err'; msg: string };

type Variant = 'panel' | 'card';

/**
 * Facade mission 的 Tileset 数据源选择面板。
 *
 * - **URL Tab**：HTTP URL → 点 "测试连通" 探测 tileset.json → 通过则 setTilesetSource
 * - **本地目录 Tab**：`<input webkitdirectory>` 选目录 → 内存 session
 *
 * 两种 variant：
 * - `panel`（默认）：MissionConfigPanel 内放完整版（带"Tileset 数据源"标题 + 状态 chip）
 * - `card`：FacadeEmptyGuide 嵌入用紧凑版（无标题/无状态 chip，外层卡片已自带标题）
 */
export function TilesetSourcePicker({ variant = 'panel' }: { variant?: Variant } = {}) {
  const mission = useCurrentMission();
  const setTilesetSource = useMissionsStore((s) => s.setTilesetSource);
  const initialTab: 'http' | 'localDir' =
    mission?.tilesetSource?.kind === 'localDir' ? 'localDir' : 'http';
  const [tab, setTab] = useState<'http' | 'localDir'>(initialTab);
  const [url, setUrl] = useState(
    mission?.tilesetSource?.kind === 'http' ? mission.tilesetSource.url ?? '' : '',
  );
  const [probe, setProbe] = useState<ProbeState>(
    mission?.tilesetSource?.kind === 'http' ? { kind: 'ok' } : { kind: 'idle' },
  );
  const dirInputRef = useRef<HTMLInputElement>(null);

  // facade + orbit + ov 都需要 tileset
  if (
    !mission ||
    (mission.type !== 'facade' && mission.type !== 'orbit' && mission.type !== 'ov')
  )
    return null;

  const doProbe = async (): Promise<void> => {
    if (!url.trim()) {
      setProbe({ kind: 'err', msg: '请先输入 URL' });
      return;
    }
    setProbe({ kind: 'probing' });
    const res = await probeTilesetUrl(url.trim());
    if (res.ok) {
      setProbe({ kind: 'ok' });
      setTilesetSource({ kind: 'http', url: url.trim() });
    } else {
      setProbe({ kind: 'err', msg: res.error ?? '未知错误' });
    }
  };

  const onPickDir = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const info = prepareLocalDirSession(files);
    if (!info) {
      setProbe({ kind: 'err', msg: '目录中未找到 tileset.json' });
      return;
    }
    setTilesetSource({
      kind: 'localDir',
      sessionId: info.sessionId,
      rootFile: info.rootFile,
      fileCount: info.fileCount,
    });
    setProbe({ kind: 'ok' });
  };

  const isLocalDirSourced = mission.tilesetSource?.kind === 'localDir';
  const localFileCount =
    mission.tilesetSource?.kind === 'localDir' ? mission.tilesetSource.fileCount : undefined;
  const localRootFile =
    mission.tilesetSource?.kind === 'localDir' ? mission.tilesetSource.rootFile : undefined;
  // 持久化后 sessionId 仍在但 window.__tilesetSessions 已丢失：判断是否需要重选
  const localSessionStale =
    isLocalDirSourced &&
    mission.tilesetSource?.sessionId &&
    !(
      typeof window !== 'undefined' &&
      window.__tilesetSessions?.[mission.tilesetSource.sessionId]
    );

  const isCard = variant === 'card';

  return (
    <section className={cn(!isCard && 'rounded-lg border border-border bg-[#131720] p-3.5')}>
      {!isCard && (
        <div className="mb-2.5 flex items-center justify-between">
          <span className="text-[11px] font-bold">Tileset 数据源</span>
          {probe.kind === 'ok' && (
            <span className="flex items-center gap-1 rounded-md bg-[#0a2b3c] px-2 py-0.5 text-[10px] font-semibold text-accent-cyan">
              <CheckCircle2 className="h-3 w-3" /> 已连通
            </span>
          )}
          {probe.kind === 'probing' && (
            <span className="flex items-center gap-1 rounded-md bg-bg-input px-2 py-0.5 text-[10px] font-semibold text-text-secondary">
              <Loader2 className="h-3 w-3 animate-spin" /> 测试中
            </span>
          )}
          {probe.kind === 'err' && (
            <span className="flex items-center gap-1 rounded-md bg-[#2d1a1a] px-2 py-0.5 text-[10px] font-semibold text-accent-danger">
              <AlertCircle className="h-3 w-3" /> 失败
            </span>
          )}
        </div>
      )}

      <div className="mb-2.5 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setTab('http')}
          className={cn(
            'rounded-sm border px-2 py-1 text-[11px] font-semibold',
            tab === 'http'
              ? 'border-accent bg-bg-input text-accent'
              : 'border-border-subtle bg-bg-input text-text-secondary hover:text-text-primary',
          )}
        >
          URL
        </button>
        <button
          type="button"
          onClick={() => setTab('localDir')}
          className={cn(
            'rounded-sm border px-2 py-1 text-[11px] font-semibold',
            tab === 'localDir'
              ? 'border-accent bg-bg-input text-accent'
              : 'border-border-subtle bg-bg-input text-text-secondary hover:text-text-primary',
          )}
        >
          本地目录
        </button>
      </div>

      {tab === 'http' && (
        <>
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setProbe({ kind: 'idle' });
              }}
              placeholder="http://localhost:8000/Data/tileset.json"
              className="h-7 flex-1 rounded-sm border border-border bg-bg-input px-2 text-[11px] text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
            />
            <button
              type="button"
              onClick={doProbe}
              disabled={probe.kind === 'probing'}
              className="h-7 rounded-sm border border-border bg-bg-input px-2.5 text-[11px] font-semibold text-text-primary hover:bg-bg-panel disabled:opacity-50"
            >
              测试连通
            </button>
          </div>
          {probe.kind === 'err' && (
            <div className="mt-2 text-[10px] text-accent-danger">{probe.msg}</div>
          )}
          {probe.kind === 'ok' && mission.tilesetSource?.kind === 'http' && (
            <div className="mt-2 text-[10px] text-text-muted">● tileset.json · 已加载</div>
          )}
        </>
      )}

      {tab === 'localDir' && (
        <>
          <input
            ref={dirInputRef}
            type="file"
            multiple
            // webkitdirectory 不是 React 标准属性，要 cast
            {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
            onChange={onPickDir}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => dirInputRef.current?.click()}
            className="flex h-7 w-full items-center justify-center gap-1.5 rounded-sm border border-border bg-bg-input px-2.5 text-[11px] font-semibold text-text-primary hover:bg-bg-panel"
          >
            <FolderOpen className="h-3 w-3" />
            选择 tileset 目录
          </button>
          {isLocalDirSourced && !localSessionStale && (
            <div className="mt-2 text-[10px] text-text-muted">
              ● {localRootFile} · {localFileCount} 个文件
            </div>
          )}
          {isLocalDirSourced && localSessionStale && (
            <div className="mt-2 text-[10px] text-accent-danger">
              ⚠ 上次的目录 session 已失效（刷新后丢失），请重新选择目录
            </div>
          )}
          {probe.kind === 'err' && (
            <div className="mt-2 text-[10px] text-accent-danger">{probe.msg}</div>
          )}
        </>
      )}
    </section>
  );
}

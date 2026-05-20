import { useEffect, useRef } from 'react';
import * as Cesium from 'cesium';
import { toast } from 'sonner';
import { useCesiumViewer } from '../cesium/CesiumContext';
import { useCurrentMission, useMissionsStore } from '../../store/missions';
import { useTilesetLoadingStore } from '../../store/tileset-loading';
import {
  ERR_LOCAL_DIR_SESSION_LOST,
  loadTileset,
  unloadTileset,
} from '../../lib/tileset-source';
import type { TilesetSource } from '../../types/mission';

/**
 * 监听 currentMission.tilesetSource 变化时加载 / 卸载 3DTileset。
 *
 * - 只在 mission.type === 'facade' 时挂载有效
 * - source 变化（新 URL 或新 session）→ 卸载旧 tileset，加载新的
 * - source 变 undefined / null → 仅卸载
 * - 组件 unmount 时卸载（避免泄露 primitive）
 *
 * loading 状态广播到 `useTilesetLoadingStore`，供 FacadeLoadingOverlay / TilesetChip 订阅。
 * 出错时弹 sonner toast。
 */
export function TilesetLoaderHost() {
  const viewer = useCesiumViewer();
  const mission = useCurrentMission();
  const setTilesetSource = useMissionsStore((s) => s.setTilesetSource);
  const tilesetRef = useRef<Cesium.Cesium3DTileset | null>(null);
  const setLoading = useTilesetLoadingStore((s) => s.setLoading);
  const setLoaded = useTilesetLoadingStore((s) => s.setLoaded);
  const setError = useTilesetLoadingStore((s) => s.setError);
  const reset = useTilesetLoadingStore((s) => s.reset);

  // facade + orbit 都需要 tileset
  const source: TilesetSource | undefined =
    mission?.type === 'facade' || mission?.type === 'orbit'
      ? mission.tilesetSource
      : undefined;

  // 用 source 的 (kind + url + sessionId) 作为变化 key
  const sourceKey = source
    ? `${source.kind}::${source.url ?? ''}::${source.sessionId ?? ''}`
    : '';

  useEffect(() => {
    if (!viewer) return;
    let cancelled = false;

    // 先卸载旧 tileset
    if (tilesetRef.current) {
      unloadTileset(viewer, tilesetRef.current);
      tilesetRef.current = null;
    }

    if (!source) {
      reset();
      return;
    }

    setLoading();
    loadTileset(viewer, source)
      .then((tileset) => {
        if (cancelled) {
          unloadTileset(viewer, tileset);
          return;
        }
        tilesetRef.current = tileset;
        const label =
          source.kind === 'http'
            ? source.url?.split('/').pop() ?? 'tileset.json'
            : source.rootFile ?? 'tileset.json';
        setLoaded({ label, fileCount: source.fileCount });
        toast.success('3DTileset 加载完成');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const code = (err as { code?: string })?.code;
        const msg = err instanceof Error ? err.message : String(err);
        // localDir session 失效（多半是刷新页面后内存丢了）：
        //   1. 主动清空 mission.tilesetSource 让 FacadeEmptyGuide 重新出现，提示用户重选目录
        //   2. 给一个解释性 toast（不重复弹 "加载失败"）
        if (code === ERR_LOCAL_DIR_SESSION_LOST) {
          setTilesetSource(undefined);
          reset();
          toast.warning('请重新选择本地目录', {
            description: '页面刷新会丢失内存中的目录句柄，需要重新选',
            duration: 6000,
          });
          return;
        }
        setError(msg);
        toast.error('3DTileset 加载失败', { description: msg });
      });

    return () => {
      cancelled = true;
      if (tilesetRef.current && viewer) {
        unloadTileset(viewer, tilesetRef.current);
        tilesetRef.current = null;
      }
    };
  }, [viewer, sourceKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

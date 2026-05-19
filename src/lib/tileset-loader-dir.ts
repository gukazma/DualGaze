/**
 * 把 `<input webkitdirectory>` 选到的 File[] 整理成内存 session，供 Cesium Resource
 * 拦截相对路径请求时反查文件。
 *
 * 设计：
 *   - 每次调 `prepareLocalDirSession(files)` 生成新的 sessionId
 *   - 文件以 `webkitRelativePath` 去掉根目录前缀后作为 key 存 Map
 *   - 全局挂 `window.__tilesetSessions[sessionId]: Map<key, File>`，方便 Cesium Resource
 *     拦截器查 key
 *   - rootFile 自动识别：搜路径最短的 `tileset.json`（典型 ContextCapture 输出
 *     `Data/tileset.json` 是顶层那个）
 *
 * sessionId 不持久化（页面刷新失效），用户重新打开 mission 时 picker 会提示重选目录。
 */

declare global {
  interface Window {
    __tilesetSessions?: Record<string, Map<string, File>>;
  }
}

let _seq = 0;
function newSessionId(): string {
  return `tsess_${Date.now().toString(36)}_${(++_seq).toString(36)}`;
}

export interface LocalDirSessionInfo {
  sessionId: string;
  /** 相对于选定根目录的 'tileset.json' 路径，如 'Data/tileset.json' 或 'tileset.json' */
  rootFile: string;
  fileCount: number;
}

/**
 * 准备一个本地目录 session。
 *
 * 输入 files 来自 `<input webkitdirectory>` 的 FileList；每个 File 有 `webkitRelativePath`
 * 形如 `RC_01_P03_CESIUM/Data/tileset.json`（首段是用户选的目录名）。
 *
 * 我们以 **首段后** 的相对路径作为 key（即 `Data/tileset.json`），方便后续 Cesium 请求
 * `tileset.json` 时同样去掉前缀做匹配。
 */
export function prepareLocalDirSession(files: FileList | File[]): LocalDirSessionInfo | null {
  const arr = Array.from(files);
  if (arr.length === 0) return null;

  // 找首段路径（所有文件共用一个根目录名）
  const firstRel = arr[0].webkitRelativePath;
  if (!firstRel) return null;
  const slashIdx = firstRel.indexOf('/');
  const rootDir = slashIdx >= 0 ? firstRel.substring(0, slashIdx) : firstRel;

  const map = new Map<string, File>();
  let rootFile: string | null = null;
  let rootFileDepth = Infinity;
  for (const f of arr) {
    const rel = f.webkitRelativePath;
    if (!rel) continue;
    // 剥掉首段（用户选的根目录），剩下作为 key
    const key = rel.startsWith(`${rootDir}/`) ? rel.substring(rootDir.length + 1) : rel;
    map.set(key, f);
    // 找 tileset.json 中路径最浅的那个（大小写不敏感 — Windows 上常见 tileset.JSON）
    if (key.toLowerCase().endsWith('tileset.json')) {
      const depth = (key.match(/\//g) ?? []).length;
      if (depth < rootFileDepth) {
        rootFileDepth = depth;
        rootFile = key;
      }
    }
  }
  if (!rootFile) return null;

  const sessionId = newSessionId();
  if (typeof window !== 'undefined') {
    if (!window.__tilesetSessions) window.__tilesetSessions = {};
    window.__tilesetSessions[sessionId] = map;
  }
  return { sessionId, rootFile, fileCount: map.size };
}

/**
 * 释放 session（撤销 ObjectURL 是浏览器自动的，但 Map 留着会泄露内存）。
 */
export function releaseLocalDirSession(sessionId: string): void {
  if (typeof window === 'undefined' || !window.__tilesetSessions) return;
  delete window.__tilesetSessions[sessionId];
}

/**
 * 判断一个 sessionId 是否还在内存中。
 *
 * 用途：刷新页面后 localStorage 里持久化的 mission.tilesetSource.sessionId 引用
 * 仍在，但内存 Map 已丢失（session 不跨页面生命周期）。此时 TilesetLoaderHost 应
 * 提前检出，弹明确的 "请重新选择目录" 而不是裸跑 loadTileset 收一个让人困惑的
 * "加载失败"。
 */
export function hasLocalDirSession(sessionId: string): boolean {
  if (typeof window === 'undefined' || !window.__tilesetSessions) return false;
  return !!window.__tilesetSessions[sessionId];
}

/**
 * 从 session 取 File；找不到返回 null。relPath 是相对于 rootDir 的路径
 * （已经剥掉根目录前缀）。
 *
 * 先精确匹配；找不到时大小写不敏感 fallback —— Windows 上常见 tileset.JSON 大写，
 * 或 Cesium normalize 路径变成小写时仍能命中。
 */
export function getSessionFile(sessionId: string, relPath: string): File | null {
  if (typeof window === 'undefined' || !window.__tilesetSessions) return null;
  const map = window.__tilesetSessions[sessionId];
  if (!map) return null;
  const exact = map.get(relPath);
  if (exact) return exact;
  const lower = relPath.toLowerCase();
  for (const [k, v] of map) {
    if (k.toLowerCase() === lower) return v;
  }
  return null;
}

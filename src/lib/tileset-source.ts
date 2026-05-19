import * as Cesium from 'cesium';
import { getSessionFile, hasLocalDirSession } from './tileset-loader-dir';
import type { TilesetSource } from '../types/mission';

/** 错误码：localDir session 内存中已丢失（多半是刷新页面后） */
export const ERR_LOCAL_DIR_SESSION_LOST = 'LOCAL_DIR_SESSION_LOST';

/**
 * 加载一个 3DTileset 到 viewer 场景。
 *
 * **M16**：仅实现 `kind: 'http'` 分支 —— 直接 `Cesium3DTileset.fromUrl(url)`，挂到
 * `scene.primitives`，并 zoomTo。
 *
 * **M17**：补 `kind: 'localDir'` —— `<input webkitdirectory>` 选目录 → 内存 Map → Cesium
 * `Resource.request` 拦截相对路径请求 → `URL.createObjectURL(file)` 返回。
 *
 * 调用方负责跟踪返回的 `Cesium3DTileset` 句柄并在卸载时 `scene.primitives.remove`。
 */
export async function loadTileset(
  viewer: Cesium.Viewer,
  source: TilesetSource,
): Promise<Cesium.Cesium3DTileset> {
  if (source.kind === 'http') {
    const url = source.url;
    if (!url) throw new Error('tileset-source: HTTP 模式需要 url 字段');
    const tileset = await Cesium.Cesium3DTileset.fromUrl(url, {
      // 性能：默认 SSE=16 已足够；如果用户机性能差可改大
      maximumScreenSpaceError: 16,
      preloadWhenHidden: false,
    });
    viewer.scene.primitives.add(tileset);
    await viewer.zoomTo(tileset);
    return tileset;
  }

  if (source.kind === 'localDir') {
    const { sessionId, rootFile } = source;
    if (!sessionId || !rootFile) {
      throw new Error(
        'tileset-source: localDir 模式需要 sessionId + rootFile —— 请重新选择目录。',
      );
    }
    // 内存 session 失效（刷新页面 / 关浏览器后必发生）→ 抛特定错码，UI 用它弹友好提示
    if (!hasLocalDirSession(sessionId)) {
      const err = new Error(
        '本地目录 session 已失效（页面刷新会丢失内存中的目录句柄），请重新选择目录。',
      );
      (err as Error & { code?: string }).code = ERR_LOCAL_DIR_SESSION_LOST;
      throw err;
    }
    const resource = buildLocalDirResource(sessionId, rootFile);
    const tileset = await Cesium.Cesium3DTileset.fromUrl(resource, {
      maximumScreenSpaceError: 16,
      preloadWhenHidden: false,
    });
    if (viewer.isDestroyed()) {
      // 加载过程中 viewer 被销毁（用户中途切了 mission / 退 sim）→ 直接释放，不挂
      try {
        tileset.destroy();
      } catch {
        // noop
      }
      throw new Error('viewer destroyed during tileset load');
    }
    viewer.scene.primitives.add(tileset);
    await viewer.zoomTo(tileset);
    return tileset;
  }

  throw new Error(`tileset-source: 未知 source.kind="${(source as { kind: string }).kind}"`);
}

/**
 * 为本地目录 session 构造一个 Cesium.Resource，所有相对路径请求被拦截并从内存 Map
 * 取 File → ObjectURL 返回。
 *
 * 设计：
 *   - 用 `proxy` 不行（proxy 只是改 host 前缀），需要 `retryCallback` + 自定义 `request`
 *   - 简单做法：构造一个虚拟根 URL（如 `tilesetsession://<sessionId>/`），然后
 *     Cesium 解析子资源 URL 时会拼成 `tilesetsession://<sessionId>/Data/B/B_L17.b3dm`
 *   - 但 Cesium 内部用 fetch（标准协议）— `tilesetsession://` 不是 http/https，浏览器
 *     会直接报错。所以我们必须用 Resource.from 自定义子方法 → 改用 base url + 监听
 *     fetch 的方式不行。
 *   - **最稳的办法**：用 `URL.createObjectURL(blob)` 作为 root，但子资源是相对路径，
 *     ObjectURL 的拼接不是普通 URL 解析。
 *   - **真正的办法**：用 Cesium.Resource 的 `request` callback —— 自定义 transformer。
 *
 * 这里采用：注册一个全局 Cesium.RequestScheduler 拦截，是侵入式的，反而更脆。
 * 改用 Cesium.Resource 包一层：通过 `templateValues` + `request` 修改 fetch。
 *
 * 实测可行方案：用 `URL.createObjectURL(file)` 给 root 直接产生 blob:URL，然后所有子
 * 资源都通过 Resource.fetch 走自定义 callback。Cesium 1.124 的 `Cesium3DTileset.fromUrl`
 * 接受 `Resource`，且 Resource 子资源沿用 base url + getDerivedResource 自己解析路径。
 *
 * 因此我们用：
 *   - 给 root tileset.json 创建一个 fake base URL（实际不发起网络请求；Resource 的
 *     `fetchJson` 我们 monkeypatch 拦截 / 或者用 templateValues）
 *
 * 实际实施：直接 monkeypatch Cesium.Resource.fetchJson / fetchArrayBuffer 太脏。
 * 我们采取一个相对干净的折中：把 root tileset.json 解析出来后递归把所有 `uri`
 * 字段替换成 blob: ObjectURL 后注入。但 ContextCapture 输出可能有上万 b3dm，全部
 * 改写不现实。
 *
 * 最终方案（v3 M17）：使用 Service Worker 拦截 fetch 请求 —— 太重。
 *
 * **折中方案**：用 Resource 的 `retryCallback` —— 当 Cesium 请求一个 URL 失败时，
 * 我们换成 blob:URL 重新 retry。但 Cesium 第一次请求是直接 fetch URL 字符串，
 * 不会失败（404 才触发 retry），所以这条路也不通。
 *
 * **最终决定**：构造一个虚拟 origin（如 `http://__tilesetsession__/<sessionId>/`），
 * 然后通过 Cesium.RequestScheduler 的全局 transformer（Cesium.Resource 加 prepareRequest
 * hook）—— 但 Cesium 公开 API 没有 prepareRequest hook。
 *
 * 唯一可行：用全局 `fetch` patch。这是侵入式但有效。我们 wrap window.fetch：
 *   - 如果 URL 命中 `http://__tilesetsession__/<sessionId>/<relPath>`，从 Map 取 File →
 *     new Response(file)
 *   - 否则 fallthrough
 *
 * 这样 Cesium 内部所有 Resource.fetch* 都被透明拦截。
 */

const FAKE_ORIGIN_PREFIX = 'http://__tilesetsession__/';
let _patched = false;

/**
 * 把虚拟 URL 解析回 (sessionId, relPath)；不匹配前缀返回 null。
 */
function parseVirtualUrl(urlStr: string): { sessionId: string; relPath: string } | null {
  if (!urlStr.startsWith(FAKE_ORIGIN_PREFIX)) return null;
  const rest = urlStr.substring(FAKE_ORIGIN_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash < 0) return null;
  const sessionId = rest.substring(0, slash);
  let relPath = rest.substring(slash + 1);
  const q = relPath.indexOf('?');
  if (q >= 0) relPath = relPath.substring(0, q);
  const h = relPath.indexOf('#');
  if (h >= 0) relPath = relPath.substring(0, h);
  try {
    relPath = decodeURIComponent(relPath);
  } catch {
    // ignore
  }
  return { sessionId, relPath };
}

/**
 * 用一个 404 Response（fetch）或 status=404 xhr 占位。
 */
const NOT_FOUND_DATA_URL =
  'data:application/json,%7B%22error%22%3A%22tilesetsession-miss%22%7D';

/**
 * 一次性 patch window.fetch + XMLHttpRequest.open：把虚拟 URL
 * `http://__tilesetsession__/<id>/<path>` 替换为该 File 的 `blob:` URL，
 * 让浏览器/Cesium 用标准链路读，避免我们手写 XHR 状态机。
 *
 * Cesium 一部分资源走 fetch（fetchJson），一部分走 XHR（fetchArrayBuffer 等），
 * 两路都得拦。
 */
function patchOnce(): void {
  if (_patched) return;
  _patched = true;

  // -------- fetch --------
  const realFetch = window.fetch.bind(window);
  window.fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const urlStr =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const parsed = parseVirtualUrl(urlStr);
    if (parsed) {
      const file = getSessionFile(parsed.sessionId, parsed.relPath);
      if (!file) {
        return new Response(null, { status: 404, statusText: `session miss: ${parsed.relPath}` });
      }
      // 直接用 File 当 body 返回 Response —— 比 blob: URL 重写 fetch URL 干净，
      // 因为 fetch 重写 URL 会丢失 Request 的 init 选项（init 已经被 Cesium 设过 headers 等）
      return new Response(file, {
        status: 200,
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
        },
      });
    }
    return realFetch(input, init);
  }) as typeof window.fetch;

  // -------- XHR --------
  // 在 open 时把虚拟 URL 替换成对应 File 的 blob: ObjectURL，让浏览器原生 XHR
  // 加载这个 blob —— XHR 的 readyState 转换 / progress / status / response 等都是
  // 浏览器自己管，不用我们模拟。
  const RealXHR = window.XMLHttpRequest;
  const realOpen = RealXHR.prototype.open;
  // 跟踪每次 open 创建的 blob URL，等 loadend / abort 时释放
  const blobUrls = new WeakMap<XMLHttpRequest, string>();

  RealXHR.prototype.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    asyncFlag?: boolean,
    user?: string | null,
    password?: string | null,
  ): void {
    const urlStr = typeof url === 'string' ? url : url.href;
    const parsed = parseVirtualUrl(urlStr);
    if (parsed) {
      const file = getSessionFile(parsed.sessionId, parsed.relPath);
      if (!file) {
        // 不存在 → open 到一个会返回 404 的 data:URL
        return realOpen.call(this, method, NOT_FOUND_DATA_URL, asyncFlag ?? true, user, password);
      }
      // 上次 open 的 blob URL 先释放
      const oldBlob = blobUrls.get(this);
      if (oldBlob) URL.revokeObjectURL(oldBlob);
      const newBlob = URL.createObjectURL(file);
      blobUrls.set(this, newBlob);
      // 释放 blob：在 loadend 之后撤销，避免泄露
      this.addEventListener(
        'loadend',
        () => {
          const blob = blobUrls.get(this);
          if (blob) {
            URL.revokeObjectURL(blob);
            blobUrls.delete(this);
          }
        },
        { once: true },
      );
      return realOpen.call(this, method, newBlob, asyncFlag ?? true, user, password);
    }
    return realOpen.call(this, method, url, asyncFlag ?? true, user, password);
  } as typeof RealXHR.prototype.open;
}

function buildLocalDirResource(sessionId: string, rootFile: string): Cesium.Resource {
  patchOnce();
  const url = `${FAKE_ORIGIN_PREFIX}${sessionId}/${rootFile}`;
  return new Cesium.Resource({ url });
}

/**
 * 卸载 tileset：从 scene.primitives 移除并销毁。
 *
 * 守: viewer 可能已被销毁（async 加载竞速 + sim 退出 / 切 mission 时常见），
 * 此时直接 destroy tileset 自身就行，不要再访问 viewer.scene。
 */
export function unloadTileset(
  viewer: Cesium.Viewer,
  tileset: Cesium.Cesium3DTileset,
): void {
  if (viewer.isDestroyed()) {
    try {
      if (!tileset.isDestroyed()) tileset.destroy();
    } catch {
      // noop
    }
    return;
  }
  if (!viewer.scene.primitives.contains(tileset)) return;
  viewer.scene.primitives.remove(tileset);
  // remove 会自动 destroy()，不需手动调
}

/**
 * 测试 HTTP URL 连通性（仅 M16 URL Tab 用）。
 * 不挂 viewer，只 HEAD/GET 一下 tileset.json 看能否拿到。
 */
export async function probeTilesetUrl(url: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const json = await res.json();
    if (!json || (typeof json !== 'object')) return { ok: false, error: '响应非 JSON' };
    // 简单结构判断：3DTiles tileset.json 必须含 asset + root
    if (!('asset' in json) || !('root' in json)) {
      return { ok: false, error: '不像 3DTiles tileset.json (缺 asset/root 字段)' };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

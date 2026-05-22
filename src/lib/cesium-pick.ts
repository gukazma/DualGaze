import * as Cesium from 'cesium';
import { cartesian3ToWgs84 } from './coord';

/**
 * 屏幕坐标 → WGS84 (lon/lat/alt)。
 *
 * 优先用 `scene.pickFromRay` 拾取 ray-hit（含 3DTileset / globe）；如果场景没有 tileset 且 globe 关闭，
 * 才 fallback 到 `globe.pick`（不包含 tileset 命中）。
 *
 * 此函数是 v3 FacadePicker 和 v1 WaypointPicker 共用。提前抽出来避免重复。
 *
 * `skipEntityNamePrefix`：用 `drillPickFromRay` 跳过 entity.name 以此为前缀的命中
 *   （让 picker 自己画的 axis 线、markers 不挡 raycast 取塔身/地面）。
 *
 * 返回 WGS84（已通过 `cartesian3ToWgs84` 完成 GCJ-02 反向修正 if applicable）。
 */
export function pickWgs84At(
  viewer: Cesium.Viewer,
  screenPos: Cesium.Cartesian2,
  skipEntityNamePrefix?: string,
): { lon: number; lat: number; alt: number } | null {
  const ray = viewer.camera.getPickRay(screenPos);
  if (!ray) return null;

  // pickFromRay / drillPickFromRay 在 Cesium 1.124 的 .d.ts 里覆盖不完整，做局部 cast
  const sceneAny = viewer.scene as unknown as {
    pickFromRay: (
      ray: Cesium.Ray,
      exclude?: object[],
    ) => { position?: Cesium.Cartesian3; object?: { id?: { name?: string } } } | undefined;
    drillPickFromRay: (
      ray: Cesium.Ray,
      limit?: number,
      exclude?: object[],
    ) => Array<{ position?: Cesium.Cartesian3; object?: { id?: { name?: string } } }>;
  };

  if (skipEntityNamePrefix && sceneAny.drillPickFromRay) {
    // drill through 多个 hits，跳过 entity.name 匹配前缀的（picker 自身可视）
    const results = sceneAny.drillPickFromRay(ray, 10);
    for (const r of results) {
      const entityName = r.object?.id?.name;
      if (entityName && entityName.startsWith(skipEntityNamePrefix)) continue;
      const cart = r.position;
      if (cart && Number.isFinite(cart.x)) {
        return cartesian3ToWgs84(cart);
      }
    }
    // fallback：射线打 globe
    const cartesianGlobe = viewer.scene.globe.pick(ray, viewer.scene);
    if (cartesianGlobe && Number.isFinite(cartesianGlobe.x)) {
      return cartesian3ToWgs84(cartesianGlobe);
    }
    return null;
  }

  const result = sceneAny.pickFromRay(ray);
  const cart = result?.position;
  if (cart && Number.isFinite(cart.x)) {
    return cartesian3ToWgs84(cart);
  }

  const cartesianGlobe = viewer.scene.globe.pick(ray, viewer.scene);
  if (cartesianGlobe && Number.isFinite(cartesianGlobe.x)) {
    return cartesian3ToWgs84(cartesianGlobe);
  }
  return null;
}

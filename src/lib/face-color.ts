/**
 * Facade face 按 index 分配色：8 色调色板循环，HSL 调色保持饱和度 / 亮度一致。
 *
 * 共用一处避免 FacadeLayer / FrustumLayer / FacadeFaceList 三处各算各的飘色。
 * 调色板从青色起步（DualGaze accent-cyan #00d2c0 大概是 hue 174°），按
 * 黄金角 137.508° 旋转，4 色之后基本能拉开足够色差。
 */
import * as Cesium from 'cesium';

const PALETTE_HUES = [174, 30, 280, 110, 0, 220, 60, 320] as const;

/** 拿原始 HSL hue (0..360) */
export function faceHue(idx: number): number {
  return PALETTE_HUES[((idx % PALETTE_HUES.length) + PALETTE_HUES.length) % PALETTE_HUES.length];
}

/** 拿 css `#rrggbb`，给 Tailwind / DOM 用 */
export function faceCssColor(idx: number, lightness = 0.55, saturation = 0.7): string {
  const c = Cesium.Color.fromHsl(faceHue(idx) / 360, saturation, lightness);
  const r = Math.round(c.red * 255).toString(16).padStart(2, '0');
  const g = Math.round(c.green * 255).toString(16).padStart(2, '0');
  const b = Math.round(c.blue * 255).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

/** 拿 Cesium.Color，给 Entity / 材质用 */
export function faceCesiumColor(
  idx: number,
  alpha = 1.0,
  lightness = 0.55,
  saturation = 0.7,
): Cesium.Color {
  return Cesium.Color.fromHsl(faceHue(idx) / 360, saturation, lightness, alpha);
}

/**
 * 给 FacadeLayer 用的一组成对 color：outline / fill / vertex。
 * 保持和原 FacadeLayer faceHueColors() 同样的语义，调色板换成上面的 PALETTE_HUES。
 */
export function faceColorTriple(idx: number): {
  outline: Cesium.Color;
  fill: Cesium.Color;
  vertex: Cesium.Color;
} {
  return {
    outline: faceCesiumColor(idx, 1.0, 0.55, 0.7),
    fill: faceCesiumColor(idx, 0.18, 0.5, 0.7),
    vertex: faceCesiumColor(idx, 1.0, 0.6, 0.85),
  };
}

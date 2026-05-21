# takeOffPoint 强制流程 · 设计 v0

> **背景**：DJI Pilot 2 实操中所有贴近 / 环绕航线都用「相对起飞点高度」模式。
> 飞手现场打一个 home 锚点，所有 wp 的 alt 都相对这点。当前 DualGaze 全程
> 走 WGS84 绝对高，KMZ 也写 WGS84 模式——导入 Pilot 2 后高度会偏离真实
> 起飞地面高度（GPS 椭球高 vs 实际地面 ≈ 几十米差），现场需要手工补偿。

## 决策摘要

| 项 | 选择 |
|---|---|
| 范围 | **1 mission = 1 takeoff**（facade 多面 / orbit 都共用，与 WPML missionConfig 对齐） |
| 拾取方式 | **3D pick 模型表面 1 点** |
| 触发时机 | **创建 mission 后、画面之前强制**（picker 入口 gate 在 takeoff 上） |
| 可视化 | **场景小 Home 图标 + label**（始终可见）+ RightSheet 顶部行 |

## UX 流（带 takeoff gate）

```
1. 用户在 MissionLibrary 创 facade / orbit mission
       │
       ▼
2. 主视图弹 FacadeEmptyGuide（之前的「还没有 3DTiles 模型」卡）
       │ 用户选 tileset URL / 本地目录
       ▼
3. tileset 加载完成
       │
       ▼
4. ⚠ 主视图右下角 CTA 变成「📍 先设置起飞点（必填）」紫橙色
       │   (替代之前的 "+ 开始绘制立面 / 环绕"，picker mode gate 在这一步)
       │ 用户点 CTA → pickerMode = 'takeoff-pick'
       ▼
5. takeoff-pick HUD：「🎯 在模型上点一处地面 / 楼顶作为起飞位置」
       │ Esc 取消，单击拾取，命中后立刻保存 + 退出 picker
       ▼
6. 场景中央 takeoff 点画 Home icon + 黄色标签
       RightSheet 顶部新增"起飞点" 行：
        🏠 起飞 · 121.4737, 31.2304 · 高度 50.2m   [重设]
       │
       ▼
7. 主视图 CTA 切回 "+ 开始绘制立面 / 环绕"，原 picker 流程恢复
```

## 数据模型

```ts
// types/mission.ts —— Mission 接口已有 takeOffSecurityHeight / heightMode；
// 加一个 takeOffPoint
interface Mission {
  ...
  /** 起飞点（用户主动 3D pick 设置）。设置后 KMZ 导出走 relativeToStartPoint */
  takeOffPoint?: { lon: number; lat: number; alt: number };
}

// MISSION_DEFAULTS 不变（takeOffPoint 默认 undefined）
```

为啥不动 `heightMode`：当前 `heightMode` 是 mission 全局字段，决定 KMZ 写 `WGS84` 还是 `relativeToStartPoint`。新逻辑：

- **internal**: scanPath / face.scanPath / orbit.scanPath 始终存 WGS84 绝对 alt
  （sim / 渲染 / 算法都基于 absolute；不动现有数据流）
- **KMZ export 时换算**：
  - 若 `mission.takeOffPoint` 存在 → 所有 placemark 的 `executeHeight = wp.alt - takeOffPoint.alt`，Folder 写 `<wpml:heightMode>relativeToStartPoint</wpml:heightMode>`
  - 若没设 → 沿用旧逻辑 WGS84
- **KMZ import 时换算**：
  - 解析 `<wpml:heightMode>` + `<wpml:takeOffPoint>`，若是 relative 模式 → wp.alt = executeHeight + takeOffPoint.alt 还原成 WGS84 存到 store；store 里的 takeOffPoint 同时记下来

## Picker 实现

新增 `pickerMode: 'takeoff-pick'`（同时支持 facade + orbit mission）：

```ts
// store/ui.ts
export type PickerMode = 'idle' | 'facade-draw' | 'orbit-draw' | 'takeoff-pick';

// components/TakeoffPicker.ts (vanilla class, 类似 OrbitPicker)
class TakeoffPicker {
  onLeftClick(screenPos): void {
    const wgs = pickWgs84At(viewer, screenPos);
    if (!wgs) return;
    useMissionsStore.getState().setTakeOffPoint({ lon: wgs.lon, lat: wgs.lat, alt: wgs.alt });
    useUiStore.getState().setPickerMode('idle');
  }
  // Esc → setPickerMode('idle')
}
```

store action 新增：

```ts
// store/missions.ts
setTakeOffPoint: (pt: { lon, lat, alt } | undefined) => void;
```

## 可视化（OrbitLayer / FacadeLayer 都加 Home 实体）

为了不在 facade / orbit / optview 重复，**单独加一个 TakeoffLayer.tsx** 监听 mission.takeOffPoint，所有 mission type 通用：

```tsx
export function TakeoffLayer() {
  // 只在 takeOffPoint 存在时画
  // billboard 用 Home icon (lucide Home → 转 SVG 数据 URL)
  // 或者 point + Cesium icon 实体
  // 黄色 #ffd24a + 文本 "🏠 起飞"
}
```

App.tsx mount：

```tsx
{(isFacade || isOrbit) && <TakeoffLayer />}
```

## UI 各处改动

| 位置 | 改动 |
|---|---|
| `FacadeStartCta` | 增加 `disabled when !mission.takeOffPoint` 状态；disabled 时灰色 + 切到 `TakeoffStartCta`「📍 先设置起飞点」 |
| `OrbitStartCta` | 同上 |
| 新建 `TakeoffStartCta` | 紫橙 `#ffd24a → #ff8b4a` 渐变 CTA，绕过 facade/orbit 的青/紫色调，显眼提示 |
| 新建 `TakeoffPickerHud` | 简单浮条「🎯 在模型上点一处地面作为起飞位置」+ Esc 提示 |
| `RightSheet` 顶部 | 加 "起飞点" 行：🏠 + 坐标 + 高度 + [重设] 按钮 |
| `App.tsx` | mount `TakeoffLayer` + `TakeoffPickerMount`；CTA 切换逻辑 |
| `kmz-export.ts` | takeOffPoint 存在时换算 executeHeight + heightMode |
| `kmz-import.ts` | 解析 takeOffPoint + relativeToStartPoint 还原 |

## 文件清单

```
src/store/missions.ts                  - 加 takeOffPoint state + setTakeOffPoint action
src/store/ui.ts                        - PickerMode 加 'takeoff-pick'
src/features/takeoff/TakeoffPicker.ts  - 新建：1 点拾取
src/features/takeoff/TakeoffLayer.tsx  - 新建：场景 Home icon 渲染
src/components/TakeoffStartCta.tsx     - 新建：未设 takeoff 时的紫橙 CTA
src/components/TakeoffPickerHud.tsx    - 新建：picker HUD
src/components/RightSheet.tsx          - 顶部加 takeoff 状态行
src/components/FacadeStartCta.tsx      - disabled gate
src/components/OrbitStartCta.tsx       - disabled gate
src/App.tsx                            - mount Takeoff*
src/lib/kmz-export.ts                  - executeHeight 换算
src/lib/kmz-import.ts                  - takeOffPoint 解析
src/types/mission.ts                   - Mission.takeOffPoint
```

## 开发拆解（M22）

1. **M22-1** types: `Mission.takeOffPoint` + `setTakeOffPoint` store action + PickerMode 扩
2. **M22-2** `TakeoffPicker.ts` + `TakeoffLayer.tsx`（Home icon billboard）
3. **M22-3** `TakeoffStartCta` + `TakeoffPickerHud` + App.tsx mount
4. **M22-4** Facade/OrbitStartCta gate（无 takeoff 时 disabled）
5. **M22-5** RightSheet 顶部 takeoff 状态行 + [重设] 入口
6. **M22-6** kmz-export 换算 + kmz-import 还原（双向 round-trip）
7. **M22-7** playwright 验证（拾 takeoff → 画 facade → 导 KMZ 检查 executeHeight 是相对值）

预估 0.5-1 session。

## Out of scope

- 不支持**多 takeoff 切换**（一个 mission 一个，重设替换）
- 不支持**通过 RTK 仪精确点位**（v3.x 不接外部硬件）
- **patrol / mapping 不强制 takeoff**（保持原 WGS84 行为，互不影响）

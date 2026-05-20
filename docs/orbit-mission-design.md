# 环绕航线 (Orbit Mission) · 交互设计 v0

> **背景**：DualGaze v3 facade 解决了平面墙的近距摄影；DPGO 还有另一类常见场景——
> 绕**垂直主轴结构**（古塔 / 烟囱 / 电塔 / 输电塔）多圈飞行，每圈不同高度，相机
> 始终对准主轴。对应 DJI Pilot 2 的「兴趣点环绕」模式。

## 决策摘要

| 项 | 选择 |
|---|---|
| 拾取方式 | **3 点拾取**：底心 + 顶心 + 侧点定半径 |
| 相机 pitch | **auto-aim 中心轴中点**（每个 wp 单独算朝向） |
| Ring 计数 | **指定 verticalSpacing (m)**，自动算圈数 |
| Mission 结构 | **1 mission = 1 orbit**（多塔需要建多个 mission），KMZ 输出 1 wayline |

## 拾取流程

```
用户进 picker 后：

①  点塔底中心（地面上靠塔的位置）       → axisBottom (lon, lat, alt)
②  点塔顶中心（屋顶 / 塔尖）            → axisTop (lon, lat, alt)
③  点塔的任意侧面（决定半径）            → side, radius = √((side-axisBottom)·horiz)²

3 点齐 → preview：透明圆柱 + scanPath
```

HUD 提示：
- 步骤 ① → `点塔底中心`
- 步骤 ② → `点塔顶中心 · ↕ 决定高度`
- 步骤 ③ → `点塔侧任意墙面 · → 决定半径`
- preview → `R=10.2m · H=30m · 8 圈 · 128 wp`

## 飞行参数（右 sheet 配置面板可调）

| 字段 | 默认 | 含义 |
|---|---|---|
| `standoff` | 8m | 实际飞行半径 = `radius + standoff`（避撞缓冲） |
| `verticalSpacing` | 3m | 每圈高度间距，决定圈数 = ⌈H / spacing⌉ + 1 |
| `pointsPerRing` | 16 | 每圈航点数（决定方位角分辨率 360/16 = 22.5°） |
| `startAngle` | 0° | 第一圈起点方位（正北 = 0°） |
| `direction` | 'cw' | 顺时针 / 逆时针 |
| `bottomAltOffset` | 0 | 底圈相对 ① 高度偏移（一般正值，避开地面） |
| `topAltOffset` | 0 | 顶圈相对 ② 高度偏移（一般负值，给安全余量） |
| `flipRingDirection` | true | 偶数圈反向 → 上下圈衔接最短（蛇形上升） |

> **不属于 OrbitScanParams 的：** `speed` 来自 `mission.globalSpeed`（在「任务配置」tab）；
> `droneId / payloadId / heightMode / takeOffSecurityHeight / flyToWaylineMode /
> finishAction / executeRCLostAction / exitOnRCLost / isClosedLoop / globalAction`
> 全部由 mission-level 共享，orbit / facade / mapping / patrol 共用同一个
> `MissionConfigPanel` 组件。

## 数据模型

```ts
// types/mission.ts 新增
export interface OrbitDef {
  axisBottom: { lon: number; lat: number; alt: number };
  axisTop: { lon: number; lat: number; alt: number };
  /** 测得的物体半径（不含 standoff） */
  radius: number;
  params: OrbitScanParams;
  /** 算出来的扫描航点 */
  scanPath?: Waypoint[];
}

export interface OrbitScanParams {
  standoff: number;
  verticalSpacing: number;
  pointsPerRing: number;
  startAngle: number;
  direction: 'cw' | 'ccw';
  bottomAltOffset: number;
  topAltOffset: number;
  flipRingDirection: boolean;
  // 注意：飞行速度从 mission.globalSpeed 取，不在这里重复
}

// Mission interface 添加
interface Mission {
  ...
  /** v3.1 orbit 类型 */
  orbit?: OrbitDef;
}

// MissionType union 添加 'orbit'
type MissionType = 'patrol' | 'mapping' | 'strip' | 'facade' | 'orbit';
```

## 算法（generateOrbitScanPath）

```
1. axis 中点 = (axisBottom + axisTop) / 2
2. H = |axisTop.alt - axisBottom.alt|
3. ringCount = ⌈H / verticalSpacing⌉ + 1
4. 对每圈 r ∈ [0..ringCount-1]:
     alt = axisBottom.alt + bottomAltOffset + r * (H - bottomAltOffset + topAltOffset) / (ringCount-1)
     radiusFinal = radius + standoff
     方位角列表 = [startAngle, startAngle + 360/pointsPerRing, ...]
     if flipRingDirection && r % 2 === 1: 反向
     for each 方位角 θ:
       wp_lon = axisBottom.lon + radiusFinal * sin(θ) / METERS_PER_DEG_LON
       wp_lat = axisBottom.lat + radiusFinal * cos(θ) / METERS_PER_DEG_LAT
       wp_alt = alt
       // 朝向：看向 axis 中点
       lookVector = midAxis - wp
       heading = atan2(lookVector.east, lookVector.north)
       pitch = atan2(lookVector.up, |lookVector.horiz|)
       gimbalYaw = heading
       push wp
```

## UI 各处与 facade 的差异

| 位置 | facade | orbit |
|---|---|---|
| 创建 modal | radio 4：贴近航线 | radio 5：**环绕航线**（新色：紫 #a64aff） |
| MissionLibrary chip | 「贴近」青 | 「环绕」紫 |
| 主视图引导 CTA | + 开始绘制立面 | **+ 开始绘制环绕**（紫色） |
| Picker HUD | 4 步 ●●●● + ★ | **3 步 ●●● + 圆柱图标** |
| Layer 渲染 | 4 角点 + 平面 + 法向箭头 + scanPath | **axis 线 + 透明圆柱 + 多圈虚线 + waypoint 点** |
| RightSheet tab 1 | facade 面列表 | **orbit 单体配置**（无列表，直接配置当前 orbit） |
| RightSheet tab 2 | 任务配置 | 任务配置（无差异） |
| RightSheet tab 3 | 扫描列表 | 扫描列表 |
| 模拟飞行 | active face 的 scanPath | 整条 orbit scanPath |
| KMZ 导出 | N face = N Folder | **1 Folder · 1 wayline**（同 patrol/mapping） |

## 边界 / Out of scope

- 不支持**非垂直轴**（倾斜塔 / 横置物体）
- 不支持**变半径**（锥形塔的 ring radius 随高度变化）—— 后续 v3.2 可加 `radiusTop / radiusBottom` 双值
- 不支持**多 orbit 拼接**（一栋塔的多种角度，e.g. 加密某段高度的圈）
- 不支持**部分弧**（< 360°，比如「东半圈拍 5 层」）—— 后续按需加 `startAngle/endAngle`

## 开发顺序（M20）

1. **M20-1** types：`OrbitDef` + `OrbitScanParams` + `MissionType=orbit`
2. **M20-2** algorithm：`lib/orbit-scan.ts:generateOrbitScanPath`
3. **M20-3** store：`mission.orbit` CRUD + recompute host
4. **M20-4** picker：`features/orbit/OrbitPicker.ts` (3 点拾取 + preview)
5. **M20-5** layer：`features/orbit/OrbitLayer.tsx` (axis + cylinder + rings + samples)
6. **M20-6** UI：`OrbitConfigPanel`, `OrbitStartCta`, `OrbitPickerHud`
7. **M20-7** mission type chip / MissionLibrary
8. **M20-8** sim 集成（effectiveWaypoints）
9. **M20-9** KMZ export/import
10. **M20-10** playwright 验证

预计 1-1.5 session。

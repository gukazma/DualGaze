# 优视航线 (Optimal-View Photogrammetry) · 设计 v0

> **目标**：对任意 3DTiles 目标区域，自动算一组**覆盖率高、视角分布均匀**的航点，
> 每个航点都指向模型表面的一个采样点，最后连成一条单一航线。适合古建、雕塑、
> 工业设备等"凹凸有起伏、墙面不规则"的复杂物体。

## 决策摘要

| 项 | 选择 |
|---|---|
| ROI 选择 | **多边形 picker**（复用 mapping 的 PolygonPicker，把 polygon 投到 3D 表面） |
| Shell 几何 | **逆违偏移 sphere Minkowski**（每点 + 周边球面采样，外包络） |
| 3 视角几何 | **法向 + ±θ 方位偶偏转**（同高度横向 ±25°） |
| TSP 穿模处理 | **后检查 + transit point**：检测连线与 tileset 相交 → 插入中间航点上升到安全高度 |

## 算法链路（6 阶段）

```
3DTiles 加载（共享 mission.tilesetSource）
      │
      ▼
Stage 1 · ROI Polygon Picker
   ┌─────────────────────────────────────────┐
   │ 用户在模型表面点 ≥3 个点闭合多边形       │
   │ 每个顶点通过 viewer.pickFromRay 取 3D 点 │
   │ Output: polygon: { lon, lat, alt }[]    │
   └─────────────────────────────────────────┘
      │
      ▼
Stage 2 · DEM (Height Field) 生成
   ┌──────────────────────────────────────────────────┐
   │ 1. 以 polygon 的 ECEF 中心为原点建 ENU 平面        │
   │ 2. polygon 投影到 (east, north) 2D → polygon2D    │
   │ 3. 取 bbox; 按 demResolution（默认 1m/cell）网格化│
   │ 4. 每个 cell (e, n) 在 polygon2D 内 → ENU 还原    │
   │    到 ECEF, 沿 -up 向下 raycast 命中表面 → 取 alt│
   │ 5. 同时对每个 cell 算梯度 → 局部 normal           │
   │ Output: HeightField { cells: { ecef, normal }[][] }│
   └──────────────────────────────────────────────────┘
      │
      ▼
Stage 3 · Safety Shell (Sphere Minkowski)
   ┌──────────────────────────────────────────────────────┐
   │ 对 DEM 每个 surface 点 P：                            │
   │   - 在 P 周围 sphere(P, standoff) 上采样 K=20 个点    │
   │   - 这些 K 点中，所有"离表面 ≥ standoff 的"加入候选 │
   │ 把所有候选点做 outer hull 近似：                     │
   │   - 对每个 cell 取其周围 candidate 中"最朝外"的那个 │
   │ Output: shellPoints: { ecef, normal }[]               │
   │                                                       │
   │ 性能：DEM N*N cell, K 球点 → O(N²·K) ≈ 200k ops      │
   │       对 100×100 cell 大约 2M ops; raycast 是瓶颈     │
   │ Fallback: ROI > 200×200m 时降级到 DEM+offset         │
   └──────────────────────────────────────────────────────┘
      │
      ▼
Stage 4 · Poisson Disk 采样
   ┌──────────────────────────────────────────────────┐
   │ 输入 shellPoints (~10k 候选)；输出稀疏均匀子集   │
   │ Bridson 法（spatial grid 加速）：                │
   │   - 网格 cell = samplingSpacing / √3            │
   │   - 随机起种子 → 邻域内 30 次尝试新点（≥ r 间距）│
   │   - 每个新点也加 grid                            │
   │ 输出 N 个均匀点，每点带 normal                   │
   │                                                  │
   │ 默认 samplingSpacing 5m → 100×100m ROI ≈ 100 点 │
   └──────────────────────────────────────────────────┘
      │
      ▼
Stage 5 · 每点 3 视角航点
   ┌─────────────────────────────────────────────────────┐
   │ 对每个 sample point S (带 normal N)：                │
   │   1. 在 N 的水平面里找 right 轴 R = N × up 归一化    │
   │      （up = world Z）                                │
   │   2. cam_0 = S + N · viewDistance                    │
   │   3. cam_left = S + (cos(θ)·N + sin(θ)·R) · viewDist │
   │   4. cam_right = S + (cos(θ)·N - sin(θ)·R) · viewDist│
   │   5. 三个 wp 都 look at S → heading/pitch/gimbalYaw  │
   │   6. 给每个 wp 一个 sourceSampleId 用于 transit 检查 │
   │ Output: scanPath (3N 个 wp, 未排序)                   │
   │                                                       │
   │ 默认 viewDistance 8m, θ 25°                          │
   └─────────────────────────────────────────────────────┘
      │
      ▼
Stage 6 · TSP 排序 + Transit Point 防穿模
   ┌──────────────────────────────────────────────────────┐
   │ 6a. 初始排序：从 wp 中心起点 nearest-neighbor          │
   │ 6b. 2-opt 优化 100 轮（一对 edge 反向若总长缩短）     │
   │ 6c. 穿模检查：相邻 wp 连线 raycast tileset；命中 →     │
   │     插入 1 个 transit point = midpoint xy + DEM.maxH  │
   │     + transitMargin（默认 +15m）                      │
   │ Output: 完整 scanPath + 偶尔插入的 transit wp          │
   └──────────────────────────────────────────────────────┘
```

## 数据模型

```ts
// types/mission.ts
export type MissionType = ... | 'optview';

export interface OptviewParams {
  /** ENU 平面 DEM 栅格分辨率 m/cell */
  demResolution: number;       // 默认 1
  /** Safety shell 离表面距离 m */
  safetyOffset: number;        // 默认 10
  /** Poisson disk 最小间距 m */
  samplingSpacing: number;     // 默认 5
  /** 相机到采样点距离 m（沿法向反方向延长） */
  viewDistance: number;        // 默认 8
  /** 3 视角的方位偏角 °（左右各 θ） */
  viewAngleOffset: number;     // 默认 25
  /** Transit point 抬升到 DEM.maxAlt + margin */
  transitMargin: number;       // 默认 15
  /** 2-opt 轮数 */
  tspIterations: number;       // 默认 100
}

export interface OptviewDef {
  polygon: { lon: number; lat: number; alt: number }[];
  params: OptviewParams;
  // computed cache (params 变化清空)
  demSummary?: { cellCount: number; maxAlt: number; minAlt: number };
  shellSampleCount?: number;
  scanPath?: Waypoint[];
}

// Mission
interface Mission {
  ...
  /** v3.2 optview 类型 */
  optview?: OptviewDef;
}
```

## 文件分布

| 文件 | 内容 |
|---|---|
| `lib/optview-dem.ts` | `generateDEM(viewer, polygon, params) → HeightField` |
| `lib/optview-shell.ts` | `generateSafetyShell(dem, standoff) → ShellPoint[]` |
| `lib/optview-poisson.ts` | `poissonDiskSample(points, minDistance) → Sample[]` |
| `lib/optview-views.ts` | `generateViewWaypoints(sample, params) → 3 wp` |
| `lib/optview-tsp.ts` | `solveTSP(wps) + insertTransits(wps, raycast) → orderedPath` |
| `lib/optview-scan.ts` | 统一入口 `generateOptviewScanPath(viewer, optview)` 串完整链路 |
| `features/optview/OptviewPicker.ts` | 多边形拾取（复用 PolygonPicker 思路） |
| `features/optview/OptviewLayer.tsx` | DEM 网格 + shell 散点 + 采样点 + scanPath 渲染 |
| `features/optview/OptviewScanRecomputeHost.tsx` | params 变化时重算 |
| `components/OptviewPickerHud.tsx` | 多边形拾取 HUD |
| `components/OptviewConfigPanel.tsx` | 7 个 slider 参数 |
| `components/OptviewStartCta.tsx` | 主视图 CTA「+ 开始绘制优视区域」 |

品牌色：**`#3cb47e` 绿（区别 facade 青 / orbit 紫）**

## 性能预算

100×100m ROI / demRes 1m / standoff 10 / spacing 5：
- DEM 生成：10k raycast ≈ 200ms
- Shell Minkowski：10k × 20 sphere points = 200k raycast ≈ 4s ⚠
- Poisson 采样：100 个点 ≈ 50ms
- 3 视角：100×3 = 300 wp ≈ 即时
- TSP 2-opt 100 轮：300² × 100 = 9M 距离计算 ≈ 200ms
- Transit 检查：300 边 raycast ≈ 60ms

**瓶颈是 Stage 3。** 默认 50×50m / spacing 5m / shell 20 球点 → 600ms 可接受。
对大 ROI 给进度条 + 用户确认。

## UX 流

1. 创 mission 时选「优视航线」（新增 radio）
2. 加载 tileset（共用 TilesetSourcePicker）
3. 主视图右下角 CTA「+ 开始绘制优视区域」
4. 进入 picker → 用户多边形拾取（≥3 顶点 + 双击 / Enter 闭合）
5. preview：HUD 显示「ROI 50×50m · 4280 m² · 计算中...」
   - 后台依次执行 Stage 2-6（带进度通知）
   - 完成后 OptviewLayer 渲染 DEM 灰网 + shell 紫点 + sample 绿点 + 3 wp 黄点 + path 黄线
6. preview 完成 → Enter 保存
7. 右 sheet 切「优视配置」tab 改 7 个参数 → 重算

## Out of scope（v3.3+）

- **多 ROI**：一个 mission 仅一个优视区域（同 orbit）
- **多分辨率 DEM**：不分级，固定 demResolution
- **GPU raycast**：所有 raycast 走 CPU `viewer.scene.pickFromRay`，性能受 Cesium 限制
- **视场 / GSD 计算**：不像 facade 智能模式预设；先用固定 viewDistance
- **Adaptive sampling**：不根据曲率自适应间距；均匀 Poisson

## 开发拆解（M21）

10 步同 M20：
1. **M21-1** types + ENABLED_MISSION_TYPES + MissionTypeChip 紫绿
2. **M21-2** `lib/optview-dem.ts`（DEM raycast 栅格）
3. **M21-3** `lib/optview-shell.ts`（Minkowski sphere offset）
4. **M21-4** `lib/optview-poisson.ts`（Bridson）
5. **M21-5** `lib/optview-views.ts`（3 视角）
6. **M21-6** `lib/optview-tsp.ts`（TSP + transit）+ `optview-scan.ts` 串
7. **M21-7** picker + store + RecomputeHost
8. **M21-8** OptviewLayer 渲染
9. **M21-9** UI 三件套（HUD / ConfigPanel / StartCta）+ RightSheet tab
10. **M21-10** KMZ + sim 集成 + playwright

预估 ~2 session。

## 不确定还想问你 3 个细节

1. **3 视角的 θ 用 ±25°（法向偶偏转）还是用 0/+25/-25 三个角？**
   - 选 ±θ：3 wp 等价于「正面 + 左偏 + 右偏」，相机有重叠拍摄
   - 选 0/+25/-25：本质一样，只是命名习惯。**就按 ±25°，cam_0 在正中**

2. **Poisson disk 在 shell 上采样：要直接在 3D 表面跑 Bridson（曲面距离）还是在 2D 投影后跑？**
   - 3D 表面距离更准但实现复杂
   - 2D 投影 (用 DEM 网格坐标) 跑 Poisson 再映射回 3D，**近垂直表面会偏密**
   - 推荐 3D 距离（用欧氏距离近似曲面距离，平面足以；exact geodesic 太重）

3. **算 DEM 时 ROI 多边形外的 cell 怎么处理？**
   - 不参与（hard mask） — 简单，多边形边界硬切；推荐
   - soft falloff — 复杂，对工业场景不够直观

如果以上 3 点没有异议，下一步我开 Pencil 4 帧画原型：

- O1: Picker mid-flow（多边形拾取 3 点中 + HUD 「3/N 顶点」）
- O2: 计算进度（DEM / Shell / Poisson / TSP 分步 progress bar）
- O3: Preview 结果（DEM 灰网 + shell 散点 + sample 绿点 + 黄线 path）
- O4: RightSheet 优视配置 tab（7 slider + 反算预估航点数 / 预计耗时）

确认后我画原型。
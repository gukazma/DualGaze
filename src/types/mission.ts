/**
 * Mission / Waypoint 数据模型。
 *
 * 所有坐标全程以 **WGS84** 存储；只有渲染到 AMap 时才走 wgs84ToGcj02 修正。
 * 这样 KMZ 导出 / DJI Pilot 2 / FlightHub 2 看到的坐标都是 GPS 标准。
 */

export type MissionType = 'patrol' | 'mapping' | 'strip' | 'facade' | 'orbit' | 'ov';

/** v3.3 启用 'patrol' + 'mapping' + 'facade' + 'orbit' + 'ov'（优视航线）；strip 仍 disabled */
export const ENABLED_MISSION_TYPES: ReadonlySet<MissionType> = new Set(['patrol', 'mapping', 'facade', 'orbit', 'ov']);

export interface MissionTypeMeta {
  id: MissionType;
  label: string;
  description: string;
  iconName: string; // lucide icon name
  disabled: boolean;
}

export const MISSION_TYPE_CATALOG: ReadonlyArray<MissionTypeMeta> = [
  {
    id: 'patrol',
    label: '巡逻航线',
    description: '逐点添加 · 模拟飞行 · 视锥可视',
    iconName: 'route',
    disabled: false,
  },
  {
    id: 'mapping',
    label: '面状航线',
    description: '多边形 → S 型扫描',
    iconName: 'grid-3x3',
    disabled: false,
  },
  {
    id: 'strip',
    label: '带状航线',
    description: '线状目标巡检',
    iconName: 'spline',
    disabled: true,
  },
  {
    id: 'facade',
    label: '贴近摄影航线',
    description: '3DTiles 立面 · 多面 S 扫描',
    iconName: 'scan-eye',
    disabled: false,
  },
  {
    id: 'orbit',
    label: '环绕摄影航线',
    description: '塔状目标多圈环绕 · 相机始终朝主轴',
    iconName: 'target',
    disabled: false,
  },
  {
    id: 'ov',
    label: '优视航线',
    description: '蝶舞 DroneScan pipeline · 采样 → 视角生成 → 优化 → 路径',
    iconName: 'scan-search',
    disabled: false,
  },
];

// ---------- Drone / Payload ----------

export interface DroneModel {
  id: string;
  label: string;
  /** DJI WPML droneEnumValue */
  droneEnumValue: number;
  droneSubEnumValue: number;
  /** 兼容的 payload id 白名单 */
  compatiblePayloads: string[];
}

export interface PayloadModel {
  id: string;
  label: string;
  /** DJI WPML payloadEnumValue */
  payloadEnumValue: number;
  payloadPositionIndex: number;
  /** v3 facade GSD 模式用：传感器宽（mm），可选 */
  sensorWidthMm?: number;
  /** 传感器高（mm） */
  sensorHeightMm?: number;
  /** 焦距（mm，真实焦距非 35mm 等效） */
  focalLengthMm?: number;
  /** 图像宽像素 */
  imageWidthPx?: number;
  /** 图像高像素 */
  imageHeightPx?: number;
}

/** v1 内置型号；后续可扩到 ThirdParty / 配置 */
export const DRONE_CATALOG: ReadonlyArray<DroneModel> = [
  { id: 'm3e', label: 'DJI Matrice 3E', droneEnumValue: 77, droneSubEnumValue: 0, compatiblePayloads: ['m3e-cam'] },
  { id: 'm3t', label: 'DJI Matrice 3T', droneEnumValue: 77, droneSubEnumValue: 1, compatiblePayloads: ['m3t-cam'] },
  { id: 'm3m', label: 'DJI Matrice 3M', droneEnumValue: 77, droneSubEnumValue: 2, compatiblePayloads: ['m3m-cam'] },
  { id: 'm30', label: 'DJI Matrice 30', droneEnumValue: 67, droneSubEnumValue: 0, compatiblePayloads: ['m30-cam'] },
  { id: 'm30t', label: 'DJI Matrice 30T', droneEnumValue: 67, droneSubEnumValue: 1, compatiblePayloads: ['m30t-cam'] },
  { id: 'm300', label: 'DJI Matrice 300 RTK', droneEnumValue: 60, droneSubEnumValue: 0, compatiblePayloads: ['h20', 'h20t', 'h20n', 'p1', 'l1'] },
  { id: 'm350', label: 'DJI Matrice 350 RTK', droneEnumValue: 89, droneSubEnumValue: 0, compatiblePayloads: ['h20', 'h20t', 'h20n', 'p1', 'l1', 'l2'] },
];

/**
 * v3 facade GSD 模式：常见 DJI 相机的传感器/焦距/像素参数。
 * 数据来自 DJI 官方 spec / WPML 文档；GSD = standoff × sensorWidth / (focal × imageWidth)。
 * 没填的相机（如 H20N 夜视）GSD 模式 fallback 到 manual mode。
 */
export const PAYLOAD_CATALOG: ReadonlyArray<PayloadModel> = [
  { id: 'm3e-cam', label: 'M3E 主云台相机', payloadEnumValue: 80, payloadPositionIndex: 0, sensorWidthMm: 17.3, sensorHeightMm: 13.0, focalLengthMm: 12.29, imageWidthPx: 5280, imageHeightPx: 3956 },
  { id: 'm3t-cam', label: 'M3T 主云台相机', payloadEnumValue: 81, payloadPositionIndex: 0, sensorWidthMm: 6.4, sensorHeightMm: 4.8, focalLengthMm: 4.4, imageWidthPx: 4000, imageHeightPx: 3000 },
  { id: 'm3m-cam', label: 'M3M 多光谱相机', payloadEnumValue: 80, payloadPositionIndex: 0, sensorWidthMm: 17.3, sensorHeightMm: 13.0, focalLengthMm: 12.29, imageWidthPx: 5280, imageHeightPx: 3956 },
  { id: 'm30-cam', label: 'M30 主云台相机', payloadEnumValue: 52, payloadPositionIndex: 0, sensorWidthMm: 6.4, sensorHeightMm: 4.8, focalLengthMm: 4.5, imageWidthPx: 4000, imageHeightPx: 3000 },
  { id: 'm30t-cam', label: 'M30T 主云台 (红外)', payloadEnumValue: 53, payloadPositionIndex: 0, sensorWidthMm: 6.4, sensorHeightMm: 4.8, focalLengthMm: 4.5, imageWidthPx: 4000, imageHeightPx: 3000 },
  { id: 'h20', label: 'H20 (RGB)', payloadEnumValue: 42, payloadPositionIndex: 0, sensorWidthMm: 6.4, sensorHeightMm: 4.8, focalLengthMm: 4.5, imageWidthPx: 5184, imageHeightPx: 3888 },
  { id: 'h20t', label: 'H20T (RGB+红外)', payloadEnumValue: 43, payloadPositionIndex: 0, sensorWidthMm: 6.4, sensorHeightMm: 4.8, focalLengthMm: 4.5, imageWidthPx: 5184, imageHeightPx: 3888 },
  { id: 'h20n', label: 'H20N (夜视)', payloadEnumValue: 61, payloadPositionIndex: 0 },
  { id: 'p1', label: 'P1 测绘相机', payloadEnumValue: 50, payloadPositionIndex: 0, sensorWidthMm: 35.9, sensorHeightMm: 24.0, focalLengthMm: 35, imageWidthPx: 8192, imageHeightPx: 5460 },
  { id: 'l1', label: 'L1 激光雷达', payloadEnumValue: 41, payloadPositionIndex: 0 },
  { id: 'l2', label: 'L2 激光雷达', payloadEnumValue: 90, payloadPositionIndex: 0 },
];

// ---------- Waypoint / Mission ----------

export type WaypointActionType = 'takePhoto' | 'startRecord' | 'stopRecord' | 'hover';

export interface WaypointAction {
  id: string;
  type: WaypointActionType;
  /** 仅 'hover' 用：悬停时长（秒） */
  hoverSeconds?: number;
}

export interface Waypoint {
  id: string;
  index: number;
  /** WGS84 经度 */
  lon: number;
  /** WGS84 纬度 */
  lat: number;
  /** 高度 (m, 椭球面或相对起飞点；由 mission heightMode 决定语义) */
  alt: number;
  /** 飞行速度 m/s（不填用 mission.globalSpeed） */
  speed: number;
  /** 朝向 ° (0=正北，顺时针) */
  heading: number;
  /** 云台俯仰 ° (-90=朝下，0=朝前，30=朝上) */
  pitch: number;
  /** 水平视场角 ° (默认 60) */
  fov: number;
  /** v3 facade 用：云台 yaw ° (0=正北，顺时针)；patrol/mapping 不填走 0 兼容 */
  gimbalYaw?: number;
  /** v3 facade 用：raycast 验距标记 — 相机前方 < standoff 有障碍，飞过去可能撞 */
  unsafe?: boolean;
  /** v3 facade 用：raycast 命中障碍的距离（米）；用于 hover tooltip 显示 */
  obstacleDistanceM?: number;
  /** 抵达此航点时执行的动作组（拍照/录像/悬停 etc.） */
  actions: WaypointAction[];
}

export type HeightMode = 'WGS84' | 'relativeToStartPoint' | 'realTimeFollowSurface';
export type FlyToWaylineMode = 'safely' | 'pointToPoint';
export type FinishAction = 'goHome' | 'autoLand' | 'hover' | 'backToStart';
export type RCLostAction = 'goBack' | 'hover' | 'landing';
export type ExitOnRCLost = 'executeLostAction' | 'goContinue';
export type GlobalCameraAction = 'none' | 'takePhoto' | 'startRecord';

/** mapping 扫描参数 —— S 型路径生成的输入 */
export interface MappingScanParams {
  /** 航线间距 m (5–200) */
  spacing: number;
  /** 朝向角 ° (0–359；0 = 南北方向扫描 / 90 = 东西方向扫描) */
  direction: number;
  /** 向内缩进 m (0–50) */
  margin: number;
  /** 云台俯仰 ° (-90 朝下 ~ 30 朝上) */
  gimbalPitchAngle: number;
  /** 横向重叠率 0–0.9（v2 持久化但不联动 spacing） */
  overlapH: number;
  /** 纵向重叠率 0–0.9 */
  overlapW: number;
}

/** mapping 多边形顶点（WGS84） */
export interface PolygonVertex {
  lon: number;
  lat: number;
  alt: number;
}

// ---------- v3 Facade Mission ----------

/** facade 立面角点（WGS84），用户拾取的 4 个角 */
export interface FacadeCorner {
  lon: number;
  lat: number;
  alt: number;
}

/** facade 立面拟合平面（ECEF 参数；由 fitPlaneFromCorners 算出） */
export interface FacadePlane {
  /** 平面中心点（Cartesian3） */
  origin: { x: number; y: number; z: number };
  /** 法向（单位向量，远离墙面方向） */
  normal: { x: number; y: number; z: number };
  /** 平面内 u 轴（水平方向单位向量） */
  uAxis: { x: number; y: number; z: number };
  /** 平面内 v 轴（垂直方向单位向量） */
  vAxis: { x: number; y: number; z: number };
  /** u 方向尺寸 m */
  width: number;
  /** v 方向尺寸 m */
  height: number;
}

/**
 * facade 扫描参数（每个 face 独立）。
 *
 * 两种模式：
 * - `smart`：用户调 gsdMm + overlapFront/overlapSide，UI 自动反推 standoff / spacingH / spacingV
 *   （需要 payload 有 sensor/focal 字段；没填 fallback 到 manual）
 * - `manual`（默认）：直接填 standoff/spacingH/spacingV，UI 不动 gsd/overlap
 *
 * 两种模式存到同一个对象，标 `mode` 区分；切换模式时 UI 把当前数值反算/正算保留语义。
 */
export interface FacadeScanParams {
  /** 模式：smart=用 GSD/overlap 反推；manual=直填 standoff/spacing */
  mode: 'smart' | 'manual';
  /** 拍摄距离 m, 3–50, 默认 8（manual 模式直填；smart 模式由 GSD 反推） */
  standoff: number;
  /** 水平网格间距 m, 0.5–20, 默认 3（同上） */
  spacingH: number;
  /** 垂直网格间距 m, 0.5–20, 默认 3 */
  spacingV: number;
  /** u 方向缩进 m, 默认 0 */
  marginU: number;
  /** v 方向缩进 m, 默认 0 */
  marginV: number;
  /** S 主方向（先水平扫还是先垂直扫） */
  marchOrder: 'horizontal' | 'vertical';
  /** 法向反转开关（处理朝室内/室外的歧义） */
  flipNormal: boolean;
  /** 飞行速度 m/s, 默认 3 */
  speed: number;
  /** smart 模式：目标 GSD（毫米），默认 2（精细建模），范围 1–30 */
  gsdMm: number;
  /** smart 模式：航向重叠率 0–1，默认 0.8 */
  overlapFront: number;
  /** smart 模式：旁向重叠率 0–1，默认 0.8 */
  overlapSide: number;
}

/** facade 单个立面（一个 mission 可有多个） */
export interface FacadeFace {
  id: string;
  /** 用户可改的名字，如 "南立面" */
  name: string;
  /** 4 个角点（用户依次点的顺序，按 0→1→2→3→0 闭合） */
  corners: FacadeCorner[];
  /** corners 拟合出的平面；picker 完成或 corners 变化时算 */
  plane?: FacadePlane;
  /** 每个 face 独立参数 */
  params: FacadeScanParams;
  /** 算出的扫描航点（params/corners/plane 变化时重算） */
  scanPath?: Waypoint[];
  /** 在总 mission scanPath 中是否参与（关掉单飞某面用） */
  enabled: boolean;
}

/** v3.1 orbit 扫描参数（不含速度，速度走 mission.globalSpeed） */
export interface OrbitScanParams {
  /** 飞行半径相对物体半径的额外缓冲距离 m（实际飞行半径 = orbit.radius + standoff） */
  standoff: number;
  /** 每圈垂直间距 m（决定圈数 = ⌈H / verticalSpacing⌉ + 1） */
  verticalSpacing: number;
  /** 每圈航点数（360° 等分；常见 8/12/16/24） */
  pointsPerRing: number;
  /** 起始方位角 °（正北=0，CW 递增） */
  startAngle: number;
  /** 飞行旋转方向 */
  direction: 'cw' | 'ccw';
  /** 底圈相对 axisBottom.alt 的高度偏移 m（正值=离地高些避碰） */
  bottomAltOffset: number;
  /** 顶圈相对 axisTop.alt 的高度偏移 m（负值=留安全余量） */
  topAltOffset: number;
  /** 偶数圈是否反向 → 上下圈衔接走最短弧（"蛇形上升"） */
  flipRingDirection: boolean;
  /**
   * v3.3 圆柱总高 m。axisTop.alt = axisBottom.alt + totalH。
   * 由 sheet 滑块控制，因为塔顶 raycast 常被构件干扰，让用户在 sheet 调更可靠。
   * picker 完成时默认 30m。
   */
  totalH: number;
}

/** v3.1 orbit 几何 + 扫描结果 */
export interface OrbitDef {
  /** 主轴底端（圆心 lon/lat + 最低拾点 alt） */
  axisBottom: { lon: number; lat: number; alt: number };
  /** 主轴顶端（lon/lat = axisBottom，alt = axisBottom.alt + params.totalH） */
  axisTop: { lon: number; lat: number; alt: number };
  /** 外接圆半径 m（v3.3 起来自 fitPoints 最小外接圆拟合；v3.1 兼容字段） */
  radius: number;
  /**
   * v3.3 用户拾的 N 个墙面点（WGS84），用于重新拟合外接圆 + sheet 中显示 / 编辑。
   * 旧 KMZ 没这个字段；导入时 fitPoints 为 undefined，但 axisBottom/Top/radius 仍可用。
   */
  fitPoints?: { lon: number; lat: number; alt: number }[];
  params: OrbitScanParams;
  /** 算出来的扫描航点 */
  scanPath?: Waypoint[];
}

// ---------- v3.3 Optimized Views (优视航线) Mission ----------

/**
 * OV 测区 AOI 多边形（WGS84 顶点 ≥3）+ 整体高度区间。
 * 高度区间用于剔除超出范围的采样点（顶层 / 地面下）。
 */
export interface OvAoi {
  vertices: { lon: number; lat: number; alt?: number }[];
  /** 采样最低高度 m（相对椭球面，沿用 mission.heightMode 语义） */
  minHeight: number;
  /** 采样最高高度 m */
  maxHeight: number;
}

/** OV 禁飞空域：多边形 + 高度区间 */
export interface OvNoFlyZone {
  id: string;
  vertices: { lon: number; lat: number }[];
  minHeight: number;
  maxHeight: number;
}

/** OV 插入障碍物：3 点定矩形 + 高度（在 tileset 未体现的人造障碍） */
export interface OvObstacleBox {
  id: string;
  corners: { lon: number; lat: number; alt: number }[]; // 3 点定矩形
  height: number;
}

/** OV 相机参数（35mm 等效 / 画幅 / 渲染分辨率 / 多线程） */
export interface OvCameraSpec {
  focalLength35mm: number; // mm
  sensorWidthMm: number; // 水平画幅 mm
  sensorHeightMm: number; // 竖直画幅 mm
  renderResolution: number; // ray-cast 内部分辨率 px
  threadCount: number; // 并发
  optimizeOverlap: number; // 视角优化重叠率 %
}

/** OV 安全罩参数（per-sample ray-cast 偏移阈值） */
export interface OvSafetyHullParams {
  safetyDistance: number; // m
  safetyHeight: number; // m
  resolution: number; // px
}

/** OV 采样参数 */
export interface OvSamplingParams {
  /** 重叠率 0-1，决定 ray-cast 网格步长 */
  overlapRatio: number;
  /** 视角距离 m */
  viewDistance: number;
  /** 最大高度 m */
  maxHeight: number;
  /** 最小高度 m（可负值，地下） */
  minHeight: number;
  /** AOI 外扩 m */
  expandDistance: number;
  /** 部分采样：sides 仅侧面 / full 全部 */
  surfaceMode: 'sides' | 'full';
  /** 可视范围采样（只对当前相机可见的区域采样） */
  visibleRangeOnly: boolean;
}

/** OV 视角生成参数 */
export interface OvViewGenParams {
  /** gimbal pitch 范围 [min, max] ° */
  pitchRange: [number, number];
  /** 4 侧视变体开关 */
  sideVariants: {
    original: boolean;
    horizontal: boolean;
    leftShift: boolean;
    rightShift: boolean;
  };
  /** 5 顶视变体开关 */
  topVariants: {
    original: boolean;
    north: boolean;
    east: boolean;
    south: boolean;
    west: boolean;
  };
  /** 7 调整策略：第一列 step，第二列 limit */
  strategies: {
    layer: { enabled: boolean; step: number; limit: number }; // 视角分层 m
    horizontalRing: { enabled: boolean; step: number; limit: number }; // 水平环形 °
    pullNear: { enabled: boolean; step: number; limit: number }; // 拉近 m
    liftHeight: { enabled: boolean; step: number; limit: number }; // 抬高 m
    pushFar: { enabled: boolean; step: number; limit: number }; // 拉远 m
    verticalRing: { enabled: boolean; step: number; limit: number }; // 垂直环形 °
    sphere: {
      enabled: boolean;
      step: number;
      sliceStep: number;
      limit: number;
    }; // 球形 ° / m / °
  };
}

/** OV 视角优化参数 */
export interface OvViewOptParams {
  method: 'angle' | 'hemisphere';
  /** 角度法 α ° */
  alpha: number;
  /** 角度法 θ ° */
  theta: number;
  /** 角度法 视角个数 K */
  viewCount: number;
  /** 半球法 半衰程度 % */
  halfDecay: number;
  /** 半球法 半衰面数 */
  halfDecayFaces: number;
  /** 半球法 半衰次数 */
  halfDecayPasses: number;
  /** 半球法 半衰量 */
  halfDecayAmount: number;
  /** 重新计算采样点（优化后用 selectedViews 反算 visibility） */
  recomputeSamples: boolean;
  /** 终止数 (0=自动) */
  terminationCount: number;
  /** 显示可见性热图 */
  showVisibilityHeatmap: boolean;
}

/** OV 路径生成参数（TSP 4-cost + 5 种区域分割） */
export interface OvPathParams {
  splitMode: 'cluster' | 'altPriority' | 'viewPriority' | 'fixedAlt' | 'viewSplit';
  /** 区域数 */
  regionCount: number;
  /** 水平距离 cost */
  costH: number;
  /** 垂直距离 cost */
  costV: number;
  /** 水平旋角 cost */
  costHRot: number;
  /** 垂直旋角 cost */
  costVRot: number;
}

/** OV 分架次参数 */
export interface OvSplitParams {
  strategy: 'count' | 'length' | 'parity';
  perSortieCount: number;
  perSortieLengthM: number;
  /** 进出航线增高 m（避障） */
  transitHeight: number;
  /** 删除相近点阈值 m */
  removeNearM: number;
}

/** OV 采样点（ray-cast 命中 + 法向估计） */
export interface OvSamplePoint {
  id: string;
  lon: number;
  lat: number;
  alt: number;
  /** ENU 单位法向量 */
  normal: [number, number, number];
  /** 被覆盖的视角数（M33 优化后填，用于热图染色） */
  coverCount?: number;
}

/** OV 视角候选 / 已选 */
export interface OvViewCandidate {
  id: string;
  /** 相机位置 WGS84 */
  camLon: number;
  camLat: number;
  camAlt: number;
  /** 看向的采样点 */
  targetSampleId: string;
  heading: number; // °
  pitch: number; // °
  /** 视角变体类型（调试用：side-original / side-horizontal / top-north / ...） */
  variant: string;
}

/** OV 单架次 */
export interface OvSortie {
  id: string;
  /** 地图染色 */
  color: string;
  waypoints: Waypoint[];
}

/** OV 可见性评估结果 */
export interface OvVisibilityResult {
  /** sampleId -> 覆盖它的 viewIds 列表 */
  sampleToViews: Record<string, string[]>;
  /** 全场景平均覆盖数 */
  avgCoverage: number;
}

/**
 * OV mission 总体 schema —— 参数 + 重产物分离。
 * 参数走持久化（KMZ schema），重产物（samples/views/paths/visibility）M30 阶段一并 persist，
 * 后续 M36 落 KMZ 时只写参数让 import 端按需重算。
 */
export interface OvDef {
  /** 测区 AOI 多边形；undefined = picker 未拾取 */
  aoi?: OvAoi;
  /** 禁飞空域列表 */
  noFlyZones: OvNoFlyZone[];
  /** 插入障碍列表（必须在 safety hull 计算前插） */
  insertObstacles: OvObstacleBox[];
  cameraParams: OvCameraSpec;
  safetyHull: OvSafetyHullParams;
  samplingParams: OvSamplingParams;
  viewGenParams: OvViewGenParams;
  viewOptParams: OvViewOptParams;
  pathParams: OvPathParams;
  splitParams: OvSplitParams;
  // 重产物（中间结果，可由参数 + tileset 重算）
  samples?: OvSamplePoint[];
  candidateViews?: OvViewCandidate[];
  selectedViews?: OvViewCandidate[];
  paths?: OvSortie[];
  visibility?: OvVisibilityResult;
}

/** facade 3DTiles 数据源 */
export interface TilesetSource {
  /** http = Cesium3DTileset.fromUrl；localDir = M17 webkitdirectory + Resource 拦截 */
  kind: 'http' | 'localDir';
  /** HTTP 时是完整 URL；localDir 时是入口 file 的相对路径 */
  url?: string;
  /** localDir 关联的内存 session ID（持久化后丢失，需用户重选目录） */
  sessionId?: string;
  /** 'tileset.json' 路径（localDir 用，识别 root） */
  rootFile?: string;
  /** localDir 时文件总数（仅 UI 显示） */
  fileCount?: number;
}

export interface Mission {
  id: string;
  name: string;
  type: MissionType;
  droneId: string;
  payloadId: string;
  waypoints: Waypoint[];
  /** 全局飞行速度 m/s */
  globalSpeed: number;
  /** 全局高度 m */
  globalHeight: number;
  /** 高度模式 */
  heightMode: HeightMode;
  /** mapping 类型：多边形顶点。patrol 不用，undefined。 */
  polygon?: PolygonVertex[];
  /** mapping 类型：算出来的 S 扫描航点（scanParams / polygon 变化时重算） */
  scanPath?: Waypoint[];
  /** mapping 类型：扫描参数 */
  scanParams?: MappingScanParams;
  /** v3 facade 类型：多个立面，每个独立 corners/plane/params/scanPath */
  facadeFaces?: FacadeFace[];
  /**
   * v3 facade 类型：当前选中的 face id（同时是模拟飞行 / KMZ 中 "选哪架次飞" 的 active 选择）。
   * 对齐 DPGO 行为：1 face = 1 wayline = 1 架次；用户一次飞一面，落地换电池再选下一面。
   * effectiveWaypoints / KMZ 单架次模拟都基于这个字段。null = 没选；UI 默认选第一个 face。
   */
  activeFaceId?: string | null;
  /** v3 facade 类型：3DTiles 数据源（HTTP URL 或本地目录 session） */
  tilesetSource?: TilesetSource;
  /** v3.1 orbit 类型：1 mission = 1 orbit；同 tilesetSource 共用（orbit 也要 tileset 才能拾点 + raycast） */
  orbit?: OrbitDef;
  /** v3.3 ov 类型：优视航线 pipeline 全状态（参数 + 中间结果） */
  ov?: OvDef;
  /**
   * v3.2 起飞点（facade / orbit 强制设；patrol / mapping 不动）。
   * 用户在 3DTiles 表面 3D pick 1 点。设置后 KMZ 导出改用 relativeToStartPoint。
   * internal scanPath 仍存 WGS84 绝对 alt；只在 KMZ export/import 时做换算。
   */
  takeOffPoint?: { lon: number; lat: number; alt: number };
  /** 安全起飞高度 m（执行任务前先爬升到此高度才进入航线，DJI WPML takeOffSecurityHeight） */
  takeOffSecurityHeight: number;
  /** 飞向首航点模式：安全模式（先到首航点正上方再下降）/ 点对点直飞 */
  flyToWaylineMode: FlyToWaylineMode;
  /** 完成动作：返航 / 降落 / 悬停 / 回首航点 */
  finishAction: FinishAction;
  /** 失控动作：返航 / 悬停 / 降落 */
  executeRCLostAction: RCLostAction;
  /** 失联后行为：执行失联动作 / 继续航线 */
  exitOnRCLost: ExitOnRCLost;
  /** 是否闭合环线（末点 → 首点） */
  isClosedLoop: boolean;
  /** 全局相机动作（贯穿航线）：无 / 拍照 / 开始录像 */
  globalAction: GlobalCameraAction;
  createdAt: number;
  updatedAt: number;
}

/** Mission 默认值集中点（createBlankMission 和 persist migration 共用） */
export const MISSION_DEFAULTS = {
  globalSpeed: 5,
  globalHeight: 60,
  heightMode: 'relativeToStartPoint' as HeightMode,
  takeOffSecurityHeight: 20,
  flyToWaylineMode: 'safely' as FlyToWaylineMode,
  finishAction: 'goHome' as FinishAction,
  executeRCLostAction: 'goBack' as RCLostAction,
  exitOnRCLost: 'executeLostAction' as ExitOnRCLost,
  isClosedLoop: true,
  globalAction: 'none' as GlobalCameraAction,
} as const;

/** mapping 扫描参数默认值（跟 dji_way_line aiPatrol 一致） */
export const MAPPING_DEFAULTS: MappingScanParams = {
  spacing: 20,
  direction: 0,
  margin: 0,
  gimbalPitchAngle: -45,
  overlapH: 0.8,
  overlapW: 0.7,
};

/** v3.1 orbit 扫描参数默认值 */
export const ORBIT_DEFAULTS: OrbitScanParams = {
  standoff: 8,
  verticalSpacing: 3,
  pointsPerRing: 16,
  startAngle: 0,
  direction: 'cw',
  bottomAltOffset: 1,
  topAltOffset: -1,
  flipRingDirection: true,
  totalH: 30,
};

/** v3 facade 扫描参数默认值 */
export const FACADE_DEFAULTS: FacadeScanParams = {
  mode: 'manual',
  standoff: 8,
  spacingH: 3,
  spacingV: 3,
  marginU: 0,
  marginV: 0,
  marchOrder: 'horizontal',
  flipNormal: false,
  speed: 3,
  gsdMm: 2,
  overlapFront: 0.8,
  overlapSide: 0.8,
};

/** facade 智能模式预设方案 */
export interface FacadePreset {
  id: 'fine' | 'general' | 'quick';
  label: string;
  description: string;
  gsdMm: number;
  overlapFront: number;
  overlapSide: number;
}

export const FACADE_PRESETS: ReadonlyArray<FacadePreset> = [
  { id: 'fine', label: '精细建模', description: 'GSD 2mm · 80/80% · 适合文物 / 细节', gsdMm: 2, overlapFront: 0.8, overlapSide: 0.8 },
  { id: 'general', label: '一般检测', description: 'GSD 5mm · 75/75% · 适合外墙缺陷扫描', gsdMm: 5, overlapFront: 0.75, overlapSide: 0.75 },
  { id: 'quick', label: '快速浏览', description: 'GSD 10mm · 65/65% · 适合先看一遍', gsdMm: 10, overlapFront: 0.65, overlapSide: 0.65 },
];

// ---------- v3.3 OV defaults ----------

export const OV_CAMERA_DEFAULTS: OvCameraSpec = {
  focalLength35mm: 24,
  sensorWidthMm: 36.0,
  sensorHeightMm: 24.0,
  renderResolution: 300,
  threadCount: 4,
  optimizeOverlap: 90,
};

export const OV_SAFETY_DEFAULTS: OvSafetyHullParams = {
  safetyDistance: 20,
  safetyHeight: 20,
  resolution: 30,
};

export const OV_SAMPLING_DEFAULTS: OvSamplingParams = {
  overlapRatio: 0.85,
  viewDistance: 50,
  maxHeight: 500,
  minHeight: -10,
  expandDistance: 0,
  surfaceMode: 'sides',
  visibleRangeOnly: false,
};

export const OV_VIEWGEN_DEFAULTS: OvViewGenParams = {
  pitchRange: [-90, 0],
  sideVariants: { original: true, horizontal: true, leftShift: true, rightShift: true },
  topVariants: { original: true, north: true, east: true, south: true, west: true },
  strategies: {
    layer: { enabled: true, step: 1, limit: 1 },
    horizontalRing: { enabled: true, step: 5, limit: 70 },
    pullNear: { enabled: true, step: 5, limit: 70 },
    liftHeight: { enabled: true, step: 5, limit: 50 },
    pushFar: { enabled: true, step: 5, limit: 50 },
    verticalRing: { enabled: true, step: 5, limit: 70 },
    sphere: { enabled: true, step: 5, sliceStep: 1, limit: 70 },
  },
};

export const OV_VIEWOPT_DEFAULTS: OvViewOptParams = {
  method: 'angle',
  alpha: 55,
  theta: 55,
  viewCount: 15,
  halfDecay: 50,
  halfDecayFaces: 6,
  halfDecayPasses: 5,
  halfDecayAmount: 30,
  recomputeSamples: false,
  terminationCount: 0,
  showVisibilityHeatmap: true,
};

export const OV_PATH_DEFAULTS: OvPathParams = {
  splitMode: 'cluster',
  regionCount: 4,
  costH: 3,
  costV: 6,
  costHRot: 1,
  costVRot: 1,
};

export const OV_SPLIT_DEFAULTS: OvSplitParams = {
  strategy: 'count',
  perSortieCount: 150,
  perSortieLengthM: 3600,
  transitHeight: 100,
  removeNearM: 1,
};

/** 完整 OvDef 默认值（mission 创建时初始化） */
export const OV_DEF_DEFAULTS: OvDef = {
  aoi: undefined,
  noFlyZones: [],
  insertObstacles: [],
  cameraParams: { ...OV_CAMERA_DEFAULTS },
  safetyHull: { ...OV_SAFETY_DEFAULTS },
  samplingParams: { ...OV_SAMPLING_DEFAULTS },
  viewGenParams: structuredClone(OV_VIEWGEN_DEFAULTS),
  viewOptParams: { ...OV_VIEWOPT_DEFAULTS },
  pathParams: { ...OV_PATH_DEFAULTS },
  splitParams: { ...OV_SPLIT_DEFAULTS },
  samples: undefined,
  candidateViews: undefined,
  selectedViews: undefined,
  paths: undefined,
  visibility: undefined,
};

// ---------- Factory ----------

let _waypointSeq = 0;
const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${(++_waypointSeq).toString(36)}`;

export function createBlankMission(init: {
  name: string;
  type: MissionType;
  droneId: string;
  payloadId: string;
}): Mission {
  const now = Date.now();
  const base: Mission = {
    id: newId('m'),
    name: init.name,
    type: init.type,
    droneId: init.droneId,
    payloadId: init.payloadId,
    waypoints: [],
    ...MISSION_DEFAULTS,
    createdAt: now,
    updatedAt: now,
  };
  if (init.type === 'mapping') {
    base.polygon = [];
    base.scanPath = [];
    base.scanParams = { ...MAPPING_DEFAULTS };
  }
  if (init.type === 'facade') {
    base.facadeFaces = [];
    base.activeFaceId = null;
    base.tilesetSource = undefined;
  }
  if (init.type === 'orbit') {
    base.orbit = undefined; // 等 picker 拾完 3 点才建
    base.tilesetSource = undefined;
  }
  if (init.type === 'ov') {
    base.tilesetSource = undefined;
    base.ov = {
      ...OV_DEF_DEFAULTS,
      viewGenParams: structuredClone(OV_VIEWGEN_DEFAULTS),
    };
  }
  return base;
}

/**
 * persist 迁移：补齐 MissionConfig 字段（v2）+ 每 waypoint 补 actions=[]（v3）
 * + mapping 字段 polygon/scanPath/scanParams 兜底（v4）
 * + facade 字段 facadeFaces/tilesetSource 兜底（v5）
 */
export function migrateMissionToLatest(m: Partial<Mission> & Pick<Mission, 'id' | 'name' | 'type' | 'droneId' | 'payloadId' | 'waypoints' | 'createdAt' | 'updatedAt'>): Mission {
  const waypoints = m.waypoints.map((wp) => ({
    ...wp,
    actions: Array.isArray(wp.actions) ? wp.actions : [],
  }));
  const next: Mission = {
    ...MISSION_DEFAULTS,
    ...m,
    waypoints,
  } as Mission;
  if (next.type === 'mapping') {
    next.polygon = Array.isArray(m.polygon) ? m.polygon : [];
    next.scanPath = Array.isArray(m.scanPath)
      ? m.scanPath.map((wp) => ({ ...wp, actions: Array.isArray(wp.actions) ? wp.actions : [] }))
      : [];
    next.scanParams = m.scanParams ?? { ...MAPPING_DEFAULTS };
  }
  if (next.type === 'facade') {
    next.facadeFaces = Array.isArray(m.facadeFaces)
      ? m.facadeFaces.map((f) => ({
          ...f,
          // 老 face 的 params 可能缺 mode/gsdMm/overlap*（v5 之前的 schema），用 FACADE_DEFAULTS 合并兜底
          params: { ...FACADE_DEFAULTS, ...(f.params ?? {}) },
          enabled: typeof f.enabled === 'boolean' ? f.enabled : true,
          scanPath: Array.isArray(f.scanPath)
            ? f.scanPath.map((wp) => ({ ...wp, actions: Array.isArray(wp.actions) ? wp.actions : [] }))
            : undefined,
        }))
      : [];
    next.tilesetSource = m.tilesetSource;
    // 旧 mission 没存 activeFaceId → 选第一个有 scanPath 的 face；都没有就 null
    const firstFaceId = next.facadeFaces?.find((f) => f.enabled !== false)?.id ?? null;
    next.activeFaceId = m.activeFaceId !== undefined ? m.activeFaceId : firstFaceId;
  }
  if (next.type === 'orbit') {
    next.tilesetSource = m.tilesetSource;
    if (m.orbit) {
      next.orbit = {
        ...m.orbit,
        params: { ...ORBIT_DEFAULTS, ...(m.orbit.params ?? {}) },
        scanPath: Array.isArray(m.orbit.scanPath)
          ? m.orbit.scanPath.map((wp) => ({
              ...wp,
              actions: Array.isArray(wp.actions) ? wp.actions : [],
            }))
          : undefined,
      };
    } else {
      next.orbit = undefined;
    }
  }
  if (next.type === 'ov') {
    next.tilesetSource = m.tilesetSource;
    const src = m.ov;
    next.ov = src
      ? {
          ...OV_DEF_DEFAULTS,
          ...src,
          // 子对象逐个合 defaults 兜底
          cameraParams: { ...OV_CAMERA_DEFAULTS, ...(src.cameraParams ?? {}) },
          safetyHull: { ...OV_SAFETY_DEFAULTS, ...(src.safetyHull ?? {}) },
          samplingParams: { ...OV_SAMPLING_DEFAULTS, ...(src.samplingParams ?? {}) },
          viewGenParams: {
            ...structuredClone(OV_VIEWGEN_DEFAULTS),
            ...(src.viewGenParams ?? {}),
          },
          viewOptParams: { ...OV_VIEWOPT_DEFAULTS, ...(src.viewOptParams ?? {}) },
          pathParams: { ...OV_PATH_DEFAULTS, ...(src.pathParams ?? {}) },
          splitParams: { ...OV_SPLIT_DEFAULTS, ...(src.splitParams ?? {}) },
          noFlyZones: Array.isArray(src.noFlyZones) ? src.noFlyZones : [],
          insertObstacles: Array.isArray(src.insertObstacles) ? src.insertObstacles : [],
        }
      : {
          ...OV_DEF_DEFAULTS,
          viewGenParams: structuredClone(OV_VIEWGEN_DEFAULTS),
        };
  }
  return next;
}

export function createWaypoint(init: {
  lon: number;
  lat: number;
  alt: number;
  index: number;
  speed?: number;
  heading?: number;
  pitch?: number;
  fov?: number;
}): Waypoint {
  return {
    id: newId('wp'),
    index: init.index,
    lon: init.lon,
    lat: init.lat,
    alt: init.alt,
    speed: init.speed ?? 5,
    heading: init.heading ?? 0,
    pitch: init.pitch ?? -25,
    fov: init.fov ?? 60,
    actions: [],
  };
}

export function createAction(type: WaypointActionType): WaypointAction {
  return {
    id: newId('act'),
    type,
    ...(type === 'hover' ? { hoverSeconds: 3 } : {}),
  };
}

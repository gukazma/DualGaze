/**
 * DJI WPML 1.0.6 KMZ → Mission 导入。
 *
 * 流程：JSZip 解压 → 拿到 wpmz/waylines.wpml → DOMParser 解析 →
 * 抽 missionConfig + Folder.executeHeightMode + Placemark[] → 映射回 Mission。
 *
 * 容错：
 * - 缺字段走 MISSION_DEFAULTS / 0 / 'goHome' 等兜底
 * - 不识别的 actionActuatorFunc 跳过（会上报到 warnings 数组）
 * - drone/payload 找不到匹配 enum 的也跳过型号设置，给默认 m3e + m3e-cam
 */
import JSZip from 'jszip';
import {
  createAction as buildAction,
  createBlankMission,
  createWaypoint as buildWaypoint,
  DRONE_CATALOG,
  FACADE_DEFAULTS,
  MAPPING_DEFAULTS,
  MISSION_DEFAULTS,
  ORBIT_DEFAULTS,
  PAYLOAD_CATALOG,
  type ExitOnRCLost,
  type FacadeCorner,
  type FacadeFace,
  type FacadeScanParams,
  type FinishAction,
  type FlyToWaylineMode,
  type GlobalCameraAction,
  type HeightMode,
  type MappingScanParams,
  type Mission,
  type MissionType,
  type OrbitDef,
  type OvDef,
  type OvSortie,
  type PolygonVertex,
  type RCLostAction,
  type Waypoint,
  type WaypointAction,
  type WaypointActionType,
} from '../types/mission';
import { generateScanPath } from './mapping-scan';

export interface KmzImportResult {
  mission: Mission;
  /** 未识别的 actionActuatorFunc / 字段告警 */
  warnings: string[];
}

export async function importKmzToMission(file: File): Promise<KmzImportResult> {
  const zip = await JSZip.loadAsync(file);
  const waylinesFile = zip.file('wpmz/waylines.wpml');
  if (!waylinesFile) throw new Error('KMZ 缺少 wpmz/waylines.wpml');
  const waylinesXml = await waylinesFile.async('string');

  const parser = new DOMParser();
  const doc = parser.parseFromString(waylinesXml, 'text/xml');
  const parseError = doc.getElementsByTagName('parsererror')[0];
  if (parseError) {
    throw new Error(`XML 解析失败: ${parseError.textContent ?? '?'}`);
  }

  const warnings: string[] = [];

  // missionConfig
  const cfg = doc.getElementsByTagName('wpml:missionConfig')[0];
  const flyToWaylineMode = readText(cfg, 'wpml:flyToWaylineMode') as FlyToWaylineMode | null;
  const finishAction = readText(cfg, 'wpml:finishAction') as FinishAction | null;
  const exitOnRCLost = readText(cfg, 'wpml:exitOnRCLost') as ExitOnRCLost | null;
  const executeRCLostAction = readText(cfg, 'wpml:executeRCLostAction') as RCLostAction | null;
  const takeOffSecurityHeight = readNumber(cfg, 'wpml:takeOffSecurityHeight');
  const globalSpeed = readNumber(cfg, 'wpml:globalTransitionalSpeed');

  // 找 drone / payload
  const droneEnum = readNumber(cfg, 'wpml:droneEnumValue');
  const droneSubEnum = readNumber(cfg, 'wpml:droneSubEnumValue');
  const payloadEnum = readNumber(cfg, 'wpml:payloadEnumValue');
  // 先按 droneEnum + subEnum 收候选；M3E/M3T/M3M(77) 与 M30/M30T(67) 靠 subEnum 即可区分。
  const droneCandidates =
    droneEnum !== null
      ? DRONE_CATALOG.filter(
          (d) =>
            d.droneEnumValue === droneEnum &&
            (droneSubEnum === null || d.droneSubEnumValue === droneSubEnum),
        )
      : [];
  // M4E/M4T 共用 droneEnumValue=99 且 subEnum 都=0，subEnum 无法区分 → 用 payloadEnumValue 消歧
  // （88→M4E / 89→M4T）。多候选时优先选 payload 对得上的那个。
  let droneMatch: (typeof DRONE_CATALOG)[number] | undefined = droneCandidates[0];
  if (droneCandidates.length > 1 && payloadEnum !== null) {
    const byPayload = droneCandidates.find((d) =>
      d.compatiblePayloads.some(
        (pid) => PAYLOAD_CATALOG.find((p) => p.id === pid)?.payloadEnumValue === payloadEnum,
      ),
    );
    if (byPayload) droneMatch = byPayload;
  }
  const payloadMatch =
    payloadEnum !== null
      ? PAYLOAD_CATALOG.find((p) => p.payloadEnumValue === payloadEnum)
      : undefined;
  if (!droneMatch && droneEnum !== null) {
    warnings.push(`未识别的 droneEnumValue=${droneEnum}, 回退默认 M3E`);
  }
  if (!payloadMatch && payloadEnum !== null) {
    warnings.push(`未识别的 payloadEnumValue=${payloadEnum}, 回退默认 M3E 相机`);
  }

  // 找所有顶层 Folder（waylines.wpml 里每个 Folder 是一架次）
  const folders = Array.from(doc.getElementsByTagName('Folder'));
  const folder = folders[0]; // 第一个用作 mission 级元数据 fallback
  const heightMode = readText(folder, 'wpml:executeHeightMode') as HeightMode | null;

  // v3.2 takeOffPoint：facade / orbit 多架次共用一个 takeOff（export 时所有 Folder 写同一个）
  // 仅在 facade / orbit + heightMode === 'relativeToStartPoint' 时回算高度。
  // patrol / mapping 即便 KMZ 里写了 takeOff XML 也不还原——v1/v2 的内部约定是 wp.alt
  // 全程存 absolute WGS84，export 时不做减法、import 时也不做加法。
  const takeOffPoint = parseTakeOffPoint(folder);

  // 识别 mission 类型：任意一个 Folder 声明 mapping/facade 都算
  const declaredType =
    (folders
      .map((f) => readText(f, 'wpml:dualgazeMissionType') as MissionType | null)
      .find((t) => t !== null) as MissionType | null) ?? null;
  const polygon = parsePolygonFromDoc(doc);
  const scanParams = parseScanParamsFromDoc(doc);
  const isOrbit = declaredType === 'orbit';
  const isOv = declaredType === 'ov';
  const isMapping =
    !isOrbit && !isOv && (declaredType === 'mapping' || (declaredType !== 'facade' && polygon.length >= 3));
  const isFacade = declaredType === 'facade';

  // DualGaze 自定义字段（lossless round-trip）
  const isClosedLoopText = readText(folder, 'wpml:dualgazeIsClosedLoop');
  const isClosedLoop = isClosedLoopText !== null
    ? isClosedLoopText === '1' || isClosedLoopText === 'true'
    : MISSION_DEFAULTS.isClosedLoop;
  const globalAction =
    (readText(folder, 'wpml:dualgazeGlobalAction') as GlobalCameraAction | null) ??
    MISSION_DEFAULTS.globalAction;

  const droneId = droneMatch?.id ?? 'm3e';
  const payloadId =
    payloadMatch?.id ??
    droneMatch?.compatiblePayloads[0] ??
    'm3e-cam';

  // 构建 mission
  const missionType: MissionType = isOrbit
    ? 'orbit'
    : isOv
      ? 'ov'
      : isFacade
        ? 'facade'
        : isMapping
          ? 'mapping'
          : 'patrol';
  const baseMission = createBlankMission({
    name: deriveMissionName(file.name),
    type: missionType,
    droneId,
    payloadId,
  });
  const mission: Mission = {
    ...baseMission,
    globalSpeed: globalSpeed ?? MISSION_DEFAULTS.globalSpeed,
    takeOffSecurityHeight: takeOffSecurityHeight ?? MISSION_DEFAULTS.takeOffSecurityHeight,
    flyToWaylineMode: flyToWaylineMode ?? MISSION_DEFAULTS.flyToWaylineMode,
    finishAction: finishAction ?? MISSION_DEFAULTS.finishAction,
    executeRCLostAction: executeRCLostAction ?? MISSION_DEFAULTS.executeRCLostAction,
    exitOnRCLost: exitOnRCLost ?? MISSION_DEFAULTS.exitOnRCLost,
    heightMode: heightMode ?? MISSION_DEFAULTS.heightMode,
    isClosedLoop,
    globalAction,
  };

  if (isMapping) {
    mission.polygon = polygon;
    mission.scanParams = scanParams ?? { ...MAPPING_DEFAULTS };
  }

  // 写 takeOffPoint（facade / orbit / ov + relative 时有效）
  const takeoffApplicable =
    missionType === 'facade' || missionType === 'orbit' || missionType === 'ov';
  const useRelative =
    takeoffApplicable && heightMode === 'relativeToStartPoint' && takeOffPoint !== null;
  const altOffset = useRelative ? takeOffPoint!.height : 0;
  if (takeOffPoint && takeoffApplicable) {
    mission.takeOffPoint = {
      lon: takeOffPoint.longitude,
      lat: takeOffPoint.latitude,
      alt: takeOffPoint.height,
    };
  }

  if (isOrbit) {
    // orbit 单 wayline：从 dualgazeOrbitDef JSON 还原；fail-safe fallback 用 Placemark 推断
    const orbitDefJson = readText(folder, 'wpml:dualgazeOrbitDef');
    let orbit = parseOrbitDef(orbitDefJson);
    if (!orbit) {
      warnings.push('未找到 dualgazeOrbitDef JSON，orbit 几何无法还原');
    }
    if (orbit) {
      // 用本地算法重算 scanPath（不信任 KMZ 里的航点）
      const placemarks = Array.from(doc.getElementsByTagName('Placemark'));
      const importedPath = parseWaypointsFromPlacemarks(
        placemarks,
        mission.globalSpeed,
        mission.globalAction,
        warnings,
        altOffset,
      );
      orbit = { ...orbit, scanPath: importedPath };
    }
    mission.orbit = orbit ?? undefined;
    mission.waypoints = [];
    mission.updatedAt = Date.now();
    return { mission, warnings };
  }

  if (isOv) {
    // ov 多架次：dualgazeOvSpec JSON 还原参数 + AOI + obstacles + noFly；
    // 每个顶层 Folder = 1 sortie，Placemark → waypoints（直接还原航线，不重算）。
    // samples / candidateViews / selectedViews / visibility 是重产物，不持久化，import 后为空。
    const specJson =
      folders.map((f) => readText(f, 'wpml:dualgazeOvSpec')).find((t) => t !== null) ?? null;
    const spec = parseOvSpec(specJson);
    if (!spec) {
      warnings.push('未找到 dualgazeOvSpec JSON，OV 参数回退默认值');
    }
    const baseOv = mission.ov; // createBlankMission('ov') 已建好默认 OvDef
    if (baseOv && spec) {
      mission.ov = {
        ...baseOv,
        ...spec,
        // 子对象 merge 防止 spec 缺字段
        cameraParams: { ...baseOv.cameraParams, ...(spec.cameraParams ?? {}) },
        safetyHull: { ...baseOv.safetyHull, ...(spec.safetyHull ?? {}) },
        samplingParams: { ...baseOv.samplingParams, ...(spec.samplingParams ?? {}) },
        viewGenParams: { ...baseOv.viewGenParams, ...(spec.viewGenParams ?? {}) },
        viewOptParams: { ...baseOv.viewOptParams, ...(spec.viewOptParams ?? {}) },
        pathParams: { ...baseOv.pathParams, ...(spec.pathParams ?? {}) },
        splitParams: { ...baseOv.splitParams, ...(spec.splitParams ?? {}) },
        noFlyZones: Array.isArray(spec.noFlyZones) ? spec.noFlyZones : [],
        insertObstacles: Array.isArray(spec.insertObstacles) ? spec.insertObstacles : [],
        // 重产物清空
        samples: undefined,
        candidateViews: undefined,
        selectedViews: undefined,
        visibility: undefined,
      };
    }
    // 从各 Folder 还原 sorties（每 Folder = 1 架次）
    const sorties: OvSortie[] = [];
    folders.forEach((fld, fi) => {
      const color = readText(fld, 'wpml:dualgazeOvSortieColor') ?? sortieFallbackColor(fi);
      const fldPlacemarks = Array.from(fld.children).filter((c) => c.tagName === 'Placemark');
      const wps = parseWaypointsFromPlacemarks(
        fldPlacemarks,
        mission.globalSpeed,
        mission.globalAction,
        warnings,
        altOffset,
      );
      if (wps.length > 0) {
        wps.forEach((w) => {
          w.gimbalYaw = w.heading; // OV waypoint gimbalYaw 跟 heading
        });
        sorties.push({ id: `sortie-import-${fi}`, color, waypoints: wps });
      }
    });
    if (mission.ov) mission.ov.paths = sorties.length > 0 ? sorties : undefined;
    mission.waypoints = [];
    mission.updatedAt = Date.now();
    return { mission, warnings };
  }

  if (isFacade) {
    // facade 多架次：每个顶层 Folder = 1 face，对齐 export 的 N waylineId 结构
    const faces: FacadeFace[] = [];
    folders.forEach((fld, fi) => {
      const faceId = readText(fld, 'wpml:dualgazeFaceId') ?? `face-import-${fi}`;
      const faceName = readText(fld, 'wpml:dualgazeFaceName') ?? `立面 ${fi + 1}`;
      const corners = parseFaceCorners(readText(fld, 'wpml:dualgazeFaceCorners'));
      const params = parseFaceParams(readText(fld, 'wpml:dualgazeFaceParams'));
      if (corners.length !== 4) {
        warnings.push(
          `Face "${faceName}" 缺 4 角点信息（可能是非 DualGaze 来源的 KMZ），plane / scanPath 无法重算，仅保留 waypoints`,
        );
      }
      const facePlacemarks = Array.from(fld.children).filter(
        (c) => c.tagName === 'Placemark',
      );
      const facePath = parseWaypointsFromPlacemarks(
        facePlacemarks,
        mission.globalSpeed,
        mission.globalAction,
        warnings,
        altOffset,
      );
      faces.push({
        id: faceId,
        name: faceName,
        corners,
        plane: undefined, // 由 FacadeScanRecomputeHost 看到有 4 corners 时重算
        params,
        scanPath: facePath.length > 0 ? facePath : undefined,
        enabled: true,
      });
    });
    mission.facadeFaces = faces;
    mission.activeFaceId = faces[0]?.id ?? null;
    mission.waypoints = [];
    mission.updatedAt = Date.now();
    return { mission, warnings };
  }

  // patrol / mapping：原逻辑（单 Folder 平铺解析 Placemark）
  const placemarks = Array.from(doc.getElementsByTagName('Placemark'));
  const waypoints = parseWaypointsFromPlacemarks(
    placemarks,
    mission.globalSpeed,
    mission.globalAction,
    warnings,
    altOffset,
  );

  if (isMapping) {
    mission.waypoints = [];
    if (mission.polygon && mission.polygon.length >= 3 && mission.scanParams) {
      mission.scanPath = generateScanPath(mission.polygon, mission.scanParams, {
        alt: mission.globalHeight,
        speed: mission.globalSpeed,
      });
    } else {
      mission.scanPath = waypoints;
    }
  } else {
    mission.waypoints = waypoints;
  }
  mission.updatedAt = Date.now();

  return { mission, warnings };
}

/**
 * 共享给 patrol / facade 的 placemark → Waypoint[] 解析。无 wpml:index 的 Placemark（boundary 等）会被自动跳过。
 *
 * `altOffset`：v3.2 起飞点 relativeToStartPoint 模式下传 takeOff.height，将 KMZ executeHeight
 * 回算成 WGS84 椭球高（mission.scanPath / waypoint.alt 全程存绝对值）。WGS84 模式传 0。
 */
function parseWaypointsFromPlacemarks(
  placemarks: Element[],
  globalSpeedFallback: number,
  globalAction: GlobalCameraAction,
  warnings: string[],
  altOffset: number,
): Waypoint[] {
  const out: Waypoint[] = [];
  for (let i = 0; i < placemarks.length; i++) {
    const pm = placemarks[i];
    const wpIdxText = readText(pm, 'wpml:index');
    if (wpIdxText === null) continue;
    const coordsText = readText(pm, 'coordinates');
    if (!coordsText) {
      warnings.push(`Placemark #${i} 缺 <coordinates>，跳过`);
      continue;
    }
    const [lonStr, latStr] = coordsText.split(',').map((s) => s.trim());
    const lon = parseFloat(lonStr);
    const lat = parseFloat(latStr);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      warnings.push(`Placemark #${i} 坐标解析失败: "${coordsText}"`);
      continue;
    }
    const execHeight = readNumber(pm, 'wpml:executeHeight') ?? 0;
    const alt = execHeight + altOffset;
    const speed = readNumber(pm, 'wpml:waypointSpeed') ?? globalSpeedFallback;
    const heading = readNumber(pm, 'wpml:waypointHeadingAngle') ?? 0;
    const pitch = readNumber(pm, 'wpml:waypointGimbalPitchAngle') ?? -25;
    const fov = readNumber(pm, 'wpml:dualgazeFov') ?? 60;

    const wp = buildWaypoint({
      index: out.length,
      lon,
      lat,
      alt,
      speed,
      heading,
      pitch,
      fov,
    });
    wp.actions = parseActionsFromPlacemark(pm, globalAction, warnings);
    out.push(wp);
  }
  return out;
}

/** 解析 face corners 字符串："lon,lat,alt lon,lat,alt ..."（4 个） */
function parseFaceCorners(text: string | null): FacadeCorner[] {
  if (!text) return [];
  return text
    .trim()
    .split(/\s+/)
    .map((triple) => {
      const [lonStr, latStr, altStr] = triple.split(',');
      return {
        lon: parseFloat(lonStr),
        lat: parseFloat(latStr),
        alt: parseFloat(altStr ?? '0') || 0,
      };
    })
    .filter((c) => Number.isFinite(c.lon) && Number.isFinite(c.lat));
}

/** 解析 face params JSON（导出时 stringify FACADE_DEFAULTS shape）—— 失败用默认值 */
function parseFaceParams(text: string | null): FacadeScanParams {
  if (!text) return { ...FACADE_DEFAULTS };
  try {
    const parsed = JSON.parse(text) as Partial<FacadeScanParams>;
    return { ...FACADE_DEFAULTS, ...parsed };
  } catch {
    return { ...FACADE_DEFAULTS };
  }
}

/** 解析 <wpml:takeOffPoint>（latitude/longitude/height）— 返回 null 表示 KMZ 没写 */
function parseTakeOffPoint(
  folder: Element | undefined,
): { latitude: number; longitude: number; height: number } | null {
  if (!folder) return null;
  const el = folder.getElementsByTagName('wpml:takeOffPoint')[0];
  if (!el) return null;
  const lat = readNumber(el, 'wpml:latitude');
  const lon = readNumber(el, 'wpml:longitude');
  const h = readNumber(el, 'wpml:height');
  if (lat === null || lon === null || h === null) return null;
  return { latitude: lat, longitude: lon, height: h };
}

/** 解析 OrbitDef JSON；缺字段用 ORBIT_DEFAULTS 兜底 */
function parseOrbitDef(text: string | null): OrbitDef | null {
  if (!text) return null;
  try {
    const j = JSON.parse(text) as Partial<OrbitDef>;
    if (!j.axisBottom || !j.axisTop || typeof j.radius !== 'number') return null;
    return {
      axisBottom: j.axisBottom,
      axisTop: j.axisTop,
      radius: j.radius,
      fitPoints: Array.isArray(j.fitPoints) ? j.fitPoints : undefined,
      params: { ...ORBIT_DEFAULTS, ...(j.params ?? {}) },
    };
  } catch {
    return null;
  }
}

/** 解析 OvDef spec JSON（导出时 stringify 的参数子集）—— 失败返回 null。 */
function parseOvSpec(text: string | null): Partial<OvDef> | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as Partial<OvDef>;
  } catch {
    return null;
  }
}

const OV_SORTIE_FALLBACK_COLORS = [
  '#38bdf8',
  '#ef4444',
  '#4ade80',
  '#ffd24a',
  '#a78bfa',
  '#ff6b35',
  '#22d3ee',
  '#f472b6',
];
function sortieFallbackColor(i: number): string {
  return OV_SORTIE_FALLBACK_COLORS[i % OV_SORTIE_FALLBACK_COLORS.length];
}

// ===== mapping 辅助 =====

function parsePolygonFromDoc(doc: Document): PolygonVertex[] {
  const placemarks = Array.from(doc.getElementsByTagName('Placemark'));
  for (const pm of placemarks) {
    const polygons = pm.getElementsByTagName('Polygon');
    if (polygons.length === 0) continue;
    const linearRings = polygons[0].getElementsByTagName('LinearRing');
    if (linearRings.length === 0) continue;
    const coordsEl = linearRings[0].getElementsByTagName('coordinates')[0];
    if (!coordsEl?.textContent) continue;
    return coordsEl.textContent
      .trim()
      .split(/\s+/)
      .map((triple) => {
        const [lonStr, latStr, altStr] = triple.split(',');
        return {
          lon: parseFloat(lonStr),
          lat: parseFloat(latStr),
          alt: parseFloat(altStr ?? '0') || 0,
        };
      })
      .filter((v) => Number.isFinite(v.lon) && Number.isFinite(v.lat));
  }
  return [];
}

function parseScanParamsFromDoc(doc: Document): MappingScanParams | null {
  const el = doc.getElementsByTagName('wpml:dualgazeScanParams')[0];
  if (!el) return null;
  const spacing = readNumber(el, 'wpml:spacing');
  const direction = readNumber(el, 'wpml:direction');
  const margin = readNumber(el, 'wpml:margin');
  const gimbalPitchAngle = readNumber(el, 'wpml:gimbalPitchAngle');
  const overlapH = readNumber(el, 'wpml:overlapH');
  const overlapW = readNumber(el, 'wpml:overlapW');
  return {
    spacing: spacing ?? MAPPING_DEFAULTS.spacing,
    direction: direction ?? MAPPING_DEFAULTS.direction,
    margin: margin ?? MAPPING_DEFAULTS.margin,
    gimbalPitchAngle: gimbalPitchAngle ?? MAPPING_DEFAULTS.gimbalPitchAngle,
    overlapH: overlapH ?? MAPPING_DEFAULTS.overlapH,
    overlapW: overlapW ?? MAPPING_DEFAULTS.overlapW,
  };
}

function parseActionsFromPlacemark(
  pm: Element,
  globalAction: GlobalCameraAction,
  warnings: string[],
): WaypointAction[] {
  const out: WaypointAction[] = [];
  const actionEls = Array.from(pm.getElementsByTagName('wpml:action'));
  for (const ael of actionEls) {
    const func = readText(ael, 'wpml:actionActuatorFunc');
    if (!func) continue;
    // 跳过全局动作 marker（导出时附加的，导入时由 globalAction 字段还原）
    if (globalAction !== 'none' && func === globalAction) {
      // 检查这是不是全局动作（actionGroup 的 marker）—— 用法简单：
      // 如果出现次数刚好 = waypoint 数（每个一次），认为是全局；否则当用户自加
      // 这里保守做法：如果是全局动作，那 KMZ 里至少有 N 个 reachPoint trigger
      // 简化处理：跳过第一个匹配 globalAction 的，剩下的当用户加的
      // 实际更稳妥的方式是看 actionGroupId，但 v1 不深究
      continue;
    }
    if (!isKnownActionType(func)) {
      warnings.push(`未识别的 action 类型 "${func}"，已跳过`);
      continue;
    }
    const action = buildAction(func);
    if (func === 'hover') {
      const t = readNumber(ael, 'wpml:hoverTime');
      if (t !== null && Number.isFinite(t)) action.hoverSeconds = t;
    }
    out.push(action);
  }
  return out;
}

function isKnownActionType(s: string): s is WaypointActionType {
  return s === 'takePhoto' || s === 'startRecord' || s === 'stopRecord' || s === 'hover';
}

// ===== XML helpers =====

function readText(parent: Element | null | undefined, tagName: string): string | null {
  if (!parent) return null;
  const els = parent.getElementsByTagName(tagName);
  // 优先取 parent 的直接子节点（同名嵌套时避免穿透）
  for (const el of Array.from(els)) {
    if (el.parentNode === parent) return el.textContent?.trim() ?? null;
  }
  // 兜底拿第一个
  return els[0]?.textContent?.trim() ?? null;
}

function readNumber(parent: Element | null | undefined, tagName: string): number | null {
  const t = readText(parent, tagName);
  if (t === null) return null;
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

function deriveMissionName(filename: string): string {
  return filename.replace(/\.kmz$/i, '').trim() || '导入的航线';
}

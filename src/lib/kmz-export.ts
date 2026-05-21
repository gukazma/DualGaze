/**
 * Mission → DJI WPML 1.0.6 KMZ 导出。
 *
 * KMZ 结构：zip 包含 `wpmz/template.kml` + `wpmz/waylines.wpml` 两份 XML。
 * 参考 dji_way_line/src/utils/kmzGenerator.js（396 行原版）。
 *
 * 类型分支：
 *   - patrol：用 mission.waypoints 当 Placemark 列表 → 1 个 Folder
 *   - mapping：用 scanPath + polygon boundary + dualgazeScanParams → 1 个 Folder
 *   - facade：**每个 enabled face 一个 Folder**，对齐 DPGO "1 face = 1 wayline = 1 架次"
 *     模型；DJI Pilot 2 / 智图 打开时把每个 Folder 列成一个独立架次让操作员选。
 *
 * Round-trip 兼容性：所有 MissionConfig 字段都能写入并被 kmz-import 还原。
 * facade 用 `<wpml:dualgazeFaceId>` / `<wpml:dualgazeFaceName>` 自定义 ns
 * 保留 face 元信息（id 用于 round-trip 一致）。
 * `isClosedLoop` / `fov` 这两个 DJI 标准没有对应字段的，按默认值还原（lossy）。
 */
import JSZip from 'jszip';
import {
  DRONE_CATALOG,
  PAYLOAD_CATALOG,
  type HeightMode,
  type MappingScanParams,
  type Mission,
  type PolygonVertex,
  type Waypoint,
  type WaypointAction,
} from '../types/mission';

/**
 * v3.2 takeOffPoint 换算：
 * - facade / orbit + mission.takeOffPoint 存在 → 强制 relativeToStartPoint，
 *   executeHeight = wp.alt - takeOffPoint.alt（KMZ store alt 仍是 WGS84 椭球高）
 * - 其它 → 走 mission.heightMode（旧行为）
 */
function hasMissionTakeOff(mission: Mission): boolean {
  return (
    (mission.type === 'facade' || mission.type === 'orbit') &&
    !!mission.takeOffPoint
  );
}

function effectiveHeightMode(mission: Mission): HeightMode {
  if (hasMissionTakeOff(mission)) return 'relativeToStartPoint';
  return mission.heightMode;
}

function effectiveExecuteHeight(mission: Mission, wp: Waypoint): number {
  if (hasMissionTakeOff(mission)) {
    return wp.alt - mission.takeOffPoint!.alt;
  }
  return wp.alt;
}

/**
 * 一个架次（wayline）。facade mission 一面 = 一架次；其它 mission 整条 = 一架次。
 * waylineId 是 DJI WPML 用来在 Pilot 2 上区分多架次的唯一 id。
 */
interface WaylineSegment {
  waylineId: number;
  /** 仅 facade 有；用于 round-trip 还原 facadeFaces[].id */
  faceId?: string;
  /** 仅 facade 有；用于 round-trip 还原 facadeFaces[].name */
  faceName?: string;
  /** 仅 facade 有；用于 round-trip 还原 face.corners（4 个 wgs84 角点） */
  faceCorners?: { lon: number; lat: number; alt: number }[];
  /** 仅 facade 有；用于 round-trip 还原 face.params（FacadeScanParams JSON） */
  faceParamsJson?: string;
  /** 仅 orbit 有；OrbitDef JSON（含 axis / radius / params），让 round-trip 还原几何 */
  orbitDefJson?: string;
  waypoints: Waypoint[];
}

/** 把一个 mission 拆成 N 个 wayline segment（facade N 面 → N 段；其它单段） */
function buildWaylineSegments(mission: Mission): WaylineSegment[] {
  if (mission.type === 'mapping') {
    return [{ waylineId: 0, waypoints: (mission.scanPath ?? []).map(reindex) }];
  }
  if (mission.type === 'facade') {
    const faces = (mission.facadeFaces ?? []).filter((f) => f.enabled !== false);
    if (faces.length === 0) {
      // 没有任何启用的 face → 仍输出 1 个空段，让 KMZ schema 合法
      return [{ waylineId: 0, waypoints: [] }];
    }
    return faces.map((f, i) => ({
      waylineId: i,
      faceId: f.id,
      faceName: f.name,
      faceCorners: f.corners.map((c) => ({ lon: c.lon, lat: c.lat, alt: c.alt })),
      faceParamsJson: JSON.stringify(f.params),
      waypoints: (f.scanPath ?? []).map(reindex),
    }));
  }
  if (mission.type === 'orbit') {
    return [
      {
        waylineId: 0,
        waypoints: (mission.orbit?.scanPath ?? []).map(reindex),
        orbitDefJson: mission.orbit
          ? JSON.stringify({
              axisBottom: mission.orbit.axisBottom,
              axisTop: mission.orbit.axisTop,
              radius: mission.orbit.radius,
              params: mission.orbit.params,
            })
          : undefined,
      },
    ];
  }
  return [{ waylineId: 0, waypoints: mission.waypoints.map(reindex) }];
}

function reindex(wp: Waypoint, idx: number): Waypoint {
  return { ...wp, index: idx };
}

function xmlEscape(s: string | undefined): string {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 给 orbit Folder 序列化 OrbitDef JSON（含 axis / radius / params） */
function orbitMetaXml(seg: WaylineSegment): string {
  if (!seg.orbitDefJson) return '';
  return `\n      <wpml:dualgazeOrbitDef>${xmlEscape(seg.orbitDefJson)}</wpml:dualgazeOrbitDef>`;
}

/** 给 facade Folder 序列化 face 元数据（id/name/4 角点/params JSON）—— 让 import lossless 还原 */
function facadeFaceMetaXml(seg: WaylineSegment): string {
  if (!seg.faceId) return '';
  const cornersXml =
    seg.faceCorners && seg.faceCorners.length > 0
      ? `\n      <wpml:dualgazeFaceCorners>${seg.faceCorners
          .map((c) => `${c.lon.toFixed(7)},${c.lat.toFixed(7)},${c.alt}`)
          .join(' ')}</wpml:dualgazeFaceCorners>`
      : '';
  const paramsXml = seg.faceParamsJson
    ? `\n      <wpml:dualgazeFaceParams>${xmlEscape(seg.faceParamsJson)}</wpml:dualgazeFaceParams>`
    : '';
  return `\n      <wpml:dualgazeFaceId>${xmlEscape(seg.faceId)}</wpml:dualgazeFaceId>\n      <wpml:dualgazeFaceName>${xmlEscape(seg.faceName)}</wpml:dualgazeFaceName>${cornersXml}${paramsXml}`;
}

const WPML_NS = 'http://www.dji.com/wpmz/1.0.6';
const KML_NS = 'http://www.opengis.net/kml/2.2';

export async function exportMissionToKmz(mission: Mission): Promise<Blob> {
  const zip = new JSZip();
  const wpmz = zip.folder('wpmz');
  if (!wpmz) throw new Error('JSZip folder failed');
  wpmz.file('template.kml', buildTemplateKml(mission));
  wpmz.file('waylines.wpml', buildWaylinesWpml(mission));
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.google-earth.kmz' });
}

// ===== template.kml =====

function buildTemplateKml(mission: Mission): string {
  const drone = DRONE_CATALOG.find((d) => d.id === mission.droneId);
  const payload = PAYLOAD_CATALOG.find((p) => p.id === mission.payloadId);
  const now = Date.now();
  const segs = buildWaylineSegments(mission);
  const isMapping = mission.type === 'mapping';
  const polygonPlacemarkXml = isMapping
    ? buildPolygonPlacemarkXml(mission.polygon ?? [])
    : '';
  const scanParamsXml = isMapping
    ? buildScanParamsXml(mission.scanParams)
    : '';

  const foldersXml = segs
    .map((seg) => buildTemplateFolder(mission, seg, polygonPlacemarkXml, scanParamsXml))
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="${KML_NS}" xmlns:wpml="${WPML_NS}">
  <Document>
    <wpml:author>DualGaze</wpml:author>
    <wpml:createTime>${now}</wpml:createTime>
    <wpml:updateTime>${now}</wpml:updateTime>
    <wpml:missionConfig>
      <wpml:flyToWaylineMode>${mission.flyToWaylineMode}</wpml:flyToWaylineMode>
      <wpml:finishAction>${mission.finishAction}</wpml:finishAction>
      <wpml:exitOnRCLost>${mission.exitOnRCLost}</wpml:exitOnRCLost>
      <wpml:executeRCLostAction>${mission.executeRCLostAction}</wpml:executeRCLostAction>
      <wpml:takeOffSecurityHeight>${mission.takeOffSecurityHeight}</wpml:takeOffSecurityHeight>
      <wpml:globalTransitionalSpeed>${mission.globalSpeed}</wpml:globalTransitionalSpeed>
      <wpml:droneInfo>
        <wpml:droneEnumValue>${drone?.droneEnumValue ?? 0}</wpml:droneEnumValue>
        <wpml:droneSubEnumValue>${drone?.droneSubEnumValue ?? 0}</wpml:droneSubEnumValue>
      </wpml:droneInfo>
      <wpml:waylineAvoidLimitAreaMode>0</wpml:waylineAvoidLimitAreaMode>
      <wpml:payloadInfo>
        <wpml:payloadEnumValue>${payload?.payloadEnumValue ?? 0}</wpml:payloadEnumValue>
        <wpml:payloadSubEnumValue>0</wpml:payloadSubEnumValue>
        <wpml:payloadPositionIndex>${payload?.payloadPositionIndex ?? 0}</wpml:payloadPositionIndex>
      </wpml:payloadInfo>
    </wpml:missionConfig>
${foldersXml}
  </Document>
</kml>`;
}

function buildTemplateFolder(
  mission: Mission,
  seg: WaylineSegment,
  polygonPlacemarkXml: string,
  scanParamsXml: string,
): string {
  const faceMetaXml = facadeFaceMetaXml(seg) + orbitMetaXml(seg);
  const takeOffPointXml = buildTakeOffPointXml(mission, seg);
  return `    <Folder>
      <wpml:templateType>waypoint</wpml:templateType>
      <wpml:dualgazeMissionType>${mission.type}</wpml:dualgazeMissionType>
      <wpml:templateId>${seg.waylineId}</wpml:templateId>${faceMetaXml}
      <wpml:waylineCoordinateSysParam>
        <wpml:coordinateMode>WGS84</wpml:coordinateMode>
        <wpml:heightMode>${effectiveHeightMode(mission)}</wpml:heightMode>
      </wpml:waylineCoordinateSysParam>
      <wpml:autoFlightSpeed>${mission.globalSpeed}</wpml:autoFlightSpeed>${takeOffPointXml}
      <wpml:globalWaypointTurnMode>toPointAndStopWithDiscontinuityCurvature</wpml:globalWaypointTurnMode>
      <wpml:globalUseStraightLine>1</wpml:globalUseStraightLine>
${polygonPlacemarkXml}${seg.waypoints.map((wp, i) => buildTemplatePlacemark(wp, i, mission)).join('\n')}
      <wpml:dualgazeIsClosedLoop>${mission.isClosedLoop ? 1 : 0}</wpml:dualgazeIsClosedLoop>
      <wpml:dualgazeGlobalAction>${mission.globalAction}</wpml:dualgazeGlobalAction>
${scanParamsXml}    </Folder>`;
}

function buildTemplatePlacemark(wp: Waypoint, index: number, mission: Mission): string {
  return `      <Placemark>
        <Point>
          <coordinates>${wp.lon.toFixed(7)},${wp.lat.toFixed(7)}</coordinates>
        </Point>
        <wpml:index>${index}</wpml:index>
        <wpml:executeHeight>${effectiveExecuteHeight(mission, wp)}</wpml:executeHeight>
        <wpml:waypointSpeed>${wp.speed}</wpml:waypointSpeed>
        <wpml:waypointHeadingParam>
          <wpml:waypointHeadingMode>smoothTransition</wpml:waypointHeadingMode>
          <wpml:waypointHeadingAngle>${wp.heading}</wpml:waypointHeadingAngle>
          <wpml:waypointHeadingAngleEnable>1</wpml:waypointHeadingAngleEnable>
        </wpml:waypointHeadingParam>
        <wpml:waypointGimbalHeadingParam>
          <wpml:waypointGimbalPitchAngle>${wp.pitch}</wpml:waypointGimbalPitchAngle>
          <wpml:waypointGimbalYawAngle>${wp.gimbalYaw ?? 0}</wpml:waypointGimbalYawAngle>
        </wpml:waypointGimbalHeadingParam>
        <wpml:dualgazeFov>${wp.fov}</wpml:dualgazeFov>
      </Placemark>`;
}

// ===== waylines.wpml =====

function buildWaylinesWpml(mission: Mission): string {
  const drone = DRONE_CATALOG.find((d) => d.id === mission.droneId);
  const payload = PAYLOAD_CATALOG.find((p) => p.id === mission.payloadId);
  const segs = buildWaylineSegments(mission);
  const isMapping = mission.type === 'mapping';
  const polygonPlacemarkXml = isMapping
    ? buildPolygonPlacemarkXml(mission.polygon ?? [])
    : '';
  const scanParamsXml = isMapping ? buildScanParamsXml(mission.scanParams) : '';
  const startActionXml = isMapping
    ? buildStartActionGroupXml(mission.scanParams?.gimbalPitchAngle ?? -45)
    : '';

  const foldersXml = segs
    .map((seg) =>
      buildWaylineFolder(
        mission,
        seg,
        startActionXml,
        polygonPlacemarkXml,
        scanParamsXml,
        isMapping,
      ),
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="${KML_NS}" xmlns:wpml="${WPML_NS}">
  <Document>
    <wpml:missionConfig>
      <wpml:flyToWaylineMode>${mission.flyToWaylineMode}</wpml:flyToWaylineMode>
      <wpml:finishAction>${mission.finishAction}</wpml:finishAction>
      <wpml:exitOnRCLost>${mission.exitOnRCLost}</wpml:exitOnRCLost>
      <wpml:executeRCLostAction>${mission.executeRCLostAction}</wpml:executeRCLostAction>
      <wpml:takeOffSecurityHeight>${mission.takeOffSecurityHeight}</wpml:takeOffSecurityHeight>
      <wpml:globalTransitionalSpeed>${mission.globalSpeed}</wpml:globalTransitionalSpeed>
      <wpml:droneInfo>
        <wpml:droneEnumValue>${drone?.droneEnumValue ?? 0}</wpml:droneEnumValue>
        <wpml:droneSubEnumValue>${drone?.droneSubEnumValue ?? 0}</wpml:droneSubEnumValue>
      </wpml:droneInfo>
      <wpml:waylineAvoidLimitAreaMode>0</wpml:waylineAvoidLimitAreaMode>
      <wpml:payloadInfo>
        <wpml:payloadEnumValue>${payload?.payloadEnumValue ?? 0}</wpml:payloadEnumValue>
        <wpml:payloadSubEnumValue>0</wpml:payloadSubEnumValue>
        <wpml:payloadPositionIndex>${payload?.payloadPositionIndex ?? 0}</wpml:payloadPositionIndex>
      </wpml:payloadInfo>
    </wpml:missionConfig>
${foldersXml}
  </Document>
</kml>`;
}

function buildWaylineFolder(
  mission: Mission,
  seg: WaylineSegment,
  startActionXml: string,
  polygonPlacemarkXml: string,
  scanParamsXml: string,
  isMapping: boolean,
): string {
  const distance = totalPathDistance(seg.waypoints).toFixed(1);
  const duration =
    mission.globalSpeed > 0
      ? Math.round(parseFloat(distance) / mission.globalSpeed)
      : 0;
  const faceMetaXml = facadeFaceMetaXml(seg) + orbitMetaXml(seg);
  const takeOffPointXml = buildTakeOffPointXml(mission, seg);
  const placemarks = seg.waypoints
    .map((wp, i, all) =>
      buildWaylinePlacemark(wp, i, all.length, mission.globalAction, isMapping, mission),
    )
    .join('\n');

  return `    <Folder>
      <wpml:templateId>${seg.waylineId}</wpml:templateId>
      <wpml:waylineId>${seg.waylineId}</wpml:waylineId>
      <wpml:dualgazeMissionType>${mission.type}</wpml:dualgazeMissionType>${faceMetaXml}
      <wpml:distance>${distance}</wpml:distance>
      <wpml:duration>${duration}</wpml:duration>
      <wpml:autoFlightSpeed>${mission.globalSpeed}</wpml:autoFlightSpeed>
      <wpml:executeHeightMode>${effectiveHeightMode(mission)}</wpml:executeHeightMode>${takeOffPointXml}
${startActionXml}${polygonPlacemarkXml}${placemarks}
      <wpml:dualgazeIsClosedLoop>${mission.isClosedLoop ? 1 : 0}</wpml:dualgazeIsClosedLoop>
      <wpml:dualgazeGlobalAction>${mission.globalAction}</wpml:dualgazeGlobalAction>
${scanParamsXml}    </Folder>`;
}

function buildWaylinePlacemark(
  wp: Waypoint,
  index: number,
  total: number,
  globalAction: Mission['globalAction'],
  isMapping: boolean,
  mission: Mission,
): string {
  const isEndpoint = index === 0 || index === total - 1;
  const turnMode = isEndpoint
    ? 'toPointAndStopWithContinuityCurvature'
    : 'coordinateTurn';
  const dampDist = isEndpoint ? '0' : '0.2';

  const actions: WaypointAction[] = [...wp.actions];
  if (globalAction !== 'none') {
    // 全局动作在每个航点 reachPoint 时触发一次
    actions.push({ id: `__global_${index}`, type: globalAction });
  }
  // mapping 模式：末点自动追加 stopRecord（startRecord 在 startActionGroup 里）
  if (isMapping && index === total - 1) {
    actions.push({ id: `__mapping_stop`, type: 'stopRecord' });
  }
  const actionGroupXml = actions.length > 0 ? buildActionGroupXml(index, actions) : '';

  return `      <Placemark>
        <Point>
          <coordinates>${wp.lon.toFixed(7)},${wp.lat.toFixed(7)}</coordinates>
        </Point>
        <wpml:index>${index}</wpml:index>
        <wpml:executeHeight>${effectiveExecuteHeight(mission, wp)}</wpml:executeHeight>
        <wpml:waypointSpeed>${wp.speed}</wpml:waypointSpeed>
        <wpml:waypointHeadingParam>
          <wpml:waypointHeadingMode>smoothTransition</wpml:waypointHeadingMode>
          <wpml:waypointHeadingAngle>${wp.heading}</wpml:waypointHeadingAngle>
          <wpml:waypointHeadingAngleEnable>1</wpml:waypointHeadingAngleEnable>
        </wpml:waypointHeadingParam>
        <wpml:waypointTurnParam>
          <wpml:waypointTurnMode>${turnMode}</wpml:waypointTurnMode>
          <wpml:waypointTurnDampingDist>${dampDist}</wpml:waypointTurnDampingDist>
        </wpml:waypointTurnParam>
        <wpml:useStraightLine>1</wpml:useStraightLine>
        <wpml:waypointGimbalHeadingParam>
          <wpml:waypointGimbalPitchAngle>${wp.pitch}</wpml:waypointGimbalPitchAngle>
          <wpml:waypointGimbalYawAngle>${wp.gimbalYaw ?? 0}</wpml:waypointGimbalYawAngle>
        </wpml:waypointGimbalHeadingParam>
        <wpml:waypointWorkType>0</wpml:waypointWorkType>
        <wpml:isRisky>0</wpml:isRisky>
        <wpml:dualgazeFov>${wp.fov}</wpml:dualgazeFov>
${actionGroupXml}      </Placemark>`;
}

function buildActionGroupXml(wpIndex: number, actions: WaypointAction[]): string {
  const actionElements = actions
    .map((a, i) => buildActionXml(a, i))
    .filter((x) => x.length > 0)
    .join('\n');
  if (!actionElements) return '';
  return `        <wpml:actionGroup>
          <wpml:actionGroupId>${wpIndex}</wpml:actionGroupId>
          <wpml:actionGroupStartIndex>${wpIndex}</wpml:actionGroupStartIndex>
          <wpml:actionGroupEndIndex>${wpIndex}</wpml:actionGroupEndIndex>
          <wpml:actionGroupMode>sequence</wpml:actionGroupMode>
          <wpml:actionTrigger>
            <wpml:actionTriggerType>reachPoint</wpml:actionTriggerType>
          </wpml:actionTrigger>
${actionElements}
        </wpml:actionGroup>
`;
}

function buildActionXml(action: WaypointAction, id: number): string {
  switch (action.type) {
    case 'takePhoto':
    case 'startRecord':
    case 'stopRecord':
      return `          <wpml:action>
            <wpml:actionId>${id}</wpml:actionId>
            <wpml:actionActuatorFunc>${action.type}</wpml:actionActuatorFunc>
            <wpml:actionActuatorFuncParam>
              <wpml:payloadPositionIndex>0</wpml:payloadPositionIndex>
            </wpml:actionActuatorFuncParam>
          </wpml:action>`;
    case 'hover':
      return `          <wpml:action>
            <wpml:actionId>${id}</wpml:actionId>
            <wpml:actionActuatorFunc>hover</wpml:actionActuatorFunc>
            <wpml:actionActuatorFuncParam>
              <wpml:hoverTime>${action.hoverSeconds ?? 3}</wpml:hoverTime>
            </wpml:actionActuatorFuncParam>
          </wpml:action>`;
    default:
      return '';
  }
}

function buildTakeOffPointXml(mission: Mission, seg: WaylineSegment): string {
  // v3.2 优先用 mission.takeOffPoint（facade / orbit 由用户主动 pick 的全局起飞点，
  // 一个 mission 一个，多架次共用）。设了 → 所有 Folder 都写同一个 takeOffPoint，
  // executeHeight 也基于它做减法（见 effectiveExecuteHeight）。
  if (hasMissionTakeOff(mission)) {
    const t = mission.takeOffPoint!;
    return `
      <wpml:takeOffPoint>
        <wpml:latitude>${t.lat.toFixed(7)}</wpml:latitude>
        <wpml:longitude>${t.lon.toFixed(7)}</wpml:longitude>
        <wpml:height>${t.alt}</wpml:height>
      </wpml:takeOffPoint>`;
  }
  // facade / orbit 没设 takeOffPoint → 不写 takeOff XML，避免 import 端把 wp.alt 错误回算。
  if (mission.type === 'facade' || mission.type === 'orbit') return '';
  // patrol / mapping：保留旧逻辑兜底（heightMode != WGS84 时取该架次首点当 anchor）。
  // 这套数据 round-trip 不是完全对称的（wp.alt 翻倍），但 DJI Pilot 2 端语义 OK。
  // 修这个 v1 历史 bug 不在 v3.2 范围内。
  if (mission.heightMode === 'WGS84') return '';
  if (seg.waypoints.length === 0) return '';
  const first = seg.waypoints[0];
  return `
      <wpml:takeOffPoint>
        <wpml:latitude>${first.lat.toFixed(7)}</wpml:latitude>
        <wpml:longitude>${first.lon.toFixed(7)}</wpml:longitude>
        <wpml:height>${first.alt}</wpml:height>
      </wpml:takeOffPoint>`;
}

// ===== mapping XML 片段 =====

/** mapping 多边形 boundary：包成一个无 index 的 Placemark+Polygon，DJI Pilot 2 当 hint */
function buildPolygonPlacemarkXml(polygon: PolygonVertex[]): string {
  if (polygon.length < 3) return '';
  const coords = polygon
    .map((v) => `${v.lon.toFixed(7)},${v.lat.toFixed(7)},${v.alt}`)
    .join(' ');
  return `      <Placemark>
        <Polygon>
          <outerBoundaryIs>
            <LinearRing>
              <coordinates>${coords}</coordinates>
            </LinearRing>
          </outerBoundaryIs>
        </Polygon>
      </Placemark>
`;
}

function buildScanParamsXml(params: MappingScanParams | undefined): string {
  if (!params) return '';
  return `      <wpml:dualgazeScanParams>
        <wpml:spacing>${params.spacing}</wpml:spacing>
        <wpml:direction>${params.direction}</wpml:direction>
        <wpml:margin>${params.margin}</wpml:margin>
        <wpml:gimbalPitchAngle>${params.gimbalPitchAngle}</wpml:gimbalPitchAngle>
        <wpml:overlapH>${params.overlapH}</wpml:overlapH>
        <wpml:overlapW>${params.overlapW}</wpml:overlapW>
      </wpml:dualgazeScanParams>
`;
}

/** mapping 起飞 actionGroup：gimbalRotate + startRecord（dji_way_line 模式） */
function buildStartActionGroupXml(gimbalPitch: number): string {
  return `      <wpml:startActionGroup>
        <wpml:action>
          <wpml:actionId>0</wpml:actionId>
          <wpml:actionActuatorFunc>gimbalRotate</wpml:actionActuatorFunc>
          <wpml:actionActuatorFuncParam>
            <wpml:gimbalPitchRotateEnable>1</wpml:gimbalPitchRotateEnable>
            <wpml:gimbalPitchRotateAngle>${gimbalPitch}</wpml:gimbalPitchRotateAngle>
          </wpml:actionActuatorFuncParam>
        </wpml:action>
        <wpml:action>
          <wpml:actionId>1</wpml:actionId>
          <wpml:actionActuatorFunc>startRecord</wpml:actionActuatorFunc>
          <wpml:actionActuatorFuncParam>
            <wpml:payloadPositionIndex>0</wpml:payloadPositionIndex>
          </wpml:actionActuatorFuncParam>
        </wpml:action>
      </wpml:startActionGroup>
`;
}

// ===== helpers =====

const EARTH_R = 6378137;
function totalPathDistance(waypoints: Waypoint[]): number {
  let d = 0;
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i];
    const b = waypoints[i + 1];
    const phi1 = (a.lat * Math.PI) / 180;
    const phi2 = (b.lat * Math.PI) / 180;
    const dPhi = ((b.lat - a.lat) * Math.PI) / 180;
    const dLam = ((b.lon - a.lon) * Math.PI) / 180;
    const s =
      Math.sin(dPhi / 2) ** 2 +
      Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLam / 2) ** 2;
    d += EARTH_R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  }
  return d;
}

import {
  useEffect,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { runCampaignEventHooks, type CampaignEventCardSpec } from "../../event-api";
import { ACADEMIC_YEAR_END_ISO, CALENDAR_EVENTS, DECISIONS } from "../../campaign-content";
import { TACTICAL_EVENTS, type TacticalEventDefinition } from "../../tactical-events";
import { PathfindingWorkerPool } from "../../pathfinding-pool";
import { PerformanceController } from "../../performance-controller";
import { isMobileClient, mobileSiteHitRadius } from "../../mobile-support";
import {REAL_BUILDING_BY_KEY,REAL_LANDMARK_BY_KEY,REAL_LANDMARK_BY_SITE,isRealCampus,mapRegionsFor} from "../map-profile";
import {SATELLITE_TREE_POINTS} from "../real-campus-satellite-trees";
import { EVENT_CARDS } from "../events/event-cards";
import {
  classifyIntent as kernelClassifyIntent,
  createKernel,
  difficultyProfile as kernelDifficultyProfile,
  isHighRiskEventTarget as kernelIsHighRiskEventTarget,
  KernelPathfinder,
  offensiveMomentum as kernelOffensiveMomentum,
  pathCrossesRisk as kernelPathCrossesRisk,
  resolveAggregateCombat as kernelResolveAggregateCombat,
  runProductionCycles as kernelRunProductionCycles,
  siteEngagedBy as kernelSiteEngagedBy,
} from "../kernel";
import { createId } from "../id";
import { createFieldContactFeed } from "../field-contact-feed";
import { pointInPolygon } from "../create-game";
import {
  RESEARCH_DEFINITIONS,
  hasResearch,
  researchIdsForTeam,
  type ResearchId,
} from "../research";
import { BASE_TEAM_UNIT_CAP, INITIAL_PRODUCTION_POPULATION_BUDGET, TEAM_COLOR, productionSlots } from "../config";
import {
  decisionAvailable,
  decisionEffectsFor,
  statusMembershipCache,
} from "../decisions";
import type {
  AcademicYearOutcome,
  AiDifficulty,
  EventCard,
  GameData,
  PlayerIdentity,
  SiteKind,
  SiteState,
  Stance,
  Team,
  TimedStatus,
  UnitState,
} from "../types";
import type {
  BattlefieldSceneApi,
  BattlefieldToolMode,
  BattleStats,
  CampContext,
  GameScreen,
} from "./contracts";
import type { NetworkChannel } from "../local-relay";
import ServerClockWorker from "../server-clock-worker.ts?worker&inline";
import type { PlayerCommandSelection } from "../player-commands";
import { createSportMarkings, type GroundMarking } from "./sport-markings";

type VictoryBroadcast = {
  winner: Team;
  title: string;
  body: string;
};

type BattlefieldEngineContext = {
  playerCommandSenderRef: RefObject<(selection: PlayerCommandSelection) => void>;
  canIssuePlayerCommandRef: RefObject<() => boolean>;
  screen: GameScreen;
  hostRef: RefObject<HTMLDivElement | null>;
  sceneApi: RefObject<BattlefieldSceneApi | null>;
  performanceControllerRef: RefObject<PerformanceController>;
  setSelected: Dispatch<SetStateAction<number | null>>;
  setCampContext: Dispatch<SetStateAction<CampContext | null>>;
  selectedRef: RefObject<number | null>;
  gameRef: RefObject<GameData>;
  setJoystickKnob: Dispatch<SetStateAction<{ x: number; y: number }>>;
  mobileMoveRef: RefObject<{ x: number; z: number }>;
  setDirectControl: Dispatch<SetStateAction<boolean>>;
  setNotice: Dispatch<SetStateAction<string>>;
  playerTeamRef: RefObject<Team>;
  observerAiModeRef: RefObject<boolean>;
  setSelectedUnitCount: Dispatch<SetStateAction<number>>;
  customMaterialsRef: RefObject<{
    unit: string | null;
    site: string | null;
    teamUnit: Partial<Record<Team, string>>;
  }>;
  pushEvent: (event: EventCard) => void;
  pauseOpenRef: RefObject<boolean>;
  screenRef: RefObject<GameScreen>;
  lanChannelsRef: RefObject<Set<NetworkChannel>>;
  lanChannelIdentityRef: RefObject<Map<NetworkChannel, PlayerIdentity>>;
  lanHostRef: RefObject<boolean>;
  dedicatedServerHostRef: RefObject<boolean>;
  timeScaleRef: RefObject<number>;
  autoDayRef: RefObject<boolean>;
  setVictoryBroadcast: Dispatch<SetStateAction<VictoryBroadcast | null>>;
  setAcademicYearBroadcast: Dispatch<
    SetStateAction<AcademicYearOutcome | null>
  >;
  setClock: Dispatch<SetStateAction<string>>;
  setStats: Dispatch<SetStateAction<BattleStats>>;
  regionRef: RefObject<"main">;
  minimapRef: RefObject<HTMLCanvasElement | null>;
  siteMenuRef: RefObject<HTMLElement | null>;
  setRenameDraft: Dispatch<SetStateAction<string>>;
  showSites: boolean;
  showControl: boolean;
  beginDecision: (decisionId: string, team: Team, silent?: boolean) => boolean;
  beginResearch: (id: ResearchId, team: Team, silent?: boolean) => boolean;
  beginProduction: (id: ResearchId, team: Team, silent?: boolean) => boolean;
  recordServerLog: (
    category: "system" | "player" | "chat" | "battle" | "command",
    text: string,
  ) => void;
};

export function useBattlefieldEngine(context: BattlefieldEngineContext) {
  const {
    playerCommandSenderRef,
    canIssuePlayerCommandRef,
    screen,
    hostRef,
    sceneApi,
    performanceControllerRef,
    setSelected,
    setCampContext,
    selectedRef,
    gameRef,
    setJoystickKnob,
    mobileMoveRef,
    setDirectControl,
    setNotice,
    playerTeamRef,
    observerAiModeRef,
    setSelectedUnitCount,
    customMaterialsRef,
    pushEvent,
    pauseOpenRef,
    screenRef,
    lanChannelsRef,
    lanChannelIdentityRef,
    lanHostRef,
    dedicatedServerHostRef,
    timeScaleRef,
    autoDayRef,
    setVictoryBroadcast,
    setAcademicYearBroadcast,
    setClock,
    setStats,
    regionRef,
    minimapRef,
    siteMenuRef,
    setRenameDraft,
    showSites,
    showControl,
    beginDecision,
    beginResearch,
    beginProduction,
    recordServerLog
  } = context;
  useEffect(() => {
    if (screen !== "game") {
      sceneApi.current = null;
      return;
    }
    const host = hostRef.current;
    if (!host) return;
    const realCampus = isRealCampus(gameRef.current.campaign.mapProfile),
      buildingMeterScale = 0.023;
    const mobileClient = isMobileClient();
    const renderer = new THREE.WebGLRenderer({
      antialias: !mobileClient,
      powerPreference: "high-performance",
    });
    const performanceController = performanceControllerRef.current,
      maximumPixelRatio = Math.min(devicePixelRatio, 1.4);
    let activeQualityProfile = performanceController.profile,
      renderPixelRatio = Math.min(
        maximumPixelRatio,
        activeQualityProfile.pixelRatio,
      );
    renderer.setPixelRatio(renderPixelRatio);
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.shadowMap.enabled = activeQualityProfile.shadowSize > 0;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x9fc5d8);
    scene.fog = new THREE.FogExp2(0x9fc5d8, 0.007);
    let portraitViewport = mobileClient && host.clientHeight > host.clientWidth;
    const camera = new THREE.PerspectiveCamera(
      portraitViewport ? 58 : 38,
      host.clientWidth / host.clientHeight,
      0.1,
      300,
    );
    const reviewParams = new URLSearchParams(location.search),
      reviewSiteId = Number(reviewParams.get("review-site")),
      reviewWide = reviewParams.has("review-wide"),
      forcedReviewHour = reviewParams.has("review-hour") ? Number(reviewParams.get("review-hour")) : Number.NaN,
      reviewSite = Number.isInteger(reviewSiteId)
        ? gameRef.current.sites.find((site) => site.id === reviewSiteId)
        : undefined,
      initialTargetX = reviewSite?.x ?? -22,
      initialTargetZ = reviewSite?.z ?? 14;
    camera.position.set(
      initialTargetX + (reviewSite ? -1.5 : 0),
      reviewSite ? 2.2 : portraitViewport ? 36 : 24,
      initialTargetZ + (reviewSite ? 2.8 : portraitViewport ? 36 : 22),
    );
    camera.lookAt(initialTargetX, 0, initialTargetZ);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(initialTargetX, 0, initialTargetZ);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enableRotate = false;
    controls.enableZoom = true;
    controls.minDistance = reviewSite ? 1.4 : mobileClient ? 9 : 13;
    controls.maxDistance = reviewSite ? reviewWide ? 32 : 15 : mobileClient ? 82 : 58;
    controls.zoomSpeed = mobileClient ? 1.08 : 0.72;
    controls.enablePan = true;
    controls.screenSpacePanning = false;
    controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
    controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
    controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
    controls.touches.ONE = THREE.TOUCH.PAN;
    controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
    let cameraInteractionEndTimer = 0;
    const hideSitePanel = () => setSelected(null),
      beginCameraInteraction = () => {
        hideSitePanel();
        clearTimeout(cameraInteractionEndTimer);
        performanceController.beginCameraInteraction();
      },
      endCameraInteraction = () => {
        clearTimeout(cameraInteractionEndTimer);
        cameraInteractionEndTimer = window.setTimeout(
          () => performanceController.endCameraInteraction(),
          300,
        );
      };
    controls.addEventListener("start", beginCameraInteraction);
    controls.addEventListener("end", endCameraInteraction);
    const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x324226, 1.9);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff0d0, 3.4);
    sun.castShadow = activeQualityProfile.shadowSize > 0;
    sun.shadow.mapSize.set(
      Math.max(1, activeQualityProfile.shadowSize),
      Math.max(1, activeQualityProfile.shadowSize),
    );
    sun.shadow.camera.left = -65;
    sun.shadow.camera.right = 65;
    sun.shadow.camera.top = 55;
    sun.shadow.camera.bottom = -55;
    sun.shadow.bias = -0.00018;
    sun.shadow.normalBias = 0.075;
    sun.shadow.radius = 2;
    scene.add(sun);
    const moon = new THREE.DirectionalLight(0x91b7ff, 0.25);
    scene.add(moon);
    const mapGroup = new THREE.Group();
    scene.add(mapGroup);
    const campusTextureLoader = new THREE.TextureLoader(),
      loadCampusTexture = (name: string, color = false) => {
        const texture = campusTextureLoader.load(`${import.meta.env.BASE_URL}materials/${name}`);
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        if (color) texture.colorSpace = THREE.SRGBColorSpace;
        return texture;
      },
      campusTextures = realCampus ? {
        grass: loadCampusTexture("campus-grass-albedo.webp", true),
        grassRoughness: loadCampusTexture("campus-grass-roughness.webp"),
        leaf: loadCampusTexture("campus-leaf-albedo.webp", true),
        leafRoughness: loadCampusTexture("campus-leaf-roughness.webp"),
        asphalt: loadCampusTexture("campus-asphalt-albedo.webp", true),
        asphaltRoughness: loadCampusTexture("campus-asphalt-roughness.webp"),
        track: loadCampusTexture("campus-track-albedo.webp", true),
        trackRoughness: loadCampusTexture("campus-track-roughness.webp"),
        paving: loadCampusTexture("campus-paving-albedo.webp", true),
        pavingRoughness: loadCampusTexture("campus-paving-roughness.webp"),
        facade: loadCampusTexture("campus-facade-detail.webp", true),
        facadeRoughness: loadCampusTexture("campus-facade-roughness.webp"),
        roof: loadCampusTexture("campus-roof-detail.webp", true),
        roofRoughness: loadCampusTexture("campus-roof-roughness.webp"),
        water: loadCampusTexture("campus-water-albedo.webp", true),
        waterNormal: loadCampusTexture("campus-water-normal.webp"),
        macro: loadCampusTexture("campus-macro-variation.webp"),
        surfaceMask: loadCampusTexture("campus-surface-mask.png"),
      } : null;
    if (campusTextures) {
      campusTextures.macro.wrapS = campusTextures.macro.wrapT = THREE.ClampToEdgeWrapping;
      campusTextures.surfaceMask.wrapS = campusTextures.surfaceMask.wrapT = THREE.ClampToEdgeWrapping;
      campusTextures.surfaceMask.magFilter = THREE.LinearFilter;
      campusTextures.surfaceMask.minFilter = THREE.LinearMipmapLinearFilter;
      campusTextures.track.repeat.set(0.2, 0.2);
      campusTextures.trackRoughness.repeat.set(0.2, 0.2);
      campusTextures.roof.repeat.set(0.18, 0.18);
      campusTextures.roofRoughness.repeat.set(0.18, 0.18);
      campusTextures.water.repeat.set(0.18, 0.18);
      campusTextures.waterNormal.repeat.set(0.12, 0.12);
    }
    const regions = mapRegionsFor(gameRef.current.campaign.mapProfile) as unknown as Record<string, any>;
    const applyCampusMacro = (material: THREE.MeshStandardMaterial, strength: number) => {
      if (!campusTextures) return material;
      material.onBeforeCompile = (shader) => {
        shader.uniforms.campusMacroMap = { value: campusTextures.macro };
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nvarying vec3 vCampusWorldPosition;")
          .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvCampusWorldPosition = worldPosition.xyz;");
        shader.fragmentShader = shader.fragmentShader
          .replace("#include <common>", "#include <common>\nuniform sampler2D campusMacroMap;\nvarying vec3 vCampusWorldPosition;")
          .replace("#include <map_fragment>", `#include <map_fragment>\nvec2 campusMacroUv = clamp((vCampusWorldPosition.xz - vec2(-66.0, -65.7355)) / vec2(132.0, 131.471), vec2(0.0), vec2(1.0));\nvec3 campusMacroTone = texture2D(campusMacroMap, vec2(campusMacroUv.x, 1.0 - campusMacroUv.y)).rgb * 1.11;\ndiffuseColor.rgb *= mix(vec3(1.0), campusMacroTone, ${strength.toFixed(3)});`);
      };
      material.customProgramCacheKey = () => `campus-macro-${strength}`;
      return material;
    };
    const applyCampusSurface = (material: THREE.MeshStandardMaterial) => {
      if (!campusTextures) return material;
      material.onBeforeCompile = (shader) => {
        shader.uniforms.campusSurfaceMask = { value: campusTextures.surfaceMask };
        shader.uniforms.campusGrassMap = { value: campusTextures.grass };
        shader.uniforms.campusGrassRoughnessMap = { value: campusTextures.grassRoughness };
        shader.uniforms.campusAsphaltMap = { value: campusTextures.asphalt };
        shader.uniforms.campusPavingMap = { value: campusTextures.paving };
        shader.uniforms.campusAsphaltRoughnessMap = { value: campusTextures.asphaltRoughness };
        shader.uniforms.campusPavingRoughnessMap = { value: campusTextures.pavingRoughness };
        shader.uniforms.campusMacroMap = { value: campusTextures.macro };
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nvarying vec3 vCampusWorldPosition;")
          .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvCampusWorldPosition = worldPosition.xyz;");
        shader.fragmentShader = shader.fragmentShader
          .replace("#include <common>", `#include <common>
uniform sampler2D campusSurfaceMask;
uniform sampler2D campusGrassMap;
uniform sampler2D campusGrassRoughnessMap;
uniform sampler2D campusAsphaltMap;
uniform sampler2D campusPavingMap;
uniform sampler2D campusAsphaltRoughnessMap;
uniform sampler2D campusPavingRoughnessMap;
uniform sampler2D campusMacroMap;
varying vec3 vCampusWorldPosition;`)
          .replace("#include <color_fragment>", `#include <color_fragment>
vec2 campusSurfaceUv = clamp((vCampusWorldPosition.xz - vec2(-66.0, -65.7355)) / vec2(132.0, 131.471), vec2(0.0), vec2(1.0));
vec3 campusSurfaceWeights = texture2D(campusSurfaceMask, campusSurfaceUv).rgb;
float campusAsphaltWeight = campusSurfaceWeights.r;
float campusPavingWeight = campusSurfaceWeights.g;
float campusDirtWeight = campusSurfaceWeights.b;
vec2 campusGrassPosition = vCampusWorldPosition.xz;
vec2 campusGrassUvA = mat2(0.939693, -0.342020, 0.342020, 0.939693) * campusGrassPosition * 1.37;
vec2 campusGrassUvB = mat2(0.642788, -0.766044, 0.766044, 0.642788) * campusGrassPosition * 0.43 + vec2(0.37, 0.19);
vec3 campusGrassTone = mix(texture2D(campusGrassMap, campusGrassUvA).rgb, texture2D(campusGrassMap, campusGrassUvB).rgb, 0.34);
diffuseColor.rgb *= campusGrassTone;
vec3 campusAsphaltTone = texture2D(campusAsphaltMap, vCampusWorldPosition.xz * 8.0).rgb * 0.82;
vec3 campusPavingTone = texture2D(campusPavingMap, vCampusWorldPosition.xz * 24.0).rgb * 0.93;
vec3 campusDirtTone = vec3(0.34, 0.25, 0.15) * (0.9 + texture2D(campusAsphaltMap, vCampusWorldPosition.xz * 12.0).r * 0.25);
diffuseColor.rgb = mix(diffuseColor.rgb, campusAsphaltTone, campusAsphaltWeight);
diffuseColor.rgb = mix(diffuseColor.rgb, campusPavingTone, campusPavingWeight);
diffuseColor.rgb = mix(diffuseColor.rgb, campusDirtTone, campusDirtWeight);
vec3 campusMacroTone = texture2D(campusMacroMap, vec2(campusSurfaceUv.x, 1.0 - campusSurfaceUv.y)).rgb * 1.11;
diffuseColor.rgb *= mix(vec3(1.0), campusMacroTone, 0.22);`)
          .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
float campusGrassRoughness = mix(texture2D(campusGrassRoughnessMap, campusGrassUvA).r, texture2D(campusGrassRoughnessMap, campusGrassUvB).r, 0.34);
roughnessFactor = campusGrassRoughness;
float campusAsphaltRoughness = texture2D(campusAsphaltRoughnessMap, vCampusWorldPosition.xz * 8.0).r;
float campusPavingRoughness = texture2D(campusPavingRoughnessMap, vCampusWorldPosition.xz * 24.0).r;
roughnessFactor = mix(roughnessFactor, campusAsphaltRoughness, campusAsphaltWeight);
roughnessFactor = mix(roughnessFactor, campusPavingRoughness, campusPavingWeight);
roughnessFactor = mix(roughnessFactor, 1.0, campusDirtWeight);`);
      };
      material.customProgramCacheKey = () => "campus-unified-surface-v2";
      return material;
    };
    const applyCampusBuildingSurface = (material: THREE.MeshStandardMaterial) => {
      if (!campusTextures) return material;
      material.onBeforeCompile = (shader) => {
        shader.uniforms.campusRoofMap = { value: campusTextures.roof };
        shader.uniforms.campusRoofRoughnessMap = { value: campusTextures.roofRoughness };
        shader.uniforms.campusMacroMap = { value: campusTextures.macro };
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nattribute float campusRoofFactor;\nvarying float vCampusRoofFactor;\nvarying vec3 vCampusWorldPosition;")
          .replace("#include <begin_vertex>", "#include <begin_vertex>\nvCampusRoofFactor = campusRoofFactor;")
          .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvCampusWorldPosition = worldPosition.xyz;");
        shader.fragmentShader = shader.fragmentShader
          .replace("#include <common>", `#include <common>
uniform sampler2D campusRoofMap;
uniform sampler2D campusRoofRoughnessMap;
uniform sampler2D campusMacroMap;
varying float vCampusRoofFactor;
varying vec3 vCampusWorldPosition;`)
          .replace("#include <color_fragment>", `#include <color_fragment>
vec3 campusFacadeTexture = texture2D(map, vMapUv).rgb;
vec3 campusRoofTexture = texture2D(campusRoofMap, vMapUv).rgb;
diffuseColor.rgb *= mix(vec3(1.0), campusRoofTexture / max(campusFacadeTexture, vec3(0.03)), step(0.5, vCampusRoofFactor));
vec2 campusBuildingMacroUv = clamp((vCampusWorldPosition.xz - vec2(-66.0, -65.7355)) / vec2(132.0, 131.471), vec2(0.0), vec2(1.0));
vec3 campusBuildingMacroTone = texture2D(campusMacroMap, vec2(campusBuildingMacroUv.x, 1.0 - campusBuildingMacroUv.y)).rgb * 1.11;
diffuseColor.rgb *= mix(vec3(1.0), campusBuildingMacroTone, mix(0.06, 0.04, step(0.5, vCampusRoofFactor)));`)
          .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
float campusRoofRoughness = texture2D(campusRoofRoughnessMap, vMapUv).r;
roughnessFactor = mix(roughnessFactor, campusRoofRoughness, step(0.5, vCampusRoofFactor));`);
      };
      material.customProgramCacheKey = () => "campus-building-surface-v1";
      return material;
    };
    const windowMaterials: THREE.MeshStandardMaterial[] = [],
      buildingSurfaceMaterials: THREE.MeshStandardMaterial[] = [],
      windowDetailMeshes: THREE.InstancedMesh[] = [],
      sportMaterials: THREE.MeshStandardMaterial[] = [],
      sportDetailMeshes: THREE.Object3D[] = [],
      buildingOutlineObjects: THREE.Object3D[] = [];
    const terrainMeshes: THREE.Mesh[] = [];
    const regionForX = (_x: number) => regions.main,
      tsinghuaCampus = regions.main.campuses?.find(
        (campus: { name: string }) => campus.name === "清华大学",
      ),
      insideTsinghuaCampus = (x: number, z: number) =>
        !!tsinghuaCampus && pointInPolygon(x, z, tsinghuaCampus.points);
    const footprintArea = (points: readonly (readonly number[])[]) =>
      Math.abs(
        points.reduce((sum, point, index) => {
          const next = points[(index + 1) % points.length];
          return sum + point[0] * next[1] - next[0] * point[1];
        }, 0) / 2,
      );
    const gameplayBuildingCache = new WeakMap<object, any[]>();
    const gameplayBuildings = (r: any) => {
      const cached = gameplayBuildingCache.get(r);
      if (cached) return cached;
      const relationMemberWayIds = realCampus
        ? new Set<number>(r.buildings.flatMap((building: any) => building.memberWayIds ?? []))
        : new Set<number>();
      const filtered = r.buildings.filter((building: any) => {
        if (realCampus && building.osmType === "way" && relationMemberWayIds.has(building.osmId)) return false;
        const smallAnonymous =
          !building.name && footprintArea(building.points) < 0.13;
        if (!realCampus)
          return !smallAnonymous || Math.abs(building.osmId) % 4 !== 0;
        const x=building.points.reduce((sum:number,point:number[])=>sum+point[0],0)/building.points.length,
          z=building.points.reduce((sum:number,point:number[])=>sum+point[1],0)/building.points.length,
          insideCampus=r.campuses.some((campus:any)=>(campus.name==="北京大学"||campus.name==="清华大学")&&pointInPolygon(x,z,campus.points));
        return insideCampus || !smallAnonymous;
      });
      const campusMeasures = realCampus ? filtered
        .filter((building: any) => REAL_BUILDING_BY_KEY.has(`${building.osmType}/${building.osmId}`))
        .map((building: any) => ({building,area:footprintArea(building.points),centerX:building.points.reduce((sum:number,point:number[])=>sum+point[0],0)/building.points.length,centerZ:building.points.reduce((sum:number,point:number[])=>sum+point[1],0)/building.points.length,minX:Math.min(...building.points.map((point:number[])=>point[0])),maxX:Math.max(...building.points.map((point:number[])=>point[0])),minZ:Math.min(...building.points.map((point:number[])=>point[1])),maxZ:Math.max(...building.points.map((point:number[])=>point[1]))})) : [],
        suppressed = new Set<any>();
      if (realCampus) for (const candidate of campusMeasures) {
        if (candidate.building.name) continue;
        const parent = campusMeasures.find(other => other !== candidate && other.area > candidate.area * 1.2 && candidate.centerX >= other.minX && candidate.centerX <= other.maxX && candidate.centerZ >= other.minZ && candidate.centerZ <= other.maxZ && pointInPolygon(candidate.centerX,candidate.centerZ,other.building.points));
        if (parent) suppressed.add(candidate.building);
      }
      const deduplicated = suppressed.size ? filtered.filter((building:any)=>!suppressed.has(building)) : filtered;
      gameplayBuildingCache.set(r, deduplicated);
      return deduplicated;
    };
    const terrainVerticalScale = realCampus ? 1 : 6,
      terrainHeight = (r: any, x: number, z: number) => {
      const { cols, rows, heights } = r.terrain,
        u =
          THREE.MathUtils.clamp(
            (x - (r.offsetX - r.width / 2)) / r.width,
            0,
            1,
          ) *
          (cols - 1),
        v =
          THREE.MathUtils.clamp((r.depth / 2 - z) / r.depth, 0, 1) * (rows - 1),
        i = Math.floor(u),
        j = Math.floor(v),
        fu = u - i,
        fv = v - j,
        at = (ii: number, jj: number) =>
          (heights[Math.min(rows - 1, jj) * cols + Math.min(cols - 1, ii)] ||
            0) * terrainVerticalScale;
      if (!realCampus)
        return THREE.MathUtils.lerp(
          THREE.MathUtils.lerp(at(i, j), at(i + 1, j), fu),
          THREE.MathUtils.lerp(at(i, j + 1), at(i + 1, j + 1), fu),
          fv,
        );
      const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
      return fu + fv <= 1
        ? a + fu * (b - a) + fv * (c - a)
        : d + (1 - fv) * (b - d) + (1 - fu) * (c - d);
    };
    if (reviewSite) {
      const reviewBuilding = regions.main.buildings.find((building: any) => `${building.osmType}/${building.osmId}` === reviewSite.osmKey),
        extent = reviewBuilding
          ? Math.max(
              Math.max(...reviewBuilding.points.map((point: number[]) => point[0])) - Math.min(...reviewBuilding.points.map((point: number[]) => point[0])),
              Math.max(...reviewBuilding.points.map((point: number[]) => point[1])) - Math.min(...reviewBuilding.points.map((point: number[]) => point[1])),
            )
          : 0.55,
        distance = Math.max(2.4, extent * 1.25 + 1.15) * (reviewWide ? 8 : 1),
        ground = terrainHeight(regions.main, reviewSite.x, reviewSite.z),
        reviewProfile = REAL_LANDMARK_BY_SITE.get(reviewSite.id),
        bearing = reviewProfile?.entranceDirection == null ? null : reviewProfile.entranceDirection * Math.PI / 180,
        viewX = bearing == null ? 0.52 : Math.sin(bearing),
        viewZ = bearing == null ? 0.86 : -Math.cos(bearing);
      controls.target.set(reviewSite.x, ground + 0.12, reviewSite.z);
      camera.position.set(reviewSite.x + distance * viewX, ground + Math.max(1.8, extent * 0.72 + 1.2) * (reviewWide ? 4.5 : 1), reviewSite.z + distance * viewZ);
      camera.lookAt(controls.target);
      controls.update();
    }
    type NavGrid = {
      cell: number;
      cols: number;
      rows: number;
      minX: number;
      minZ: number;
      blocked: Uint8Array;
      building: Uint8Array;
      water: Uint8Array;
      road: Uint8Array;
      elevation: Float32Array;
      component: Int32Array;
      mainComponent: number;
    };
    const buildNavGrid = (r: any): NavGrid => {
      const cell = 0.7,
        minX = r.offsetX - r.width / 2,
        minZ = -r.depth / 2,
        cols = Math.ceil(r.width / cell),
        rows = Math.ceil(r.depth / cell),
        blocked = new Uint8Array(cols * rows),
        building = new Uint8Array(cols * rows),
        water = new Uint8Array(cols * rows),
        road = new Uint8Array(cols * rows),
        elevation = new Float32Array(cols * rows),
        markPolygons = (polygons: readonly any[], mask: Uint8Array) => {
          for (const polygon of polygons) {
            const xs = polygon.points.map((p: number[]) => p[0]),
              zs = polygon.points.map((p: number[]) => p[1]),
              x0 = Math.max(0, Math.floor((Math.min(...xs) - minX) / cell) - 1),
              x1 = Math.min(
                cols - 1,
                Math.ceil((Math.max(...xs) - minX) / cell) + 1,
              ),
              z0 = Math.max(0, Math.floor((Math.min(...zs) - minZ) / cell) - 1),
              z1 = Math.min(
                rows - 1,
                Math.ceil((Math.max(...zs) - minZ) / cell) + 1,
              );
            for (let gz = z0; gz <= z1; gz++)
              for (let gx = x0; gx <= x1; gx++) {
                const x = minX + (gx + 0.5) * cell,
                  z = minZ + (gz + 0.5) * cell;
                if (pointInPolygon(x, z, polygon.points)) {
                  blocked[gz * cols + gx] = 1;
                  mask[gz * cols + gx] = 1;
                }
              }
          }
        };
      markPolygons(gameplayBuildings(r), building);
      markPolygons(r.waters, water);
      for (let gz = 0; gz < rows; gz++)
        for (let gx = 0; gx < cols; gx++)
          elevation[gz * cols + gx] = terrainHeight(
            r,
            minX + (gx + 0.5) * cell,
            minZ + (gz + 0.5) * cell,
          );
      for (const route of r.roads) {
        for (let i = 1; i < route.points.length; i++) {
          const [x1, z1] = route.points[i - 1],
            [x2, z2] = route.points[i],
            length = Math.hypot(x2 - x1, z2 - z1),
            steps = Math.max(1, Math.ceil(length / (cell * 0.35)));
          for (let step = 0; step <= steps; step++) {
            const t = step / steps,
              gx = Math.floor((x1 + (x2 - x1) * t - minX) / cell),
              gz = Math.floor((z1 + (z2 - z1) * t - minZ) / cell);
            if (gx < 0 || gz < 0 || gx >= cols || gz >= rows) continue;
            road[gz * cols + gx] = 1;
          }
        }
      }
      const component = new Int32Array(cols * rows);
      component.fill(-1);
      let componentId = 0,
        mainComponent = -1,
        mainSize = 0;
      const queue = new Int32Array(cols * rows),
        directions = [-1, 1, -cols, cols];
      for (let start = 0; start < component.length; start++) {
        if (blocked[start] || component[start] !== -1) continue;
        let head = 0,
          tail = 0,
          size = 0;
        queue[tail++] = start;
        component[start] = componentId;
        while (head < tail) {
          const current = queue[head++],
            cx = current % cols;
          size++;
          for (const delta of directions) {
            const next = current + delta;
            if (next < 0 || next >= component.length) continue;
            if ((delta === -1 && cx === 0) || (delta === 1 && cx === cols - 1))
              continue;
            if (blocked[next] || component[next] !== -1) continue;
            component[next] = componentId;
            queue[tail++] = next;
          }
        }
        if (size > mainSize) {
          mainSize = size;
          mainComponent = componentId;
        }
        componentId++;
      }
      return {
        cell,
        cols,
        rows,
        minX,
        minZ,
        blocked,
        building,
        water,
        road,
        elevation,
        component,
        mainComponent,
      };
    };
    let pathfindingSpentMs = 0,
      pathfindingSamples = 0;
    const pathCache = new Map<string, [number, number][]>(),
      PATH_CACHE_LIMIT = 384,
      clonePath = (path: readonly [number, number][]) =>
        path.map(([x, z]) => [x, z] as [number, number]),
      rememberPath = (key: string, path: [number, number][]) => {
        pathCache.delete(key);
        pathCache.set(key, clonePath(path));
        while (pathCache.size > PATH_CACHE_LIMIT) {
          const oldest = pathCache.keys().next().value;
          if (oldest === undefined) break;
          pathCache.delete(oldest);
        }
      };
    const navGrid = buildNavGrid(regions.main),
      remoteSession = { active: lanChannelsRef.current.size > 0 && !lanHostRef.current },
      kernelPathfinder = new KernelPathfinder(navGrid),
      sharedKernel = createKernel(gameRef.current, {
        navGrid,
        fixedStepMilliseconds: 50,
        aiTeams: [],
        mutateInitialState: !remoteSession.active,
      }),
      kernelOwnsSimulation = true,
      isRemoteGuest = () => (remoteSession.active ||= lanChannelsRef.current.size > 0 && !lanHostRef.current),
      navIndex = (grid: NavGrid, x: number, z: number) => {
        const gx = Math.floor((x - grid.minX) / grid.cell),
          gz = Math.floor((z - grid.minZ) / grid.cell);
        return gx < 0 || gz < 0 || gx >= grid.cols || gz >= grid.rows
          ? -1
          : gz * grid.cols + gx;
      },
      navPoint = (grid: NavGrid, index: number): [number, number] => [
        grid.minX + ((index % grid.cols) + 0.5) * grid.cell,
        grid.minZ + (Math.floor(index / grid.cols) + 0.5) * grid.cell,
      ],
      nearestOpenIndex = (grid: NavGrid, x: number, z: number) => {
        const center = navIndex(grid, x, z);
        if (
          center >= 0 &&
          !grid.blocked[center] &&
          grid.component[center] === grid.mainComponent
        )
          return center;
        const cx = THREE.MathUtils.clamp(
            Math.floor((x - grid.minX) / grid.cell),
            0,
            grid.cols - 1,
          ),
          cz = THREE.MathUtils.clamp(
            Math.floor((z - grid.minZ) / grid.cell),
            0,
            grid.rows - 1,
          );
        for (let radius = 1; radius < 32; radius++)
          for (let dz = -radius; dz <= radius; dz++)
            for (let dx = -radius; dx <= radius; dx++) {
              if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
              const gx = cx + dx,
                gz = cz + dz;
              if (gx < 0 || gz < 0 || gx >= grid.cols || gz >= grid.rows)
                continue;
              const index = gz * grid.cols + gx;
              if (
                !grid.blocked[index] &&
                grid.component[index] === grid.mainComponent
              )
                return index;
            }
        return -1;
      },
      nearestRoadIndex = (grid: NavGrid, x: number, z: number) => {
        const cx = THREE.MathUtils.clamp(
            Math.floor((x - grid.minX) / grid.cell),
            0,
            grid.cols - 1,
          ),
          cz = THREE.MathUtils.clamp(
            Math.floor((z - grid.minZ) / grid.cell),
            0,
            grid.rows - 1,
          );
        for (let radius = 0; radius < 80; radius++)
          for (let dz = -radius; dz <= radius; dz++)
            for (let dx = -radius; dx <= radius; dx++) {
              if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
              const gx = cx + dx,
                gz = cz + dz;
              if (gx < 0 || gz < 0 || gx >= grid.cols || gz >= grid.rows)
                continue;
              const index = gz * grid.cols + gx;
              if (
                grid.road[index] &&
                !grid.blocked[index] &&
                grid.component[index] === grid.mainComponent
              )
                return index;
            }
        return -1;
      },
      legacyFindPath = (
        fromX: number,
        fromZ: number,
        toX: number,
        toZ: number,
        allowBuildingFallback = false,
      ): [number, number][] => {
        const pathfindingStartedAt = performance.now();
        const grid = navGrid,
          start = nearestOpenIndex(grid, fromX, fromZ),
          goal = nearestOpenIndex(grid, toX, toZ);
        if (start < 0 || goal < 0) {
          pathfindingSpentMs += performance.now() - pathfindingStartedAt;
          pathfindingSamples++;
          return [];
        }
        const cacheKey = `${start}:${goal}:${allowBuildingFallback ? 1 : 0}`,
          cached = pathCache.get(cacheKey);
        if (cached) {
          pathCache.delete(cacheKey);
          pathCache.set(cacheKey, cached);
          return clonePath(cached);
        }
        if (start === goal) {
          const sameCellPath = [navPoint(grid, goal)];
          rememberPath(cacheKey, sameCellPath);
          pathfindingSpentMs += performance.now() - pathfindingStartedAt;
          pathfindingSamples++;
          return clonePath(sameCellPath);
        }
        const total = grid.cols * grid.rows,
          cost = new Float32Array(total),
          came = new Int32Array(total),
          closed = new Uint8Array(total),
          heap: { index: number; score: number }[] = [];
        cost.fill(Number.POSITIVE_INFINITY);
        came.fill(-1);
        cost[start] = 0;
        const goalX = goal % grid.cols,
          goalZ = Math.floor(goal / grid.cols),
          push = (entry: { index: number; score: number }) => {
            heap.push(entry);
            let i = heap.length - 1;
            while (i > 0) {
              const parent = Math.floor((i - 1) / 2);
              if (heap[parent].score <= entry.score) break;
              heap[i] = heap[parent];
              i = parent;
            }
            heap[i] = entry;
          },
          pop = () => {
            const first = heap[0],
              last = heap.pop()!;
            if (heap.length) {
              let i = 0;
              while (true) {
                let child = i * 2 + 1;
                if (child >= heap.length) break;
                if (
                  child + 1 < heap.length &&
                  heap[child + 1].score < heap[child].score
                )
                  child++;
                if (heap[child].score >= last.score) break;
                heap[i] = heap[child];
                i = child;
              }
              heap[i] = last;
            }
            return first;
          };
        push({ index: start, score: 0 });
        const directions = [
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
        ],
          pathBlocked = (index: number) =>
            !allowBuildingFallback &&
            grid.building[index];
        while (heap.length) {
          const current = pop();
          if (!current || closed[current.index]) continue;
          if (current.index === goal) break;
          closed[current.index] = 1;
          const cx = current.index % grid.cols,
            cz = Math.floor(current.index / grid.cols);
          for (const [dx, dz] of directions) {
            const nx = cx + dx,
              nz = cz + dz;
            if (nx < 0 || nz < 0 || nx >= grid.cols || nz >= grid.rows)
              continue;
            const next = nz * grid.cols + nx;
            if (pathBlocked(next) || closed[next]) continue;
            if (
              dx &&
              dz &&
              (pathBlocked(cz * grid.cols + nx) ||
                pathBlocked(nz * grid.cols + cx))
            )
              continue;
            const signedSlope =
                (grid.elevation[next] - grid.elevation[current.index]) /
                (grid.cell * Math.hypot(dx, dz)),
              slopeCost =
                signedSlope > 0
                  ? 1 + signedSlope * 2.2
                  : 1 + Math.abs(signedSlope) * 0.28,
              stepCost =
                Math.hypot(dx, dz) *
                (grid.water[next]
                  ? 7.2
                  : grid.building[next]
                  ? 5.8
                  : grid.road[next]
                    ? 0.68
                    : 1.18) *
                slopeCost,
              nextCost = cost[current.index] + stepCost;
            if (nextCost >= cost[next]) continue;
            cost[next] = nextCost;
            came[next] = current.index;
            const heuristic = Math.hypot(goalX - nx, goalZ - nz) * 0.68;
            push({ index: next, score: nextCost + heuristic });
          }
        }
        if (came[goal] < 0) {
          const fallbackPath: [number, number][] = allowBuildingFallback
            ? []
            : legacyFindPath(fromX, fromZ, toX, toZ, true);
          rememberPath(cacheKey, fallbackPath);
          pathfindingSpentMs += performance.now() - pathfindingStartedAt;
          pathfindingSamples++;
          return clonePath(fallbackPath);
        }
        const reversed: [number, number][] = [];
        let cursor = goal;
        while (cursor !== start && cursor >= 0) {
          reversed.push(navPoint(grid, cursor));
          cursor = came[cursor];
        }
        reversed.reverse();
        const simplified = reversed;
        const goalPoint = navPoint(grid, goal),
          lastPoint = simplified.at(-1);
        if (
          !lastPoint ||
          Math.hypot(lastPoint[0] - goalPoint[0], lastPoint[1] - goalPoint[1]) >
            0.05
        )
          simplified.push(goalPoint);
        rememberPath(cacheKey, simplified);
        pathfindingSpentMs += performance.now() - pathfindingStartedAt;
        pathfindingSamples++;
        return clonePath(simplified);
      };
    const findPath = (
      fromX: number,
      fromZ: number,
      toX: number,
      toZ: number,
      allowBuildingFallback = false,
    ) => {
      const startedAt = performance.now(),
        result = kernelPathfinder.find(
          fromX,
          fromZ,
          toX,
          toZ,
          allowBuildingFallback,
        );
      pathfindingSpentMs += performance.now() - startedAt;
      pathfindingSamples++;
      return result;
    };
    const pathWorkerPool = new PathfindingWorkerPool({
        cell: navGrid.cell,
        cols: navGrid.cols,
        rows: navGrid.rows,
        minX: navGrid.minX,
        minZ: navGrid.minZ,
        building: navGrid.building,
        water: navGrid.water,
        road: navGrid.road,
      }),
      findPathInWorker = async (
        fromX: number,
        fromZ: number,
        toX: number,
        toZ: number,
      ) => {
        const start = nearestOpenIndex(navGrid, fromX, fromZ),
          goal = nearestOpenIndex(navGrid, toX, toZ);
        if (start < 0 || goal < 0) return [] as [number, number][];
        const strictPath = await pathWorkerPool.find(start, goal, false);
        return strictPath.length
          ? strictPath
          : pathWorkerPool.find(start, goal, true);
      };
    const collisionAreas = [
      ...gameplayBuildings(regions.main).map((area: any) => ({
        ...area,
        obstacleKind: "building" as const,
      })),
      ...regions.main.waters.map((area: any) => ({
        ...area,
        obstacleKind: "water" as const,
      })),
    ].map((area: any) => ({
      points: area.points,
      name: area.name as string,
      osmKey: area.osmType && area.osmId ? `${area.osmType}/${area.osmId}` : undefined,
      kind: area.obstacleKind as "building" | "water",
      minX: Math.min(...area.points.map((point: number[]) => point[0])),
      maxX: Math.max(...area.points.map((point: number[]) => point[0])),
      minZ: Math.min(...area.points.map((point: number[]) => point[1])),
      maxZ: Math.max(...area.points.map((point: number[]) => point[1])),
    }));
    const collisionCell = 4,
      collisionIndex = new Map<string, typeof collisionAreas>();
    collisionAreas.forEach((area) => {
      for (
        let gx = Math.floor(area.minX / collisionCell);
        gx <= Math.floor(area.maxX / collisionCell);
        gx++
      )
        for (
          let gz = Math.floor(area.minZ / collisionCell);
          gz <= Math.floor(area.maxZ / collisionCell);
          gz++
        ) {
          const key = `${gx}/${gz}`,
            bucket = collisionIndex.get(key);
          if (bucket) bucket.push(area);
          else collisionIndex.set(key, [area]);
        }
    });
    const dynamicUnitCell = 3,
      dynamicUnitIndex = new Map<string, UnitState[]>(),
      dynamicUnitKey = (x: number, z: number) =>
        `${Math.floor(x / dynamicUnitCell)}/${Math.floor(z / dynamicUnitCell)}`,
      refreshDynamicUnitIndex = () => {
        dynamicUnitIndex.clear();
        for (const unit of gameRef.current.units) {
          const key = dynamicUnitKey(unit.x, unit.z),
            bucket = dynamicUnitIndex.get(key);
          if (bucket) bucket.push(unit);
          else dynamicUnitIndex.set(key, [unit]);
        }
      },
      unitsNearPoint = (x: number, z: number, radius: number) => {
        const minX = Math.floor((x - radius) / dynamicUnitCell),
          maxX = Math.floor((x + radius) / dynamicUnitCell),
          minZ = Math.floor((z - radius) / dynamicUnitCell),
          maxZ = Math.floor((z + radius) / dynamicUnitCell),
          result: UnitState[] = [];
        for (let gridX = minX; gridX <= maxX; gridX++)
          for (let gridZ = minZ; gridZ <= maxZ; gridZ++)
            for (const unit of dynamicUnitIndex.get(`${gridX}/${gridZ}`) ?? [])
              if (Math.hypot(unit.x - x, unit.z - z) <= radius)
                result.push(unit);
        return result;
      };
    const obstaclesAt = (x: number, z: number) =>
        (
          collisionIndex.get(
            `${Math.floor(x / collisionCell)}/${Math.floor(z / collisionCell)}`,
          ) ?? []
        ).filter(
          (area) =>
            x >= area.minX &&
            x <= area.maxX &&
            z >= area.minZ &&
            z <= area.maxZ &&
            pointInPolygon(x, z, area.points),
        ),
      insideObstacle = (x: number, z: number) => obstaclesAt(x, z).length > 0,
      insideWater = (x: number, z: number) =>
        obstaclesAt(x, z).some((area) => area.kind === "water"),
      buildingAt = (x: number, z: number) =>
        obstaclesAt(x, z).find((area) => area.kind === "building"),
      enemyInsideBuilding = (
        building: (typeof collisionAreas)[number],
        team: Team,
      ) => {
        const centerX = (building.minX + building.maxX) / 2,
          centerZ = (building.minZ + building.maxZ) / 2,
          radius =
            Math.hypot(
              building.maxX - building.minX,
              building.maxZ - building.minZ,
            ) / 2;
        return unitsNearPoint(centerX, centerZ, radius).some(
          (unit) =>
            unit.team !== team &&
            unit.hp > 0 &&
            unit.x >= building.minX &&
            unit.x <= building.maxX &&
            unit.z >= building.minZ &&
            unit.z <= building.maxZ &&
            pointInPolygon(unit.x, unit.z, building.points),
        );
      },
      pointWalkable = (x: number, z: number, team?: Team) => {
        const index = navIndex(navGrid, x, z);
        if (index < 0) return false;
        const building = buildingAt(x, z);
        return !building || (!!team && !enemyInsideBuilding(building, team));
      },
      walkableWithClearance = (x: number, z: number) => {
        const index = navIndex(navGrid, x, z);
        return (
          index >= 0 &&
          !navGrid.blocked[index] &&
          navGrid.component[index] === navGrid.mainComponent &&
          !insideObstacle(x, z)
        );
      },
      nearestClearIndex = (x: number, z: number) => {
        const centerX = THREE.MathUtils.clamp(
            Math.floor((x - navGrid.minX) / navGrid.cell),
            0,
            navGrid.cols - 1,
          ),
          centerZ = THREE.MathUtils.clamp(
            Math.floor((z - navGrid.minZ) / navGrid.cell),
            0,
            navGrid.rows - 1,
          );
        for (let radius = 0; radius < 32; radius++)
          for (let dz = -radius; dz <= radius; dz++)
            for (let dx = -radius; dx <= radius; dx++) {
              if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
              const gx = centerX + dx,
                gz = centerZ + dz;
              if (gx < 0 || gz < 0 || gx >= navGrid.cols || gz >= navGrid.rows)
                continue;
              const index = gz * navGrid.cols + gx,
                [pointX, pointZ] = navPoint(navGrid, index);
              if (walkableWithClearance(pointX, pointZ)) return index;
            }
        return nearestOpenIndex(navGrid, x, z);
      },
      ejectTrappedUnits = () => {
        if (isRemoteGuest()) return;
        gameRef.current.units.forEach((unit) => {
          const current = navIndex(navGrid, unit.x, unit.z),
            trapped = current < 0;
          if (!trapped) return;
          const openIndex = nearestClearIndex(unit.x, unit.z);
          if (openIndex < 0) return;
          const [safeX, safeZ] = navPoint(navGrid, openIndex),
            target =
              unit.targetSiteId == null
                ? undefined
                : gameRef.current.sites[unit.targetSiteId];
          unit.x = safeX;
          unit.z = safeZ;
          unit.tx = safeX;
          unit.tz = safeZ;
          unit.path = undefined;
          unit.pathIndex = undefined;
          if (target && !target.destroyed) {
            const safePath = findPath(
              safeX,
              safeZ,
              target.navX ?? target.x,
              target.navZ ?? target.z,
            );
            unit.path = safePath;
            unit.pathIndex = 0;
            const destination = safePath.at(-1);
            if (destination) [unit.tx, unit.tz] = destination;
          }
        });
      };
    const refreshNavAnchors = () => {
      if (isRemoteGuest()) return; // Visual refresh must not relocate server units.
      gameRef.current.sites.forEach((site) => {
        if (site.destroyed) return;
        let anchor = nearestClearIndex(site.x, site.z);
        if (anchor < 0) return;
        let anchorPoint = navPoint(navGrid, anchor),
          needsPortal =
            Math.hypot(anchorPoint[0] - site.x, anchorPoint[1] - site.z) > 2.2;
        if (needsPortal) {
          const roadAnchor = nearestRoadIndex(navGrid, site.x, site.z);
          if (roadAnchor >= 0) {
            const [roadX, roadZ] = navPoint(navGrid, roadAnchor);
            if (!walkableWithClearance(roadX, roadZ)) {
              [site.navX, site.navZ] = anchorPoint;
              site.hasPortal =
                Math.hypot(anchorPoint[0] - site.x, anchorPoint[1] - site.z) >
                0.6;
              return;
            }
            anchor = roadAnchor;
            anchorPoint = [roadX, roadZ];
          }
        }
        [site.navX, site.navZ] = anchorPoint;
        site.hasPortal =
          needsPortal &&
          Math.hypot(anchorPoint[0] - site.x, anchorPoint[1] - site.z) > 0.6;
      });
      gameRef.current.units.forEach((unit) => {
        const current = navIndex(navGrid, unit.x, unit.z);
        if (current >= 0 && !navGrid.blocked[current]) return;
        const open = nearestClearIndex(unit.x, unit.z);
        if (open < 0) return;
        const [safeX,safeZ]=navPoint(navGrid,open),target=unit.targetSiteId==null?undefined:gameRef.current.sites[unit.targetSiteId];
        unit.x=safeX;unit.z=safeZ;
        if(target&&!target.destroyed){const path=findPath(safeX,safeZ,target.navX??target.x,target.navZ??target.z);unit.path=path;unit.pathIndex=0;const destination=path.at(-1);unit.tx=destination?.[0]??safeX;unit.tz=destination?.[1]??safeZ;}
        else {unit.tx=safeX;unit.tz=safeZ;unit.path=undefined;unit.pathIndex=undefined;}
      });
    };
    refreshNavAnchors();
    const surfaceGeometry = (
      r: any,
      points: number[][],
      lift: number,
      heightResolver?: (x: number, z: number) => number,
      holes: number[][][] = [],
    ) => {
      const cleanRing = (ring: number[][]) => {
          const clean = ring.filter((p, i, values) => !i || Math.hypot(p[0] - values[i - 1][0], p[1] - values[i - 1][1]) > 0.001);
          if (clean.length > 2 && Math.hypot(clean[0][0] - clean.at(-1)![0], clean[0][1] - clean.at(-1)![1]) < 0.001) clean.pop();
          return clean;
        },
        clean = cleanRing(points),
        cleanHoles = holes.map(cleanRing).filter((ring) => ring.length >= 3),
        allPoints = [clean, ...cleanHoles].flat();
      const contour = clean.map((p) => new THREE.Vector2(p[0], p[1])),
        holeContours = cleanHoles.map((ring) => ring.map((p) => new THREE.Vector2(p[0], p[1]))),
        faces = THREE.ShapeUtils.triangulateShape(contour, holeContours),
        g = new THREE.BufferGeometry();
      g.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(
          allPoints.flatMap((p) => [
            p[0],
            (heightResolver?.(p[0], p[1]) ??
              terrainHeight(r, p[0], p[1])) + lift,
            p[1],
          ]),
          3,
        ),
      );
      g.setAttribute("uv", new THREE.Float32BufferAttribute(allPoints.flatMap((point) => [point[0] * 8, point[1] * 8]), 2));
      g.setIndex(faces.flatMap((face) => {
        if (!realCampus) return face;
        const a=allPoints[face[0]],b=allPoints[face[1]],c=allPoints[face[2]],cross=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
        return cross>0?[face[0],face[2],face[1]]:face;
      }));
      if (realCampus) g.setAttribute("normal", new THREE.Float32BufferAttribute(allPoints.flatMap(() => [0,1,0]),3));
      else g.computeVertexNormals();
      return g;
    };
    const sportSurfaces: {
      name: string;
      track?: boolean;
      points: readonly (readonly [number, number])[];
    }[] = [
      {
        name: "五四体育场",
        track: true,
        points: [[-22.93, 33.63], [-20.81, 33.49], [-20.62, 36.7], [-22.76, 36.86]],
      },
      {
        name: "北大东操场",
        track: true,
        points: [[-24.8, 15.29], [-24.09, 18.16], [-22.07, 17.66], [-22.78, 14.8]],
      },
      {
        name: "清华西大操场",
        track: true,
        points: [[-5.34, -6.08], [-5.62, -10.03], [-3.39, -10.19], [-3.1, -6.24]],
      },
      {
        name: "清华东大操场",
        track: true,
        points: [[13.25, -7.73], [13.11, -11.85], [15.93, -11.95], [16.07, -7.88]],
      },
      {
        name: "清华紫荆操场",
        track: true,
        points: [[8.16, -18.14], [7.97, -22.29], [10.35, -22.4], [10.54, -18.25]],
      },
      {
        name: "清华东区操场",
        track: true,
        points: [[30.86, -5.91], [31.02, -2.48], [32.68, -2.5], [33.15, -2.53], [33, -6.03]],
      },
    ];
    const namedRoadCell=3,
      namedRoadIndex=new Map<string,{name:string;kind:string;x1:number;z1:number;x2:number;z2:number;width:number}[]>(),
      registerNamedRoad=(road:any)=>{
        if(!realCampus||!road.name)return;
        for(let index=1;index<road.points.length;index++){
          const [x1,z1]=road.points[index-1],[x2,z2]=road.points[index],segment={name:road.name,kind:road.kind,x1,z1,x2,z2,width:road.width};
          for(let gx=Math.floor((Math.min(x1,x2)-road.width)/namedRoadCell);gx<=Math.floor((Math.max(x1,x2)+road.width)/namedRoadCell);gx++)for(let gz=Math.floor((Math.min(z1,z2)-road.width)/namedRoadCell);gz<=Math.floor((Math.max(z1,z2)+road.width)/namedRoadCell);gz++){
            const key=`${gx}/${gz}`,bucket=namedRoadIndex.get(key);if(bucket)bucket.push(segment);else namedRoadIndex.set(key,[segment]);
          }
        }
      },
      namedRoadAt=(x:number,z:number)=>{
        let best:{name:string;kind:string;distance:number}|undefined;
        const gx=Math.floor(x/namedRoadCell),gz=Math.floor(z/namedRoadCell);
        for(let cellX=-1;cellX<=1;cellX++)for(let cellZ=-1;cellZ<=1;cellZ++)for(const segment of namedRoadIndex.get(`${gx+cellX}/${gz+cellZ}`)??[]){
          const dx=segment.x2-segment.x1,dz=segment.z2-segment.z1,length=dx*dx+dz*dz,t=length?THREE.MathUtils.clamp(((x-segment.x1)*dx+(z-segment.z1)*dz)/length,0,1):0,distance=Math.hypot(x-(segment.x1+dx*t),z-(segment.z1+dz*t));
          if(distance<=Math.max(.55,segment.width/2+.2)&&(!best||distance<best.distance))best={name:segment.name,kind:segment.kind,distance};
        }
        return best;
      };
    const addRegion = (r: any) => {
      const { cols, rows, heights } = r.terrain,
        pos: number[] = [],
        terrainUvs: number[] = [],
        terrainColors: number[] = [],
        idx: number[] = [];
      const scaledHeights = heights.map(
          (height: number) => height * terrainVerticalScale,
        ),
        waterVisualAreas = r.waters.map((water: any) => ({
          points: water.points,
          holes: water.holes ?? [],
          minX: Math.min(...water.points.map((point: number[]) => point[0])),
          maxX: Math.max(...water.points.map((point: number[]) => point[0])),
          minZ: Math.min(...water.points.map((point: number[]) => point[1])),
          maxZ: Math.max(...water.points.map((point: number[]) => point[1])),
          level: Math.min(...water.points.map((point: number[]) => terrainHeight(r, point[0], point[1]))) - 0.025,
        })),
        waterAt = (x: number, z: number) => waterVisualAreas.find((water: any) => x >= water.minX && x <= water.maxX && z >= water.minZ && z <= water.maxZ && pointInPolygon(x, z, water.points) && !water.holes.some((hole: number[][]) => pointInPolygon(x, z, hole))),
        minimumHeight = Math.min(...scaledHeights),
        maximumHeight = Math.max(...scaledHeights),
        heightRange = Math.max(0.001, maximumHeight - minimumHeight),
        lowlandColor = new THREE.Color(realCampus ? 0xd0d8bd : 0x587d49),
        highlandColor = new THREE.Color(realCampus ? 0xd8cfb1 : 0x9a9866),
        terrainTone = new THREE.Color(),
        heightAt = (i: number, j: number) =>
          scaledHeights[
            THREE.MathUtils.clamp(j, 0, rows - 1) * cols +
              THREE.MathUtils.clamp(i, 0, cols - 1)
          ] ?? 0;
      for (let j = 0; j < rows; j++)
        for (let i = 0; i < cols; i++) {
          const x = r.offsetX - r.width / 2 + (i / (cols - 1)) * r.width,
            z = r.depth / 2 - (j / (rows - 1)) * r.depth,
            rawHeight = heightAt(i, j),
            water = waterAt(x, z),
            height = realCampus && water ? Math.min(rawHeight, water.level - 0.08) : rawHeight,
            normalizedHeight = (height - minimumHeight) / heightRange,
            gradient = Math.hypot(
              heightAt(i + 1, j) - heightAt(i - 1, j),
              heightAt(i, j + 1) - heightAt(i, j - 1),
            ),
            slopeShade = THREE.MathUtils.clamp(1 - gradient * 0.13, 0.72, 1);
          pos.push(x, height, z);
          terrainUvs.push(x * 1.5, z * 1.5);
          terrainTone
            .copy(lowlandColor)
            .lerp(highlandColor, normalizedHeight * 0.82)
            .multiplyScalar(slopeShade);
          terrainColors.push(terrainTone.r, terrainTone.g, terrainTone.b);
        }
      for (let j = 0; j < rows - 1; j++)
        for (let i = 0; i < cols - 1; i++) {
          const a = j * cols + i,
            b = a + 1,
            c = a + cols,
            d = c + 1;
          idx.push(a, b, c, b, d, c);
        }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(terrainUvs, 2));
      geo.setAttribute(
        "color",
        new THREE.Float32BufferAttribute(terrainColors, 3),
      );
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const terrain = new THREE.Mesh(
        geo,
        applyCampusSurface(new THREE.MeshStandardMaterial({
          vertexColors: true,
          map: null,
          roughnessMap: null,
          roughness: 0.98,
          side: THREE.FrontSide,
        })),
      );
      terrain.receiveShadow = true;
      terrain.castShadow = true;
      mapGroup.add(terrain);
      terrainMeshes.push(terrain);
      if (realCampus && r.landcovers?.length) {
        type LandcoverBucket = {
          positions: number[];
          indices: number[];
          uvs: number[];
          color: number;
        };
        const landcoverBuckets: Record<"lawn" | "garden" | "forest" | "pitch", LandcoverBucket> = {
          lawn: { positions: [], indices: [], uvs: [], color: 0xd6dec9 },
          garden: { positions: [], indices: [], uvs: [], color: 0xcbd8c1 },
          forest: { positions: [], indices: [], uvs: [], color: 0xb9cbb7 },
          pitch: { positions: [], indices: [], uvs: [], color: 0xc6dbc4 },
        };
        for (const cover of r.landcovers) {
          if (cover.kind !== "pitch") continue;
          const clean = cover.points.filter(
            (point: number[], index: number, points: number[][]) =>
              !index || Math.hypot(point[0] - points[index - 1][0], point[1] - points[index - 1][1]) > 0.001,
          );
          if (clean.length > 2 && Math.hypot(clean[0][0] - clean.at(-1)![0], clean[0][1] - clean.at(-1)![1]) < 0.001)
            clean.pop();
          if (clean.length < 3) continue;
          const bucket = cover.kind === "pitch"
            ? landcoverBuckets.pitch
            : cover.kind === "forest" || cover.kind === "wood"
              ? landcoverBuckets.forest
              : cover.kind === "garden"
                ? landcoverBuckets.garden
                : landcoverBuckets.lawn;
          const base = bucket.positions.length / 3,
            faces = THREE.ShapeUtils.triangulateShape(clean.map((point: number[]) => new THREE.Vector2(point[0], point[1])), []);
          for (const point of clean) {
            bucket.positions.push(point[0], terrainHeight(r, point[0], point[1]) + 0.018, point[1]);
            bucket.uvs.push(point[0] * 1.5, point[1] * 1.5);
          }
          for (const face of faces) bucket.indices.push(base + face[0], base + face[1], base + face[2]);
        }
        for (const bucket of Object.values(landcoverBuckets)) {
          if (!bucket.positions.length) continue;
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute("position", new THREE.Float32BufferAttribute(bucket.positions, 3));
          geometry.setAttribute("uv", new THREE.Float32BufferAttribute(bucket.uvs, 2));
          geometry.setIndex(bucket.indices);
          geometry.computeVertexNormals();
          const mesh = new THREE.Mesh(geometry, applyCampusMacro(new THREE.MeshStandardMaterial({
            color: bucket.color,
            map: campusTextures?.grass ?? null,
            roughnessMap: campusTextures?.grassRoughness ?? null,
            roughness: 1,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1,
          }), 0.24));
          mesh.receiveShadow = false;
          mesh.renderOrder = 1;
          mapGroup.add(mesh);
        }
      }
      if (realCampus && r.hardscapes?.length && !campusTextures?.surfaceMask) {
        const hardscapeBuckets = {
          pedestrian: { positions: [] as number[], indices: [] as number[], uvs: [] as number[], color: 0xebe7df, texture: campusTextures?.paving, roughness: campusTextures?.pavingRoughness },
          parking: { positions: [] as number[], indices: [] as number[], uvs: [] as number[], color: 0xd2d4d2, texture: campusTextures?.asphalt, roughness: campusTextures?.asphaltRoughness },
        };
        for (const area of r.hardscapes) {
          const clean = area.points.filter(
            (point: number[], index: number, points: number[][]) =>
              !index || Math.hypot(point[0] - points[index - 1][0], point[1] - points[index - 1][1]) > 0.001,
          );
          if (clean.length > 2 && Math.hypot(clean[0][0] - clean.at(-1)![0], clean[0][1] - clean.at(-1)![1]) < 0.001) clean.pop();
          if (clean.length < 3) continue;
          const bucket = area.kind === "parking" ? hardscapeBuckets.parking : hardscapeBuckets.pedestrian,
            base = bucket.positions.length / 3,
            faces = THREE.ShapeUtils.triangulateShape(clean.map((point: number[]) => new THREE.Vector2(point[0], point[1])), []);
          for (const point of clean) { bucket.positions.push(point[0], terrainHeight(r, point[0], point[1]) + 0.026, point[1]); bucket.uvs.push(point[0] * 24, point[1] * 24); }
          for (const face of faces) bucket.indices.push(base + face[0], base + face[1], base + face[2]);
        }
        for (const bucket of Object.values(hardscapeBuckets)) {
          if (!bucket.positions.length) continue;
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute("position", new THREE.Float32BufferAttribute(bucket.positions, 3));
          geometry.setAttribute("uv", new THREE.Float32BufferAttribute(bucket.uvs, 2));
          geometry.setIndex(bucket.indices);
          geometry.computeVertexNormals();
          const mesh = new THREE.Mesh(geometry, applyCampusMacro(new THREE.MeshStandardMaterial({ color: bucket.color, map: bucket.texture ?? null, roughnessMap: bucket.roughness ?? null, roughness: 0.96, depthTest: false, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), 0.1));
          mesh.receiveShadow = false;
          mesh.renderOrder = 8;
          mapGroup.add(mesh);
        }
      }
      for (const campus of r.campuses ?? []) {
        const team: Team | null =
          campus.name === "北京大学"
            ? "pku"
            : campus.name === "清华大学"
              ? "thu"
              : null;
        if (!team || campus.points.length < 3) continue;
        const fill = new THREE.Mesh(
          surfaceGeometry(r, campus.points, 0.025),
          new THREE.MeshBasicMaterial({
            color: TEAM_COLOR[team],
            transparent: true,
            opacity: 0.095,
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
        );
        fill.renderOrder = 0;
        fill.visible = false;
        mapGroup.add(fill);
        const borderPoints = campus.points.map(
            (p: number[]) =>
              new THREE.Vector3(
                p[0],
                terrainHeight(r, p[0], p[1]) + 0.16,
                p[1],
              ),
          ),
          border = new THREE.LineLoop(
            new THREE.BufferGeometry().setFromPoints(borderPoints),
            new THREE.LineBasicMaterial({
              color: TEAM_COLOR[team],
              transparent: true,
              opacity: 0.68,
            }),
          );
        border.renderOrder = 3;
        border.visible = false;
        mapGroup.add(border);
      }
      if (r === regions.main)
        for (const surface of sportSurfaces) {
          const rawPoints = surface.points.map(([x, z]) => [x, z]),
            centerX =
              rawPoints.reduce((sum, point) => sum + point[0], 0) /
              rawPoints.length,
            centerZ =
              rawPoints.reduce((sum, point) => sum + point[1], 0) /
              rawPoints.length,
            covariance = rawPoints.reduce(
              (value, [x, z]) => {
                const dx = x - centerX,
                  dz = z - centerZ;
                value.xx += dx * dx;
                value.zz += dz * dz;
                value.xz += dx * dz;
                return value;
              },
              { xx: 0, zz: 0, xz: 0 },
            ),
            axisAngle =
              Math.atan2(
                2 * covariance.xz,
                covariance.xx - covariance.zz,
              ) / 2,
            axisX = Math.cos(axisAngle),
            axisZ = Math.sin(axisAngle),
            sideX = -axisZ,
            sideZ = axisX,
            projections = rawPoints.map(([x, z]) => ({
              along: (x - centerX) * axisX + (z - centerZ) * axisZ,
              side: (x - centerX) * sideX + (z - centerZ) * sideZ,
            })),
            halfLength = Math.max(
              ...projections.map((value) => Math.abs(value.along)),
            ),
            halfWidth = Math.max(
              ...projections.map((value) => Math.abs(value.side)),
            ),
            at = (along: number, side: number): [number, number] => [
              centerX + axisX * along + sideX * side,
              centerZ + axisZ * along + sideZ * side,
            ],
            capsule = (length: number, width: number) => {
              const radius = Math.max(0.08, width),
                straight = Math.max(0.05, length - radius),
                result: [number, number][] = [];
              for (let index = 0; index <= 16; index++) {
                const angle = -Math.PI / 2 + (index / 16) * Math.PI;
                result.push(
                  at(
                    straight + Math.cos(angle) * radius,
                    Math.sin(angle) * radius,
                  ),
                );
              }
              for (let index = 0; index <= 16; index++) {
                const angle = Math.PI / 2 + (index / 16) * Math.PI;
                result.push(
                  at(
                    -straight + Math.cos(angle) * radius,
                    Math.sin(angle) * radius,
                  ),
                );
              }
              return result;
            },
            points = surface.track
              ? capsule(halfLength, halfWidth)
              : rawPoints,
            interiorHeightSamples = Array.from(
              { length: 25 },
              (_, index) => {
                const along = ((index % 5) / 4) * 2 - 1,
                  side = (Math.floor(index / 5) / 4) * 2 - 1,
                  [x, z] = at(along * halfLength, side * halfWidth);
                return terrainHeight(r, x, z);
              },
            ),
            surfaceHeight = Math.max(
              terrainHeight(r, centerX, centerZ),
              ...points.map(([x, z]) => terrainHeight(r, x, z)),
              ...interiorHeightSamples,
            ),
            flatSportHeight = () => surfaceHeight,
            baseMaterial = applyCampusMacro(new THREE.MeshStandardMaterial({
                color: realCampus ? surface.track ? 0xd2cbc3 : 0xb4bea8 : surface.track ? 0xb84a3f : 0x397a48,
                map: realCampus ? surface.track ? campusTextures?.track ?? null : campusTextures?.grass ?? null : null,
                roughnessMap: realCampus ? surface.track ? campusTextures?.trackRoughness ?? null : campusTextures?.grassRoughness ?? null : null,
                emissive: surface.track ? 0x170a07 : 0x07110a,
                emissiveIntensity: realCampus ? 0.015 : 0.05,
                roughness: realCampus ? 0.91 : 0.96,
                side: THREE.DoubleSide,
                polygonOffset: true,
                polygonOffsetFactor: -3,
              }), realCampus ? 0.12 : 0),
            base = new THREE.Mesh(
              surfaceGeometry(r, points, 0.035, flatSportHeight),
              baseMaterial,
            );
          sportMaterials.push(baseMaterial);
          base.name = surface.name;
          base.receiveShadow = true;
          base.renderOrder = 2;
          mapGroup.add(base);
          const trackInset = Math.min(0.38, halfWidth * 0.3),
            infieldHalfWidth = Math.max(0.24, halfWidth - trackInset),
            infieldHalfLength = Math.max(0.3, halfLength - trackInset),
            infieldStraight = Math.max(
              0.05,
              infieldHalfLength - infieldHalfWidth,
            ),
            pitchHalfWidth = surface.track
              ? Math.max(0.2, infieldHalfWidth * 0.76)
              : halfWidth * 0.94,
            curvedCornerLimit =
              infieldStraight +
              Math.sqrt(
                Math.max(
                  0,
                  infieldHalfWidth * infieldHalfWidth -
                    pitchHalfWidth * pitchHalfWidth,
                ),
              ),
            pitchHalfLength = surface.track
              ? Math.max(
                  0.26,
                  Math.min(
                    infieldHalfLength * 0.92,
                    curvedCornerLimit - 0.06,
                  ),
                )
              : halfLength * 0.94,
            inner: [number, number][] = [
              at(-pitchHalfLength, -pitchHalfWidth),
              at(pitchHalfLength, -pitchHalfWidth),
              at(pitchHalfLength, pitchHalfWidth),
              at(-pitchHalfLength, pitchHalfWidth),
            ],
            pitchMaterial = applyCampusMacro(new THREE.MeshStandardMaterial({
                color: realCampus ? 0xb7c1a9 : 0x2f914d,
                map: realCampus ? campusTextures?.grass ?? null : null,
                roughnessMap: realCampus ? campusTextures?.grassRoughness ?? null : null,
                emissive: 0x07110a,
                emissiveIntensity: realCampus ? 0.015 : 0.05,
                roughness: 0.96,
                side: THREE.DoubleSide,
                polygonOffset: true,
                polygonOffsetFactor: -4,
              }), realCampus ? 0.16 : 0),
            pitch = new THREE.Mesh(
              surfaceGeometry(r, inner, 0.055, flatSportHeight),
              pitchMaterial,
            ),
            markings: GroundMarking[] = [{ points: inner, closed: true }];
          sportMaterials.push(pitchMaterial);
          pitch.receiveShadow = true;
          pitch.renderOrder = 3;
          mapGroup.add(pitch);
          const addFieldLine = (values: [number, number][], loop = false) => {
            markings.push({ points: values, closed: loop });
          };
          addFieldLine(
            [at(0, -pitchHalfWidth), at(0, pitchHalfWidth)],
          );
          addFieldLine(
            Array.from({ length: 33 }, (_, index) => {
              const angle = (index / 32) * Math.PI * 2,
                radius = Math.min(0.32, pitchHalfWidth * 0.24);
              return at(Math.cos(angle) * radius, Math.sin(angle) * radius);
            }),
            true,
          );
          for (const sign of [-1, 1]) {
            const end = sign * pitchHalfLength,
              penaltyInner = sign * pitchHalfLength * 0.7,
              goalInner = sign * pitchHalfLength * 0.86;
            addFieldLine(
              [
                at(end, -pitchHalfWidth * 0.58),
                at(penaltyInner, -pitchHalfWidth * 0.58),
                at(penaltyInner, pitchHalfWidth * 0.58),
                at(end, pitchHalfWidth * 0.58),
              ],
            );
            addFieldLine(
              [
                at(end, -pitchHalfWidth * 0.3),
                at(goalInner, -pitchHalfWidth * 0.3),
                at(goalInner, pitchHalfWidth * 0.3),
                at(end, pitchHalfWidth * 0.3),
              ],
            );
          }
          if (surface.track)
            for (const inset of [0.08, 0.16, 0.24, 0.32]) {
              const lanePoints = capsule(
                Math.max(0.1, halfLength - inset),
                Math.max(0.08, halfWidth - inset),
              );
              markings.push({ points: lanePoints, closed: true });
            }
          const sportDetails = createSportMarkings(markings, surfaceHeight + .075);
          sportDetailMeshes.push(sportDetails);
          mapGroup.add(sportDetails);
        }
      type RoadBucket = {
        positions: number[];
        indices: number[];
        uvs: number[];
        vertexIndex: number;
        color: number;
        lift: number;
        renderOrder: number;
        texture?: THREE.Texture;
        roughness?: THREE.Texture;
      };
      const roadBuckets: Record<"asphalt" | "path" | "dirt" | "curb", RoadBucket> = {
          asphalt: {
            positions: [],
            indices: [],
            uvs: [],
            vertexIndex: 0,
            color: realCampus ? 0xd2d4d3 : 0x303840,
            lift: 0.035,
            renderOrder: 2,
            texture: campusTextures?.asphalt,
            roughness: campusTextures?.asphaltRoughness,
          },
          dirt: {
            positions: [],
            indices: [],
            uvs: [],
            vertexIndex: 0,
            color: 0x9a805a,
            lift: 0.042,
            renderOrder: 3,
          },
          path: {
            positions: [],
            indices: [],
            uvs: [],
            vertexIndex: 0,
            color: realCampus ? 0xeeeae2 : 0xb9ad91,
            lift: 0.048,
            renderOrder: 4,
            texture: campusTextures?.paving,
            roughness: campusTextures?.pavingRoughness,
          },
          curb: {
            positions: [],
            indices: [],
            uvs: [],
            vertexIndex: 0,
            color: 0xd8d3c8,
            lift: 0.03,
            renderOrder: 1,
            texture: campusTextures?.paving,
            roughness: campusTextures?.pavingRoughness,
          },
        },
        waterAreas = waterVisualAreas,
        inWater = (x: number, z: number) =>
          waterAreas.some(
            (water: any) =>
              x >= water.minX &&
              x <= water.maxX &&
              z >= water.minZ &&
              z <= water.maxZ &&
              pointInPolygon(x, z, water.points) && !(water.holes ?? []).some((hole: number[][]) => pointInPolygon(x, z, hole)),
          );
      const addRoadCap = (
          bucket: RoadBucket,
          x: number,
          z: number,
          radius: number,
        ) => {
          const ring: [number, number][] = [];
          for (let step = 0; step <= 10; step++) {
            const angle = (step / 10) * Math.PI * 2;
            ring.push([
              x + Math.cos(angle) * radius,
              z + Math.sin(angle) * radius,
            ]);
          }
          const flatY =
              Math.max(
                terrainHeight(r, x, z),
                ...ring.map(([edgeX, edgeZ]) => terrainHeight(r, edgeX, edgeZ)),
              ) +
              bucket.lift +
              0.004,
            centerIndex = bucket.vertexIndex;
          bucket.positions.push(x, flatY, z);
          bucket.uvs.push(x * 8, z * 8);
          bucket.vertexIndex++;
          ring.forEach(([edgeX, edgeZ], step) => {
            bucket.positions.push(edgeX, flatY, edgeZ);
            bucket.uvs.push(edgeX * 8, edgeZ * 8);
            bucket.vertexIndex++;
            if (step > 0)
              bucket.indices.push(
                centerIndex,
                centerIndex + step,
                centerIndex + step + 1,
              );
          });
        },
        addRoadStrip = (
          bucket: RoadBucket,
          points: [number, number][],
          width: number,
        ) => {
          if (points.length < 2) return;
          const firstVertex = bucket.vertexIndex,
            halfWidth = width / 2;
          points.forEach(([x, z], index) => {
            const previous = points[Math.max(0, index - 1)],
              next = points[Math.min(points.length - 1, index + 1)],
              incomingX = x - previous[0],
              incomingZ = z - previous[1],
              outgoingX = next[0] - x,
              outgoingZ = next[1] - z,
              incomingLength = Math.hypot(incomingX, incomingZ),
              outgoingLength = Math.hypot(outgoingX, outgoingZ);
            let offsetX = 0,
              offsetZ = 0;
            if (!index || index === points.length - 1) {
              const dx = !index ? outgoingX : incomingX,
                dz = !index ? outgoingZ : incomingZ,
                length = Math.max(0.0001, Math.hypot(dx, dz));
              offsetX = (-dz / length) * halfWidth;
              offsetZ = (dx / length) * halfWidth;
            } else {
              const inX = incomingX / Math.max(0.0001, incomingLength),
                inZ = incomingZ / Math.max(0.0001, incomingLength),
                outX = outgoingX / Math.max(0.0001, outgoingLength),
                outZ = outgoingZ / Math.max(0.0001, outgoingLength),
                tangentX = inX + outX,
                tangentZ = inZ + outZ,
                tangentLength = Math.hypot(tangentX, tangentZ);
              if (tangentLength < 0.08) {
                offsetX = -inZ * halfWidth;
                offsetZ = inX * halfWidth;
              } else {
                const miterX = -tangentZ / tangentLength,
                  miterZ = tangentX / tangentLength,
                  normalX = -inZ,
                  normalZ = inX,
                  denominator = miterX * normalX + miterZ * normalZ,
                  rawLength =
                    Math.abs(denominator) < 0.2
                      ? halfWidth
                      : halfWidth / denominator,
                  miterLength = THREE.MathUtils.clamp(
                    rawLength,
                    -halfWidth * 1.8,
                    halfWidth * 1.8,
                  );
                offsetX = miterX * miterLength;
                offsetZ = miterZ * miterLength;
              }
            }
            const leftX = x + offsetX,
              leftZ = z + offsetZ,
              rightX = x - offsetX,
              rightZ = z - offsetZ;
            bucket.positions.push(
              leftX,
              terrainHeight(r, leftX, leftZ) + bucket.lift,
              leftZ,
              rightX,
              terrainHeight(r, rightX, rightZ) + bucket.lift,
              rightZ,
            );
            bucket.uvs.push(leftX * 8, leftZ * 8, rightX * 8, rightZ * 8);
            bucket.vertexIndex += 2;
            if (index > 0) {
              const previousLeft = firstVertex + (index - 1) * 2,
                previousRight = previousLeft + 1,
                currentLeft = firstVertex + index * 2,
                currentRight = currentLeft + 1;
              bucket.indices.push(
                previousLeft,
                currentLeft,
                previousRight,
                currentLeft,
                currentRight,
                previousRight,
              );
            }
          });
          addRoadCap(bucket, points[0][0], points[0][1], halfWidth);
          const lastPoint = points.at(-1)!;
          addRoadCap(bucket, lastPoint[0], lastPoint[1], halfWidth);
        };
      const pedestrianKinds = new Set([
          "footway",
          "path",
          "pedestrian",
          "steps",
          "cycleway",
          "corridor",
        ]);
      for (const road of r.roads) registerNamedRoad(road);
      const classicVehicleCell = 3,
        classicVehicleSegments: {x1:number;z1:number;x2:number;z2:number;radius:number}[] = [],
        classicVehicleIndex = new Map<string,number[]>();
      if (!realCampus) for (const road of r.roads) {
        if (pedestrianKinds.has(road.kind)) continue;
        const radius = Math.max(road.width, 0.24) / 2;
        for (let index = 1; index < road.points.length; index++) {
          const [x1,z1]=road.points[index-1],[x2,z2]=road.points[index],segmentIndex=classicVehicleSegments.length;
          classicVehicleSegments.push({x1,z1,x2,z2,radius});
          for(let gx=Math.floor((Math.min(x1,x2)-radius)/classicVehicleCell);gx<=Math.floor((Math.max(x1,x2)+radius)/classicVehicleCell);gx++)for(let gz=Math.floor((Math.min(z1,z2)-radius)/classicVehicleCell);gz<=Math.floor((Math.max(z1,z2)+radius)/classicVehicleCell);gz++){
            const key=`${gx}/${gz}`,bucket=classicVehicleIndex.get(key);if(bucket)bucket.push(segmentIndex);else classicVehicleIndex.set(key,[segmentIndex]);
          }
        }
      }
      const onClassicVehicleSurface=(x:number,z:number)=>(classicVehicleIndex.get(`${Math.floor(x/classicVehicleCell)}/${Math.floor(z/classicVehicleCell)}`)??[]).some(index=>{
        const segment=classicVehicleSegments[index],dx=segment.x2-segment.x1,dz=segment.z2-segment.z1,length=dx*dx+dz*dz,t=length?THREE.MathUtils.clamp(((x-segment.x1)*dx+(z-segment.z1)*dz)/length,0,1):0;
        return Math.hypot(x-(segment.x1+dx*t),z-(segment.z1+dz*t))<=segment.radius+.055;
      });
      for (const road of r.roads) {
        if (realCampus && campusTextures?.surfaceMask && !road.bridge) continue;
        const kind = road.kind as string,
          pedestrianRoad = pedestrianKinds.has(kind),
          bucket = pedestrianRoad
            ? roadBuckets.path
            : kind === "track"
              ? roadBuckets.dirt
              : roadBuckets.asphalt,
          displayWidth = Math.max(road.width, realCampus ? pedestrianRoad ? 0.04 : 0.08 : pedestrianRoad ? 0.15 : 0.24);
        let chunk: [number, number][] = [];
        const flushChunk = () => {
          if (chunk.length > 1) {
            if (realCampus && !pedestrianRoad && (road.sidewalk && road.sidewalk !== "no" || ["primary","secondary","tertiary","residential","living_street"].includes(kind)))
              addRoadStrip(roadBuckets.curb, chunk, displayWidth + 0.055);
            addRoadStrip(bucket, chunk, displayWidth);
          }
          chunk = [];
        };
        for (let k = 1; k < road.points.length; k++) {
          const [x1, z1] = road.points[k - 1],
            [x2, z2] = road.points[k],
            dx = x2 - x1,
            dz = z2 - z1,
            len = Math.hypot(dx, dz);
          if (len < 0.01) continue;
          const steps = Math.max(1, Math.ceil(len / 0.18));
          for (let step = 0; step <= steps; step++) {
            const t = step / steps,
              sampleX = x1 + dx * t,
              sampleZ = z1 + dz * t;
            if (
              (!realCampus && inWater(sampleX, sampleZ)) ||
              (!realCampus && pedestrianRoad && onClassicVehicleSurface(sampleX, sampleZ))
            ) {
              flushChunk();
              continue;
            }
            const previousPoint = chunk.at(-1);
            if (
              previousPoint &&
              Math.hypot(
                sampleX - previousPoint[0],
                sampleZ - previousPoint[1],
              ) > 0.3
            )
              flushChunk();
            if (
              !chunk.length ||
              Math.hypot(
                sampleX - chunk.at(-1)![0],
                sampleZ - chunk.at(-1)![1],
              ) > 0.002
            )
              chunk.push([sampleX, sampleZ]);
          }
        }
        flushChunk();
      }
      if (realCampus && !campusTextures?.surfaceMask) {
        type RoadEndpoint = { x: number; z: number; width: number; pedestrian: boolean; bridge: boolean; roadIndex: number };
        type RoadSegment = { x1:number;z1:number;x2:number;z2:number;width:number;pedestrian:boolean;bridge:boolean;roadIndex:number };
        const endpointCell = 0.35,
          endpointIndex = new Map<string, RoadEndpoint[]>(),
          segmentIndex = new Map<string,RoadSegment[]>(),
          endpoints: RoadEndpoint[] = [];
        for (const [roadIndex,road] of r.roads.entries()) {
          if (road.points.length < 2) continue;
          const pedestrian = pedestrianKinds.has(road.kind), width = Math.max(road.width, pedestrian ? 0.04 : 0.08);
          for (const point of [road.points[0], road.points.at(-1)]) endpoints.push({ x: point[0], z: point[1], width, pedestrian, bridge: !!road.bridge, roadIndex });
          for(let pointIndex=1;pointIndex<road.points.length;pointIndex++){
            const first=road.points[pointIndex-1],second=road.points[pointIndex],segment={x1:first[0],z1:first[1],x2:second[0],z2:second[1],width,pedestrian,bridge:!!road.bridge,roadIndex};
            for(let gx=Math.floor((Math.min(segment.x1,segment.x2)-.14)/endpointCell);gx<=Math.floor((Math.max(segment.x1,segment.x2)+.14)/endpointCell);gx++)for(let gz=Math.floor((Math.min(segment.z1,segment.z2)-.14)/endpointCell);gz<=Math.floor((Math.max(segment.z1,segment.z2)+.14)/endpointCell);gz++){
              const key=`${gx}/${gz}`,bucket=segmentIndex.get(key);if(bucket)bucket.push(segment);else segmentIndex.set(key,[segment]);
            }
          }
        }
        for (const endpoint of endpoints) {
          const key = `${Math.floor(endpoint.x / endpointCell)}/${Math.floor(endpoint.z / endpointCell)}`, bucket = endpointIndex.get(key);
          if (bucket) bucket.push(endpoint); else endpointIndex.set(key, [endpoint]);
        }
        const stitched = new Set<string>(), endpointConnected = new Set<RoadEndpoint>();
        for (const endpoint of endpoints) {
          const gx = Math.floor(endpoint.x / endpointCell), gz = Math.floor(endpoint.z / endpointCell);
          let closest: RoadEndpoint | undefined, distance = 0.32;
          for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const candidate of endpointIndex.get(`${gx + dx}/${gz + dz}`) ?? []) {
            if (candidate.roadIndex===endpoint.roadIndex||candidate.pedestrian !== endpoint.pedestrian) continue;
            const gap = Math.hypot(endpoint.x - candidate.x, endpoint.z - candidate.z);
            if (gap > 0.004 && gap < distance) { closest = candidate; distance = gap; }
          }
          if (!closest) continue;
          const first = `${endpoint.x.toFixed(3)}/${endpoint.z.toFixed(3)}`, second = `${closest.x.toFixed(3)}/${closest.z.toFixed(3)}`, key = first < second ? `${first}|${second}` : `${second}|${first}`;
          if (stitched.has(key)) continue;
          const midpointX = (endpoint.x + closest.x) / 2, midpointZ = (endpoint.z + closest.z) / 2;
          if (!endpoint.bridge && !closest.bridge && inWater(midpointX, midpointZ)) continue;
          stitched.add(key);
          endpointConnected.add(endpoint);endpointConnected.add(closest);
          addRoadStrip(endpoint.pedestrian || closest.pedestrian ? roadBuckets.path : roadBuckets.asphalt, [[endpoint.x, endpoint.z], [closest.x, closest.z]], Math.min(endpoint.width, closest.width));
        }
        for(const endpoint of endpoints){
          if(endpointConnected.has(endpoint))continue;
          const gx=Math.floor(endpoint.x/endpointCell),gz=Math.floor(endpoint.z/endpointCell);let best:{segment:RoadSegment;x:number;z:number;distance:number}|undefined;
          for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)for(const segment of segmentIndex.get(`${gx+dx}/${gz+dz}`)??[]){
            if(segment.roadIndex===endpoint.roadIndex||segment.pedestrian!==endpoint.pedestrian)continue;
            const sx=segment.x2-segment.x1,sz=segment.z2-segment.z1,length=sx*sx+sz*sz,t=length?THREE.MathUtils.clamp(((endpoint.x-segment.x1)*sx+(endpoint.z-segment.z1)*sz)/length,0,1):0,x=segment.x1+sx*t,z=segment.z1+sz*t,distance=Math.hypot(endpoint.x-x,endpoint.z-z);
            if(distance>.004&&distance<.14&&(!best||distance<best.distance))best={segment,x,z,distance};
          }
          if(!best)continue;
          const first=`${endpoint.x.toFixed(3)}/${endpoint.z.toFixed(3)}`,second=`${best.x.toFixed(3)}/${best.z.toFixed(3)}`,key=first<second?`${first}|${second}`:`${second}|${first}`;
          if(stitched.has(key))continue;
          const midpointX=(endpoint.x+best.x)/2,midpointZ=(endpoint.z+best.z)/2;
          if(!endpoint.bridge&&!best.segment.bridge&&inWater(midpointX,midpointZ))continue;
          stitched.add(key);
          addRoadStrip(endpoint.pedestrian?roadBuckets.path:roadBuckets.asphalt,[[endpoint.x,endpoint.z],[best.x,best.z]],Math.min(endpoint.width,best.segment.width));
        }
      }
      Object.values(roadBuckets).forEach((bucket) => {
        if (!bucket.positions.length) return;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(bucket.positions, 3),
        );
        geometry.setAttribute("uv", new THREE.Float32BufferAttribute(bucket.uvs, 2));
        geometry.setIndex(bucket.indices);
        geometry.computeVertexNormals();
        const roads = new THREE.Mesh(
          geometry,
          applyCampusMacro(new THREE.MeshStandardMaterial({
            color: bucket.color,
            map: bucket.texture ?? null,
            roughnessMap: bucket.roughness ?? null,
            roughness: 0.94,
            metalness: 0,
            depthTest: true,
            depthWrite: true,
            polygonOffset: true,
            polygonOffsetFactor: -bucket.renderOrder,
            polygonOffsetUnits: -bucket.renderOrder,
          }), 0.12),
        );
        roads.receiveShadow = false;
        roads.renderOrder = realCampus ? 8 + bucket.renderOrder : bucket.renderOrder;
        mapGroup.add(roads);
      });
      const bp: number[] = [],
        bi: number[] = [],
        bc: number[] = [],
        bu: number[] = [],
        bs: number[] = [],
        buildingPalette = [
          0x9aa7a3, 0xaca99f, 0xa49a90, 0x93a2aa, 0xb1a58f, 0x9da69a,
        ],
        appearanceFor = (b: any) => {
          const profile = realCampus
            ? REAL_BUILDING_BY_KEY.get(`${b.osmType}/${b.osmId}`) ?? REAL_LANDMARK_BY_KEY.get(`${b.osmType}/${b.osmId}`)
            : undefined;
          if (profile) {
            const totalHeight = profile.heightMeters * buildingMeterScale,
              customBodyRatio = profile.signature === "domed-auditorium"
                ? 0.38
                : profile.signature === "central-main"
                  ? 0.46
                  : profile.signature === "twin-towers"
                    ? 0.28
                    : 1,
              roofHeight = customBodyRatio < 1 ? 0 : ("roofMeters" in profile ? profile.roofMeters : 0) * buildingMeterScale;
            return {
              totalHeight,
              wallHeight: Math.max(0.09, totalHeight * customBodyRatio - roofHeight),
              roofHeight,
              roof: profile.roof as string,
              wallTone: new THREE.Color(profile.facadeColor),
              roofTone: new THREE.Color(profile.roofColor),
              profile,
            };
          }
          if (realCampus) {
            const use = String(b.building || b.amenity || ""),
              fallbackLevels = /apartments|residential|dormitory/.test(use) ? 6 : /commercial|office|retail/.test(use) ? 8 : /industrial|warehouse/.test(use) ? 3 : /house|detached/.test(use) ? 2 : 4,
              metres = b.height || (b.levels || fallbackLevels) * 3.35,
              totalHeight = THREE.MathUtils.clamp(metres * buildingMeterScale, 0.08, 2.6),
              taggedColor = /^#?[0-9a-f]{6}$/i.test(b.colour || "") ? (b.colour.startsWith("#") ? b.colour : `#${b.colour}`) : null,
              wallTone = new THREE.Color(taggedColor || (/industrial|warehouse/.test(use) ? "#9aa09d" : /commercial|office|retail/.test(use) ? "#91a0a4" : /house|detached/.test(use) ? "#a6907e" : "#a7a49b")),
              roofTone = new THREE.Color(/^#?[0-9a-f]{6}$/i.test(b.roofColour || "") ? (b.roofColour.startsWith("#") ? b.roofColour : `#${b.roofColour}`) : /industrial|commercial|office/.test(use) ? "#727a79" : "#77736c"),
              roof = ["gabled","hipped","pyramidal"].includes(b.roofShape) ? b.roofShape : "flat",
              roofHeight = roof === "flat" ? 0 : Math.min(0.11, totalHeight * 0.18);
            return { totalHeight, wallHeight: Math.max(0.07, totalHeight - roofHeight), roofHeight, roof, wallTone, roofTone, profile: undefined };
          }
          const totalHeight = b.levels
              ? Math.min(7, b.levels * 0.58)
              : 0.95 + (b.osmId % 6) * 0.17,
            tone = new THREE.Color(
              buildingPalette[Math.abs(b.osmId) % buildingPalette.length],
            );
          return {
            totalHeight,
            wallHeight: totalHeight,
            roofHeight: 0,
            roof: "flat" as string,
            wallTone: tone.clone().multiplyScalar(0.78),
            roofTone: tone.clone().lerp(new THREE.Color(0xd0b09b), 0.26),
            profile: undefined,
          };
        };
      let bv = 0;
      for (const b of gameplayBuildings(r)) {
        const pts = b.points.filter(
          (p: number[], i: number, a: number[][]) =>
            !i || Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) > 0.001,
        );
        if (
          pts.length > 2 &&
          Math.hypot(pts[0][0] - pts.at(-1)[0], pts[0][1] - pts.at(-1)[1]) <
            0.001
        )
          pts.pop();
        if (pts.length < 3) continue;
        const x =
            pts.reduce((a: number, p: number[]) => a + p[0], 0) / pts.length,
          z = pts.reduce((a: number, p: number[]) => a + p[1], 0) / pts.length,
          centerBase = terrainHeight(r, x, z),
          base = realCampus
            ? Math.max(centerBase, ...pts.map((point: number[]) => terrainHeight(r, point[0], point[1])))
            : centerBase,
          appearance = appearanceFor(b),
          h = appearance.wallHeight,
          start = bv,
          wallTone = appearance.wallTone,
          roofTone = appearance.roofTone;
        if (realCampus && (appearance.profile?.signature === "chinese-gate" || appearance.profile?.signature === "white-arch-gate")) continue;
        let facadeDistance = 0;
        for (let pointIndex = 0; pointIndex < pts.length; pointIndex++) {
          const p = pts[pointIndex];
          if (pointIndex) facadeDistance += Math.hypot(p[0] - pts[pointIndex - 1][0], p[1] - pts[pointIndex - 1][1]);
          bp.push(p[0], realCampus ? terrainHeight(r, p[0], p[1]) : base, p[1], p[0], base + h, p[1]);
          bu.push(facadeDistance * 12, 0, facadeDistance * 12, Math.max(1, h * 40));
          bs.push(0, 0);
          bc.push(
            wallTone.r,
            wallTone.g,
            wallTone.b,
            realCampus ? wallTone.r : roofTone.r,
            realCampus ? wallTone.g : roofTone.g,
            realCampus ? wallTone.b : roofTone.b,
          );
          bv += 2;
        }
        const roofStart = bv;
        if (realCampus) for (const point of pts) {
          bp.push(point[0], base + h, point[1]);
          bu.push(point[0] * 1.35, point[1] * 1.35);
          bc.push(roofTone.r, roofTone.g, roofTone.b);
          bs.push(1);
          bv++;
        }
        const roofVertex = (index: number) => realCampus ? roofStart + index : start + index * 2 + 1;
        for (let i = 0; i < pts.length; i++) {
          const j = (i + 1) % pts.length,
            a = start + i * 2,
            c = start + j * 2;
          bi.push(a, c, a + 1, a + 1, c, c + 1);
        }
        if (appearance.roofHeight > 0) {
          if (appearance.roof === "gabled") {
            const xs=pts.map((p:number[])=>p[0]),zs=pts.map((p:number[])=>p[1]),alongX=Math.max(...xs)-Math.min(...xs)>=Math.max(...zs)-Math.min(...zs),extent=(alongX?Math.max(...xs)-Math.min(...xs):Math.max(...zs)-Math.min(...zs))*.36,
              ridgeStart=bv,ridgeA=[x+(alongX?-extent:0),z+(alongX?0:-extent)],ridgeB=[x+(alongX?extent:0),z+(alongX?0:extent)];
            for(const ridge of [ridgeA,ridgeB]){bp.push(ridge[0],base+h+appearance.roofHeight,ridge[1]);bu.push(ridge[0]*1.35,ridge[1]*1.35);bc.push(roofTone.r,roofTone.g,roofTone.b);bs.push(1);bv++;}
            for(let i=0;i<pts.length;i++){const j=(i+1)%pts.length,mid=(alongX?(pts[i][0]+pts[j][0])/2-x:(pts[i][1]+pts[j][1])/2-z);bi.push(roofVertex(i),roofVertex(j),ridgeStart+(mid>0?1:0));}
          } else {
            const apex=bv;bp.push(x,base+h+appearance.roofHeight,z);bu.push(x*1.35,z*1.35);bc.push(roofTone.r,roofTone.g,roofTone.b);bs.push(1);bv++;
            for(let i=0;i<pts.length;i++){const j=(i+1)%pts.length;bi.push(roofVertex(i),roofVertex(j),apex);}
          }
        } else for (const face of THREE.ShapeUtils.triangulateShape(
            pts.map((p: number[]) => new THREE.Vector2(p[0], p[1])),
            [],
          ))
            bi.push(
              roofVertex(face[0]),
              roofVertex(face[1]),
              roofVertex(face[2]),
            );
      }
      const bg = new THREE.BufferGeometry();
      bg.setAttribute("position", new THREE.Float32BufferAttribute(bp, 3));
      bg.setAttribute("color", new THREE.Float32BufferAttribute(bc, 3));
      bg.setAttribute("uv", new THREE.Float32BufferAttribute(bu, 2));
      bg.setAttribute("campusRoofFactor", new THREE.Float32BufferAttribute(bs, 1));
      bg.setIndex(bi);
      bg.computeVertexNormals();
      const facadeBuildingMaterial = applyCampusBuildingSurface(new THREE.MeshStandardMaterial({
          vertexColors: true,
          map: campusTextures?.facade ?? null,
          roughnessMap: campusTextures?.facadeRoughness ?? null,
          roughness: 0.82,
          side: THREE.DoubleSide,
          flatShading: true,
        }));
      const buildings = new THREE.Mesh(
        bg,
        facadeBuildingMaterial,
      );
      facadeBuildingMaterial.emissive.set(0x26384b);
      facadeBuildingMaterial.emissiveIntensity = 0;
      buildingSurfaceMaterials.push(facadeBuildingMaterial);
      buildings.receiveShadow = false;
      buildings.castShadow = true;
      mapGroup.add(buildings);
      if (realCampus) {
        type AccentKind = "box" | "column" | "dome" | "roof";
        type Accent = { matrix: THREE.Matrix4; color: THREE.Color };
        const accents: Record<AccentKind, Accent[]> = { box: [], column: [], dome: [], roof: [] },
          dummy = new THREE.Object3D(),
          footprintByKey = new Map(gameplayBuildings(r).map((building: any) => [`${building.osmType}/${building.osmId}`, building])),
          push = (kind: AccentKind, x: number, y: number, z: number, sx: number, sy: number, sz: number, color: string, rotation = 0) => {
            dummy.position.set(x, y, z);
            dummy.scale.set(sx, sy, sz);
            dummy.rotation.set(0, rotation, 0);
            dummy.updateMatrix();
            accents[kind].push({ matrix: dummy.matrix.clone(), color: new THREE.Color(color) });
          };
        for (const landmark of REAL_LANDMARK_BY_SITE.values()) {
          const site = gameRef.current.sites[landmark.siteId];
          if (!site) continue;
          const building: any = footprintByKey.get(landmark.key),
            points: number[][] = building?.points ?? [],
            centerX = points.length ? points.reduce((sum, point) => sum + point[0], 0) / points.length : site.x,
            centerZ = points.length ? points.reduce((sum, point) => sum + point[1], 0) / points.length : site.z;
          let angle = 0;
          if (points.length > 1) {
            let longest = 0;
            for (let index = 0; index < points.length; index++) {
              const next = points[(index + 1) % points.length], dx = next[0] - points[index][0], dz = next[1] - points[index][1], distance = Math.hypot(dx, dz);
              if (distance > longest) { longest = distance; angle = Math.atan2(dz, dx); }
            }
          }
          if (landmark.entranceDirection != null) angle = landmark.entranceDirection * Math.PI / 180;
          const axisX = Math.cos(angle), axisZ = Math.sin(angle), sideX = -axisZ, sideZ = axisX,
            projections = points.length ? points.map(point => ({ along: (point[0] - centerX) * axisX + (point[1] - centerZ) * axisZ, side: (point[0] - centerX) * sideX + (point[1] - centerZ) * sideZ })) : [{ along: -0.3, side: -0.08 }, { along: 0.3, side: 0.08 }],
            length = Math.max(0.24, Math.max(...projections.map(value => value.along)) - Math.min(...projections.map(value => value.along))),
            depth = Math.max(0.12, Math.max(...projections.map(value => value.side)) - Math.min(...projections.map(value => value.side))),
            base = Math.max(terrainHeight(r, centerX, centerZ), ...points.map(point => terrainHeight(r, point[0], point[1]))), height = landmark.heightMeters * buildingMeterScale,
            facade = landmark.facadeColor, trim = landmark.secondaryColor, roof = landmark.roofColor,
            rotation = -angle,
            entranceRadians = landmark.entranceDirection == null ? null : landmark.entranceDirection * Math.PI / 180,
            entranceX = entranceRadians == null ? sideX : Math.sin(entranceRadians),
            entranceZ = entranceRadians == null ? sideZ : -Math.cos(entranceRadians),
            frontSign = sideX * entranceX + sideZ * entranceZ >= 0 ? 1 : -1,
            at = (along: number, side: number) => [centerX + axisX * along + sideX * side * frontSign, centerZ + axisZ * along + sideZ * side * frontSign] as const,
            boxAt = (along: number, side: number, y: number, sx: number, sy: number, sz: number, color = facade) => { const [x, z] = at(along, side); push("box", x, y, z, sx, sy, sz, color, rotation); },
            columnAt = (along: number, side: number, y: number, radius: number, sy: number, color = trim) => { const [x, z] = at(along, side); push("column", x, y, z, radius, sy, radius, color, rotation); },
            roofAt = (along: number, side: number, y: number, sx: number, sy: number, sz: number, color = roof) => { const [x, z] = at(along, side); push("roof", x, y, z, sx, sy, sz, color, rotation); };
          switch (landmark.signature) {
            case "chinese-gate":
              for (const along of [-0.31,-0.11,0.11,0.31]) boxAt(along, 0, base + height * 0.38, 0.075, height * 0.68, Math.max(0.1, depth), facade);
              boxAt(0, 0, base + height * 0.78, Math.max(0.62, length * 1.08), height * 0.16, Math.max(0.11, depth * 1.06), trim);
              roofAt(0, 0, base + height + 0.035, Math.max(0.7, length * 1.16), 0.07, Math.max(0.18, depth * 1.5));
              break;
            case "white-arch-gate":
              for (const along of [-0.31,-0.11,0.11,0.31]) boxAt(along, 0, base + height * 0.4, 0.07, height * 0.72, Math.max(0.1, depth), facade);
              for (const along of [-0.31, -0.11, 0.11, 0.31]) columnAt(along, depth * 0.54, base + height * 0.42, 0.018, height * 0.68);
              boxAt(0, 0, base + height * 0.78, Math.max(0.62, length), height * 0.15, Math.max(0.1, depth), facade);
              boxAt(0, 0, base + height * 0.88, Math.max(0.5, length * 0.8), 0.035, Math.max(0.08, depth * 0.85), trim);
              break;
            case "pagoda":
              boxAt(0, 0, base + height * 0.48, Math.max(0.12, length * 0.56), height * 0.9, Math.max(0.12, depth * 0.56), facade);
              for (let tier = 0; tier < 9; tier++) { const fraction = (tier + 1) / 10, scale = 1 - tier * 0.055; roofAt(0, 0, base + height * fraction, Math.max(0.24, length * 1.45 * scale), 0.035, Math.max(0.24, depth * 1.45 * scale)); }
              roofAt(0, 0, base + height + 0.06, Math.max(0.16, length), 0.12, Math.max(0.16, depth));
              break;
            case "pku-library": {
              boxAt(0, depth * 0.51, base + height * 0.32, length * 0.22, height * 0.42, 0.02, "#395d67");
              break;
            }
            case "xuetang":
              roofAt(0, 0, base + height + 0.025, length * 0.92, 0.05, depth * 0.74);
              boxAt(0, depth * 0.52, base + height * 0.32, length * 0.2, height * 0.48, 0.02, trim);
              for (const along of [-length * 0.09, length * 0.09]) columnAt(along, depth * 0.59, base + height * 0.48, 0.014, height * 0.75);
              boxAt(0, depth * 0.58, base + height * 0.82, length * 0.28, 0.025, 0.03, trim);
              break;
            case "domed-auditorium": {
              const body = height * 0.5, domeRadius = Math.min(length, depth) * 0.36;
              columnAt(0, 0, base + body + domeRadius * 0.12, domeRadius * 0.64, domeRadius * 0.24, roof);
              push("dome", centerX, base + body + domeRadius * 0.08, centerZ, domeRadius * 1.7, Math.max(0.12, (height - body) * 0.58), domeRadius * 1.7, roof, rotation);
              for (const along of [-length * 0.24, -length * 0.08, length * 0.08, length * 0.24]) columnAt(along, depth * 0.56, base + body * 0.52, 0.014, body * 0.9);
              boxAt(0, depth * 0.55, base + body * 0.96, length * 0.7, 0.025, 0.03, trim);
              break;
            }
            case "central-main": {
              const body = height * 0.46, lowerWidth = Math.min(length * 0.22, 0.5), lowerDepth = Math.min(depth * 0.34, 0.38), upperHeight = height - body;
              boxAt(0, 0, base + body + upperHeight * 0.34, lowerWidth, upperHeight * 0.68, lowerDepth, facade);
              boxAt(0, 0, base + body + upperHeight * 0.78, lowerWidth * 0.72, upperHeight * 0.26, lowerDepth * 0.72, trim);
              boxAt(0, depth * 0.52, base + body * 0.22, length * 0.12, body * 0.24, 0.025, "#3e514f");
              for (const along of [-length * 0.075, -length * 0.025, length * 0.025, length * 0.075]) columnAt(along, depth * 0.57, base + body * 0.45, 0.011, body * 0.66);
              roofAt(0, 0, base + height + 0.025, lowerWidth * 0.72, 0.05, lowerDepth * 0.72);
              break;
            }
            case "historic-library":
              for (const along of [-length * 0.31, 0, length * 0.31]) roofAt(along, 0, base + height + 0.022, length * 0.27, 0.045, depth * 0.56);
              for (const along of [-length * 0.075, length * 0.075]) columnAt(along, depth * 0.58, base + height * 0.48, 0.012, height * 0.68);
              boxAt(0, depth * 0.58, base + height * 0.82, length * 0.22, 0.025, 0.03, trim);
              break;
            case "historic-science":
              roofAt(0, 0, base + height + 0.022, length * 0.9, 0.045, depth * 0.78);
              for (const along of [-length * 0.075, length * 0.075]) columnAt(along, depth * 0.58, base + height * 0.48, 0.012, height * 0.68);
              boxAt(0, depth * 0.58, base + height * 0.82, length * 0.22, 0.025, 0.03, trim);
              break;
            case "modern-auditorium":
              boxAt(0, depth * 0.51, base + height * 0.4, length * 0.18, height * 0.52, 0.02, "#3d5963");
              break;
            case "museum":
              for (const along of [-0.35, -0.21, -0.07, 0.07, 0.21, 0.35].map(value => value * length)) boxAt(along, depth * 0.51, base + height * 0.53, length * 0.018, height * 0.88, 0.015, "#765337");
              boxAt(0, depth * 0.58, base + height * 0.18, length * 0.32, height * 0.24, 0.02, "#272a29");
              break;
            case "twin-towers": {
              const podium = height * 0.28;
              for (const along of [-length * 0.26, length * 0.26]) boxAt(along, 0, base + podium + (height - podium) * 0.46, length * 0.34, (height - podium) * 0.92, depth * 0.62, facade);
              boxAt(0, depth * 0.51, base + podium * 0.46, length * 0.25, podium * 0.62, 0.02, "#355663");
              break;
            }
            case "dormitory":
              boxAt(0, depth * 0.52, base + Math.min(0.055, height * 0.25), Math.min(0.12, length * 0.18), Math.min(0.09, height * 0.36), 0.018, trim);
              break;
            case "dining-hall":
              boxAt(0, depth * 0.56, base + Math.min(0.16, height * 0.45), Math.min(0.42, length * 0.52), 0.03, Math.min(0.14, depth * 0.3), trim);
              break;
            default:
              boxAt(0, depth * 0.52, base + Math.min(0.14, height * 0.38), Math.min(0.22, length * 0.3), Math.min(0.18, height * 0.54), 0.018, trim);
          }
        }
        const geometries: Record<AccentKind, THREE.BufferGeometry> = {
            box: new THREE.BoxGeometry(1, 1, 1),
            column: new THREE.CylinderGeometry(0.5, 0.56, 1, 10),
            dome: new THREE.SphereGeometry(0.5, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
            roof: new THREE.ConeGeometry(0.5, 1, 4),
          },
          accentMaterials: Record<AccentKind, THREE.MeshStandardMaterial> = {
            box: new THREE.MeshStandardMaterial({ color: 0xffffff, map: campusTextures?.facade ?? null, roughnessMap: campusTextures?.facadeRoughness ?? null, roughness: 0.84 }),
            column: new THREE.MeshStandardMaterial({ color: 0xffffff, map: campusTextures?.facade ?? null, roughnessMap: campusTextures?.facadeRoughness ?? null, roughness: 0.88 }),
            dome: new THREE.MeshStandardMaterial({ color: 0xffffff, map: campusTextures?.roof ?? null, roughnessMap: campusTextures?.roofRoughness ?? null, roughness: 0.86, metalness: 0.03 }),
            roof: new THREE.MeshStandardMaterial({ color: 0xffffff, map: campusTextures?.roof ?? null, roughnessMap: campusTextures?.roofRoughness ?? null, roughness: 0.9 }),
          };
        geometries.roof.rotateY(Math.PI / 4);
        for (const [kind, instances] of Object.entries(accents) as [AccentKind, Accent[]][]) {
          if (!instances.length) continue;
          const mesh = new THREE.InstancedMesh(geometries[kind], accentMaterials[kind], instances.length);
          instances.forEach((instance, index) => { mesh.setMatrixAt(index, instance.matrix); mesh.setColorAt(index, instance.color); });
          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
          mesh.castShadow = true;
          mapGroup.add(mesh);
        }
      }
      const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(bg, 32),
        new THREE.LineBasicMaterial({
          color: 0x65706e,
          transparent: true,
          opacity: 0.48,
        }),
      );
      outline.renderOrder = 5;
      buildingOutlineObjects.push(outline);
      mapGroup.add(outline);
      const windowInstances: {matrix:THREE.Matrix4;x:number;y:number;z:number}[] = [],
        doorMatrices: THREE.Matrix4[] = [],
        detailDummy = new THREE.Object3D(),
        windowLimit = r === regions.main ? realCampus ? 48000 : 18000 : 2600,
        detailedBuildings = [...gameplayBuildings(r)].sort((a: any, b: any) => {
          const ap = REAL_BUILDING_BY_KEY.get(`${a.osmType}/${a.osmId}`), bp = REAL_BUILDING_BY_KEY.get(`${b.osmType}/${b.osmId}`);
          return Number(bp?.siteId != null) - Number(ap?.siteId != null) || Number(!!bp) - Number(!!ap);
        });
      for (const b of detailedBuildings) {
        const pts = b.points.filter(
          (p: number[], i: number, a: number[][]) =>
            !i || Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) > 0.001,
        );
        if (
          pts.length > 2 &&
          Math.hypot(pts[0][0] - pts.at(-1)[0], pts[0][1] - pts.at(-1)[1]) <
            0.001
        )
          pts.pop();
        if (pts.length < 3) continue;
        const signedArea = pts.reduce((sum: number, p: number[], i: number) => {
            const next = pts[(i + 1) % pts.length];
            return sum + p[0] * next[1] - next[0] * p[1];
          }, 0),
          outwardSign = signedArea > 0 ? -1 : 1;
        const x =
            pts.reduce((a: number, p: number[]) => a + p[0], 0) / pts.length,
          z = pts.reduce((a: number, p: number[]) => a + p[1], 0) / pts.length,
          centerBase = terrainHeight(r, x, z),
          base = realCampus
            ? Math.max(centerBase, ...pts.map((point: number[]) => terrainHeight(r, point[0], point[1])))
            : centerBase,
          appearance = appearanceFor(b),
          h = appearance.wallHeight,
          rows = Math.min(8, Math.max(1, appearance.profile && "levels" in appearance.profile ? appearance.profile.levels : Math.floor(h / 0.48))),
          omitWindows = appearance.profile?.signature === "pagoda" || appearance.profile?.signature === "chinese-gate" || appearance.profile?.signature === "white-arch-gate";
        if (appearance.profile?.signature === "chinese-gate" || appearance.profile?.signature === "white-arch-gate") continue;
        let longest: { a: number[]; c: number[]; len: number } | null = null;
        for (
          let i = 0;
          i < pts.length && windowInstances.length < windowLimit;
          i++
        ) {
          const a = pts[i],
            c = pts[(i + 1) % pts.length],
            dx = c[0] - a[0],
            dz = c[1] - a[1],
            len = Math.hypot(dx, dz);
          if (!longest || len > longest.len) longest = { a, c, len };
          if (len < (realCampus ? 0.12 : 0.42)) continue;
          if (omitWindows) continue;
          const cols = Math.min(8, Math.max(1, Math.floor(len / (realCampus ? 0.12 : 0.34)))),
            angle = Math.atan2(-dz, dx) + (outwardSign < 0 ? Math.PI : 0),
            nx = (-dz / len) * outwardSign,
            nz = (dx / len) * outwardSign;
          for (
            let row = 0;
            row < rows && windowInstances.length < windowLimit;
            row++
          )
            for (
              let col = 0;
              col < cols && windowInstances.length < windowLimit;
              col++
            ) {
              const t = (col + 1) / (cols + 1);
              detailDummy.position.set(
                a[0] + dx * t + nx * (realCampus ? 0.006 : 0.025),
                base + (h * (row + 1)) / (rows + 1),
                a[1] + dz * t + nz * (realCampus ? 0.006 : 0.025),
              );
              detailDummy.rotation.set(0, angle, 0);
              detailDummy.scale.set(
                Math.min(realCampus ? 0.045 : 0.18, (len / (cols + 1)) * 0.5),
                realCampus ? 0.035 : 0.12,
                1,
              );
              detailDummy.updateMatrix();
              windowInstances.push({matrix:detailDummy.matrix.clone(),x:detailDummy.position.x,y:detailDummy.position.y,z:detailDummy.position.z});
            }
        }
        if (longest && longest.len > (realCampus ? 0.12 : 0.45)) {
          const dx = longest.c[0] - longest.a[0],
            dz = longest.c[1] - longest.a[1],
            len = longest.len,
            nx = (-dz / len) * outwardSign,
            nz = (dx / len) * outwardSign;
          detailDummy.position.set(
            (longest.a[0] + longest.c[0]) / 2 + nx * (realCampus ? 0.007 : 0.03),
            base + (realCampus ? 0.055 : 0.17),
            (longest.a[1] + longest.c[1]) / 2 + nz * (realCampus ? 0.007 : 0.03),
          );
          detailDummy.rotation.set(0, Math.atan2(-dz, dx) + (outwardSign < 0 ? Math.PI : 0), 0);
          detailDummy.scale.set(realCampus ? 0.07 : 0.23, realCampus ? 0.11 : 0.34, 1);
          detailDummy.updateMatrix();
          doorMatrices.push(detailDummy.matrix.clone());
        }
      }
      const darkWindowMaterial = new THREE.MeshStandardMaterial({
        color: 0x31566a,
        roughness: 0.28,
        metalness: 0.08,
        side: THREE.FrontSide,
        depthTest: true,
        depthWrite: true,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -2,
      }),
        windowMaterial = new THREE.MeshStandardMaterial({
        color: 0x31566a,
        emissive: 0xffc45e,
        emissiveIntensity: 0,
        roughness: 0.28,
        metalness: 0.08,
        side: THREE.FrontSide,
        depthTest: true,
        depthWrite: true,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -2,
      });
      windowMaterials.push(windowMaterial);
      const windowGeometry=new THREE.PlaneGeometry(1,1),windowCells=new Map<string,typeof windowInstances>();
      for(const instance of windowInstances){const key=realCampus?`${Math.floor(instance.x/16)}/${Math.floor(instance.z/16)}`:"classic",bucket=windowCells.get(key);if(bucket)bucket.push(instance);else windowCells.set(key,[instance]);}
      for(const [key,instances] of windowCells){
        const groups=realCampus?[
          {material:darkWindowMaterial,instances:instances.filter(instance=>{const hash=(Math.imul(Math.round(instance.x*1000),73856093)^Math.imul(Math.round(instance.y*1000),83492791)^Math.imul(Math.round(instance.z*1000),19349663))>>>0;return hash%100>=18;})},
          {material:windowMaterial,instances:instances.filter(instance=>{const hash=(Math.imul(Math.round(instance.x*1000),73856093)^Math.imul(Math.round(instance.y*1000),83492791)^Math.imul(Math.round(instance.z*1000),19349663))>>>0;return hash%100<18;})},
        ]:[{material:windowMaterial,instances}];
        for(const group of groups){if(!group.instances.length)continue;const windows=new THREE.InstancedMesh(windowGeometry,group.material,group.instances.length);group.instances.forEach((instance,index)=>windows.setMatrixAt(index,instance.matrix));windows.instanceMatrix.needsUpdate=true;windows.renderOrder=6;
          if(realCampus){windows.userData.campusWindowCenter={x:group.instances.reduce((sum,instance)=>sum+instance.x,0)/group.instances.length,z:group.instances.reduce((sum,instance)=>sum+instance.z,0)/group.instances.length};windows.userData.campusWindowLit=group.material===windowMaterial;}
          windowDetailMeshes.push(windows);mapGroup.add(windows);
        }
      }
      const doors = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshStandardMaterial({
          color: 0x493a31,
          roughness: 0.8,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        }),
        doorMatrices.length,
      );
      doorMatrices.forEach((m, i) => doors.setMatrixAt(i, m));
      doors.instanceMatrix.needsUpdate = true;
      doors.renderOrder = 6;
      mapGroup.add(doors);
      const waterMat = applyCampusMacro(new THREE.MeshStandardMaterial({
        color: realCampus ? 0xc1cfcb : 0x478ca5,
        map: realCampus ? campusTextures?.water ?? null : null,
        emissive: 0x10282b,
        emissiveIntensity: realCampus ? 0.12 : 0.28,
        normalMap: campusTextures?.waterNormal ?? null,
        normalScale: new THREE.Vector2(realCampus ? 0.14 : 0.22, realCampus ? 0.14 : 0.22),
        transparent: true,
        opacity: realCampus ? 0.88 : 0.83,
        roughness: realCampus ? 0.34 : 0.42,
        metalness: realCampus ? 0.04 : 0,
        side: THREE.DoubleSide,
      }), realCampus ? 0.08 : 0);
      const bankPositions: number[] = [], bankIndices: number[] = [];
      let bankVertex = 0;
      for (const water of waterVisualAreas) {
        if (water.points.length < 3) continue;
        const wm = new THREE.Mesh(
          realCampus ? surfaceGeometry(r, water.points, 0, () => water.level, water.holes) : surfaceGeometry(r, water.points, 0.15),
          waterMat,
        );
        wm.renderOrder = 4;
        mapGroup.add(wm);
        if (realCampus) for (const shore of [water.points, ...water.holes]) for (let index = 0; index < shore.length; index++) {
          const point = shore[index], next = shore[(index + 1) % shore.length], topA = Math.min(terrainHeight(r, point[0], point[1]), water.level + 0.035), topB = Math.min(terrainHeight(r, next[0], next[1]), water.level + 0.035);
          bankPositions.push(point[0], water.level - 0.015, point[1], point[0], topA, point[1], next[0], water.level - 0.015, next[1], next[0], topB, next[1]);
          bankIndices.push(bankVertex, bankVertex + 2, bankVertex + 1, bankVertex + 1, bankVertex + 2, bankVertex + 3);
          bankVertex += 4;
        }
      }
      if (bankPositions.length) {
        const bankGeometry = new THREE.BufferGeometry();
        bankGeometry.setAttribute("position", new THREE.Float32BufferAttribute(bankPositions, 3));
        bankGeometry.setIndex(bankIndices);
        bankGeometry.computeVertexNormals();
        const banks = new THREE.Mesh(bankGeometry, new THREE.MeshStandardMaterial({ color: 0x667658, roughness: 1, side: THREE.DoubleSide }));
        banks.receiveShadow = true;
        mapGroup.add(banks);
      }
    };
    addRegion(regions.main);
    for (const r of [regions.main]) {
      const apron = new THREE.Mesh(
        new THREE.BoxGeometry(r.width + 34, 0.12, r.depth + 34),
        new THREE.MeshStandardMaterial({
          color: r.offsetX ? 0x617c4f : 0x668351,
          roughness: 1,
        }),
      );
      apron.position.set(r.offsetX, -0.12, 0);
      apron.receiveShadow = true;
      mapGroup.add(apron);
    }
    const buildingGroup = new THREE.Group(),
      siteHitProxies: THREE.Mesh[] = [],
      siteHitGeometry = new THREE.CylinderGeometry(1.15, 1.15, 2.8, 12),
      siteHitMaterial = new THREE.MeshBasicMaterial({ visible: false });
    buildingGroup.visible = !reviewSite;
    scene.add(buildingGroup);
    const siteNodeBatchGroup = new THREE.Group();
    siteNodeBatchGroup.visible = !reviewSite;
    scene.add(siteNodeBatchGroup);
    const unitGroup = new THREE.Group();
    unitGroup.visible = !reviewSite;
    scene.add(unitGroup);
    const commandGroup = new THREE.Group();
    commandGroup.visible = !reviewSite;
    scene.add(commandGroup);
    const combatGroup = new THREE.Group();
    combatGroup.visible = !reviewSite;
    scene.add(combatGroup);
    const battleAlertGroup = new THREE.Group();
    battleAlertGroup.visible = !reviewSite;
    scene.add(battleAlertGroup);
    const territoryGroup = new THREE.Group();
    territoryGroup.visible = !reviewSite;
    territoryGroup.visible = false;
    scene.add(territoryGroup);
    const siteObjects = new Map<number, THREE.Group>();
    const unitObjects = new Map<number, THREE.Group>();
    const selectedUnitIds = new Set<number>();
    const directKeys = new Set<string>();
    let directControlActive = false,
      activeToolMode: BattlefieldToolMode = null,
      directLeaderId: number | null = null,
      nextDirectFollowerPathAt = 0,
      nextDirectCommandAt = 0,
      cameraBeforeDirect: {
        position: THREE.Vector3;
        target: THREE.Vector3;
      } | null = null;
    const exitDirectControl = () => {
        if (!directControlActive) return;
        directControlActive = false;
        directLeaderId = null;
        nextDirectFollowerPathAt = 0;
        directKeys.clear();
        mobileMoveRef.current = { x: 0, z: 0 };
        setJoystickKnob({ x: 0, y: 0 });
        unitObjects.forEach((object) => {
          const ring = object.userData.selectionRing as
            | THREE.Sprite
            | undefined;
          ring?.scale.set(1.42, 1.42, 1);
        });
        controls.enabled = true;
        if (cameraBeforeDirect) {
          camera.position.copy(cameraBeforeDirect.position);
          controls.target.copy(cameraBeforeDirect.target);
          controls.update();
        }
        cameraBeforeDirect = null;
        setDirectControl(false);
        setNotice("已退出近距离控制");
      },
      enterDirectControl = () => {
        if (!canIssuePlayerCommandRef.current()) return false;
        const selectedUnits = gameRef.current.units.filter(
          (unit) =>
            unit.team === playerTeamRef.current && selectedUnitIds.has(unit.id),
        );
        if (!selectedUnits.length) return false;
        cameraBeforeDirect = {
          position: camera.position.clone(),
          target: controls.target.clone(),
        };
        selectedUnits.forEach((unit) => {
          unit.path = undefined;
          unit.pathIndex = undefined;
          unit.targetSiteId = undefined;
          unit.tx = unit.x;
          unit.tz = unit.z;
        });
        directLeaderId = selectedUnits[0].id;
        playerCommandSenderRef.current({ unitIds: selectedUnits.map(u => u.id) });
        nextDirectFollowerPathAt = 0;
        directControlActive = true;
        controls.enabled = false;
        setDirectControl(true);
        setSelected(null);
        setNotice("近距离控制：WASD控制领队，其余学生自动寻路跟随，Esc退出");
        return true;
      };
    const onDirectKeyDown = (event: KeyboardEvent) => {
        const target = event.target as HTMLElement | null,
          typing =
            target?.tagName === "INPUT" ||
            target?.tagName === "TEXTAREA" ||
            target?.tagName === "SELECT";
        if (typing) return;
        const key = event.key.toLowerCase();
        if (key === "escape") {
          exitDirectControl();
          return;
        }
        if (key === "f" && !directControlActive) {
          if (!enterDirectControl())
            setNotice(
              `请先双击选中一批${playerTeamRef.current === "pku" ? "北大" : gameRef.current.campaign.thuFactionName}学生`,
            );
          return;
        }
        if (directControlActive && ["w", "a", "s", "d"].includes(key)) {
          directKeys.add(key);
          event.preventDefault();
        }
      },
      onDirectKeyUp = (event: KeyboardEvent) => {
        directKeys.delete(event.key.toLowerCase());
      };
    addEventListener("keydown", onDirectKeyDown);
    addEventListener("keyup", onDirectKeyUp);
    let customSiteTexture: THREE.Texture | null = null,
      customUnitTextures: Partial<Record<Team, THREE.Texture>> = {},
      unitMaterialRequest = 0,
      siteMaterialRequest = 0;
    const combatEffects: { sprite: THREE.Sprite; born: number }[] = [];
    const fightCanvas = document.createElement("canvas");
    fightCanvas.width = 192;
    fightCanvas.height = 192;
    const fightCtx = fightCanvas.getContext("2d")!;
    fightCtx.font = "150px Segoe UI Symbol";
    fightCtx.textAlign = "center";
    fightCtx.textBaseline = "middle";
    fightCtx.fillStyle = "#fff2b8";
    fightCtx.strokeStyle = "#b51f39";
    fightCtx.lineWidth = 9;
    fightCtx.strokeText("⚔", 96, 104);
    fightCtx.fillText("⚔", 96, 104);
    const fightTexture = new THREE.CanvasTexture(fightCanvas);
    fightTexture.colorSpace = THREE.SRGBColorSpace;
    const battleAlertObjects = new Map<number, THREE.Sprite>(),
      addBattleAlert = (x: number, z: number) => {
        const campaign = gameRef.current.campaign;
        campaign.battleAlerts ??= [];
        if (
          campaign.battleAlerts.some(
            (alert) =>
              !alert.seen && Math.hypot(alert.x - x, alert.z - z) < 3.5,
          )
        )
          return;
        const id =
            campaign.battleAlerts.reduce(
              (maximum, alert) => Math.max(maximum, alert.id),
              -1,
            ) + 1,
          alert = { id, x, z, atHour: campaign.elapsedHours, seen: false },
          sprite = new THREE.Sprite(
            new THREE.SpriteMaterial({
              map: fightTexture,
              color: 0xff304e,
              transparent: true,
              depthTest: false,
              depthWrite: false,
            }),
          );
        campaign.battleAlerts.push(alert);
        sprite.position.set(x, terrainHeight(regionForX(x), x, z) + 2.5, z);
        sprite.scale.set(0.9, 0.9, 1);
        sprite.renderOrder = 80;
        sprite.userData.battleAlertId = id;
        battleAlertGroup.add(sprite);
        battleAlertObjects.set(id, sprite);
      };
    const arrowCanvas = document.createElement("canvas");
    arrowCanvas.width = 128;
    arrowCanvas.height = 128;
    const arrowContext = arrowCanvas.getContext("2d")!;
    arrowContext.fillStyle = "#ffffff";
    arrowContext.beginPath();
    arrowContext.moveTo(64, 8);
    arrowContext.lineTo(112, 112);
    arrowContext.lineTo(64, 84);
    arrowContext.lineTo(16, 112);
    arrowContext.closePath();
    arrowContext.fill();
    const commandArrowTexture = new THREE.CanvasTexture(arrowCanvas);
    commandArrowTexture.colorSpace = THREE.SRGBColorSpace;
    const spawnCombatEffect = (x: number, z: number) => {
      const r = regionForX(x),
        sprite = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: fightTexture,
            transparent: true,
            depthTest: false,
            depthWrite: false,
            opacity: 1,
          }),
        );
      sprite.position.set(x, terrainHeight(r, x, z) + 2, z);
      sprite.scale.set(1.05, 1.05, 1);
      sprite.renderOrder = 60;
      combatGroup.add(sprite);
      combatEffects.push({ sprite, born: performance.now() });
    };
    const disposeCommandObject = (
      object: THREE.Object3D,
      disposeMaps = true,
    ) => {
      object.traverse((child) => {
        const renderable = child as THREE.Mesh & {
          material?: THREE.Material | THREE.Material[];
          geometry?: THREE.BufferGeometry;
        };
        renderable.geometry?.dispose();
        const materials = Array.isArray(renderable.material)
          ? renderable.material
          : renderable.material
            ? [renderable.material]
            : [];
        materials.forEach((material) => {
          const map = (material as THREE.SpriteMaterial).map;
          if (
            disposeMaps &&
            map &&
            map !== fightTexture &&
            map !== commandArrowTexture
          )
            map.dispose();
          material.dispose();
        });
      });
    };
    const clearCommandVisuals = () => {
      commandGroup.children.slice().forEach((child) => {
        commandGroup.remove(child);
        disposeCommandObject(child);
      });
    };
    const commandAnimations: {
        curve: THREE.Curve<THREE.Vector3>;
        movers: THREE.Sprite[];
        label: THREE.Sprite;
        sourceId?: number;
        phase: number;
      }[] = [],
      commandTangent = new THREE.Vector3(),
      commandScreenA = new THREE.Vector3(),
      commandScreenB = new THREE.Vector3(),
      commandLineMaterials: LineMaterial[] = [];
    const orientCommandArrow = (
      sprite: THREE.Sprite,
      point: THREE.Vector3,
      tangent: THREE.Vector3,
    ) => {
      camera.updateMatrixWorld();
      commandScreenA.copy(point).project(camera);
      commandScreenB.copy(point).addScaledVector(tangent, 0.45).project(camera);
      (sprite.material as THREE.SpriteMaterial).rotation =
        Math.atan2(
          commandScreenB.y - commandScreenA.y,
          commandScreenB.x - commandScreenA.x,
        ) -
        Math.PI / 2;
    };
    const commandLabelTexture = (text: string, color: string) => {
      const c = document.createElement("canvas");
      c.width = 384;
      c.height = 80;
      const x = c.getContext("2d")!;
      x.fillStyle = "rgba(12,20,18,.92)";
      x.roundRect(4, 4, 376, 72, 18);
      x.fill();
      x.strokeStyle = color;
      x.lineWidth = 5;
      x.stroke();
      x.fillStyle = "#fff8de";
      x.font = "700 31px Microsoft YaHei";
      x.textAlign = "center";
      x.fillText(text, 192, 53);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    const addCommandLine = (
      a: THREE.Vector3,
      b: THREE.Vector3,
      preview = false,
      attack = true,
      troops = 0,
      path?: [number, number][],
      dispatchRatio = 0.6,
      sourceId?: number,
      intent = false,
      team?: Team,
    ) => {
      const makeLine = (
          curve: THREE.Curve<THREE.Vector3>,
          color: number,
          width: number,
          opacity: number,
          renderOrder: number,
          track = true,
        ) => {
          const distance = curve.getLength(),
            segments = Math.max(12, Math.ceil(distance * 1.6)),
            positions: number[] = [];
          for (let i = 0; i <= segments; i++) {
            const point = curve.getPoint(i / segments);
            positions.push(point.x, point.y, point.z);
          }
          const geometry = new LineGeometry();
          geometry.setPositions(positions);
          const material = new LineMaterial({
            color,
            linewidth: width,
            transparent: true,
            opacity,
            depthTest: false,
            depthWrite: false,
            worldUnits: false,
          });
          material.resolution.set(host.clientWidth, host.clientHeight);
          if (track) commandLineMaterials.push(material);
          const line = new Line2(geometry, material);
          line.computeLineDistances();
          line.renderOrder = renderOrder;
          return line;
        },
        makeArrowSprite = (color: number, scale: number) => {
          const sprite = new THREE.Sprite(
            new THREE.SpriteMaterial({
              map: commandArrowTexture,
              color,
              transparent: true,
              depthTest: false,
              depthWrite: false,
            }),
          );
          sprite.scale.set(scale, scale, 1);
          return sprite;
        };
      if (preview) {
        const start = a.clone(),
          end = b.clone(),
          previewPoints = path?.length
            ? [
                start,
                ...path.map(
                  ([x, z]) =>
                    new THREE.Vector3(
                      x,
                      terrainHeight(regionForX(x), x, z) + 1.75,
                      z,
                    ),
                ),
                end,
              ]
            : [start, end],
          curve =
            previewPoints.length > 2
              ? new THREE.CatmullRomCurve3(
                  previewPoints,
                  false,
                  "centripetal",
                  0.15,
                )
              : new THREE.LineCurve3(start, end),
          group = new THREE.Group(),
          line = makeLine(curve, 0xdffaff, 2.1, 0.72, 40, false),
          head = makeArrowSprite(0xffffff, 0.34);
        group.add(line);
        head.position.copy(end);
        const previewTangent = curve.getTangent(1);
        orientCommandArrow(head, end, previewTangent);
        head.renderOrder = 41;
        group.add(head);
        commandGroup.add(group);
        return group;
      }
      const color = intent
          ? 0xffc857
          : team === "pku"
            ? 0xff6f82
            : team === "thu"
              ? 0xc984ff
              : 0xb9eaf4,
        pathPoints = path?.length
          ? [
              a.clone(),
              ...path.map(
                ([x, z]) =>
                  new THREE.Vector3(
                    x,
                    terrainHeight(regionForX(x), x, z) + 1.45,
                    z,
                  ),
              ),
              b.clone(),
            ]
          : [a.clone(), b.clone()],
        curve = new THREE.CatmullRomCurve3(
          pathPoints,
          false,
          "centripetal",
          0.3,
        ),
        group = new THREE.Group(),
        line = makeLine(curve, color, 2.2, 0.48, 32);
      group.add(line);
      const movers: THREE.Sprite[] = [];
      for (let i = 0; i < 2; i++) {
        const mover = makeArrowSprite(0xffffff, 0.23);
        mover.renderOrder = 36;
        group.add(mover);
        movers.push(mover);
      }
      const label = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: commandLabelTexture(
            intent
              ? "占领后继续行动"
              : `${attack ? "⚔ 进攻" : "✚ 增援"} · ${troops ? `${troops}人` : `持续${Math.round(dispatchRatio * 100)}%`}`,
            intent ? "#ffc857" : attack ? "#ff684d" : "#79dcff",
          ),
          transparent: true,
          depthTest: false,
          depthWrite: false,
        }),
      );
      label.scale.set(2.9, 0.6, 1);
      label.position.copy(curve.getPoint(0.5));
      label.position.y += 0.55;
      label.renderOrder = 38;
      label.visible = false;
      group.add(label);
      commandGroup.add(group);
      commandAnimations.push({
        curve,
        movers,
        label,
        sourceId,
        phase: (a.x + a.z) * 0.071,
      });
      return group;
    };
    const rebuildCommandLines = () => {
      clearCommandVisuals();
      commandAnimations.splice(0);
      commandLineMaterials.splice(0);
      gameRef.current.sites.forEach((s) => {
        if (s.destroyed) return;
        const renderedTargets = new Set<number>();
        const renderSegment = (
          targetId: number,
          path: [number, number][] | undefined,
          intent: boolean,
        ) => {
          const t = gameRef.current.sites[targetId];
          if (!t || t.destroyed) return;
          renderedTargets.add(targetId);
          const troops = intent
            ? 0
            : gameRef.current.units
                .filter((u) => u.siteId === s.id && u.targetSiteId === t.id)
                .reduce((sum, unit) => sum + unit.strength, 0);
        const route = addCommandLine(
          new THREE.Vector3(
            s.x,
            terrainHeight(regionForX(s.x), s.x, s.z) + 1.75,
            s.z,
          ),
          new THREE.Vector3(
            t.x,
            terrainHeight(regionForX(t.x), t.x, t.z) + 1.75,
            t.z,
          ),
          false,
          s.team !== t.team,
          troops,
            path,
          s.dispatchRatio ?? 0.6,
          s.id,
            intent,
            s.team,
        );
        route.traverse((object) => {
          object.userData.commandSourceId = s.id;
        });
        };
        if (
          (observerAiModeRef.current || s.team === playerTeamRef.current) &&
          s.orderTarget != null
        )
          renderSegment(s.orderTarget, s.orderPath, false);
        if (!observerAiModeRef.current) {
          const plannedTarget =
            s.plannedOrderTargets?.[playerTeamRef.current];
          if (plannedTarget != null)
            renderSegment(
              plannedTarget,
              s.plannedOrderPaths?.[playerTeamRef.current],
              true,
            );
        } else {
          const movingTargets = new Map<
            number,
            [number, number][] | undefined
          >();
          for (const unit of gameRef.current.units) {
            if (
              unit.team !== s.team ||
              unit.siteId !== s.id ||
              unit.targetSiteId == null ||
              unit.retreating ||
              renderedTargets.has(unit.targetSiteId)
            )
              continue;
            if (!movingTargets.has(unit.targetSiteId))
              movingTargets.set(unit.targetSiteId, unit.path);
          }
          for (const [targetId, path] of movingTargets)
            renderSegment(targetId, path, false);
        }
      });
    };
    const issueOrder = (
      team: Team,
      source: SiteState,
      target: SiteState,
      requested = Number.POSITIVE_INFINITY,
      emergency = false,
    ) => {
      if (source.destroyed || target.destroyed || source.team !== team)
        return 0;
      if (target.team !== team && !gameRef.current.campaign.warUnlocked)
        return 0;
      if (kernelOwnsSimulation && !isRemoteGuest()) {
        source.orderTarget = target.id;
        source.orderOwner = "player";
        sharedKernel.dispatch({ type: "order_site", team, sourceId: source.id, targetId: target.id,
          count: Number.isFinite(requested) ? requested : undefined });
        return 0;
      }
      source.dispatchRatio ??=
        source.stance === "defend"
          ? 0.45
          : source.stance === "guard"
            ? 0.72
            : 1;
      const idle = gameRef.current.units.filter(
          (unit) =>
            unit.team === team &&
            unit.siteId === source.id &&
            unit.targetSiteId == null &&
            (!directControlActive || !selectedUnitIds.has(unit.id)) &&
            Math.hypot(
              unit.x - (source.navX ?? source.x),
              unit.z - (source.navZ ?? source.z),
            ) < 3.4,
        ),
        reserve = emergency
          ? Math.min(1, idle.length)
          : source.stance === "defend"
            ? Math.max(4, Math.ceil(idle.length * 0.55))
            : source.stance === "guard"
              ? Math.max(2, Math.ceil(idle.length * 0.28))
              : 0,
        desired = Number.isFinite(requested)
          ? requested
          : Math.ceil(
              idle.length *
                source.dispatchRatio *
                (decisionEffectsFor(gameRef.current.campaign, team).dispatch ?? 1),
            ),
        initialMoving = idle.slice(
          0,
          Math.max(0, Math.min(desired, idle.length - reserve)),
        );
      const moving = [...initialMoving],
        movingIds = new Set(moving.map((unit) => unit.id)),
        busGroups = new Set(
          moving
            .filter((unit) => unit.transport === "bus" && unit.transportGroupId)
            .map((unit) => unit.transportGroupId!),
        );
      for (const unit of idle)
        if (
          unit.transportGroupId &&
          busGroups.has(unit.transportGroupId) &&
          !movingIds.has(unit.id)
        ) {
          moving.push(unit);
          movingIds.add(unit.id);
        }
      const targetX = target.navX ?? target.x,
        targetZ = target.navZ ?? target.z,
        sharedPath = findPath(
          source.navX ?? source.x,
          source.navZ ?? source.z,
          targetX,
          targetZ,
        );
      if (!sharedPath.length) return 0;
      source.orderTarget = target.id;
      source.orderOwner = "player";
      source.orderPath = sharedPath;
      let deployed = 0;
      moving.forEach((unit) => {
        const offsetX = ((unit.id % 7) - 3) * 0.13,
          offsetZ = ((Math.floor(unit.id / 7) % 7) - 3) * 0.13;
        unit.targetSiteId = target.id;
        unit.path = clonePath(sharedPath);
        unit.pathIndex = 0;
        unit.tx = targetX + offsetX;
        unit.tz = targetZ + offsetZ;
        deployed += unit.strength;
        void findPathInWorker(
          unit.x,
          unit.z,
          targetX + offsetX,
          targetZ + offsetZ,
        )
          .then((personalPath) => {
            if (
              !personalPath.length ||
              unit.targetSiteId !== target.id ||
              Math.hypot(unit.tx - (targetX + offsetX), unit.tz - (targetZ + offsetZ)) >
                0.05 ||
              !gameRef.current.units.includes(unit)
            )
              return;
            const destination = personalPath.at(-1)!;
            unit.path = personalPath;
            unit.pathIndex = 0;
            unit.tx = destination[0];
            unit.tz = destination[1];
          })
          .catch(() => {
            // The shared corridor remains valid if a worker is unavailable.
          });
      });
      rebuildCommandLines();
      refreshRouteHighlights();
      return deployed;
    };
    const configureRouteChain = (
      team: Team,
      source: SiteState,
      targets: SiteState[],
    ) => {
      const chain = [source, ...targets].filter(
        (site, index, items) =>
          !site.destroyed &&
          (index === 0 || site.id !== items[index - 1]?.id),
      );
      let deployed = 0,
        configured = 0;
      for (let index = 0; index < chain.length - 1; index++) {
        if (isRemoteGuest()) {
          const from = chain[index], to = chain[index + 1];
          if (from.team === team) {
            from.orderTarget = to.id;
            if (from.plannedOrderTargets) delete from.plannedOrderTargets[team];
          } else { from.plannedOrderTargets ??= {}; from.plannedOrderTargets[team] = to.id; }
          configured++;
          continue;
        }
        const from = chain[index],
          to = chain[index + 1],
          path = findPath(
            from.navX ?? from.x,
            from.navZ ?? from.z,
            to.navX ?? to.x,
            to.navZ ?? to.z,
          );
        if (!path.length) continue;
        if (from.team === team) {
          deployed += issueOrder(team, from, to);
          if (from.plannedOrderTargets) delete from.plannedOrderTargets[team];
          if (from.plannedOrderPaths) delete from.plannedOrderPaths[team];
        } else {
          from.plannedOrderTargets ??= {};
          from.plannedOrderPaths ??= {};
          from.plannedOrderTargets[team] = to.id;
          from.plannedOrderOwners ??= {};
          from.plannedOrderOwners[team] = "player";
          from.plannedOrderPaths[team] = path;
        }
        configured++;
      }
      // Server-side site dispatch owns paths and transport grouping.
      playerCommandSenderRef.current({ siteIds: chain.slice(0, -1).map(s => s.id) });
      rebuildCommandLines();
      refreshRouteHighlights();
      return { deployed, configured };
    };
    const labelTexture = (text: string, color: string) => {
      const c = document.createElement("canvas");
      c.width = 512;
      c.height = 96;
      const x = c.getContext("2d")!;
      x.fillStyle = "rgba(21,30,25,.86)";
      x.roundRect(4, 4, 504, 88, 16);
      x.fill();
      x.strokeStyle = color;
      x.lineWidth = 5;
      x.stroke();
      x.fillStyle = "#fff6dc";
      x.font = "700 34px Microsoft YaHei";
      x.textAlign = "center";
      x.fillText(text, 256, 61);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    const nearbyPopulationCache = new Map<number, number>();
    const stanceTextureCache = new Map<string, THREE.CanvasTexture>(),
      stanceIconTexture = (stance: Stance, color: string) => {
        const key = `${stance}/${color}`;
        const cached = stanceTextureCache.get(key);
        if (cached) return cached;
        const canvas = document.createElement("canvas");
        canvas.width = 128;
        canvas.height = 128;
        const context = canvas.getContext("2d")!;
        context.fillStyle = "rgba(15,24,21,.92)";
        context.beginPath();
        context.arc(64, 64, 55, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = color;
        context.fillStyle = color;
        context.lineWidth = 10;
        context.lineCap = "round";
        context.lineJoin = "round";
        if (stance === "defend") {
          context.beginPath();
          context.moveTo(64, 23);
          context.lineTo(94, 36);
          context.lineTo(88, 82);
          context.quadraticCurveTo(64, 108, 40, 82);
          context.lineTo(34, 36);
          context.closePath();
          context.stroke();
        } else if (stance === "guard") {
          context.beginPath();
          context.arc(64, 64, 12, 0, Math.PI * 2);
          context.fill();
          context.beginPath();
          context.arc(64, 64, 30, -0.8, 0.8);
          context.arc(64, 64, 45, -0.8, 0.8);
          context.stroke();
        } else {
          context.fillRect(39, 32, 13, 64);
          context.fillRect(76, 32, 13, 64);
        }
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        stanceTextureCache.set(key, texture);
        return texture;
      };
    const siteTypeTextureCache = new Map<SiteKind, THREE.CanvasTexture>(),
      siteTypeIconTexture = (kind: SiteKind) => {
        const cached = siteTypeTextureCache.get(kind);
        if (cached) return cached;
        const canvas = document.createElement("canvas");
        canvas.width = 128;
        canvas.height = 128;
        const context = canvas.getContext("2d")!;
        context.fillStyle = "rgba(15,24,21,.92)";
        context.beginPath();
        context.arc(64, 64, 55, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = "#ffe39a";
        context.fillStyle = "#ffe39a";
        context.lineWidth = 9;
        context.lineCap = "round";
        context.lineJoin = "round";
        if (kind === "dorm") {
          context.strokeRect(27, 56, 74, 34);
          context.fillRect(33, 43, 24, 18);
          context.fillRect(25, 87, 12, 19);
          context.fillRect(91, 87, 12, 19);
        } else if (kind === "dining") {
          context.beginPath();
          context.arc(64, 70, 34, 0, Math.PI);
          context.stroke();
          context.fillRect(31, 82, 66, 10);
          [47, 64, 81].forEach((x) => {
            context.beginPath();
            context.moveTo(x, 52);
            context.quadraticCurveTo(x - 8, 39, x, 27);
            context.stroke();
          });
        } else if (kind === "gate") {
          context.strokeRect(29, 35, 70, 62);
          context.beginPath();
          context.arc(64, 67, 22, Math.PI, 0);
          context.stroke();
          context.fillRect(42, 67, 44, 32);
        } else if (kind === "camp") {
          context.beginPath();
          context.moveTo(24, 94);
          context.lineTo(64, 29);
          context.lineTo(104, 94);
          context.closePath();
          context.stroke();
          context.beginPath();
          context.moveTo(64, 29);
          context.lineTo(64, 94);
          context.stroke();
        } else {
          context.strokeRect(28, 38, 72, 52);
          context.beginPath();
          context.moveTo(28, 38);
          context.lineTo(64, 24);
          context.lineTo(100, 38);
          context.stroke();
          context.fillRect(42, 50, 10, 28);
          context.fillRect(59, 50, 10, 28);
          context.fillRect(76, 50, 10, 28);
        }
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        siteTypeTextureCache.set(kind, texture);
        return texture;
      };
    const nodeTextureCache = new Map<string, THREE.CanvasTexture>(),
      haloTextureCache = new Map<string, THREE.CanvasTexture>(),
      siteNodeTexture = (team: Team, stance: Stance, kind: SiteKind) => {
        const thuBlue = gameRef.current.campaign.thuFactionName === "中科大",
          teamStroke =
            team === "pku" ? "#d62b46" : thuBlue ? "#2879bd" : "#9153b9",
          key = `${team}/${stance}/${kind}/${teamStroke}`,
          cached = nodeTextureCache.get(key);
        if (cached) return cached;
        const canvas = document.createElement("canvas");
        canvas.width = 192;
        canvas.height = 192;
        const context = canvas.getContext("2d")!;
        context.beginPath();
        context.arc(96, 96, 78, 0, Math.PI * 2);
        context.fillStyle = "rgba(12,20,18,.96)";
        context.fill();
        context.lineWidth = 18;
        context.strokeStyle = teamStroke;
        context.stroke();
        const drawShield = (inset: number, width: number, opacity: number) => {
          context.beginPath();
          context.moveTo(96, 38 + inset);
          context.lineTo(140 - inset, 55 + inset * 0.35);
          context.lineTo(133 - inset * 0.7, 111 - inset * 0.25);
          context.quadraticCurveTo(
            96,
            151 - inset,
            59 + inset * 0.7,
            111 - inset * 0.25,
          );
          context.lineTo(52 + inset, 55 + inset * 0.35);
          context.closePath();
          context.globalAlpha = opacity;
          context.strokeStyle = "#ffe39a";
          context.lineWidth = width;
          context.stroke();
          context.globalAlpha = 1;
        };
        context.drawImage(
          siteTypeIconTexture(kind).image as CanvasImageSource,
          58,
          58,
          76,
          76,
        );
        if (stance === "guard" || stance === "defend") drawShield(0, 8, 0.92);
        if (stance === "defend") drawShield(13, 5, 0.74);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        nodeTextureCache.set(key, texture);
        return texture;
      },
      haloTexture = (color: string) => {
        const cached = haloTextureCache.get(color);
        if (cached) return cached;
        const canvas = document.createElement("canvas");
        canvas.width = 192;
        canvas.height = 192;
        const context = canvas.getContext("2d")!;
        context.beginPath();
        context.arc(96, 96, 76, 0, Math.PI * 2);
        context.lineWidth = 16;
        context.strokeStyle = color;
        context.shadowColor = color;
        context.shadowBlur = 22;
        context.stroke();
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        haloTextureCache.set(color, texture);
        return texture;
      },
      nearbyFriendlyPeople = (site: SiteState) =>
        nearbyPopulationCache.get(site.id) ??
        gameRef.current.units.reduce(
          (sum, unit) =>
            unit.team === site.team &&
            unit.siteId === site.id &&
            Math.hypot(
              unit.x - (site.navX ?? site.x),
              unit.z - (site.navZ ?? site.z),
            ) < 3.4
              ? sum + unit.strength
              : sum,
          0,
        ),
      drawSiteLabel = (
        context: CanvasRenderingContext2D,
        site: SiteState,
        labelColor: string,
      ) => {
        context.clearRect(0, 0, 512, 96);
        context.beginPath();
        context.fillStyle = "rgba(21,30,25,.86)";
        context.roundRect(4, 4, 504, 88, 16);
        context.fill();
        context.strokeStyle = labelColor;
        context.lineWidth = 5;
        context.stroke();
        context.fillStyle = "#fff6dc";
        const title = site.displayName ?? site.name,
          titleSize = Math.max(21, Math.min(34, 42 - title.length * 0.6));
        context.font = `700 ${titleSize}px Microsoft YaHei`;
        context.textAlign = "center";
        context.lineWidth = 5;
        context.strokeStyle = "rgba(0,0,0,.92)";
        context.strokeText(title, 256, 61, 474);
        context.fillStyle = "#fffaf0";
        context.fillText(title, 256, 61, 474);
      },
      drawSiteCount = (
        context: CanvasRenderingContext2D,
        site: SiteState,
        count: number,
      ) => {
        context.clearRect(0, 0, 128, 64);
        context.font = "900 44px Microsoft YaHei";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.lineWidth = 7;
        context.strokeStyle = "rgba(5,10,9,.88)";
        context.strokeText(String(count), 64, 34, 112);
        context.fillStyle =
          site.team === "pku"
            ? "rgba(255,115,133,.82)"
            : gameRef.current.campaign.thuFactionName === "中科大"
              ? "rgba(103,199,255,.82)"
              : "rgba(211,160,255,.82)";
        context.fillText(String(count), 64, 34, 112);
      };
    const siteNodeGeometry = new THREE.PlaneGeometry(1, 1),
      siteNodeBatches: {
        mesh: THREE.InstancedMesh;
        sites: SiteState[];
      }[] = [],
      siteNodeDummy = new THREE.Object3D(),
      updateSiteNodeBatches = (markerScale = 1) => {
        for (const batch of siteNodeBatches) {
          batch.sites.forEach((site, index) => {
            siteNodeDummy.position.set(
              site.x,
              terrainHeight(regionForX(site.x), site.x, site.z) + (realCampus ? 0.35 : 1.75),
              site.z,
            );
            siteNodeDummy.quaternion.copy(camera.quaternion);
            siteNodeDummy.scale.setScalar(1.15 * markerScale);
            siteNodeDummy.updateMatrix();
            batch.mesh.setMatrixAt(index, siteNodeDummy.matrix);
          });
          batch.mesh.instanceMatrix.needsUpdate = true;
        }
      },
      rebuildSiteNodeBatches = () => {
        siteNodeBatchGroup.children.slice().forEach((child) => {
          siteNodeBatchGroup.remove(child);
          const mesh = child as THREE.InstancedMesh;
          const material = mesh.material as THREE.Material;
          material.dispose();
        });
        siteNodeBatches.length = 0;
        const buckets = new Map<string, SiteState[]>();
        for (const site of gameRef.current.sites) {
          if (site.destroyed) continue;
          const key = `${site.team}/${site.stance}/${site.type}`,
            bucket = buckets.get(key);
          if (bucket) bucket.push(site);
          else buckets.set(key, [site]);
        }
        for (const sites of buckets.values()) {
          const first = sites[0],
            material = new THREE.MeshBasicMaterial({
              map: siteNodeTexture(first.team, first.stance, first.type),
              transparent: true,
              depthTest: false,
              depthWrite: false,
              side: THREE.DoubleSide,
            }),
            mesh = new THREE.InstancedMesh(
              siteNodeGeometry,
              material,
              sites.length,
            );
          mesh.count = sites.length;
          mesh.frustumCulled = false;
          mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          mesh.renderOrder = 22;
          siteNodeBatchGroup.add(mesh);
          siteNodeBatches.push({ mesh, sites });
        }
        updateSiteNodeBatches();
      };
    const rebuildTerritory = () => {
      territoryGroup.children.slice().forEach((child) => {
        territoryGroup.remove(child);
        const mesh = child as THREE.Mesh;
        mesh.geometry?.dispose();
        if (Array.isArray(mesh.material))
          mesh.material.forEach((material) => material.dispose());
        else mesh.material?.dispose();
      });
      const region = regions.main,
        cols = 72,
        rows = 56,
        activeSites = gameRef.current.sites.filter((site) => !site.destroyed),
        positions: number[] = [],
        colors: number[] = [],
        indices: number[] = [],
        pkuColor = new THREE.Color(0xd92845),
        thuColor = new THREE.Color(
          gameRef.current.campaign.thuFactionName === "中科大"
            ? 0x2879bd
            : 0x7a3fa2,
        ),
        blended = new THREE.Color();
      for (let row = 0; row <= rows; row++) {
        const z = region.depth / 2 - (row / rows) * region.depth;
        for (let col = 0; col <= cols; col++) {
          const x =
            region.offsetX - region.width / 2 + (col / cols) * region.width;
          let pkuInfluence = 0,
            thuInfluence = 0;
          activeSites.forEach((site) => {
            const distanceSquared =
                (x - site.x) * (x - site.x) + (z - site.z) * (z - site.z),
              strategicWeight =
                site.type === "capital" || site.type === "target"
                  ? 1.65
                  : site.type === "gate"
                    ? 1.25
                    : site.type === "camp"
                      ? 0.65
                      : 1,
              influence =
                strategicWeight / Math.pow(distanceSquared + 18, 0.82);
            if (site.team === "pku") pkuInfluence += influence;
            else thuInfluence += influence;
          });
          const balance =
              (pkuInfluence - thuInfluence) /
              Math.max(0.0001, pkuInfluence + thuInfluence),
            teamMix = THREE.MathUtils.smoothstep(balance, -0.075, 0.075);
          blended.copy(thuColor).lerp(pkuColor, teamMix);
          positions.push(x, terrainHeight(region, x, z) + 0.22, z);
          colors.push(blended.r, blended.g, blended.b);
        }
      }
      for (let row = 0; row < rows; row++)
        for (let col = 0; col < cols; col++) {
          const topLeft = row * (cols + 1) + col,
            topRight = topLeft + 1,
            bottomLeft = topLeft + cols + 1,
            bottomRight = bottomLeft + 1;
          indices.push(
            topLeft,
            bottomLeft,
            topRight,
            topRight,
            bottomLeft,
            bottomRight,
          );
        }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(positions, 3),
      );
      geometry.setAttribute(
        "color",
        new THREE.Float32BufferAttribute(colors, 3),
      );
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.28,
          depthWrite: false,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -2,
        }),
      );
      mesh.renderOrder = 7;
      territoryGroup.add(mesh);
    };
    const rebuildBuildings = () => {
      buildingGroup.children.slice().forEach((child) => {
        buildingGroup.remove(child);
        disposeCommandObject(child, false);
      });
      siteObjects.clear();
      siteHitProxies.length = 0;
      gameRef.current.sites
        .filter((site) => !site.destroyed)
        .forEach((site) => {
          const g = new THREE.Group(),
            region = regionForX(site.x),
            isTarget = false;
          g.position.set(site.x, terrainHeight(region, site.x, site.z), site.z);
          if (site.hasPortal && site.navX != null && site.navZ != null) {
            const portalX = site.navX - site.x,
              portalZ = site.navZ - site.z,
              portalGeometry = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(0, 0.48, 0),
                new THREE.Vector3(portalX, 0.48, portalZ),
              ]),
              portalLine = new THREE.Line(
                portalGeometry,
                new THREE.LineDashedMaterial({
                  color: 0x6cecff,
                  dashSize: 0.38,
                  gapSize: 0.22,
                  transparent: true,
                  opacity: 0.9,
                  depthTest: false,
                }),
              ),
              portalRing = new THREE.Mesh(
                new THREE.RingGeometry(0.32, 0.48, 28),
                new THREE.MeshBasicMaterial({
                  color: 0x6cecff,
                  transparent: true,
                  opacity: 0.95,
                  side: THREE.DoubleSide,
                  depthTest: false,
                }),
              );
            portalLine.computeLineDistances();
            portalLine.renderOrder = 26;
            portalRing.rotation.x = -Math.PI / 2;
            portalRing.position.set(portalX, 0.5, portalZ);
            portalRing.renderOrder = 27;
            g.add(portalLine, portalRing);
          }
          const routeHighlight = new THREE.Sprite(
              new THREE.SpriteMaterial({
                map: haloTexture("#ffe16d"),
                transparent: true,
                depthTest: false,
                depthWrite: false,
              }),
            ),
            hoverHighlight = new THREE.Sprite(
              new THREE.SpriteMaterial({
                map: haloTexture("#ffffff"),
                transparent: true,
                depthTest: false,
                depthWrite: false,
              }),
            );
          routeHighlight.scale.set(1.5, 1.5, 1);
          routeHighlight.position.y = 1.75;
          routeHighlight.visible = selectedRef.current === site.id;
          routeHighlight.renderOrder = 23;
          hoverHighlight.scale.set(1.78, 1.78, 1);
          hoverHighlight.position.y = 1.75;
          hoverHighlight.visible = false;
          hoverHighlight.renderOrder = 24;
          const labelColor =
              site.team === "pku"
                ? "#df3b50"
                : gameRef.current.campaign.thuFactionName === "中科大"
                  ? "#3a8fd2"
                  : "#a569d0",
            labelCanvas = document.createElement("canvas");
          labelCanvas.width = 512;
          labelCanvas.height = 96;
          const labelContext = labelCanvas.getContext("2d")!;
          drawSiteLabel(labelContext, site, labelColor);
          const labelTexture = new THREE.CanvasTexture(labelCanvas),
            labelSprite = new THREE.Sprite(
              new THREE.SpriteMaterial({
                map: labelTexture,
                transparent: true,
                depthTest: false,
                depthWrite: false,
              }),
            );
          labelTexture.colorSpace = THREE.SRGBColorSpace;
          const labelScaleX = isTarget ? 4.6 : 3.7,
            labelScaleY = isTarget ? 0.82 : 0.68,
            labelY = 2.75 + (site.id % 3) * 0.42,
            countCanvas = document.createElement("canvas");
          labelSprite.scale.set(labelScaleX, labelScaleY, 1);
          labelSprite.position.y = labelY;
          labelSprite.renderOrder = 30;
          countCanvas.width = 128;
          countCanvas.height = 64;
          const countContext = countCanvas.getContext("2d")!,
            initialCount = nearbyFriendlyPeople(site);
          drawSiteCount(countContext, site, initialCount);
          const countTexture = new THREE.CanvasTexture(countCanvas),
            countSprite = new THREE.Sprite(
              new THREE.SpriteMaterial({
                map: countTexture,
                transparent: true,
                depthTest: false,
                depthWrite: false,
              }),
            );
          countTexture.colorSpace = THREE.SRGBColorSpace;
          countSprite.scale.set(0.68, 0.34, 1);
          countSprite.position.y = 1.5;
          countSprite.renderOrder = 31;
          g.add(
            routeHighlight,
            hoverHighlight,
            labelSprite,
            countSprite,
          );
          g.userData.routeHighlight = routeHighlight;
          g.userData.hoverHighlight = hoverHighlight;
          g.userData.labelSprite = labelSprite;
          g.userData.countBadge = {
            context: countContext,
            texture: countTexture,
            last: initialCount,
          };
          let materialBadge: THREE.Sprite | null = null;
          if (customSiteTexture) {
            materialBadge = new THREE.Sprite(
              new THREE.SpriteMaterial({
                map: customSiteTexture,
                transparent: true,
                depthTest: false,
                depthWrite: false,
              }),
            );
            materialBadge.scale.set(0.72, 0.72, 1);
            materialBadge.position.y = 1.75;
            materialBadge.renderOrder = 25;
            g.add(materialBadge);
          }
          if (isTarget) {
            const beacon = new THREE.Mesh(
              new THREE.RingGeometry(1.48, 1.62, 48),
              new THREE.MeshBasicMaterial({
                color: 0xffd96b,
                transparent: true,
                opacity: 0.9,
                side: THREE.DoubleSide,
                depthTest: false,
              }),
            );
            beacon.rotation.x = -Math.PI / 2;
            beacon.position.y = 0.22;
            beacon.userData.targetBeacon = true;
            g.add(beacon);
          }
          g.userData.fixedMarkerIcons = [
            {
              object: routeHighlight,
              x: 0,
              y: 1.75,
              scaleX: 1.5,
              scaleY: 1.5,
            },
            {
              object: hoverHighlight,
              x: 0,
              y: 1.75,
              scaleX: 1.78,
              scaleY: 1.78,
            },
            {
              object: countSprite,
              x: 0,
              y: 1.5,
              scaleX: 0.68,
              scaleY: 0.34,
            },
            {
              object: labelSprite,
              x: 0,
              y: labelY,
              scaleX: labelScaleX,
              scaleY: labelScaleY,
            },
            ...(materialBadge
              ? [
                  {
                    object: materialBadge,
                    x: 0,
                    y: 1.75,
                    scaleX: 0.72,
                    scaleY: 0.72,
                  },
                ]
              : []),
          ];
          const hit = new THREE.Mesh(
            siteHitGeometry,
            siteHitMaterial,
          );
          hit.position.set(
            site.x,
            terrainHeight(region, site.x, site.z) + 1.75,
            site.z,
          );
          hit.userData.siteHitProxy = true;
          hit.userData.siteId = site.id;
          hit.updateMatrixWorld(true);
          siteHitProxies.push(hit);
          g.traverse((o) => {
            o.userData.siteId = site.id;
          });
          buildingGroup.add(g);
          siteObjects.set(site.id, g);
        });
      rebuildSiteNodeBatches();
      rebuildTerritory();
    };
    const refreshSiteStance = (siteId: number) => {
      const site = gameRef.current.sites[siteId];
      if (!site) return;
      rebuildSiteNodeBatches();
      if (site.orderTarget != null) rebuildCommandLines();
    };
    const refreshRouteHighlights = () => {
      siteObjects.forEach((object, id) => {
        const highlight = object.userData.routeHighlight as
          THREE.Object3D | undefined;
        if (highlight) highlight.visible = selectedRef.current === id;
      });
    };
    const textureLoader = new THREE.TextureLoader(),
      makeBallTexture = (
        file: string | null,
        fallbackText: string,
        teamColor: string,
        sealColor: string,
      ) => {
        const canvas = document.createElement("canvas");
        canvas.width = 1024;
        canvas.height = 512;
        const context = canvas.getContext("2d")!;
        context.fillStyle = teamColor;
        context.fillRect(0, 0, 1024, 512);
        const drawBacking = (centerX: number) => {
          context.beginPath();
          context.arc(centerX, 256, 188, 0, Math.PI * 2);
          context.fillStyle = "#fffaf0";
          context.fill();
          context.lineWidth = 16;
          context.strokeStyle = "#e1c56d";
          context.stroke();
          context.fillStyle = sealColor;
          context.font = "900 270px Microsoft YaHei";
          context.textAlign = "center";
          context.textBaseline = "middle";
          context.fillText(fallbackText, centerX, 270);
        };
        drawBacking(256);
        drawBacking(768);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
        if (file)
          textureLoader.load(`${import.meta.env.BASE_URL}${file}`, (loaded) => {
            const image = loaded.image as HTMLImageElement;
            [256, 768].forEach((centerX) => {
              context.beginPath();
              context.arc(centerX, 256, 176, 0, Math.PI * 2);
              context.fillStyle = "#fffaf0";
              context.fill();
              context.drawImage(image, centerX - 166, 90, 332, 332);
            });
            texture.needsUpdate = true;
          });
        return texture;
      },
      unitBallTextures = {
        pku: makeBallTexture("pku-seal.png", "北", "#b5102b", "#b40019"),
        thu: makeBallTexture("thu-seal.png", "清", "#6f3291", "#6f2c91"),
        ustc: makeBallTexture(null, "科", "#174f78", "#174f78"),
        zju: makeBallTexture(null, "浙", "#175b9b", "#175b9b"),
        nju: makeBallTexture(null, "南", "#6f2b86", "#6f2b86"),
        fdu: makeBallTexture(null, "复", "#174a9b", "#174a9b"),
        sjtu: makeBallTexture(null, "交", "#b11f2d", "#b11f2d"),
      };
    const routeDotCanvas = document.createElement("canvas");
    routeDotCanvas.width = 64;
    routeDotCanvas.height = 64;
    const routeDotContext = routeDotCanvas.getContext("2d")!;
    routeDotContext.beginPath();
    routeDotContext.arc(32, 32, 24, 0, Math.PI * 2);
    routeDotContext.fillStyle = "#fff";
    routeDotContext.shadowColor = "#fff";
    routeDotContext.shadowBlur = 10;
    routeDotContext.fill();
    const routeDotTexture = new THREE.CanvasTexture(routeDotCanvas);
    const selectionCanvas = document.createElement("canvas");
    selectionCanvas.width = 128;
    selectionCanvas.height = 128;
    const selectionContext = selectionCanvas.getContext("2d")!;
    selectionContext.beginPath();
    selectionContext.arc(64, 64, 48, 0, Math.PI * 2);
    selectionContext.lineWidth = 10;
    selectionContext.strokeStyle = "#ffe36f";
    selectionContext.shadowColor = "#ffe36f";
    selectionContext.shadowBlur = 8;
    selectionContext.stroke();
    const selectionTexture = new THREE.CanvasTexture(selectionCanvas);
    const UNIT_RENDER_SCALE = 0.56 / 3,
      UNIT_SEPARATION_DISTANCE = 0.48 / 3,
      unitBodyGeometry = new THREE.SphereGeometry(0.58, 16, 12),
      farUnitBodyGeometry = new THREE.SphereGeometry(0.58, 8, 6),
      unitLimbGeometry = new THREE.CylinderGeometry(0.055, 0.055, 0.68, 7),
      unitHandGeometry = new THREE.SphereGeometry(0.09, 8, 6),
      unitGlowGeometry = new THREE.RingGeometry(0.68, 0.86, 18),
      unitBodyMaterials = {
        pku: new THREE.MeshStandardMaterial({
          color: 0xffffff,
          map: unitBallTextures.pku,
          roughness: 0.24,
          metalness: 0.08,
          emissive: 0xc91f3a,
          emissiveIntensity: 0.035,
        }),
        thu: new THREE.MeshStandardMaterial({
          color: 0xffffff,
          map: unitBallTextures.thu,
          roughness: 0.24,
          metalness: 0.08,
          emissive: 0x74429d,
          emissiveIntensity: 0.035,
        }),
        ustc: new THREE.MeshStandardMaterial({
          color: 0xffffff,
          map: unitBallTextures.ustc,
          roughness: 0.24,
          metalness: 0.08,
          emissive: 0x174f78,
          emissiveIntensity: 0.035,
        }),
        zju: new THREE.MeshStandardMaterial({
          color: 0xffffff,
          map: unitBallTextures.zju,
          roughness: 0.24,
          metalness: 0.08,
          emissive: 0x175b9b,
          emissiveIntensity: 0.035,
        }),
        nju: new THREE.MeshStandardMaterial({
          color: 0xffffff, map: unitBallTextures.nju, roughness: 0.24,
          metalness: 0.08, emissive: 0x6f2b86, emissiveIntensity: 0.035,
        }),
        fdu: new THREE.MeshStandardMaterial({
          color: 0xffffff, map: unitBallTextures.fdu, roughness: 0.24,
          metalness: 0.08, emissive: 0x174a9b, emissiveIntensity: 0.035,
        }),
        sjtu: new THREE.MeshStandardMaterial({
          color: 0xffffff, map: unitBallTextures.sjtu, roughness: 0.24,
          metalness: 0.08, emissive: 0xb11f2d, emissiveIntensity: 0.035,
        }),
      },
      unitLimbMaterial = new THREE.MeshStandardMaterial({
        color: 0x242824,
        roughness: 0.8,
      }),
      unitGlowMaterials = {
        pku: new THREE.MeshBasicMaterial({
          color: 0xc91f3a,
          transparent: true,
          opacity: 0.72,
          side: THREE.DoubleSide,
        }),
        thu: new THREE.MeshBasicMaterial({
          color: 0x74429d,
          transparent: true,
          opacity: 0.72,
          side: THREE.DoubleSide,
        }),
      },
      unitSelectionMaterial = new THREE.SpriteMaterial({
        map: selectionTexture,
        color: 0xffdf63,
        transparent: true,
        opacity: 0.95,
        depthTest: true,
        depthWrite: false,
      }),
      routeDotMaterials = {
        pku: new THREE.SpriteMaterial({
          map: routeDotTexture,
          color: 0xff3552,
          transparent: true,
          depthTest: false,
          depthWrite: false,
        }),
        thu: new THREE.SpriteMaterial({
          map: routeDotTexture,
          color: 0xb56bea,
          transparent: true,
          depthTest: false,
          depthWrite: false,
        }),
      },
      sharedUnitGeometries = new Set<THREE.BufferGeometry>([
        unitBodyGeometry,
        farUnitBodyGeometry,
        unitLimbGeometry,
        unitHandGeometry,
        unitGlowGeometry,
      ]),
      sharedUnitMaterials = new Set<THREE.Material>([
        unitBodyMaterials.pku,
        unitBodyMaterials.thu,
        unitBodyMaterials.ustc,
        unitBodyMaterials.zju,
        unitBodyMaterials.nju,
        unitBodyMaterials.fdu,
        unitBodyMaterials.sjtu,
        unitLimbMaterial,
        unitGlowMaterials.pku,
        unitGlowMaterials.thu,
        unitSelectionMaterial,
        routeDotMaterials.pku,
        routeDotMaterials.thu,
      ]);
    const useLegacyUnitRenderer =
        new URLSearchParams(location.search).get("renderer") === "legacy",
      unitInstanceCapacity = 3200,
      farUnitMeshes = {
        pku: new THREE.InstancedMesh(
          farUnitBodyGeometry,
          unitBodyMaterials.pku,
          unitInstanceCapacity,
        ),
        thu: new THREE.InstancedMesh(
          farUnitBodyGeometry,
          unitBodyMaterials.thu,
          unitInstanceCapacity,
        ),
        ustc: new THREE.InstancedMesh(
          farUnitBodyGeometry,
          unitBodyMaterials.ustc,
          unitInstanceCapacity,
        ),
        zju: new THREE.InstancedMesh(
          farUnitBodyGeometry,
          unitBodyMaterials.zju,
          unitInstanceCapacity,
        ),
        nju: new THREE.InstancedMesh(
          farUnitBodyGeometry,
          unitBodyMaterials.nju,
          unitInstanceCapacity,
        ),
        fdu: new THREE.InstancedMesh(
          farUnitBodyGeometry,
          unitBodyMaterials.fdu,
          unitInstanceCapacity,
        ),
        sjtu: new THREE.InstancedMesh(
          farUnitBodyGeometry,
          unitBodyMaterials.sjtu,
          unitInstanceCapacity,
        ),
      },
      farUnitDummy = new THREE.Object3D(),
      detailedUnitIds = new Set<number>(),
      unitFightingUntil = new Map<number, number>();
    if (!useLegacyUnitRenderer)
      Object.values(farUnitMeshes).forEach((mesh) => {
        mesh.count = 0;
        mesh.frustumCulled = false;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        unitGroup.add(mesh);
      });
    const busGeometry = new THREE.BoxGeometry(1.48, 0.62, 0.66),
      bikeFrameGeometry = new THREE.BoxGeometry(0.48, 0.055, 0.045),
      bikeWheelGeometry = new THREE.TorusGeometry(0.16, 0.026, 6, 12),
      bikeHandleGeometry = new THREE.BoxGeometry(0.04, 0.25, 0.15),
      bikeSeatGeometry = new THREE.BoxGeometry(0.15, 0.045, 0.1),
      busMaterials = {
        pku: new THREE.MeshStandardMaterial({
          color: 0xd11f3b,
          emissive: 0x2b0309,
          emissiveIntensity: 0.16,
          roughness: 0.42,
        }),
        thu: new THREE.MeshStandardMaterial({
          color: 0x8b4bb5,
          emissive: 0x170522,
          emissiveIntensity: 0.16,
          roughness: 0.42,
        }),
      },
      bikeTireMaterial = new THREE.MeshStandardMaterial({
        color: 0x1b2021,
        roughness: 0.88,
      }),
      bikeMaterials = {
        pku: new THREE.MeshStandardMaterial({ color: 0xf2ce31, roughness: 0.42 }),
        thu: new THREE.MeshStandardMaterial({ color: 0xf2ce31, roughness: 0.42 }),
      },
      transportMeshes = {
        busPku: new THREE.InstancedMesh(busGeometry, busMaterials.pku, 160),
        busThu: new THREE.InstancedMesh(busGeometry, busMaterials.thu, 160),
        largePku: new THREE.InstancedMesh(
          busGeometry,
          new THREE.MeshStandardMaterial({ color: 0x61202a, metalness: 0.35 }),
          160,
        ),
        largeThu: new THREE.InstancedMesh(
          busGeometry,
          new THREE.MeshStandardMaterial({ color: 0x443052, metalness: 0.35 }),
          160,
        ),
      },
      createBikeMeshes = (material: THREE.MeshStandardMaterial) => ({
        frame: new THREE.InstancedMesh(bikeFrameGeometry, material, 3200),
        frontWheel: new THREE.InstancedMesh(
          bikeWheelGeometry,
          bikeTireMaterial,
          3200,
        ),
        rearWheel: new THREE.InstancedMesh(
          bikeWheelGeometry,
          bikeTireMaterial,
          3200,
        ),
        handle: new THREE.InstancedMesh(bikeHandleGeometry, material, 3200),
        seat: new THREE.InstancedMesh(
          bikeSeatGeometry,
          bikeTireMaterial,
          3200,
        ),
      }),
      bikeVariantMeshes = {
        pkuBike: createBikeMeshes(bikeMaterials.pku),
        pkuSlogan: createBikeMeshes(
          new THREE.MeshStandardMaterial({ color: 0xffd51f, emissive: 0x5a4400 }),
        ),
        pkuPhone: createBikeMeshes(
          new THREE.MeshStandardMaterial({ color: 0xff9f31, emissive: 0x5b2700 }),
        ),
        thuBike: createBikeMeshes(bikeMaterials.thu),
        thuPurple: createBikeMeshes(
          new THREE.MeshStandardMaterial({ color: 0x9b55cc, emissive: 0x2d103e }),
        ),
      },
      transportDummy = new THREE.Object3D(),
      bikePartMatrix = new THREE.Matrix4(),
      bikePartTransforms = {
        frame: new THREE.Matrix4().compose(
          new THREE.Vector3(0, 0.19, 0),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -0.18)),
          new THREE.Vector3(1, 1, 1),
        ),
        frontWheel: new THREE.Matrix4().makeTranslation(0.29, 0.16, 0),
        rearWheel: new THREE.Matrix4().makeTranslation(-0.29, 0.16, 0),
        handle: new THREE.Matrix4().makeTranslation(0.25, 0.36, 0),
        seat: new THREE.Matrix4().makeTranslation(-0.1, 0.34, 0),
      };
    Object.values(transportMeshes).forEach((mesh) => {
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      unitGroup.add(mesh);
    });
    Object.values(bikeVariantMeshes).forEach((parts) =>
      Object.values(parts).forEach((mesh) => {
        mesh.count = 0;
        mesh.frustumCulled = false;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.castShadow = false;
        unitGroup.add(mesh);
      }),
    );
    const disposeUnitObject = (object: THREE.Object3D) => {
      const geometries = new Set<THREE.BufferGeometry>(),
        materials = new Set<THREE.Material>();
      object.traverse((child) => {
        const renderable = child as THREE.Mesh & {
          material?: THREE.Material | THREE.Material[];
          geometry?: THREE.BufferGeometry;
        };
        if (
          renderable.geometry &&
          !sharedUnitGeometries.has(renderable.geometry)
        )
          geometries.add(renderable.geometry);
        const childMaterials = Array.isArray(renderable.material)
          ? renderable.material
          : renderable.material
            ? [renderable.material]
            : [];
        childMaterials.forEach((material) => {
          if (!sharedUnitMaterials.has(material)) materials.add(material);
        });
      });
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
    };
    const createDetailedUnitObject = (u: UnitState) => {
      const g = new THREE.Group(),
        region = regionForX(u.x),
        body = new THREE.Mesh(
          unitBodyGeometry,
          u.skin ? unitBodyMaterials[u.skin] : unitBodyMaterials[u.team],
        );
      body.position.y = 0.98;
      body.castShadow = false;
      body.receiveShadow = false;
      g.add(body);
      const arms: THREE.Mesh[] = [],
        legs: THREE.Mesh[] = [],
        detailParts: THREE.Mesh[] = [];
      [-1, 1].forEach((side) => {
        const arm = new THREE.Mesh(unitLimbGeometry, unitLimbMaterial);
        arm.position.set(side * 0.54, 0.9, 0);
        arm.rotation.z = side * 0.95;
        g.add(arm);
        arms.push(arm);
        detailParts.push(arm);
        const leg = new THREE.Mesh(unitLimbGeometry, unitLimbMaterial);
        leg.position.set(side * 0.25, 0.35, 0);
        leg.rotation.z = side * 0.28;
        g.add(leg);
        legs.push(leg);
        detailParts.push(leg);
        const hand = new THREE.Mesh(unitHandGeometry, unitLimbMaterial);
        hand.position.set(side * 0.82, 0.71, 0);
        g.add(hand);
        detailParts.push(hand);
      });
      const glow = new THREE.Mesh(unitGlowGeometry, unitGlowMaterials[u.team]);
      glow.rotation.x = -Math.PI / 2;
      glow.position.y = 0.05;
      g.add(glow);
      const selectionRing = new THREE.Sprite(unitSelectionMaterial);
      selectionRing.position.y = 0.98;
      selectionRing.scale.set(1.42, 1.42, 1);
      selectionRing.visible = selectedUnitIds.has(u.id);
      selectionRing.renderOrder = 18;
      g.add(selectionRing);
      const routeMarker = new THREE.Sprite(routeDotMaterials[u.team]);
      routeMarker.position.y = 1.9;
      routeMarker.scale.set(1.15, 1.15, 1);
      routeMarker.visible = false;
      routeMarker.renderOrder = 90;
      g.add(routeMarker);
      g.position.set(u.x, terrainHeight(region, u.x, u.z), u.z);
      g.scale.setScalar(UNIT_RENDER_SCALE);
      g.userData = {
        unitId: u.id,
        arms,
        legs,
        body,
        detailParts,
        detailsVisible: true,
        glow,
        selectionRing,
        routeMarker,
        renderTeam: u.team,
        renderSkin: u.skin ?? u.team,
      };
      unitGroup.add(g);
      unitObjects.set(u.id, g);
      detailedUnitIds.add(u.id);
      return g;
    };
    const syncDetailedUnits = (force = false) => {
      if (useLegacyUnitRenderer) {
        if (!force && unitObjects.size === gameRef.current.units.length) return;
        unitObjects.forEach((object) => {
          unitGroup.remove(object);
          disposeUnitObject(object);
        });
        unitObjects.clear();
        detailedUnitIds.clear();
        gameRef.current.units
          .filter((unit) => unit.transport !== "bus")
          .forEach(createDetailedUnitObject);
        return;
      }
      const cap = activeQualityProfile.detailedUnits,
        closeView = camera.position.distanceTo(controls.target) < 20,
        candidates = gameRef.current.units
          .filter((unit) => unit.transport !== "bus")
          .map((unit) => {
            const priority =
                selectedUnitIds.has(unit.id) || unit.id === directLeaderId
                  ? -1000
                  : (unitFightingUntil.get(unit.id) ?? 0) > performance.now() ||
                      unit.retreating
                    ? -500
                    : 0,
              distance = Math.hypot(
                unit.x - controls.target.x,
                unit.z - controls.target.z,
              );
            return { unit, score: priority + distance };
          })
          .sort((a, b) => a.score - b.score),
        desired = new Set(
          candidates
            .filter((item) => item.score < 0 || (closeView && item.score < 18))
            .slice(0, cap)
            .map((item) => item.unit.id),
        ),
        unitsById = new Map(
          gameRef.current.units.map((unit) => [unit.id, unit] as const),
        );
      unitObjects.forEach((object, id) => {
        const unit = unitsById.get(id),
          appearanceChanged =
            !!unit &&
            (object.userData.renderTeam !== unit.team ||
              object.userData.renderSkin !== (unit.skin ?? unit.team));
        if (desired.has(id) && unit && !appearanceChanged) return;
        unitGroup.remove(object);
        disposeUnitObject(object);
        unitObjects.delete(id);
        detailedUnitIds.delete(id);
      });
      desired.forEach((id) => {
        if (unitObjects.has(id)) return;
        const unit = unitsById.get(id);
        if (unit) createDetailedUnitObject(unit);
      });
    };
    const renderPositions = new Map<number, { x: number; z: number }>();
    const renderPosition = (unit: UnitState) => isRemoteGuest() ? renderPositions.get(unit.id) ?? unit : unit;
    const updateFarUnitInstances = () => {
      const counts = {
        pku: 0,
        thu: 0,
        ustc: 0,
        zju: 0,
        nju: 0,
        fdu: 0,
        sjtu: 0,
      };
      for (const unit of gameRef.current.units) {
        if (unit.transport === "bus") continue;
        if (detailedUnitIds.has(unit.id)) continue;
        const key = (unit.skin ?? unit.team) as keyof typeof farUnitMeshes,
          index = counts[key]++;
        if (index >= unitInstanceCapacity) continue;
        const position = renderPosition(unit);
        farUnitDummy.position.set(
          position.x,
          terrainHeight(regionForX(position.x), position.x, position.z) +
            0.98 * UNIT_RENDER_SCALE +
            (insideWater(position.x, position.z) ? 0.1 : 0),
          position.z,
        );
        farUnitDummy.rotation.set(0, Math.atan2(unit.tx - unit.x, unit.tz - unit.z), 0);
        farUnitDummy.scale.setScalar(UNIT_RENDER_SCALE);
        farUnitDummy.updateMatrix();
        farUnitMeshes[key].setMatrixAt(index, farUnitDummy.matrix);
      }
      (Object.keys(farUnitMeshes) as (keyof typeof farUnitMeshes)[]).forEach(
        (key) => {
          const mesh = farUnitMeshes[key];
          mesh.count = Math.min(counts[key], unitInstanceCapacity);
          mesh.instanceMatrix.needsUpdate = true;
        },
      );
      const transportCounts = {
          busPku: 0,
          busThu: 0,
          largePku: 0,
          largeThu: 0,
        },
        bikeCounts = {
          pkuBike: 0,
          pkuSlogan: 0,
          pkuPhone: 0,
          thuBike: 0,
          thuPurple: 0,
        },
        busLeaders = new Map<string, UnitState>();
      for (const unit of gameRef.current.units) {
        if (unit.transport === "bus" && unit.transportGroupId) {
          if (!busLeaders.has(unit.transportGroupId))
            busLeaders.set(unit.transportGroupId, unit);
          continue;
        }
        if (unit.transport !== "bike") continue;
        const key =
            unit.transportModel === "pku_slogan_bike"
              ? "pkuSlogan"
              : unit.transportModel === "pku_phone_bike"
                ? "pkuPhone"
                : unit.transportModel === "thu_purple_bike"
                  ? "thuPurple"
                  : unit.team === "pku"
                    ? "pkuBike"
                    : "thuBike",
          index = bikeCounts[key]++;
        const position = renderPosition(unit);
        transportDummy.position.set(
          position.x,
          terrainHeight(regionForX(position.x), position.x, position.z) + 0.08,
          position.z,
        );
        transportDummy.rotation.set(
          0,
          Math.atan2(unit.tx - unit.x, unit.tz - unit.z),
          0,
        );
        transportDummy.rotation.y -= Math.PI / 2;
        transportDummy.scale.set(1, 1, 1);
        transportDummy.updateMatrix();
        const parts = bikeVariantMeshes[key];
        (Object.keys(parts) as (keyof typeof parts)[]).forEach((part) => {
          bikePartMatrix.multiplyMatrices(
            transportDummy.matrix,
            bikePartTransforms[part],
          );
          parts[part].setMatrixAt(index, bikePartMatrix);
        });
      }
      for (const leader of busLeaders.values()) {
        const key =
            leader.transportModel === "large_bus"
              ? leader.team === "pku"
                ? "largePku"
                : "largeThu"
              : leader.team === "pku"
                ? "busPku"
                : "busThu",
          index = transportCounts[key]++;
        const position = renderPosition(leader);
        transportDummy.position.set(
          position.x,
          terrainHeight(regionForX(position.x), position.x, position.z) + 0.34,
          position.z,
        );
        transportDummy.rotation.set(
          0,
          Math.atan2(leader.tx - leader.x, leader.tz - leader.z),
          0,
        );
        transportDummy.rotation.y -= Math.PI / 2;
        transportDummy.scale.setScalar(
          leader.transportModel === "large_bus" ? 1.15 : 1,
        );
        transportDummy.updateMatrix();
        transportMeshes[key].setMatrixAt(index, transportDummy.matrix);
      }
      (Object.keys(transportMeshes) as (keyof typeof transportMeshes)[]).forEach(
        (key) => {
          transportMeshes[key].count = transportCounts[key];
          transportMeshes[key].instanceMatrix.needsUpdate = true;
        },
      );
      (Object.keys(bikeVariantMeshes) as (keyof typeof bikeVariantMeshes)[]).forEach(
        (key) => {
          const count = bikeCounts[key];
          Object.values(bikeVariantMeshes[key]).forEach((mesh) => {
            mesh.count = count;
            mesh.instanceMatrix.needsUpdate = true;
          });
        },
      );
    };
    const rebuildUnits = () => syncDetailedUnits(true);
    const refreshUnitSelection = () => {
      syncDetailedUnits();
      unitObjects.forEach((object, id) => {
        const ring = object.userData.selectionRing as
          | THREE.Sprite
          | undefined;
        if (ring) ring.visible = selectedUnitIds.has(id);
      });
      setSelectedUnitCount(
        gameRef.current.units
          .filter((unit) => selectedUnitIds.has(unit.id))
          .reduce((sum, unit) => sum + unit.strength, 0),
      );
    };
    const applyMaterials = (
      unitUrl: string | null,
      siteUrl: string | null,
      teamUnitUrls: Partial<Record<Team, string>> = {},
    ) => {
      const unitRequest = ++unitMaterialRequest,
        siteRequest = ++siteMaterialRequest;
      Object.values(customUnitTextures).forEach((texture) => texture?.dispose());
      customUnitTextures = {};
      for (const team of ["pku", "thu"] as Team[]) {
        unitBodyMaterials[team].map = unitBallTextures[team];
        unitBodyMaterials[team].needsUpdate = true;
        const desiredUrl = teamUnitUrls[team] || unitUrl;
        if (!desiredUrl) continue;
        textureLoader.load(desiredUrl, (texture) => {
          if (unitRequest !== unitMaterialRequest) {
            texture.dispose();
            return;
          }
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
          customUnitTextures[team]?.dispose();
          customUnitTextures[team] = texture;
          unitBodyMaterials[team].map = texture;
          unitBodyMaterials[team].needsUpdate = true;
        });
      }
      if (siteUrl) {
        textureLoader.load(siteUrl, (texture) => {
          if (siteRequest !== siteMaterialRequest) {
            texture.dispose();
            return;
          }
          texture.colorSpace = THREE.SRGBColorSpace;
          customSiteTexture?.dispose();
          customSiteTexture = texture;
          rebuildBuildings();
        });
      } else {
        customSiteTexture?.dispose();
        customSiteTexture = null;
        rebuildBuildings();
      }
    };
    rebuildBuildings();
    rebuildUnits();
    rebuildCommandLines();
    const treeGroup = new THREE.Group();
    scene.add(treeGroup);
    let seed = 91723;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    const tg = new THREE.CylinderGeometry(realCampus ? 0.012 : 0.07, realCampus ? 0.018 : 0.11, realCampus ? 0.24 : 0.86, 7),
      tm = new THREE.MeshStandardMaterial({ color: 0x61412f, roughness: 1 }),
      crownGeometries = realCampus
        ? [new THREE.DodecahedronGeometry(0.13, 1), new THREE.SphereGeometry(0.12, 12, 9), new THREE.ConeGeometry(0.14, 0.32, 11), new THREE.SphereGeometry(0.12, 12, 9)]
        : [new THREE.SphereGeometry(0.52, 10, 8), new THREE.SphereGeometry(0.52, 10, 8), new THREE.SphereGeometry(0.52, 10, 8)],
      crownMaterials = (realCampus ? [0x8d9e80, 0x9ba17c, 0x778c72, 0x87977d] : [0x315d36, 0x467648, 0x5b8a4e]).map(
        (color) => new THREE.MeshStandardMaterial({ color, map: realCampus ? campusTextures?.leaf ?? null : null, roughnessMap: realCampus ? campusTextures?.leafRoughness ?? null : null, roughness: 0.9 }),
      ),
      treePositions: { x: number; y: number; z: number; variant: number; scale: number }[] = [];
    if (realCampus) {
      const campusPolygons=regions.main.campuses.filter((campus:any)=>campus.name==="北京大学"||campus.name==="清华大学"),seen=new Set<string>(),
        insideCampus=(x:number,z:number)=>campusPolygons.some((campus:any)=>pointInPolygon(x,z,campus.points)),
        waterBounds=regions.main.waters.map((water:any)=>({minX:Math.min(...water.points.map((point:number[])=>point[0]))-.32,maxX:Math.max(...water.points.map((point:number[])=>point[0]))+.32,minZ:Math.min(...water.points.map((point:number[])=>point[1]))-.32,maxZ:Math.max(...water.points.map((point:number[])=>point[1]))+.32})),
        pushTree=(x:number,z:number,preferredVariant?:number)=>{
          const key=`${Math.round(x/.08)}/${Math.round(z/.08)}`;
          if(treePositions.length>=2600||seen.has(key)||!insideCampus(x,z)||insideObstacle(x,z)||gameRef.current.sites.some(site=>Math.hypot(site.x-x,site.z-z)<.22))return;
          const besideWater=waterBounds.some((water:any)=>x>=water.minX&&x<=water.maxX&&z>=water.minZ&&z<=water.maxZ),hash=Math.abs(Math.round(x*100)*31+Math.round(z*100)*17),variant=besideWater?3:preferredVariant??hash%3;
          seen.add(key);treePositions.push({x,y:terrainHeight(regions.main,x,z),z,variant,scale:.82+(hash%7)*.05});
        };
      for(const campus of ["pku","thu"] as const){const candidates=SATELLITE_TREE_POINTS[campus],target=campus==="pku"?650:1100,threshold=Math.min(1,target/candidates.length);for(const point of candidates){const x=Math.round(point[0]*1000),z=Math.round(point[1]*1000),hash=(Math.imul(x,73856093)^Math.imul(z,19349663))>>>0;if(hash/4294967296<threshold)pushTree(point[0],point[1]);}}
      for(const [x,z] of regions.main.trees??[])pushTree(x,z);
      for(const [rowIndex,row] of (regions.main.treeRows??[]).entries())for(let segment=1;segment<row.length;segment++){
        const a=row[segment-1],b=row[segment],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz),count=Math.max(1,Math.floor(length/.26));
        for(let index=0;index<=count;index++){const t=index/count;pushTree(a[0]+dx*t,a[1]+dz*t,rowIndex%2);}
      }
    } else for (const [r, count] of [[regions.main, 340]] as [any, number][]) {
      for (let i = 0; i < count; i++) {
        const x = r.offsetX - r.width / 2 + rnd() * r.width,
          z = -r.depth / 2 + rnd() * r.depth;
        if (
          gameRef.current.sites.some(
            (s) => Math.hypot(s.x - x, s.z - z) < 3.2,
          ) ||
          r.roads.some((road: any) =>
            road.points.some(
              (p: number[]) => Math.hypot(p[0] - x, p[1] - z) < 0.5,
            ),
          )
        )
          continue;
        treePositions.push({ x, y: terrainHeight(r, x, z), z, variant: 0, scale: 1 });
      }
    }
    const treeTrunks = new THREE.InstancedMesh(tg, tm, treePositions.length),
      variantPositions = crownGeometries.map((_,variant)=>realCampus?treePositions.filter(position=>position.variant===variant):treePositions),
      treeCrowns = crownGeometries.map((geometry, variant) => new THREE.InstancedMesh(geometry, crownMaterials[variant], variantPositions[variant].length)),
      treeCrownClusters = realCampus ? crownGeometries.map((geometry, variant) => new THREE.InstancedMesh(geometry, crownMaterials[variant], variantPositions[variant].length * 2)) : [],
      treeDummy = new THREE.Object3D();
    treePositions.forEach((position, index) => {
      treeDummy.position.set(position.x, position.y + (realCampus ? 0.12 : 0.43), position.z);
      treeDummy.rotation.set(0, 0, 0);
      treeDummy.scale.set(position.scale * .82, position.scale, position.scale * .82);
      treeDummy.updateMatrix();
      treeTrunks.setMatrixAt(index, treeDummy.matrix);
    });
    treeCrowns.forEach((mesh, variant) => variantPositions[variant].forEach((position, index) => {
      treeDummy.position.set(position.x, position.y + (realCampus ? variant === 2 ? 0.27 : 0.24 : 0.92 + variant * 0.32), position.z);
      treeDummy.rotation.set(0, ((index * 37 + variant * 19) % 360) * Math.PI / 180, 0);
      const width = realCampus ? variant === 1 ? .72 : variant === 2 ? .88 : variant === 3 ? 1.08 : 1 : 1.1 - variant * .18,
        height = realCampus ? variant === 0 ? .82 : variant === 1 ? 1.22 : variant === 2 ? 1.08 : 1.38 : .65;
      treeDummy.scale.set(position.scale * width, position.scale * height, position.scale * width);
      treeDummy.updateMatrix();
      mesh.setMatrixAt(index, treeDummy.matrix);
    }));
    treeCrownClusters.forEach((mesh, variant) => variantPositions[variant].forEach((position, index) => {
      for (let layer = 0; layer < 2; layer++) {
        const angle = ((index * 137 + variant * 53 + layer * 167) % 360) * Math.PI / 180,
          radial = variant === 2 ? 0.018 : 0.052 + layer * 0.012,
          baseY = variant === 2 ? 0.27 : 0.24,
          vertical = variant === 2 ? 0.035 + layer * 0.055 : variant === 1 ? -0.035 + layer * 0.09 : variant === 3 ? -0.045 + layer * 0.025 : -0.025 + layer * 0.055,
          clusterScale = variant === 2 ? 0.62 - layer * 0.08 : 0.62 + layer * 0.05;
        treeDummy.position.set(position.x + Math.cos(angle) * radial, position.y + baseY + vertical, position.z + Math.sin(angle) * radial);
        treeDummy.rotation.set(0, angle, 0);
        treeDummy.scale.set(position.scale * clusterScale, position.scale * clusterScale * (variant === 1 ? 1.18 : variant === 3 ? 1.12 : 0.88), position.scale * clusterScale);
        treeDummy.updateMatrix();
        mesh.setMatrixAt(index * 2 + layer, treeDummy.matrix);
      }
    }));
    treeTrunks.instanceMatrix.needsUpdate = true;
    treeCrowns.forEach((mesh) => (mesh.instanceMatrix.needsUpdate = true));
    treeCrownClusters.forEach((mesh) => (mesh.instanceMatrix.needsUpdate = true));
    treeTrunks.castShadow = true;
    treeCrowns.forEach((mesh) => (mesh.castShadow = true));
    treeCrownClusters.forEach((mesh) => (mesh.castShadow = false));
    treeGroup.add(treeTrunks, ...treeCrowns, ...treeCrownClusters);
    const lampPositions: { x: number; z: number; glowX: number; glowZ: number; r: any }[] = [],
      lampSeen = new Set<string>();
    for (const r of [regions.main]) {
      const cap = r === regions.main ? 650 : 90,
        pushLamp = (x: number, z: number, glowX = x, glowZ = z) => {
          const precision = realCampus ? 4 : 2,
            key = `${Math.round(x * precision)}/${Math.round(z * precision)}`;
          if (
            lampSeen.has(key) ||
            lampPositions.length >= cap ||
            (realCampus && insideObstacle(x, z))
          )
            return;
          lampSeen.add(key);
          lampPositions.push({ x, z, glowX, glowZ, r });
        };
      for (const [x, z] of r.lamps ?? []) pushLamp(x, z);
      const campusAreas = realCampus
          ? r.campuses.filter((campus: any) => campus.name === "北京大学" || campus.name === "清华大学")
          : [],
        insideCampus = (x: number, z: number) => !realCampus || campusAreas.some((campus: any) => pointInPolygon(x, z, campus.points)),
        spacing = realCampus ? 0.72 : 3.1;
      for (const road of r.roads) {
        if (
          ["steps", "corridor", "track", "motorway", "motorway_link", "trunk", "trunk_link"].includes(road.kind) ||
          road.lit === "no" ||
          (realCampus && !road.points.some((point: number[]) => insideCampus(point[0], point[1])))
        )
          continue;
        let distanceUntilNext = spacing * 0.5,
          sampleIndex = 0;
        for (let k = 1; k < road.points.length; k++) {
          const [x1, z1] = road.points[k - 1],
            [x2, z2] = road.points[k],
            dx = x2 - x1,
            dz = z2 - z1,
            len = Math.hypot(dx, dz);
          if (len < 0.01) continue;
          let travelled = 0;
          while (travelled + distanceUntilNext <= len) {
            travelled += distanceUntilNext;
            const t = travelled / len,
              nx = -dz / len,
              nz = dx / len,
              side = (sampleIndex++ + k) % 2 ? 1 : -1,
              offset = road.width / 2 + (realCampus ? 0.07 : 0.16);
            const roadX = x1 + dx * t,
              roadZ = z1 + dz * t;
            pushLamp(roadX + nx * offset * side, roadZ + nz * offset * side, roadX, roadZ);
            distanceUntilNext = spacing;
          }
          distanceUntilNext -= len - travelled;
        }
      }
    }
    const poleGeometry = new THREE.CylinderGeometry(realCampus ? 0.006 : 0.025, realCampus ? 0.009 : 0.038, realCampus ? 0.14 : 0.82, 6),
      poleMaterial = new THREE.MeshStandardMaterial({
        color: 0x303735,
        roughness: 0.76,
      }),
      bulbGeometry = new THREE.SphereGeometry(realCampus ? 0.016 : 0.065, 8, 6),
      lampBulbMaterial = new THREE.MeshStandardMaterial({
        color: 0xffe3a6,
        emissive: 0xffb23f,
        emissiveIntensity: 0.1,
        roughness: 0.25,
      }),
      poles = new THREE.InstancedMesh(
        poleGeometry,
        poleMaterial,
        lampPositions.length,
      ),
      bulbs = new THREE.InstancedMesh(
        bulbGeometry,
        lampBulbMaterial,
        lampPositions.length,
      ),
      lampGlowCanvas = document.createElement("canvas"),
      lampGlowContext = lampGlowCanvas.getContext("2d")!,
      lampGlowGradient = (lampGlowCanvas.width = lampGlowCanvas.height = 64, lampGlowContext.createRadialGradient(32, 32, 2, 32, 32, 31)),
      lampGlowTexture = (lampGlowGradient.addColorStop(0, "rgba(255,211,124,.82)"), lampGlowGradient.addColorStop(0.38, "rgba(255,186,74,.36)"), lampGlowGradient.addColorStop(1, "rgba(255,164,48,0)"), lampGlowContext.fillStyle = lampGlowGradient, lampGlowContext.fillRect(0, 0, 64, 64), new THREE.CanvasTexture(lampGlowCanvas)),
      lampGlowGeometry = new THREE.CircleGeometry(realCampus ? 0.4 : 1.15, 20),
      lampGlowMaterial = new THREE.MeshBasicMaterial({ color: 0xffc66f, map: lampGlowTexture, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
      lampGlows = new THREE.InstancedMesh(lampGlowGeometry, lampGlowMaterial, lampPositions.length),
      lampDummy = new THREE.Object3D();
    lampPositions.forEach((p, i) => {
      const base = terrainHeight(p.r, p.x, p.z);
      lampDummy.rotation.set(0, 0, 0);
      lampDummy.position.set(p.x, base + (realCampus ? 0.07 : 0.41), p.z);
      lampDummy.updateMatrix();
      poles.setMatrixAt(i, lampDummy.matrix);
      lampDummy.position.y = base + (realCampus ? 0.15 : 0.86);
      lampDummy.updateMatrix();
      bulbs.setMatrixAt(i, lampDummy.matrix);
      lampDummy.position.set(p.glowX, terrainHeight(p.r, p.glowX, p.glowZ) + 0.012, p.glowZ);
      lampDummy.rotation.set(-Math.PI / 2, 0, 0);
      lampDummy.updateMatrix();
      lampGlows.setMatrixAt(i, lampDummy.matrix);
    });
    poles.instanceMatrix.needsUpdate = true;
    bulbs.instanceMatrix.needsUpdate = true;
    lampGlows.instanceMatrix.needsUpdate = true;
    lampGlows.renderOrder = 7;
    scene.add(poles, bulbs, lampGlows);
    const lights: THREE.PointLight[] = Array.from({ length: Math.min(8, lampPositions.length) }, () => {
      const light = new THREE.PointLight(0xffc66f, 0, realCampus ? 0.9 : 5, 2);
      light.userData.hasLamp = false;
      scene.add(light);
      return light;
    });
    let lastLampLightUpdateAt = -Infinity;
    const ray = new THREE.Raycaster(),
      mouse = new THREE.Vector2(),
      projectedSiteNode = new THREE.Vector3(),
      projectedSiteEdge = new THREE.Vector3(),
      siteNodeWorld = new THREE.Vector3(),
      siteNodeCameraRight = new THREE.Vector3(),
      siteNodeWorldPosition = (site: SiteState, target = new THREE.Vector3()) =>
        target.set(
          site.x,
          terrainHeight(regionForX(site.x), site.x, site.z) + (realCampus ? 0.35 : 1.75),
          site.z,
        );
    let down: {
        x: number;
        y: number;
        site?: number;
        sourceSite?: number;
        selection?: boolean;
        tool?: boolean;
        multiRoute?: boolean;
        eraseLines?: boolean;
        erasedLines?: Set<number>;
        routeTargets?: number[];
      } | null = null,
      previewLine: THREE.Object3D | null = null,
      touchRouteSourceId: number | null = null,
      rightGesture: {
        x: number;
        y: number;
        moved: boolean;
      } | null = null;
    const setRay = (ev: MouseEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      mouse.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
      mouse.y = (-(ev.clientY - r.top) / r.height) * 2 + 1;
      ray.setFromCamera(mouse, camera);
    };
    const hitSiteNode = (ev: MouseEvent, radiusMultiplier = 1) => {
      const rect = renderer.domElement.getBoundingClientRect(),
        pointerX = ev.clientX - rect.left,
        pointerY = ev.clientY - rect.top,
        markerScale = THREE.MathUtils.clamp(
          camera.position.distanceTo(controls.target) / Math.hypot(24, 22),
          0.45,
          1.9,
        );
      camera.updateMatrixWorld();
      siteNodeCameraRight
        .setFromMatrixColumn(camera.matrixWorld, 0)
        .normalize();
      const screenHit = gameRef.current.sites
        .filter((site) => !site.destroyed)
        .map((site) => {
          siteNodeWorldPosition(site, siteNodeWorld);
          projectedSiteNode.copy(siteNodeWorld).project(camera);
          projectedSiteEdge
            .copy(siteNodeWorld)
            .addScaledVector(siteNodeCameraRight, (1.15 * markerScale) / 2)
            .project(camera);
          const centerX = ((projectedSiteNode.x + 1) * rect.width) / 2,
            centerY = ((1 - projectedSiteNode.y) * rect.height) / 2,
            edgeX = ((projectedSiteEdge.x + 1) * rect.width) / 2,
            edgeY = ((1 - projectedSiteEdge.y) * rect.height) / 2,
            radius = Math.hypot(edgeX - centerX, edgeY - centerY);
          return {
            id: site.id,
            visible: projectedSiteNode.z >= -1 && projectedSiteNode.z <= 1,
            distance: Math.hypot(pointerX - centerX, pointerY - centerY),
            radius,
          };
        })
        .filter(
          (candidate) =>
            candidate.visible &&
            candidate.distance <= (mobileClient
              ? mobileSiteHitRadius(candidate.radius, radiusMultiplier)
              : candidate.radius * radiusMultiplier),
        )
        .sort((a, b) => a.distance - b.distance)[0];
      return screenHit?.id;
    };
    const hitSite = (ev: MouseEvent) => {
      const screenHit = hitSiteNode(ev);
      if (screenHit != null) return screenHit;
      setRay(ev);
      const hit = ray
        .intersectObjects(siteHitProxies, false)
        .find((item) => item.object.userData.siteHitProxy);
      if (hit) return hit.object.userData.siteId as number;
      return undefined;
    };
    const groundAt = (ev: MouseEvent) => {
      setRay(ev);
      return ray.intersectObjects(terrainMeshes, false)[0]?.point ?? null;
    };
    const projectedUnitPoint = new THREE.Vector3(),
      hitFriendlyUnitOnScreen = (ev: MouseEvent) => {
        const rect = renderer.domElement.getBoundingClientRect(),
          pointerX = ev.clientX - rect.left,
          pointerY = ev.clientY - rect.top;
        camera.updateMatrixWorld();
        let closest: UnitState | undefined,
          closestDistance = mobileClient ? 46 : 32;
        for (const unit of gameRef.current.units) {
          if (unit.team !== playerTeamRef.current || unit.hp <= 0) continue;
          projectedUnitPoint
            .set(
              unit.x,
              terrainHeight(regionForX(unit.x), unit.x, unit.z) +
                0.98 * UNIT_RENDER_SCALE,
              unit.z,
            )
            .project(camera);
          if (
            projectedUnitPoint.z < -1 ||
            projectedUnitPoint.z > 1 ||
            Math.abs(projectedUnitPoint.x) > 1.08 ||
            Math.abs(projectedUnitPoint.y) > 1.08
          )
            continue;
          const screenX = ((projectedUnitPoint.x + 1) * rect.width) / 2,
            screenY = ((1 - projectedUnitPoint.y) * rect.height) / 2,
            distance = Math.hypot(pointerX - screenX, pointerY - screenY);
          if (distance < closestDistance) {
            closestDistance = distance;
            closest = unit;
          }
        }
        return closest;
      };
    const commandHoverPoint = new THREE.Vector3(),
      setRouteUnitMarkers = (sourceId?: number) => {
        const source =
          sourceId == null ? undefined : gameRef.current.sites[sourceId];
        gameRef.current.units.forEach((unit) => {
          const marker = unitObjects.get(unit.id)?.userData.routeMarker as
            THREE.Sprite | undefined;
          if (marker)
            marker.visible =
              !!source &&
              unit.siteId === source.id &&
              unit.targetSiteId === source.orderTarget;
        });
      },
      hideCommandLabels = () => {
        commandAnimations.forEach((animation) => {
          animation.label.visible = false;
        });
        setRouteUnitMarkers();
      },
      pointSegmentDistance = (
        px: number,
        py: number,
        ax: number,
        ay: number,
        bx: number,
        by: number,
      ) => {
        const dx = bx - ax,
          dy = by - ay,
          lengthSquared = dx * dx + dy * dy;
        if (!lengthSquared) return Math.hypot(px - ax, py - ay);
        const t = THREE.MathUtils.clamp(
          ((px - ax) * dx + (py - ay) * dy) / lengthSquared,
          0,
          1,
        );
        return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
      },
      updateCommandLabelHover = (ev: MouseEvent) => {
        const rect = renderer.domElement.getBoundingClientRect(),
          pointerX = ev.clientX - rect.left,
          pointerY = ev.clientY - rect.top;
        camera.updateMatrixWorld();
        let closest: (typeof commandAnimations)[number] | undefined,
          closestDistance = mobileClient ? 22 : 11;
        commandAnimations.forEach((animation) => {
          animation.curve.getPoint(0, commandHoverPoint).project(camera);
          let previousX = ((commandHoverPoint.x + 1) * rect.width) / 2,
            previousY = ((1 - commandHoverPoint.y) * rect.height) / 2;
          for (let step = 1; step <= 32; step++) {
            animation.curve
              .getPoint(step / 32, commandHoverPoint)
              .project(camera);
            const currentX = ((commandHoverPoint.x + 1) * rect.width) / 2,
              currentY = ((1 - commandHoverPoint.y) * rect.height) / 2,
              distance = pointSegmentDistance(
                pointerX,
                pointerY,
                previousX,
                previousY,
                currentX,
                currentY,
              );
            if (distance < closestDistance) {
              closestDistance = distance;
              closest = animation;
            }
            previousX = currentX;
            previousY = currentY;
          }
        });
        commandAnimations.forEach((animation) => {
          animation.label.visible = animation === closest;
        });
        setRouteUnitMarkers(closest?.sourceId);
      };
    const commandSourceAt = (event: MouseEvent) => {
        setRay(event);
        const hit = ray
          .intersectObjects(commandGroup.children, true)
          .find((item) => item.object.userData.commandSourceId != null);
        return hit?.object.userData.commandSourceId as number | undefined;
      },
      removeCommandLine = (sourceId?: number) => {
        if (!canIssuePlayerCommandRef.current()) return false;
        if (sourceId == null) return false;
        const source = gameRef.current.sites[sourceId],
          team = playerTeamRef.current,
          active = source?.team === team && source.orderTarget != null,
          planned = source?.plannedOrderTargets?.[team] != null;
        if (!source || (!active && !planned)) return false;
        if (active) {
          source.orderTarget = undefined;
          source.orderPath = undefined;
          gameRef.current.units
            .filter((unit) => unit.siteId === sourceId)
            .forEach((unit) => {
              unit.targetSiteId = undefined;
              unit.path = undefined;
              unit.pathIndex = undefined;
              unit.tx = unit.x;
              unit.tz = unit.z;
            });
        }
        if (source.plannedOrderTargets)
          delete source.plannedOrderTargets[team];
        if (source.plannedOrderPaths) delete source.plannedOrderPaths[team];
        playerCommandSenderRef.current({ siteIds: [sourceId], unitIds: active ? gameRef.current.units.filter(u => u.siteId === sourceId && u.team === team).map(u => u.id) : [] });
        rebuildCommandLines();
        rebuildBuildings();
        return true;
      },
      simplifyCommandChain = (sourceId?: number) => {
        if (!canIssuePlayerCommandRef.current()) return false;
        if (sourceId == null) return false;
        const game = gameRef.current,
          source = game.sites[sourceId];
        const routeTarget = (site: SiteState) =>
          site.team === playerTeamRef.current
            ? site.orderTarget
            : site.plannedOrderTargets?.[playerTeamRef.current];
        if (!source || routeTarget(source) == null) return false;
        const chain: SiteState[] = [source],
          visited = new Set([source.id]);
        let cursor = source;
        while (routeTarget(cursor) != null) {
          const next = game.sites[routeTarget(cursor)!];
          if (!next || next.destroyed || visited.has(next.id)) break;
          chain.push(next);
          visited.add(next.id);
          cursor = next;
        }
        if (chain.length < 3) return false;
        const terminal = chain.at(-1)!;
        const simplifiedPath = findPath(
          source.navX ?? source.x,
          source.navZ ?? source.z,
          terminal.navX ?? terminal.x,
          terminal.navZ ?? terminal.z,
        );
        if (source.team === playerTeamRef.current) {
          source.orderTarget = terminal.id;
          source.orderPath = simplifiedPath;
        } else {
          source.plannedOrderTargets ??= {};
          source.plannedOrderPaths ??= {};
          source.plannedOrderTargets[playerTeamRef.current] = terminal.id;
          source.plannedOrderPaths[playerTeamRef.current] = simplifiedPath;
        }
        chain.slice(1, -1).forEach((site) => {
          if (site.team === playerTeamRef.current) {
            site.orderTarget = undefined;
            site.orderPath = undefined;
          }
          if (site.plannedOrderTargets)
            delete site.plannedOrderTargets[playerTeamRef.current];
          if (site.plannedOrderPaths)
            delete site.plannedOrderPaths[playerTeamRef.current];
        });
        game.units
          .filter(
            (unit) =>
              unit.team === source.team &&
              unit.targetSiteId != null &&
              visited.has(unit.targetSiteId),
          )
          .forEach((unit) => {
            const path = findPath(
              unit.x,
              unit.z,
              terminal.navX ?? terminal.x,
              terminal.navZ ?? terminal.z,
            );
            if (!path.length) return;
            unit.targetSiteId = terminal.id;
            unit.path = path;
            unit.pathIndex = 0;
            [unit.tx, unit.tz] = path.at(-1)!;
          });
        rebuildCommandLines();
        refreshRouteHighlights();
        setNotice(
          `兵线已简化：${source.displayName ?? source.name} → ${terminal.displayName ?? terminal.name}`,
        );
        playerCommandSenderRef.current({ siteIds: chain.slice(0, -1).map(s => s.id) });
        return true;
      };
    const buildCampAt = (
      point: THREE.Vector3,
      requestedTeam = playerTeamRef.current,
      silent = false,
    ) => {
      if (!silent && !canIssuePlayerCommandRef.current()) return false;
      const g = gameRef.current,
        index = navIndex(navGrid, point.x, point.z),
        activeCamps = g.sites.filter(
          (site) => site.type === "camp" && !site.destroyed,
        );
      const campTeam = requestedTeam;
      if (g.resources[campTeam] < 80)
        return (silent || setNotice("建立营地需要80战略资源"), false);
      if (activeCamps.length >= 4)
        return (silent || setNotice("主战场最多同时维持4座临时营地"), false);
      if (
        index < 0 ||
        navGrid.blocked[index] ||
        navGrid.component[index] !== navGrid.mainComponent
        )
        return (
          silent || setNotice("这里被建筑、水体或封闭庭院占用，无法建立营地"),
          false
        );
      if (
        g.sites.some(
          (site) =>
            !site.destroyed &&
            Math.hypot(site.x - point.x, site.z - point.z) < 2.2,
        )
      )
        return (silent || setNotice("营地距离现有据点过近"), false);
      const nearbyPku = g.units.filter(
          (unit) =>
            unit.team === campTeam &&
            Math.hypot(unit.x - point.x, unit.z - point.z) < 4.5,
        ).length,
        nearbyEnemy = g.units.some(
          (unit) =>
            unit.team !== campTeam &&
            Math.hypot(unit.x - point.x, unit.z - point.z) < 5,
        );
      if ((!silent && nearbyPku < 3) || nearbyEnemy)
        return (
          silent || setNotice(
            `需要附近至少3名${campTeam === "pku" ? "北大" : g.campaign.thuFactionName}学生，且5格内没有${campTeam === "pku" ? g.campaign.thuFactionName : "北大"}部队`,
          ),
          false
        );
      const id = g.campaign.nextSiteId++,
        name = `临时营地 ${activeCamps.length + 1}`,
        camp: SiteState = {
          id,
          name,
          displayName: name,
          team: campTeam,
          x: point.x,
          z: point.z,
          navX: point.x,
          navZ: point.z,
          type: "camp",
          stance: "guard",
          supply: 45,
          temporary: true,
          dispatchRatio: 0.65,
        };
      g.resources[campTeam] -= 80;
      g.sites.push(camp);
      rebuildBuildings();
      if (!silent) {
        setSelected(id);
        setRenameDraft(name);
      }
      if (!silent && !g.campaign.firedEvents.includes("first_camp")) {
        g.campaign.firedEvents.push("first_camp");
        pushEvent({ id: "first_camp", ...EVENT_CARDS.first_camp });
      }
      if (!silent)
        setNotice(
          "临时营地已建立；可在多目标兵线中把它作为绕行中继，敌军攻克后会直接拆除",
        );
      return true;
    };
    const selectedCentroid = () => {
      const units = gameRef.current.units.filter((unit) =>
        selectedUnitIds.has(unit.id),
      );
      if (!units.length) return null;
      const x = units.reduce((sum, unit) => sum + unit.x, 0) / units.length,
        z = units.reduce((sum, unit) => sum + unit.z, 0) / units.length;
      return new THREE.Vector3(x, terrainHeight(regionForX(x), x, z) + 1.35, z);
    };
    let hoveredSiteId: number | null = null,
      hoveredRoadName = "";
    const setHoveredSite = (siteId: number | null) => {
      if (hoveredSiteId != null) {
        const previous = siteObjects.get(hoveredSiteId)?.userData
          .hoverHighlight as THREE.Object3D | undefined;
        if (previous) previous.visible = false;
      }
      hoveredSiteId = siteId;
      if (siteId != null) {
        const next = siteObjects.get(siteId)?.userData.hoverHighlight as
          THREE.Object3D | undefined;
        if (next) next.visible = true;
      }
    };
    const issueTouchRoute = (targetId: number) => {
      const sourceId = touchRouteSourceId;
      touchRouteSourceId = null;
      if (sourceId == null || !canIssuePlayerCommandRef.current()) return false;
      if (sourceId === targetId) {
        setNotice("已取消点选调兵");
        return false;
      }
      const source = gameRef.current.sites[sourceId],
        target = gameRef.current.sites[targetId];
      if (
        !source ||
        !target ||
        source.destroyed ||
        target.destroyed ||
        source.team !== playerTeamRef.current
      )
        return false;
      if (target.team !== playerTeamRef.current && !gameRef.current.campaign.warUnlocked) {
        setNotice("8月19日前尚未开放交战：可以增援友方据点");
        return false;
      }
      const { deployed, configured } = configureRouteChain(
        playerTeamRef.current,
        source,
        [target],
      );
      setNotice(
        configured
          ? deployed
            ? `${source.displayName ?? source.name} → ${target.displayName ?? target.name}：${deployed}名学生出发`
            : `已建立持续兵线；后续可调兵力会自动前往${target.displayName ?? target.name}`
          : "未找到可行路径，兵线建立失败",
      );
      setSelected(null);
      return configured > 0;
    };
    renderer.domElement.addEventListener("pointerdown", (e) => {
      hideCommandLabels();
      setCampContext(null);
      if (e.button === 0) {
        setRay(e);
        const alertHit = ray.intersectObjects(
            battleAlertGroup.children,
            false,
          )[0],
          alertId = alertHit?.object.userData.battleAlertId as
            number | undefined;
        if (alertId != null) {
          const alert = gameRef.current.campaign.battleAlerts?.find(
            (candidate) => candidate.id === alertId,
          );
          if (alert) alert.seen = true;
          const sprite = battleAlertObjects.get(alertId);
          if (sprite) battleAlertGroup.remove(sprite);
          battleAlertObjects.delete(alertId);
          setNotice("已查看这处交战记录");
          return;
        }
      }
      if (e.button === 2) {
        rightGesture = {
          x: e.clientX,
          y: e.clientY,
          moved: false,
        };
        down = null;
        return;
      }
      const site = hitSite(e),
        sourceSite = hitSiteNode(e, 0.9),
        screenUnit = site == null ? hitFriendlyUnitOnScreen(e) : undefined,
        selection = !!screenUnit && selectedUnitIds.has(screenUnit.id),
        eraseLines = e.shiftKey,
        tool = activeToolMode === "simplify-lines" && !eraseLines,
        multiRoute = activeToolMode === "multi-route" && !eraseLines;
      down = {
        x: e.clientX,
        y: e.clientY,
        site,
        sourceSite,
        selection,
        tool,
        multiRoute,
        eraseLines,
        erasedLines: eraseLines ? new Set<number>() : undefined,
        routeTargets: sourceSite != null && multiRoute ? [] : undefined,
      };
      if (site == null) setSelected(null);
      if (sourceSite != null || selection || tool || eraseLines) {
        controls.enabled = false;
        renderer.domElement.setPointerCapture(e.pointerId);
      }
    });
    renderer.domElement.addEventListener("pointermove", (e) => {
      if (rightGesture && (e.buttons & 2) !== 0) {
        if (
          Math.hypot(e.clientX - rightGesture.x, e.clientY - rightGesture.y) > 7
        )
          rightGesture.moved = true;
        return;
      }
      if (!down) {
        updateCommandLabelHover(e);
        if (realCampus && !mobileClient && hitSite(e) == null) {
          const point = groundAt(e), road = point ? namedRoadAt(point.x, point.z) : undefined;
          if (road && road.name !== hoveredRoadName) {
            hoveredRoadName = road.name;
            setNotice(`${road.name} · ${road.kind} · 2026真实校园`);
          } else if (!road) hoveredRoadName = "";
        }
        return;
      }
      hideCommandLabels();
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) < 8) return;
      if (down.eraseLines) {
        const sourceId = commandSourceAt(e);
        if (
          sourceId != null &&
          !down.erasedLines?.has(sourceId) &&
          removeCommandLine(sourceId)
        ) {
          down.erasedLines?.add(sourceId);
          setNotice("Shift左键擦除经过的兵线");
        }
        return;
      }
      if (down.tool) {
        const sourceId = commandSourceAt(e);
        if (sourceId != null) simplifyCommandChain(sourceId);
        return;
      }
      const p = groundAt(e);
      if (!p) return;
      if (previewLine) {
        commandGroup.remove(previewLine);
        disposeCommandObject(previewLine);
      }
      if (down.selection) {
        const hovered = hitSite(e);
        setHoveredSite(hovered ?? null);
        const center = selectedCentroid();
        if (!center) return;
        const target = hovered != null ? gameRef.current.sites[hovered] : null;
        previewLine = addCommandLine(
          center,
          target ? siteNodeWorldPosition(target) : p.clone(),
          true,
        );
        return;
      }
      if (down.sourceSite == null) return;
      const s = gameRef.current.sites[down.sourceSite];
      if (!s) return;
      const hovered = hitSite(e);
      if (
        down.multiRoute &&
        hovered != null &&
        hovered !== down.sourceSite
      ) {
        const targets = down.routeTargets ?? (down.routeTargets = []),
          previous = targets.at(-2);
        if (previous === hovered) targets.pop();
        else if (targets.at(-1) !== hovered && !targets.includes(hovered))
          targets.push(hovered);
      }
      const previewTargets = down.multiRoute ? down.routeTargets ?? [] : [],
        finalPreviewSite =
          hovered != null && hovered !== down.sourceSite
            ? gameRef.current.sites[hovered]
            : null,
        intermediatePreviewPath = previewTargets
          .slice(0, finalPreviewSite ? -1 : undefined)
          .map((id) => gameRef.current.sites[id])
          .filter(Boolean)
          .map((site) => [site.navX ?? site.x, site.navZ ?? site.z] as [number, number]);
      setHoveredSite(
        hovered != null && hovered !== down.sourceSite ? hovered : null,
      );
      previewLine = addCommandLine(
        siteNodeWorldPosition(s),
        finalPreviewSite ? siteNodeWorldPosition(finalPreviewSite) : p.clone(),
        true,
        true,
        0,
        intermediatePreviewPath,
      );
    });
    renderer.domElement.addEventListener("pointerup", (e) => {
      if (!down) return;
      controls.enabled = true;
      if (renderer.domElement.hasPointerCapture(e.pointerId))
        renderer.domElement.releasePointerCapture(e.pointerId);
      if (previewLine) {
        commandGroup.remove(previewLine);
        disposeCommandObject(previewLine);
        previewLine = null;
      }
      setHoveredSite(null);
      const end = hitSite(e),
        moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8;
      if (down.tool || down.eraseLines) {
        down = null;
        return;
      }
      if (!canIssuePlayerCommandRef.current()) { down = null; return; }
      if (!moved && touchRouteSourceId != null && down.site != null) {
        issueTouchRoute(down.site);
        down = null;
        return;
      }
      if (moved && down.selection) {
        const target = end != null ? gameRef.current.sites[end] : null,
          point = groundAt(e),
          center = selectedCentroid();
        if (
          target &&
          target.team !== playerTeamRef.current &&
          !gameRef.current.campaign.warUnlocked
        ) {
          setNotice(
            `8月19日前可自由调兵，但不能向${playerTeamRef.current === "pku" ? "清华" : "北大"}据点发起进攻`,
          );
          down = null;
          return;
        }
        if (point && center) {
          const destinationX = target?.navX ?? point.x,
            destinationZ = target?.navZ ?? point.z,
            path = isRemoteGuest() ? [[destinationX, destinationZ] as [number, number]] : findPath(center.x, center.z, destinationX, destinationZ);
          if (path.length) {
            const selectedUnits = gameRef.current.units.filter(
              (unit) =>
                unit.team === playerTeamRef.current &&
                selectedUnitIds.has(unit.id),
            );
            selectedUnits.forEach((unit, index) => {
              const personalX =
                  destinationX + ((index % 7) - 3) * 0.12,
                personalZ =
                  destinationZ +
                  ((Math.floor(index / 7) % 7) - 3) * 0.12;
              unit.targetSiteId = target?.id;
              unit.path = clonePath(path);
              unit.pathIndex = 0;
              unit.tx = personalX;
              unit.tz = personalZ;
              if (isRemoteGuest()) return;
              void findPathInWorker(unit.x, unit.z, personalX, personalZ)
                .then((personalPath) => {
                  if (
                    !personalPath.length ||
                    unit.targetSiteId !== target?.id ||
                    Math.hypot(unit.tx - personalX, unit.tz - personalZ) > 0.05 ||
                    !gameRef.current.units.includes(unit)
                  )
                    return;
                  const destination = personalPath.at(-1)!;
                  unit.path = personalPath;
                  unit.pathIndex = 0;
                  unit.tx = destination[0];
                  unit.tz = destination[1];
                })
                .catch(() => {
                  // Keep using the shared corridor when a worker fails.
                });
            });
            const people = selectedUnits.reduce(
              (sum, unit) => sum + unit.strength,
              0,
            );
            playerCommandSenderRef.current({ unitIds: selectedUnits.map(u => u.id) });
            setNotice(
              target
                ? `已命令 ${people} 名学生${target.team === playerTeamRef.current ? "支援" : "进攻"}${target.displayName ?? target.name}`
                : `已调动 ${people} 名学生`,
            );
          } else setNotice("目标位置无法到达，调兵命令未执行");
        }
        setSelected(null);
        down = null;
        return;
      }
      if (!moved && down.site != null) {
        setSelected(down.site);
        const site = gameRef.current.sites[down.site];
        setRenameDraft(site?.displayName ?? site?.name ?? "");
      }
      if (realCampus && !moved && down.site == null) {
        const point = groundAt(e), feature = point ? obstaclesAt(point.x, point.z).find(area=>area.name) : undefined, road = point && !feature ? namedRoadAt(point.x, point.z) : undefined;
        if (feature?.name)
          setNotice(`${feature.name} · 2026真实校园 · ${feature.osmKey ?? "校园资料"}`);
        else if(road) setNotice(`${road.name} · ${road.kind} · 2026真实校园`);
      }
      if (
        moved &&
        down.sourceSite != null &&
        end != null &&
        end !== down.sourceSite
      ) {
        const source = gameRef.current.sites[down.sourceSite],
          targetIds = down.multiRoute ? [...(down.routeTargets ?? [])] : [];
        if (targetIds.at(-1) !== end && !targetIds.includes(end))
          targetIds.push(end);
        const targets = targetIds
            .map((id) => gameRef.current.sites[id])
            .filter((site): site is SiteState => !!site && !site.destroyed),
          target = targets[0] ?? gameRef.current.sites[end];
        if (source.team === playerTeamRef.current) {
          if (
            targets.some((candidate) => candidate.team !== playerTeamRef.current) &&
            !gameRef.current.campaign.warUnlocked
          ) {
            setNotice("8月19日前尚未开放交战：可以自由调兵或增援友方据点");
            down = null;
            return;
          }
          const { deployed: troops, configured } = configureRouteChain(
            playerTeamRef.current,
            source,
            targets,
          );
          setNotice(
            isRemoteGuest() ? "兵线命令已发送给服务器" : configured > 1
              ? `已建立包含${configured}段的多目标兵线；${troops}名学生开始执行`
              : troops
                ? `${source.displayName ?? source.name} → ${target.displayName ?? target.name}：${troops}名学生出发`
                : source.orderTarget === target.id
                  ? `已建立 ${source.displayName ?? source.name} → ${target.displayName ?? target.name} 持续兵线；当前无可调动兵力，后续新兵会自动输送`
                : `未找到可行路径，兵线建立失败`,
          );
          setSelected(null);
        } else setNotice("只能从己方控制的据点发出命令");
      }
      down = null;
    });
    renderer.domElement.addEventListener("pointercancel", (e) => {
      controls.enabled = true;
      if (renderer.domElement.hasPointerCapture(e.pointerId))
        renderer.domElement.releasePointerCapture(e.pointerId);
      if (previewLine) {
        commandGroup.remove(previewLine);
        disposeCommandObject(previewLine);
        previewLine = null;
      }
      setHoveredSite(null);
      down = null;
    });
    renderer.domElement.addEventListener("pointerleave", hideCommandLabels);
    renderer.domElement.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (rightGesture?.moved) {
        rightGesture = null;
        return;
      }
      const sourceId = commandSourceAt(e);
      if (sourceId != null) {
        const source = gameRef.current.sites[sourceId];
        rightGesture = null;
        if (!source) return;
        removeCommandLine(sourceId);
        setNotice(`已右键取消 ${source.displayName ?? source.name} 的持续兵线`);
        return;
      }
      const point = groundAt(e);
      rightGesture = null;
      if (!point) return;
      setSelected(null);
      setCampContext({
        x: e.clientX,
        y: e.clientY,
        worldX: point.x,
        worldZ: point.z,
      });
    });
    renderer.domElement.addEventListener("dblclick", (e) => {
      const screenUnit = hitFriendlyUnitOnScreen(e),
        point = screenUnit ? null : groundAt(e),
        centerX = screenUnit?.x ?? point?.x,
        centerZ = screenUnit?.z ?? point?.z;
      const nearby = centerX != null && centerZ != null
        ? gameRef.current.units.filter(
            (unit) =>
              unit.team === playerTeamRef.current &&
              Math.hypot(unit.x - centerX, unit.z - centerZ) < 2.6,
          )
        : [];
      if (nearby.some((unit) => selectedUnitIds.has(unit.id))) {
        selectedUnitIds.clear();
      } else {
        selectedUnitIds.clear();
        nearby.forEach((unit) => selectedUnitIds.add(unit.id));
      }
      refreshUnitSelection();
      setSelected(null);
      const selectedPeople = gameRef.current.units
        .filter((unit) => selectedUnitIds.has(unit.id))
        .reduce((sum, unit) => sum + unit.strength, 0);
      setNotice(
        selectedPeople
          ? `已选中附近 ${selectedPeople} 名${playerTeamRef.current === "pku" ? "北大" : gameRef.current.campaign.thuFactionName}学生；再次双击可释放控制`
          : nearby.length
            ? `已释放对这批${playerTeamRef.current === "pku" ? "北大" : gameRef.current.campaign.thuFactionName}学生的控制`
            : `附近没有可选中的${playerTeamRef.current === "pku" ? "北大" : gameRef.current.campaign.thuFactionName}学生`,
      );
    });
    const fireEvent = (
      id: string,
      apply?: () => void,
      cardOverride?: CampaignEventCardSpec,
    ) => {
        const campaign = gameRef.current.campaign;
        if (campaign.firedEvents.includes(id)) return false;
        const card =
          cardOverride ?? EVENT_CARDS[id as keyof typeof EVENT_CARDS];
        if (!card) return false;
        campaign.firedEvents.push(id);
        apply?.();
        pushEvent({ id, ...card });
        recordServerLog("system", `事件触发：${card.title}`);
        return true;
      },
      addTimedStatus = (
        id: string,
        title: string,
        team: Team,
        duration: number,
        attack: number,
        movement: number,
        morale: number,
        extra: Partial<
          Pick<
            TimedStatus,
            "production" | "defense" | "supplyUse" | "healing" | "riverMovement"
          >
        > = {},
      ) => {
        const campaign = gameRef.current.campaign;
        campaign.statuses ??= [];
        campaign.statuses = campaign.statuses.filter(
          (status) => status.id !== id,
        );
        campaign.statuses.push({
          id,
          title,
          team,
          until: campaign.elapsedHours + duration,
          attack,
          movement,
          morale,
          ...extra,
          unitIds: gameRef.current.units
            .filter((unit) => unit.team === team)
            .map((unit) => unit.id),
        });
      },
      unitStatusModifiers = (unit: UnitState) =>
        (gameRef.current.campaign.statuses ?? [])
          .filter(
            (status) => {
              if (
                status.team !== unit.team ||
                status.until <= gameRef.current.campaign.elapsedHours
              )
                return false;
              let ids = statusMembershipCache.get(status);
              if (!ids) {
                ids = new Set(status.unitIds);
                statusMembershipCache.set(status, ids);
              }
              return ids.has(unit.id);
            },
          )
          .reduce(
            (result, status) => ({
              attack: result.attack * status.attack,
              movement: result.movement * status.movement,
              morale: result.morale * status.morale,
              production: result.production * (status.production ?? 1),
              defense: result.defense * (status.defense ?? 1),
              supplyUse: result.supplyUse * (status.supplyUse ?? 1),
              healing: result.healing * (status.healing ?? 1),
              riverMovement:
                result.riverMovement * (status.riverMovement ?? 1),
            }),
            {
              attack: 1,
              movement: 1,
              morale: 1,
              production: 1,
              defense: 1,
              supplyUse: 1,
              healing: 1,
              riverMovement: 1,
            },
          ),
      nextUnitId = () =>
        gameRef.current.units.reduce(
          (max, unit) => Math.max(max, unit.id),
          -1,
        ) + 1,
      spawnUnitsAt = (
        site: SiteState,
        team: Team,
        count: number,
        attackModifier = 1,
        refresh = true,
        supply = 100,
        skin?: UnitState["skin"],
      ) => {
        let id = nextUnitId();
        const actualCount = count * 5;
        for (let i = 0; i < actualCount; i++) {
          const angle = (i / Math.max(1, actualCount)) * Math.PI * 2,
            radius = 0.48 + (i % 3) * 0.15,
            anchorX = site.navX ?? site.x,
            anchorZ = site.navZ ?? site.z;
          gameRef.current.units.push({
            id: id++,
            team,
            x: anchorX + Math.cos(angle) * radius,
            z: anchorZ + Math.sin(angle) * radius,
            tx: anchorX,
            tz: anchorZ,
            hp: 100,
            supply,
            strength: 1,
            morale: 100,
            skin,
            siteId: site.id,
            attackModifier,
          });
        }
        if (refresh) rebuildUnits();
      },
      teamPopulation = (team: Team) =>
        gameRef.current.units
          .filter((unit) => unit.team === team)
          .reduce((sum, unit) => sum + unit.strength, 0),
      boundProductionPopulation = (site: SiteState) =>
        gameRef.current.units
          .filter(
            (unit) =>
              unit.team === site.team &&
              unit.siteId === site.id &&
              unit.targetSiteId == null,
          )
          .reduce((sum, unit) => sum + unit.strength, 0),
      productionSitePopulationCap = (site: SiteState) => {
        const initialCount = Math.max(
            1,
            gameRef.current.campaign.initialProductionSites[site.team],
          ),
          teamProductionSites = gameRef.current.sites
            .filter(
              (candidate) =>
                candidate.team === site.team &&
                !candidate.destroyed &&
                (candidate.type === "dorm" || candidate.type === "dining"),
            )
            .sort((a, b) => a.id - b.id),
          rank = Math.max(
            0,
            teamProductionSites.findIndex((candidate) => candidate.id === site.id),
          ),
          base = Math.floor(
            INITIAL_PRODUCTION_POPULATION_BUDGET / initialCount,
          ),
          remainder = INITIAL_PRODUCTION_POPULATION_BUDGET % initialCount;
        return base + (rank < remainder ? 1 : 0);
      },
      teamUnitCap = (team: Team) => {
        const campaign = gameRef.current.campaign,
          initialSites = Math.max(
            1,
            team === "pku" ? campaign.initialPkuSites : campaign.initialThuSites,
          ),
          currentSites = gameRef.current.sites.filter(
            (site) => site.team === team && !site.destroyed,
          ).length;
        return Math.max(
          100,
          Math.floor(
            ((BASE_TEAM_UNIT_CAP * currentSites) / initialSites) *
              (decisionEffectsFor(campaign, team).populationCap ?? 1),
          ),
        );
      },
      hasProductionCapacity = (
        site: SiteState,
        knownTeamPopulation = teamPopulation(site.team),
      ) =>
        knownTeamPopulation < teamUnitCap(site.team) &&
        boundProductionPopulation(site) < productionSitePopulationCap(site),
      teamStatusFactor = (
        team: Team,
        key:
          | "attack"
          | "movement"
          | "morale"
          | "production"
          | "defense"
          | "supplyUse"
          | "healing"
          | "riverMovement",
      ) =>
        (gameRef.current.campaign.statuses ?? [])
          .filter(
            (status) =>
              status.team === team &&
              status.until > gameRef.current.campaign.elapsedHours,
          )
          .reduce((factor, status) => factor * (status[key] ?? 1), 1),
      productionGrowthPerHour = (team: Team) => {
        const population = teamPopulation(team);
        if (population > teamUnitCap(team) - 5) return 0;
        const dorms = gameRef.current.sites.filter(
            (site) =>
              site.team === team && site.type === "dorm" && !site.destroyed,
          ),
          dining = gameRef.current.sites.filter(
            (site) =>
              site.team === team && site.type === "dining" && !site.destroyed,
          ),
          availableDorms = dorms.filter((site) =>
            hasProductionCapacity(site, population),
          ).length,
          availableDining = dining.filter((site) =>
            hasProductionCapacity(site, population),
          ).length,
          activeDorms = Math.min(
            productionSlots(dorms.length, 0.35),
            availableDorms,
          ),
          activeDining = Math.min(
            productionSlots(dining.length, 0.4),
            availableDining,
          );
        const modifier =
          teamStatusFactor(team, "production") *
          (decisionEffectsFor(gameRef.current.campaign, team).production ?? 1);
        return ((activeDorms * 5) / 6 + (activeDining * 5) / 12) * modifier;
      },
      applyCalendarEvent = (definition: (typeof CALENDAR_EVENTS)[number]) => {
        const targets: Team[] =
            definition.team === "both"
              ? ["pku", "thu"]
              : [definition.team as Team],
          duration = definition.effects.durationHours ?? 168;
        return fireEvent(
          definition.id,
          () => {
            let spawned = false;
            for (const team of targets) {
              if (definition.effects.resources)
                gameRef.current.resources[team] += definition.effects.resources;
              if (definition.effects.spawn) {
                const sites = gameRef.current.sites.filter(
                  (site) =>
                    site.team === team &&
                    !site.destroyed &&
                    (site.type === "dorm" || site.type === "gate"),
                );
                if (sites.length) {
                  const squads = Math.max(
                    1,
                    Math.ceil(definition.effects.spawn / 5),
                  );
                  for (let i = 0; i < squads; i++)
                    spawnUnitsAt(sites[i % sites.length], team, 1, 1, false);
                  spawned = true;
                }
              }
              addTimedStatus(
                `calendar_${definition.id}_${team}`,
                definition.title,
                team,
                duration,
                definition.effects.attack ?? 1,
                definition.effects.movement ?? 1,
                definition.effects.morale ?? 1,
                {
                  production: definition.effects.production,
                  defense: definition.effects.defense,
                  supplyUse: definition.effects.supplyUse,
                  healing: definition.effects.healing,
                  riverMovement: definition.effects.riverMovement,
                },
              );
              if ((definition.effects.healing ?? 1) > 1)
                gameRef.current.units
                  .filter((unit) => unit.team === team)
                  .forEach(
                    (unit) =>
                      (unit.hp = Math.min(
                        100,
                        unit.hp + 25 * ((definition.effects.healing ?? 1) - 1),
                      )),
                  );
              if (
                definition.id.includes("opening_ceremony") ||
                definition.id === "pku_degree_committee"
              ) {
                const active = gameRef.current.campaign.decisions.active[team];
                if (active)
                  active.completesAt = Math.max(
                    gameRef.current.campaign.elapsedHours,
                    active.completesAt - 24,
                  );
              }
            }
            if (spawned) rebuildUnits();
          },
          {
            title: definition.title,
            body: definition.body,
            effect: definition.effect,
            quadrant:
              definition.team === "pku"
                ? "lake"
                : definition.team === "thu"
                  ? "march"
                  : "arrival",
            date: `${definition.sourceType === "annual_activity" ? "年度活动窗口 · " : ""}${new Date(definition.startISO).toLocaleDateString("zh-CN", {
              timeZone: "Asia/Shanghai",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}`,
            image: definition.image,
            sourceType: definition.sourceType,
            sourceUrl: definition.sourceUrl,
          },
        );
      },
      applyTacticalEvent = (definition: TacticalEventDefinition) => {
        let targets: Team[] =
          definition.team === "both"
            ? ["pku", "thu"]
            : [definition.team as Team];
        if (
          definition.id === "catchup_alumni_return" &&
          definition.team === "both"
        ) {
          const pkuSites = gameRef.current.sites.filter(
              (site) => site.team === "pku" && !site.destroyed,
            ).length,
            thuSites = gameRef.current.sites.filter(
              (site) => site.team === "thu" && !site.destroyed,
            ).length;
          targets = [pkuSites <= thuSites ? "pku" : "thu"];
        }
        return fireEvent(
          definition.id,
          () => {
            let spawned = false;
            for (const team of targets) {
              if (definition.effects.resources)
                gameRef.current.resources[team] += definition.effects.resources;
              if (definition.effects.spawn) {
                const sites = gameRef.current.sites.filter(
                  (site) =>
                    site.team === team &&
                    !site.destroyed &&
                    (site.type === "dorm" || site.type === "gate"),
                );
                for (
                  let i = 0;
                  i < Math.ceil(definition.effects.spawn / 5) && sites.length;
                  i++
                )
                  spawnUnitsAt(sites[i % sites.length], team, 1, 1, false);
                spawned ||= !!sites.length;
              }
              addTimedStatus(
                `tactical_${definition.id}_${team}`,
                definition.title,
                team,
                definition.effects.durationHours ?? 168,
                definition.effects.attack ?? 1,
                definition.effects.movement ?? 1,
                definition.effects.morale ?? 1,
                {
                  production: definition.effects.production,
                  defense: definition.effects.defense,
                  supplyUse: definition.effects.supplyUse,
                  healing: definition.effects.healing,
                  riverMovement: definition.effects.riverMovement,
                },
              );
              if ((definition.effects.healing ?? 1) > 1)
                gameRef.current.units
                  .filter((unit) => unit.team === team)
                  .forEach(
                    (unit) =>
                      (unit.hp = Math.min(
                        100,
                        unit.hp + 25 * ((definition.effects.healing ?? 1) - 1),
                      )),
                  );
            }
            if (spawned) rebuildUnits();
          },
          {
            title: definition.title,
            body: definition.body,
            effect: definition.effect,
            quadrant:
              definition.team === "pku"
                ? "lake"
                : definition.team === "thu"
                  ? "march"
                  : "classroom",
            date: "战况触发",
            image: definition.image,
            sourceType: definition.sourceType,
            sourceUrl: definition.sourceUrl,
          },
        );
      },
      setOutcome = (winner: Team, reason: string) => {
        const campaign = gameRef.current.campaign;
        if (campaign.outcome) return;
        campaign.outcome = {
          winner,
          reason,
          atHour: campaign.elapsedHours,
        };
        recordServerLog(
          "battle",
          `战役结果：${winner === "pku" ? "北大" : campaign.thuFactionName}胜利，${reason}`,
        );
        setVictoryBroadcast({
          winner,
          title:
            winner === "pku"
              ? "胜利广播：北大全面胜利"
              : `胜利广播：${campaign.thuFactionName}全面胜利`,
          body:
            winner === "pku"
              ? `${reason}，战役结果正式记为北大胜利；地图仍可继续游玩。`
              : `${reason}，战役结果正式记为${campaign.thuFactionName}胜利；地图仍可继续游玩。`,
        });
      };
    const resilientTasks = new Map<
        number,
        { callback: () => void; interval: number; nextAt: number }
      >(),
      resilientSetInterval = (callback: () => void, interval: number) => {
        const id = window.setInterval(() => {
          if (
            dedicatedServerHostRef.current &&
            document.visibilityState === "hidden"
          )
            return;
          callback();
          const task = resilientTasks.get(id);
          if (task) task.nextAt = performance.now() + interval;
        }, interval);
        resilientTasks.set(id, {
          callback,
          interval,
          nextAt: performance.now() + interval,
        });
        return id;
      },
      resilientClearInterval = (id: number) => {
        window.clearInterval(id);
        resilientTasks.delete(id);
      },
      parkBikeAtSite = (unit: UnitState, site: SiteState) => {
        if (unit.transport !== "bike") return;
        const model = unit.transportModel;
        unit.transport = undefined;
        unit.transportGroupId = undefined;
        unit.transportModel = undefined;
        unit.transportOutsidePenalty = false;
        if (!model || RESEARCH_DEFINITIONS[model].category !== "bike") return;
        const campaign = gameRef.current.campaign;
        campaign.research.stockpile[unit.team][model] += 1;
        site.bikeCooldownUntil = Math.max(
          site.bikeCooldownUntil ?? 0,
          campaign.elapsedHours + RESEARCH_DEFINITIONS[model].cooldownHours,
        );
      };
    let combatPulse = 0,
      lastCombatParticleAt = 0,
      lastBattleAlertAt = 0;
    const combatTimer = resilientSetInterval(() => {
      if (kernelOwnsSimulation) return;
      if (screenRef.current === "home" || pauseOpenRef.current) return;
      if (lanChannelsRef.current.size && !lanHostRef.current) return;
      if (
        dedicatedServerHostRef.current &&
        lanChannelIdentityRef.current.size === 0
      )
        return;
      const g = gameRef.current,
        now = performance.now(),
        combatTimeScale = THREE.MathUtils.clamp(timeScaleRef.current, 0.5, 64),
        used = new Set<number>(),
        dead = new Set<number>();
      let ordersChanged = false;
      combatPulse++;
      refreshDynamicUnitIndex();
      const aliveByTeam = { pku: 0, thu: 0 };
      for (const unit of g.units) aliveByTeam[unit.team]++;
      const combatStride =
          g.units.length >= 2400 ? 3 : g.units.length >= 1600 ? 2 : 1,
        effectiveCombatScale = combatTimeScale * combatStride;
      const activeSitesByTeam: Record<Team, SiteState[]> = {
        pku: [],
        thu: [],
      };
      for (const site of g.sites)
        if (!site.destroyed) activeSitesByTeam[site.team].push(site);
      const emitCombatFeedback = (x: number, z: number) => {
        if (
          now - lastCombatParticleAt >=
            activeQualityProfile.combatParticleIntervalMs &&
          combatEffects.length < activeQualityProfile.combatParticles
        ) {
          spawnCombatEffect(x, z);
          lastCombatParticleAt = now;
        }
        if (now - lastBattleAlertAt >= 1400) {
          addBattleAlert(x, z);
          lastBattleAlertAt = now;
        }
      };
      const aggregateCombat = g.campaign.warUnlocked && g.units.length >= 900;
      if (aggregateCombat) {
        const cellSize = 2.35,
          gridOffset = (combatPulse % 2) * (cellSize / 2),
          combatCells = new Map<string, UnitState[]>();
        for (const unit of g.units) {
          if (unit.hp <= 0 || unit.retreating) continue;
          const key = `${Math.floor((unit.x + gridOffset) / cellSize)}/${Math.floor((unit.z + gridOffset) / cellSize)}`,
            bucket = combatCells.get(key);
          if (bucket) bucket.push(unit);
          else combatCells.set(key, [unit]);
        }
        const resolveAggregateGroup = (
          pku: UnitState[],
          thu: UnitState[],
          centerX: number,
          centerZ: number,
        ) => {
          if (!pku.length || !thu.length) return;
          const result = kernelResolveAggregateCombat(
            g,
            pku,
            thu,
            combatTimeScale,
            combatPulse,
          );
          for (const id of result.affectedIds) {
            used.add(id);
            unitFightingUntil.set(id, now + 320);
          }
          for (const id of result.deadIds) dead.add(id);
          emitCombatFeedback(centerX, centerZ);
        };
        for (const members of combatCells.values()) {
          const pku = members.filter((unit) => unit.team === "pku"),
            thu = members.filter((unit) => unit.team === "thu");
          if (!pku.length || !thu.length) continue;
          const centerX =
              members.reduce((sum, unit) => sum + unit.x, 0) / members.length,
            centerZ =
              members.reduce((sum, unit) => sum + unit.z, 0) / members.length;
          resolveAggregateGroup(pku, thu, centerX, centerZ);
        }
        // 建筑碰撞可能把争夺同一据点的双方隔在不同空间网格中。
        // 对已进入据点作战半径、但尚未被近身格斗处理的单位补做一次
        // 据点级范围交战，避免宿舍内部/外部两团人永久互相等待。
        const attackersBySite = new Map<number, UnitState[]>(),
          defendersBySite = new Map<number, UnitState[]>();
        for (const unit of g.units) {
          if (unit.hp <= 0 || unit.retreating || used.has(unit.id)) continue;
          if (unit.targetSiteId != null) {
            const target = g.sites[unit.targetSiteId];
            if (
              target &&
              !target.destroyed &&
              target.team !== unit.team &&
              Math.hypot(
                unit.x - (target.navX ?? target.x),
                unit.z - (target.navZ ?? target.z),
              ) < 12
            ) {
              const attackers = attackersBySite.get(target.id);
              if (attackers) attackers.push(unit);
              else attackersBySite.set(target.id, [unit]);
            }
          }
          const home = g.sites[unit.siteId];
          if (
            home &&
            !home.destroyed &&
            home.team === unit.team &&
            Math.hypot(
              unit.x - (home.navX ?? home.x),
              unit.z - (home.navZ ?? home.z),
            ) < 12
          ) {
            const defenders = defendersBySite.get(home.id);
            if (defenders) defenders.push(unit);
            else defendersBySite.set(home.id, [unit]);
          }
        }
        for (const [siteId, attackers] of attackersBySite) {
          const site = g.sites[siteId],
            defenders = (defendersBySite.get(siteId) ?? []).filter(
              (unit) => unit.team === site.team && !used.has(unit.id),
            ),
            availableAttackers = attackers.filter((unit) => !used.has(unit.id));
          if (!site || !defenders.length || !availableAttackers.length) continue;
          const pku = [...availableAttackers, ...defenders].filter(
              (unit) => unit.team === "pku",
            ),
            thu = [...availableAttackers, ...defenders].filter(
              (unit) => unit.team === "thu",
            );
          resolveAggregateGroup(
            pku,
            thu,
            site.navX ?? site.x,
            site.navZ ?? site.z,
          );
        }
      } else for (const unit of g.units) {
        if (!g.campaign.warUnlocked) break;
        if (used.has(unit.id) || unit.hp <= 0) continue;
        if ((unit.id + combatPulse) % combatStride !== 0) continue;
        let enemy: UnitState | undefined,
          best = 1.35;
        for (const candidate of unitsNearPoint(unit.x, unit.z, 1.35)) {
          if (
            candidate.team === unit.team ||
            candidate.hp <= 0 ||
            used.has(candidate.id)
          )
            continue;
          const distance = Math.hypot(
            candidate.x - unit.x,
            candidate.z - unit.z,
          );
          if (distance < best) {
            best = distance;
            enemy = candidate;
          }
        }
        if (!enemy && unit.targetSiteId != null) {
          const target = g.sites[unit.targetSiteId];
          if (
            target &&
            !target.destroyed &&
            target.team !== unit.team &&
            Math.hypot(
              unit.x - (target.navX ?? target.x),
              unit.z - (target.navZ ?? target.z),
            ) < 12
          ) {
            let nearestDefenderDistance = Number.POSITIVE_INFINITY;
            for (const candidate of unitsNearPoint(
              target.navX ?? target.x,
              target.navZ ?? target.z,
              12,
            )) {
              if (
                candidate.team !== target.team ||
                candidate.siteId !== target.id ||
                candidate.hp <= 0 ||
                used.has(candidate.id)
              )
                continue;
              const distance = Math.hypot(
                candidate.x - unit.x,
                candidate.z - unit.z,
              );
              if (distance < nearestDefenderDistance) {
                nearestDefenderDistance = distance;
                enemy = candidate;
              }
            }
          }
        }
        if (!enemy) continue;
        used.add(unit.id);
        used.add(enemy.id);
        unitFightingUntil.set(unit.id, now + 260);
        unitFightingUntil.set(enemy.id, now + 260);
        const defenseStats = (fighter: UnitState) => {
            const home = g.sites[fighter.siteId];
            if (
              !home ||
              home.destroyed ||
              home.team !== fighter.team ||
              Math.hypot(
                fighter.x - (home.navX ?? home.x),
                fighter.z - (home.navZ ?? home.z),
              ) > 2.3
            )
              return { attack: 1, taken: 1 };
            if (home.type === "gate") return { attack: 1.22, taken: 0.8 };
            if (
              home.type === "teaching" ||
              home.type === "capital" ||
              home.type === "target"
            )
              return { attack: 1.1, taken: 0.91 };
            return { attack: 1, taken: 1 };
          },
          unitDefense = defenseStats(unit),
          enemyDefense = defenseStats(enemy),
          caution =
            (g.campaign.cautionUntil ?? 0) > g.campaign.elapsedHours ? 0.9 : 1,
          morningPenalty =
            (g.campaign.morningPenaltyUntil ?? 0) > g.campaign.elapsedHours
              ? 0.72
              : 1,
          unitStatus = unitStatusModifiers(unit),
          enemyStatus = unitStatusModifiers(enemy),
          unitDecision = decisionEffectsFor(g.campaign, unit.team),
          enemyDecision = decisionEffectsFor(g.campaign, enemy.team),
          unitWaterPenalty = insideWater(unit.x, unit.z) ? 0.5 : 1,
          enemyWaterPenalty = insideWater(enemy.x, enemy.z) ? 0.5 : 1,
          unitTransport = unit.transportModel
            ? RESEARCH_DEFINITIONS[unit.transportModel]
            : undefined,
          enemyTransport = enemy.transportModel
            ? RESEARCH_DEFINITIONS[enemy.transportModel]
            : undefined,
          unitOutsidePenalty =
            unit.transportModel === "thu_purple_bike" &&
            !insideTsinghuaCampus(unit.x, unit.z),
          enemyOutsidePenalty =
            enemy.transportModel === "thu_purple_bike" &&
            !insideTsinghuaCampus(enemy.x, enemy.z),
          unitTransportAttack = unitTransport?.attackMultiplier ?? 1,
          enemyTransportAttack = enemyTransport?.attackMultiplier ?? 1,
          unitTransportDefense = unitTransport?.damageTakenMultiplier ?? 1,
          enemyTransportDefense = enemyTransport?.damageTakenMultiplier ?? 1,
          unitMorale = Math.min(
            150,
            (unit.morale ?? 100) *
              unitStatus.morale *
              (unitDecision.morale ?? 1) *
              (unitTransport?.moraleMultiplier ?? 1) *
              (unitOutsidePenalty ? unitTransport?.outsideCampusMorale ?? 1 : 1),
          ),
          enemyMorale = Math.min(
            150,
            (enemy.morale ?? 100) *
              enemyStatus.morale *
              (enemyDecision.morale ?? 1) *
              (enemyTransport?.moraleMultiplier ?? 1) *
              (enemyOutsidePenalty ? enemyTransport?.outsideCampusMorale ?? 1 : 1),
          ),
          unitPower =
            (unit.attackModifier ?? 1) *
            unitTransportAttack *
            unitWaterPenalty *
            unitStatus.attack *
            (unitDecision.attack ?? 1) *
            (0.62 + unitMorale / 250) *
            g.campaign.attackBonus[unit.team] *
            caution *
            morningPenalty *
            unitDefense.attack,
          enemyPower =
            (enemy.attackModifier ?? 1) *
            enemyTransportAttack *
            enemyWaterPenalty *
            enemyStatus.attack *
            (enemyDecision.attack ?? 1) *
            (0.62 + enemyMorale / 250) *
            g.campaign.attackBonus[enemy.team] *
            caution *
            morningPenalty *
            enemyDefense.attack;
        const unitDamage =
            (((1.25 + enemy.supply * 0.007) * enemyPower * unitDefense.taken) /
              ((unitDecision.defense ?? 1) * unitStatus.defense)) *
            unitTransportDefense *
            effectiveCombatScale,
          enemyDamage =
            (((1.25 + unit.supply * 0.007) * unitPower * enemyDefense.taken) /
              ((enemyDecision.defense ?? 1) * enemyStatus.defense)) *
            enemyTransportDefense *
            effectiveCombatScale;
        if (unit.transport === "bike") {
          unit.transport = undefined;
          unit.transportModel = undefined;
          const home = g.sites[unit.siteId];
          if (home) home.bikeCooldownUntil = g.campaign.elapsedHours + 1;
        }
        if (enemy.transport === "bike") {
          enemy.transport = undefined;
          enemy.transportModel = undefined;
          const home = g.sites[enemy.siteId];
          if (home) home.bikeCooldownUntil = g.campaign.elapsedHours + 1;
        }
        unit.hp -= unitDamage;
        enemy.hp -= enemyDamage;
        unit.morale = Math.max(0, (unit.morale ?? 100) - unitDamage * 0.72);
        enemy.morale = Math.max(0, (enemy.morale ?? 100) - enemyDamage * 0.72);
        unit.supply = Math.max(
          0,
          unit.supply -
            0.07 *
              combatTimeScale *
              unitStatus.supplyUse *
              (unitDecision.supplyUse ?? 1),
        );
        enemy.supply = Math.max(
          0,
          enemy.supply -
            0.07 *
              combatTimeScale *
              enemyStatus.supplyUse *
              (enemyDecision.supplyUse ?? 1),
        );
        if (unit.hp <= 0) dead.add(unit.id);
        if (enemy.hp <= 0) dead.add(enemy.id);
        emitCombatFeedback((unit.x + enemy.x) / 2, (unit.z + enemy.z) / 2);
      }
      for (const unit of g.units) {
        if (dead.has(unit.id) || unit.retreating) continue;
        if ((unit.id + combatPulse) % combatStride !== 0) continue;
        const status = unitStatusModifiers(unit),
          transport = unit.transportModel
            ? RESEARCH_DEFINITIONS[unit.transportModel]
            : undefined,
          outsidePenalty =
            unit.transportModel === "thu_purple_bike" &&
            !insideTsinghuaCampus(unit.x, unit.z),
          effectiveMorale = Math.min(
            150,
            (unit.morale ?? 100) *
              status.morale *
              (transport?.moraleMultiplier ?? 1) *
              (outsidePenalty ? transport?.outsideCampusMorale ?? 1 : 1),
          ),
          alive = aliveByTeam[unit.team],
          casualtyRatio =
            g.deaths[unit.team] /
            Math.max(1, g.deaths[unit.team] + alive * unit.strength),
          collapse =
            (1 - effectiveMorale / 100) * 0.58 +
            (1 - Math.max(0, unit.hp) / 100) * 0.22 +
            casualtyRatio * 0.42;
        if (collapse < 0.62) continue;
        const fallback = activeSitesByTeam[unit.team].reduce<
          SiteState | undefined
        >(
          (closest, site) =>
            !closest ||
            Math.hypot(site.x - unit.x, site.z - unit.z) <
              Math.hypot(closest.x - unit.x, closest.z - unit.z)
              ? site
              : closest,
          undefined,
        );
        if (!fallback) continue;
        unit.retreating = true;
        unit.targetSiteId = fallback.id;
        unit.path = findPath(
          unit.x,
          unit.z,
          fallback.navX ?? fallback.x,
          fallback.navZ ?? fallback.z,
        );
        unit.pathIndex = 0;
      }
      for (const unit of g.units) {
        if (used.has(unit.id)) continue;
        if (unit.targetSiteId != null) {
          const target = g.sites[unit.targetSiteId];
          if (!target) continue;
          const targetX = target.navX ?? target.x,
            targetZ = target.navZ ?? target.z,
            distance = Math.hypot(unit.x - targetX, unit.z - targetZ);
          if (target.team === unit.team && distance < 1.85) {
            unit.siteId = target.id;
            if (unit.retreating) {
              unit.retreating = false;
              unit.morale = Math.min(100, (unit.morale ?? 40) + 28);
            }
            unit.targetSiteId = undefined;
            unit.path = undefined;
            unit.pathIndex = undefined;
            parkBikeAtSite(unit, target);
            const angle = ((unit.id % 7) / 7) * Math.PI * 2;
            unit.tx = targetX + Math.cos(angle) * 0.92;
            unit.tz = targetZ + Math.sin(angle) * 0.92;
            ordersChanged = true;
          } else {
            if (!unit.path || (unit.pathIndex ?? 0) >= unit.path.length) {
              const nextPath = findPath(unit.x, unit.z, targetX, targetZ);
              if (!nextPath.length) {
                unit.path = undefined;
                unit.pathIndex = undefined;
                unit.targetSiteId = undefined;
                const home = g.sites[unit.siteId];
                unit.tx = home?.navX ?? home?.x ?? unit.x;
                unit.tz = home?.navZ ?? home?.z ?? unit.z;
                continue;
              }
              unit.path = nextPath;
              unit.pathIndex = 0;
            }
            unit.tx = targetX + ((unit.id % 5) - 2) * 0.24;
            unit.tz = targetZ + ((unit.id % 4) - 1.5) * 0.24;
          }
          continue;
        }
        let home = g.sites[unit.siteId];
        if (!home || home.destroyed) {
          home = g.sites
            .filter((site) => site.team === unit.team && !site.destroyed)
            .sort(
              (a, b) =>
                Math.hypot(a.x - unit.x, a.z - unit.z) -
                Math.hypot(b.x - unit.x, b.z - unit.z),
            )[0];
          if (!home) continue;
          unit.siteId = home.id;
          const homePath = findPath(
            unit.x,
            unit.z,
            home.navX ?? home.x,
            home.navZ ?? home.z,
          );
          unit.path = homePath;
          if (!homePath.length) {
            unit.path = undefined;
            unit.pathIndex = undefined;
            unit.tx = unit.x;
            unit.tz = unit.z;
            continue;
          }
          unit.pathIndex = 0;
        }
        const angle = ((unit.id % 7) / 7) * Math.PI * 2;
        unit.tx = (home.navX ?? home.x) + Math.cos(angle) * 0.92;
        unit.tz = (home.navZ ?? home.z) + Math.sin(angle) * 0.92;
      }
      if (ordersChanged) {
        rebuildCommandLines();
      }
      if (dead.size) {
        let selectionChanged = false;
        for (const unit of g.units) {
          if (!dead.has(unit.id)) continue;
          g.deaths[unit.team] += unit.strength;
          const mesh = unitObjects.get(unit.id);
          if (mesh) {
            unitGroup.remove(mesh);
            disposeUnitObject(mesh);
          }
          unitObjects.delete(unit.id);
          detailedUnitIds.delete(unit.id);
          unitFightingUntil.delete(unit.id);
          selectionChanged = selectedUnitIds.delete(unit.id) || selectionChanged;
        }
        g.units = g.units.filter((unit) => !dead.has(unit.id));
        if (selectionChanged) refreshUnitSelection();
      }
      for (const site of g.sites) {
        if (!g.campaign.warUnlocked) break;
        if (site.destroyed) continue;
        const siteX = site.navX ?? site.x,
          siteZ = site.navZ ?? site.z,
          nearbySiteUnits = unitsNearPoint(siteX, siteZ, 1.85);
        const attackers = nearbySiteUnits.filter(
          (unit) =>
            unit.hp > 0 &&
            unit.targetSiteId === site.id &&
            unit.team !== site.team &&
            Math.hypot(unit.x - siteX, unit.z - siteZ) < 1.55,
        );
        if (!attackers.length) continue;
        const defenders = nearbySiteUnits.filter(
          (unit) =>
            unit.hp > 0 &&
            unit.team === site.team &&
            Math.hypot(unit.x - siteX, unit.z - siteZ) < 1.85,
        );
        if (defenders.length) continue;
        const newTeam = attackers[0].team,
          oldTeam = site.team,
          plannedTargetId = site.plannedOrderTargets?.[newTeam],
          plannedPath = site.plannedOrderPaths?.[newTeam];
        if (
          site.type === "target" &&
          newTeam === "pku" &&
          !g.campaign.firedEvents.includes("qz_captured")
        ) {
          fireEvent("qz_captured", () => {
            site.team = "thu";
            site.supply = Math.max(65, site.supply);
            site.stance = "defend";
            site.dispatchRatio = 0.4;
            site.displayName = site.name;
            g.units
              .filter(
                (unit) =>
                  unit.team === "pku" &&
                  Math.hypot(unit.x - site.x, unit.z - site.z) < 6,
              )
              .forEach((unit, index) => {
                unit.team = "thu";
                unit.skin = undefined;
                unit.siteId = site.id;
                unit.targetSiteId = undefined;
                unit.path = undefined;
                unit.pathIndex = undefined;
                const angle = (index / Math.max(1, attackers.length)) * Math.PI * 2;
                unit.tx = siteX + Math.cos(angle) * 0.9;
                unit.tz = siteZ + Math.sin(angle) * 0.9;
              });
            site.orderTarget = undefined;
            site.orderPath = undefined;
            rebuildUnits();
            rebuildBuildings();
            rebuildCommandLines();
          });
          setNotice("求真书院的首次攻势被事件拦截；据点仍由清华控制");
          continue;
        }
        if (site.type === "camp") {
          site.destroyed = true;
          site.orderTarget = undefined;
          site.orderPath = undefined;
          g.sites.forEach((source) => {
            if (source.orderTarget === site.id) {
              source.orderTarget = undefined;
              source.orderPath = undefined;
            }
          });
          g.units.forEach((unit) => {
            if (unit.targetSiteId !== site.id && unit.siteId !== site.id)
              return;
            unit.targetSiteId = undefined;
            unit.path = undefined;
            unit.pathIndex = undefined;
            const fallback = g.sites
              .filter(
                (candidate) =>
                  candidate.team === unit.team &&
                  !candidate.destroyed &&
                  candidate.id !== site.id,
              )
              .sort(
                (a, b) =>
                  Math.hypot(a.x - unit.x, a.z - unit.z) -
                  Math.hypot(b.x - unit.x, b.z - unit.z),
              )[0];
            if (fallback) {
              unit.siteId = fallback.id;
              const fallbackPath = findPath(
                unit.x,
                unit.z,
                fallback.navX ?? fallback.x,
                fallback.navZ ?? fallback.z,
              );
              unit.path = fallbackPath;
              if (fallbackPath.length) {
                unit.pathIndex = 0;
                unit.tx = fallback.navX ?? fallback.x;
                unit.tz = fallback.navZ ?? fallback.z;
              } else {
                unit.path = undefined;
                unit.pathIndex = undefined;
                unit.tx = unit.x;
                unit.tz = unit.z;
              }
            } else {
              unit.tx = unit.x;
              unit.tz = unit.z;
            }
          });
          rebuildBuildings();
          rebuildCommandLines();
          setSelected(null);
          setNotice(`${site.displayName ?? site.name}已被攻克并拆除`);
          continue;
        }
        site.team = newTeam;
        site.supply = 45;
        site.stance = "standby";
        site.dispatchRatio = 1;
        const baseName = site.name.replace(
          /^北大清华园校区·|^清华燕园校区·/,
          "",
        );
        site.displayName =
          newTeam === "pku"
            ? `北大清华园校区·${baseName}`
            : `清华燕园校区·${baseName}`;
        attackers.forEach((unit, index) => {
          unit.siteId = site.id;
          unit.targetSiteId = undefined;
          unit.path = undefined;
          unit.pathIndex = undefined;
          parkBikeAtSite(unit, site);
          const angle = (index / attackers.length) * Math.PI * 2;
          unit.tx = siteX + Math.cos(angle) * 0.9;
          unit.tz = siteZ + Math.sin(angle) * 0.9;
        });
        site.orderTarget = undefined;
        site.orderPath = undefined;
        if (plannedTargetId != null) {
          site.orderTarget = plannedTargetId;
          site.orderPath = plannedPath;
          if (site.plannedOrderTargets)
            delete site.plannedOrderTargets[newTeam];
          if (site.plannedOrderPaths) delete site.plannedOrderPaths[newTeam];
        }
        if (site.type === "target" && newTeam === "pku") {
          fireEvent("qz_strategic_buff", () => {
            g.resources.pku += 120;
            g.campaign.attackBonus.pku *= 1.12;
            addTimedStatus(
              "qz_strategic_buff_status",
              "求真突破",
              "pku",
              336,
              1.12,
              1.05,
              1.15,
              { production: 1.1 },
            );
          });
        }
        if (
          (site.type === "capital" || site.name.includes("元培学院")) &&
          oldTeam === "pku" &&
          newTeam === "thu"
        ) {
          fireEvent("yuanpei_fallen", () => {
            g.resources.thu += 120;
            g.campaign.attackBonus.thu *= 1.12;
            addTimedStatus(
              "yuanpei_strategic_buff_status",
              "元培突破",
              "thu",
              336,
              1.12,
              1.05,
              1.15,
              { production: 1.1 },
            );
          });
        }
        if (plannedTargetId != null) {
          const nextTarget = g.sites[plannedTargetId];
          if (nextTarget && !nextTarget.destroyed)
            issueOrder(newTeam, site, nextTarget, Number.POSITIVE_INFINITY, true);
        }
        rebuildBuildings();
        rebuildCommandLines();
        setNotice(
          site.type === "target" && newTeam === "pku"
            ? `北京大学攻克求真书院并获得战略加成；战役继续至一方全部据点失守`
            : `${site.displayName ?? site.name}已被${newTeam === "pku" ? "北大" : g.campaign.thuFactionName}控制`,
        );
      }
    }, 120);
    const siteTouchesRoad = (site: SiteState) => {
        const centerX = site.navX ?? site.x,
          centerZ = site.navZ ?? site.z,
          center = navIndex(navGrid, centerX, centerZ);
        if (center < 0) return false;
        const gridX = center % navGrid.cols,
          gridZ = Math.floor(center / navGrid.cols);
        for (let offsetX = -3; offsetX <= 3; offsetX++)
          for (let offsetZ = -3; offsetZ <= 3; offsetZ++) {
            const x = gridX + offsetX,
              z = gridZ + offsetZ;
            if (x < 0 || z < 0 || x >= navGrid.cols || z >= navGrid.rows)
              continue;
            if (navGrid.road[z * navGrid.cols + x]) return true;
          }
        return false;
      },
      allocateTransport = (
        team: Team,
        kind: ResearchId,
        preferredSiteId?: number,
      ) => {
        const game = gameRef.current,
          campaign = game.campaign,
          definition = RESEARCH_DEFINITIONS[kind],
          isBus = definition.category === "bus",
          equipmentRequired = isBus ? 1 : definition.passengers;
        if (!hasResearch(campaign, team, kind)) return false;
        if (campaign.research.stockpile[team][kind] < equipmentRequired)
          return false;
        const peopleRequired = definition.passengers,
          sites = game.sites.filter(
            (site) =>
              site.team === team &&
              !site.destroyed &&
              (!isBus || siteTouchesRoad(site)) &&
              (isBus
                ? (site.busCooldownUntil ?? 0) <= campaign.elapsedHours
                : (site.bikeCooldownUntil ?? 0) <= campaign.elapsedHours),
          ),
          candidates = sites
            .map((site) => ({
              site,
              idle: game.units.filter(
                (unit) =>
                  unit.team === team &&
                  unit.siteId === site.id &&
                  unit.targetSiteId == null &&
                  !unit.transport &&
                  Math.hypot(
                    unit.x - (site.navX ?? site.x),
                    unit.z - (site.navZ ?? site.z),
                  ) < 3.4,
              ),
            }))
            .filter((candidate) => candidate.idle.length >= peopleRequired);
        if (!candidates.length) return false;
        let chosen =
          candidates.find(({ site }) => site.id === preferredSiteId) ??
          candidates[0];
        if (preferredSiteId == null && !isBus) {
          const totalWeight = candidates.reduce(
              (sum, candidate) => sum + candidate.idle.length,
              0,
            ),
            roll = Math.random() * totalWeight;
          let cursor = 0;
          for (const candidate of candidates) {
            cursor += candidate.idle.length;
            if (roll <= cursor) {
              chosen = candidate;
              break;
            }
          }
        } else if (preferredSiteId == null)
          chosen = candidates[Math.floor(Math.random() * candidates.length)];
        const { site, idle } = chosen;
        campaign.research.stockpile[team][kind] -= equipmentRequired;
        if (isBus) {
          const groupId = `bus-${team}-${Math.floor(campaign.elapsedHours)}-${site.id}`;
          idle.slice(0, peopleRequired).forEach((unit) => {
            unit.transport = "bus";
            unit.transportGroupId = groupId;
            unit.transportModel = kind;
          });
          site.busCooldownUntil =
            campaign.elapsedHours + definition.cooldownHours;
          campaign.research.lastBusAllocation[team] = campaign.elapsedHours;
        } else {
          idle.slice(0, peopleRequired).forEach((unit) => {
            unit.transport = "bike";
            unit.transportGroupId = undefined;
            unit.transportModel = kind;
          });
          site.bikeCooldownUntil =
            campaign.elapsedHours + definition.cooldownHours;
          campaign.research.lastBikeAllocation[team] = campaign.elapsedHours;
        }
        rebuildUnits();
        setNotice(
          `${definition.title}已配发至${site.displayName ?? site.name}，${peopleRequired}名学生进入载具状态`,
        );
        return true;
      },
      disembarkBusGroup = (groupId?: string) => {
        if (!groupId) return;
        gameRef.current.units
          .filter((unit) => unit.transportGroupId === groupId)
          .forEach((unit) => {
            unit.transport = undefined;
            unit.transportGroupId = undefined;
            unit.transportModel = undefined;
          });
      };
    const benchmarkParams = new URLSearchParams(window.location.search),
      aiBenchmarkScenario = benchmarkParams.get("ai-benchmark"),
      renderBenchmark = benchmarkParams.has("render-benchmark"),
      aiBenchmarkDifficulties = (() => {
        if (!aiBenchmarkScenario) return null;
        const result: Partial<Record<Team, AiDifficulty>> = {};
        if (aiBenchmarkScenario.includes("pku-hard")) result.pku = "hard";
        else if (aiBenchmarkScenario.includes("pku-standard"))
          result.pku = "standard";
        else if (aiBenchmarkScenario.includes("pku-casual"))
          result.pku = "casual";
        if (aiBenchmarkScenario.includes("thu-hard")) result.thu = "hard";
        else if (aiBenchmarkScenario.includes("thu-standard"))
          result.thu = "standard";
        else if (aiBenchmarkScenario.includes("thu-casual"))
          result.thu = "casual";
        if (aiBenchmarkScenario === "hard-mirror") {
          result.pku = "hard";
          result.thu = "hard";
        }
        return result;
      })(),
      aiBenchmarkDates = [
        "2026-08-19T20:00:00+08:00",
        "2026-08-22T00:00:00+08:00",
        "2026-08-25T00:00:00+08:00",
        "2026-08-29T00:00:00+08:00",
        "2026-09-02T00:00:00+08:00",
        "2026-09-04T00:00:00+08:00",
        "2026-09-06T00:00:00+08:00",
        "2026-09-10T00:00:00+08:00",
        "2026-09-16T00:00:00+08:00",
        "2026-09-26T00:00:00+08:00",
      ];
    let aiBenchmarkSamples: Record<string, unknown>[] = [],
      aiBenchmarkSampleIndex = 0,
      aiBenchmarkLastElapsed = -1,
      aiBenchmarkPreviousOwners = new Map<number, Team>();
    const publishAiBenchmark = () => {
        if (!aiBenchmarkScenario) return;
        const payload = {
          scenario: aiBenchmarkScenario,
          samples: aiBenchmarkSamples,
        };
        (
          window as unknown as {
            __qingbeiAiBenchmark: {
              scenario: string;
              samples: Record<string, unknown>[];
            };
          }
        ).__qingbeiAiBenchmark = payload;
        let output = document.getElementById("qingbei-ai-benchmark");
        if (!output) {
          output = document.createElement("script");
          output.id = "qingbei-ai-benchmark";
          output.setAttribute("type", "application/json");
          document.body.appendChild(output);
        }
        output.textContent = JSON.stringify(payload);
      },
      captureAiBenchmarkSamples = (game: GameData) => {
        if (!aiBenchmarkScenario) return;
        if (game.campaign.elapsedHours < aiBenchmarkLastElapsed) {
          aiBenchmarkSamples = [];
          aiBenchmarkSampleIndex = 0;
          aiBenchmarkPreviousOwners = new Map(
            game.sites.map((site) => [site.id, site.team]),
          );
        }
        aiBenchmarkLastElapsed = game.campaign.elapsedHours;
        const campaignStart = Date.parse(game.campaign.startDateISO);
        while (aiBenchmarkSampleIndex < aiBenchmarkDates.length) {
          const iso = aiBenchmarkDates[aiBenchmarkSampleIndex],
            sampleHour = (Date.parse(iso) - campaignStart) / 3_600_000;
          if (game.campaign.elapsedHours < sampleHour) break;
          const routeGroups = new Map<
              string,
              { sourceId: number; targetId: number; committed: number }
            >(),
            ownershipChanges: {
              site: string;
              from: Team;
              to: Team;
            }[] = [];
          for (const unit of game.units) {
            if (unit.targetSiteId == null) continue;
            const key = `${unit.siteId}>${unit.targetSiteId}`,
              existing = routeGroups.get(key);
            if (existing) existing.committed += unit.strength;
            else
              routeGroups.set(key, {
                sourceId: unit.siteId,
                targetId: unit.targetSiteId,
                committed: unit.strength,
              });
          }
          for (const site of game.sites) {
            const previous = aiBenchmarkPreviousOwners.get(site.id);
            if (previous && previous !== site.team)
              ownershipChanges.push({
                site: site.displayName ?? site.name,
                from: previous,
                to: site.team,
              });
            aiBenchmarkPreviousOwners.set(site.id, site.team);
          }
          const population = { pku: 0, thu: 0 },
            sites = { pku: 0, thu: 0 };
          for (const unit of game.units)
            population[unit.team] += unit.strength;
          for (const site of game.sites)
            if (!site.destroyed) sites[site.team]++;
          const routes = [...routeGroups.values()]
            .map(({ sourceId, targetId, committed }) => {
              const source = game.sites[sourceId],
                target = game.sites[targetId],
                sourcePath =
                  source?.orderTarget === targetId ? source.orderPath : undefined,
                path = sourcePath ??
                  game.units.find(
                    (unit) =>
                      unit.siteId === sourceId && unit.targetSiteId === targetId,
                  )?.path;
              return {
                team: source?.team,
                source: source?.displayName ?? source?.name ?? sourceId,
                target: target?.displayName ?? target?.name ?? targetId,
                targetTeam: target?.team,
                committed,
                waypoints: path?.length ?? 0,
                pathSample: path
                  ? path
                      .filter(
                        (_, index) =>
                          index === 0 ||
                          index === path.length - 1 ||
                          index % Math.max(1, Math.floor(path.length / 6)) === 0,
                      )
                      .slice(0, 8)
                  : [],
              };
            })
            .sort((a, b) => b.committed - a.committed);
          const sample = {
            iso,
            elapsedHours: game.campaign.elapsedHours,
            sites,
            population,
            deaths: { ...game.deaths },
            casualtyRatio: {
              pku: game.deaths.pku / Math.max(1, game.deaths.thu),
              thu: game.deaths.thu / Math.max(1, game.deaths.pku),
            },
            resources: { ...game.resources },
            intent: { ...(game.campaign.ai.intent ?? {}) },
            difficulty: {
              ...(game.campaign.ai.difficultyByTeam ?? {
                pku: game.campaign.ai.difficulty,
                thu: game.campaign.ai.difficulty,
              }),
            },
            ownershipChanges,
            routes,
            outcome: game.campaign.outcome ?? null,
          };
          aiBenchmarkSamples.push(sample);
          console.info(`[AI_BENCHMARK_SAMPLE]${JSON.stringify(sample)}`);
          aiBenchmarkSampleIndex++;
        }
        publishAiBenchmark();
      };
    publishAiBenchmark();
    const campaignTimer = resilientSetInterval(() => {
      if (kernelOwnsSimulation) return;
      if (screenRef.current === "home" || pauseOpenRef.current) return;
      if (lanChannelsRef.current.size && !lanHostRef.current) return;
      if (
        dedicatedServerHostRef.current &&
        lanChannelIdentityRef.current.size === 0
      )
        return;
      const g = gameRef.current,
        campaign = g.campaign,
        qz = g.sites.find(
          (site) => site.name === "求真书院" && !site.destroyed,
        ),
        yuanpei = g.sites.find(
          (site) => site.name === "元培学院（俄文楼）" && !site.destroyed,
        ),
        mathSchool = g.sites.find(
          (site) =>
            site.name === "北京大学数学科学学院（理科一号楼）" &&
            !site.destroyed,
        ),
        library = g.sites.find(
          (site) => site.name === "北京大学图书馆" && !site.destroyed,
        ),
        physics = g.sites.find(
          (site) =>
            (site.name === "北京大学物理学院" || site.name === "物理学院") &&
            !site.destroyed,
        ),
        chemistry = g.sites.find(
          (site) => site.name.includes("化学学院") && !site.destroyed,
        );
      campaign.statuses = (campaign.statuses ?? []).filter(
        (status) => status.until > campaign.elapsedHours,
      );
      const campaignNow =
          new Date(campaign.startDateISO).getTime() +
          campaign.elapsedHours * 3_600_000,
        academicYearEnd = new Date(ACADEMIC_YEAR_END_ISO).getTime();
      if (campaignNow <= academicYearEnd)
        for (const definition of CALENDAR_EVENTS) {
          const start = new Date(definition.startISO).getTime();
          if (campaignNow < start) continue;
          const newlyFired = applyCalendarEvent(definition);
          if (newlyFired && definition.id === "pku_undergrad_registration") {
            const target =
                g.units.filter((unit) => unit.team === "thu").length + 20,
              current = g.units.filter((unit) => unit.team === "pku").length,
              dorms = g.sites.filter(
                (site) =>
                  site.team === "pku" &&
                  site.type === "dorm" &&
                  !site.destroyed,
              );
            for (let i = 0; i < Math.ceil(Math.max(0, target - current) / 5); i++)
              if (dorms.length)
                spawnUnitsAt(dorms[i % dorms.length], "pku", 1, 1, false);
            rebuildUnits();
          }
        }
      for (const team of ["pku", "thu"] as Team[]) {
        const active = campaign.decisions.active[team];
        if (!active || active.completesAt > campaign.elapsedHours) continue;
        const definition = DECISIONS.find((item) => item.id === active.id);
        if (!definition) {
          campaign.decisions.active[team] = null;
          continue;
        }
        campaign.decisions.completed.push(definition.id);
        for (const excluded of definition.exclusiveWith ?? [])
          if (!campaign.decisions.locked.includes(excluded))
            campaign.decisions.locked.push(excluded);
        campaign.decisions.active[team] = null;
        setNotice(`${team === "pku" ? "北大" : campaign.thuFactionName}决策完成：${definition.title}`);
      }
      for (const team of ["pku", "thu"] as Team[]) {
        const active = campaign.research.active[team];
        if (!active || active.completesAt > campaign.elapsedHours) continue;
        if (!campaign.research.completed[team].includes(active.id))
          campaign.research.completed[team].push(active.id);
        campaign.research.active[team] = null;
        setNotice(
          `${team === "pku" ? "北大" : campaign.thuFactionName}研发完成：${RESEARCH_DEFINITIONS[active.id].title}`,
        );
      }
      for (const team of ["pku", "thu"] as Team[]) {
        const productionLines = campaign.research.production[team];
        for (const id of Object.keys(productionLines) as ResearchId[]) {
          const production = productionLines[id];
          if (!production || production.completesAt > campaign.elapsedHours)
            continue;
          const definition = RESEARCH_DEFINITIONS[id];
          campaign.research.stockpile[team][id] += definition.productionQuantity;
          if (g.resources[team] >= definition.deploymentCost) {
            g.resources[team] -= definition.deploymentCost;
            production.id = createId();
            production.startedAt = campaign.elapsedHours;
            production.completesAt = campaign.elapsedHours + definition.productionHours;
            setNotice(
              `${team === "pku" ? "北大" : campaign.thuFactionName}完成并继续生产：${definition.title} × ${definition.productionQuantity}`,
            );
          } else {
            delete productionLines[id];
            setNotice(
              `${definition.title}完成一批后因资源不足自动停产`,
            );
          }
        }
      }
      for (const team of ["pku", "thu"] as Team[])
        for (const kind of [...researchIdsForTeam(team)].reverse()) {
          if (!hasResearch(campaign, team, kind)) continue;
          if (campaign.research.stockpile[team][kind] <= 0) continue;
          const definition = RESEARCH_DEFINITIONS[kind],
            isBus = definition.category === "bus",
            last =
              isBus
                ? campaign.research.lastBusAllocation[team]
                : campaign.research.lastBikeAllocation[team];
          if (campaign.elapsedHours - last < definition.cooldownHours) continue;
          if (isBus)
            campaign.research.lastBusAllocation[team] = campaign.elapsedHours;
          else campaign.research.lastBikeAllocation[team] = campaign.elapsedHours;
          if (Math.random() < (isBus ? 0.32 : 0.62))
            allocateTransport(team, kind);
        }
      const engagementNow = performance.now(),
        fightingUnitIds = new Set(
          g.units
            .filter(
              (unit) =>
                (unitFightingUntil.get(unit.id) ?? 0) > engagementNow,
            )
            .map((unit) => unit.id),
        ),
        siteEngagedBy = (site: SiteState | undefined, attackingTeam: Team) =>
          kernelSiteEngagedBy(
            site,
            attackingTeam,
            g.units,
            fightingUnitIds,
          );
      if (campaign.warUnlocked)
        for (const definition of TACTICAL_EVENTS) {
          if (campaign.firedEvents.includes(definition.id)) continue;
          const trigger = definition.trigger,
            eventTeam = definition.team === "both" ? null : (definition.team as Team),
            siteOwned = (name: string, team: Team) =>
              g.sites.some(
                (site) => site.name === name && site.team === team && !site.destroyed,
              );
          let matches = false;
          if (trigger.type === "site_threat" && eventTeam) {
            const sites = g.sites.filter(
              (site) =>
                trigger.sites.includes(site.name) &&
                site.team === eventTeam &&
                !site.destroyed,
            );
            matches = sites.some(
              (site) =>
                g.units.filter(
                  (unit) =>
                    unit.team !== eventTeam &&
                    (unit.targetSiteId === site.id ||
                      (unitFightingUntil.get(unit.id) ?? 0) > engagementNow) &&
                    Math.hypot(
                      unit.x - (site.navX ?? site.x),
                      unit.z - (site.navZ ?? site.z),
                    ) < 12,
                ).length >= trigger.enemyCount,
            );
          } else if (trigger.type === "control_all" && eventTeam) {
            const stagger =
              96 +
              [...definition.id].reduce((sum, char) => sum + char.charCodeAt(0), 0) %
                240;
            matches =
              campaign.elapsedHours >= stagger &&
              trigger.sites.every((name) => siteOwned(name, eventTeam));
          } else if (trigger.type === "resource_low" && eventTeam) {
            matches =
              g.resources[eventTeam] < trigger.below &&
              siteOwned(trigger.site, eventTeam);
          } else if (trigger.type === "disadvantage") {
            const pkuSites = g.sites.filter(
                (site) => site.team === "pku" && !site.destroyed,
              ).length,
              thuSites = g.sites.filter(
                (site) => site.team === "thu" && !site.destroyed,
              ).length;
            matches = eventTeam
              ? (eventTeam === "pku" ? thuSites - pkuSites : pkuSites - thuSites) >=
                trigger.siteDelta
              : Math.abs(pkuSites - thuSites) >= trigger.siteDelta;
          } else if (trigger.type === "casualties") {
            matches = g.deaths.pku + g.deaths.thu >= trigger.total;
          } else if (trigger.type === "elapsed") {
            matches = campaign.elapsedHours >= trigger.hours;
          } else if (trigger.type === "core_recaptured" && eventTeam) {
            const owned = siteOwned(trigger.site, eventTeam),
              foughtThere = (campaign.battleAlerts ?? []).some((alert) => {
                const site = g.sites.find((candidate) => candidate.name === trigger.site);
                return site && Math.hypot(alert.x - site.x, alert.z - site.z) < 5;
              });
            matches = owned && foughtThere && campaign.elapsedHours > 96;
          }
          if (matches) applyTacticalEvent(definition);
        }
      if (campaignNow >= academicYearEnd && !campaign.academicYearOutcome) {
        const ratioPoints = (a: number, b: number, weight: number) =>
            a + b > 0 ? (a / (a + b)) * weight : weight / 2,
          pkuSites = g.sites.filter((site) => site.team === "pku" && !site.destroyed),
          thuSites = g.sites.filter((site) => site.team === "thu" && !site.destroyed),
          siteInfluence = (sites: SiteState[]) =>
            sites.reduce(
              (sum, site) =>
                sum +
                (site.type === "capital" || site.type === "target"
                  ? 2.2
                  : site.type === "gate"
                    ? 1.35
                    : site.type === "camp"
                      ? 0.55
                      : 1),
              0,
            ),
          pkuUnits = g.units.filter((unit) => unit.team === "pku"),
          thuUnits = g.units.filter((unit) => unit.team === "thu"),
          readiness = (units: UnitState[]) =>
            units.length
              ? units.reduce(
                  (sum, unit) =>
                    sum +
                    (unit.hp / 100 + unit.supply / 100 + (unit.morale ?? 100) / 100) /
                      3,
                  0,
                ) / units.length
              : 0,
          pkuScore =
            ratioPoints(pkuSites.length, thuSites.length, 30) +
            ratioPoints(siteInfluence(pkuSites), siteInfluence(thuSites), 20) +
            ratioPoints(pkuUnits.length, thuUnits.length, 15) +
            ratioPoints(g.deaths.thu, g.deaths.pku, 15) +
            ratioPoints(readiness(pkuUnits), readiness(thuUnits), 10) +
            ratioPoints(g.resources.pku, g.resources.thu, 10),
          thuScore = 100 - pkuScore,
          result: AcademicYearOutcome["result"] =
            Math.abs(pkuScore - thuScore) < 5
              ? "draw"
              : pkuScore > thuScore
                ? "pku"
                : "thu",
          outcome: AcademicYearOutcome = {
            atHour: campaign.elapsedHours,
            pkuScore,
            thuScore,
            result,
            summary:
              result === "draw"
                ? "一个学年过去，双方仍处于长期僵持。"
                : `${result === "pku" ? "北大" : campaign.thuFactionName}取得学年阶段优势。`,
          };
        campaign.academicYearOutcome = outcome;
        setAcademicYearBroadcast(outcome);
        pushEvent({
          id: "academic_year_epilogue",
          title: "学年结语：战线仍在延伸",
          body: outcome.summary,
          effect: `北大 ${pkuScore.toFixed(1)} 分；${campaign.thuFactionName} ${thuScore.toFixed(1)} 分。正式胜负规则保持不变，战局可以继续。`,
          quadrant: "classroom",
          date: "2027年8月15日",
          image: "events/calendar/shared_midsummer.webp",
          sourceType: "calendar",
        });
      }
      if (campaign.elapsedHours >= 0) fireEvent("thu_arrival");
      if (campaign.elapsedHours >= 35)
        fireEvent("pku_jianghuai_welcome", () => {
          g.resources.pku += 20;
          addTimedStatus("jianghuai_welcome", "江淮迎新", "pku", 48, 1, 1, 1.1);
        });
      const morningDay = Math.floor(campaign.elapsedHours / 24);
      if (morningDay > campaign.lastMorningEventDay) {
        campaign.lastMorningEventDay = morningDay;
        const morningDate = new Date(
            new Date(campaign.startDateISO).getTime() + morningDay * 86_400_000,
          ),
          weekday = morningDate.getUTCDay(),
          teamsStarted = ([
            ["pku", "2026-09-07T08:00:00+08:00"],
            ["thu", "2026-09-14T08:00:00+08:00"],
          ] as const).filter(
            ([, start]) => morningDate.getTime() >= new Date(start).getTime(),
          ),
          id = `morning_class_${morningDay}`;
        if (weekday >= 1 && weekday <= 5 && teamsStarted.length) {
          for (const [team] of teamsStarted) {
            const teamId = `${id}_${team}`;
            if (campaign.firedEvents.includes(teamId)) continue;
            campaign.firedEvents.push(teamId);
            addTimedStatus(teamId, "上早八", team, 1, 0.72, 0.68, 0.9);
          }
          if (!campaign.firedEvents.includes(id)) campaign.firedEvents.push(id);
          pushEvent({
            id,
            ...EVENT_CARDS.morning_class,
            date: `${morningDate.toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })} · 08:00`,
          });
        }
      }
      if (campaign.elapsedHours >= 24)
        fireEvent("night_mobilization", () => {
          g.resources.pku += 20;
          g.resources.thu += 20;
        });
      if (campaign.elapsedHours >= 84)
        fireEvent("war_begins", () => {
          campaign.warUnlocked = true;
        });
      if (campaign.elapsedHours >= 328)
        fireEvent("thu_morning_run", () => {
          addTimedStatus("thu_run_thu", "清华夜跑", "thu", 4, 0.9, 1.5, 1.2);
          addTimedStatus("thu_run_pku", "夜跑对峙", "pku", 4, 1.2, 1, 1.05);
          const edgeSites = g.sites
            .filter(
              (site) =>
                site.team === "thu" &&
                !site.destroyed &&
                (site.type === "gate" ||
                  Math.abs(site.x) > 18 ||
                  Math.abs(site.z) > 25),
            )
            .slice(0, 12);
          if (edgeSites.length)
            g.units
              .filter((unit) => unit.team === "thu")
              .forEach((unit, index) => {
                const target = edgeSites[(index + 1) % edgeSites.length];
                unit.targetSiteId = target.id;
                unit.path = findPath(
                  unit.x,
                  unit.z,
                  target.navX ?? target.x,
                  target.navZ ?? target.z,
                );
                unit.pathIndex = 0;
              });
        });
      const activeRun = (campaign.statuses ?? []).find(
        (status) => status.id === "thu_run_thu",
      );
      if (activeRun) {
        const edgeSites = g.sites
          .filter(
            (site) =>
              site.team === "thu" &&
              !site.destroyed &&
              (site.type === "gate" ||
                Math.abs(site.x) > 18 ||
                Math.abs(site.z) > 25),
          )
          .slice(0, 12);
        if (edgeSites.length)
          g.units
            .filter(
              (unit) =>
                unit.team === "thu" &&
                activeRun.unitIds.includes(unit.id) &&
                unit.targetSiteId == null,
            )
            .forEach((unit) => {
              const currentIndex = Math.max(
                  0,
                  edgeSites.findIndex((site) => site.id === unit.siteId),
                ),
                target = edgeSites[(currentIndex + 1) % edgeSites.length];
              unit.targetSiteId = target.id;
              unit.path = findPath(
                unit.x,
                unit.z,
                target.navX ?? target.x,
                target.navZ ?? target.z,
              );
              unit.pathIndex = 0;
            });
      }
      const thuAssaulting = (site?: SiteState) =>
        siteEngagedBy(site, "thu");
      if (campaign.warUnlocked && thuAssaulting(library))
        fireEvent("pku_librarian", () =>
          addTimedStatus("librarian", "图书管理员", "pku", 24, 1.1, 1, 1.5),
        );
      if (campaign.warUnlocked && thuAssaulting(physics))
        fireEvent("two_bombs_one_satellite", () => {
          g.units
            .filter(
              (unit) =>
                unit.team === "thu" &&
                physics &&
                Math.hypot(unit.x - physics.x, unit.z - physics.z) < 6,
            )
            .forEach((unit) => {
              unit.hp = Math.max(5, unit.hp - 68);
              unit.morale = Math.max(0, (unit.morale ?? 100) - 45);
            });
          addTimedStatus("two_bombs", "两弹一星", "pku", 24, 1, 1, 1.5);
        });
      if (campaign.warUnlocked && thuAssaulting(chemistry))
        fireEvent("chemistry_century", () => {
          g.units
            .filter(
              (unit) =>
                unit.team === "thu" &&
                chemistry &&
                Math.hypot(unit.x - chemistry.x, unit.z - chemistry.z) < 5,
            )
            .forEach((unit) => (unit.supply = Math.max(0, unit.supply - 65)));
          addTimedStatus("chemistry", "百年化学", "pku", 18, 1, 1, 1.2);
        });
      if (
        campaign.warUnlocked &&
        qz &&
        siteEngagedBy(qz, "pku")
      )
        fireEvent("qz_approach", () => {
          addTimedStatus("qz_defense", "水向下流", "thu", 24, 1, 1, 1.25);
          addTimedStatus("qz_stall", "前锋受阻", "pku", 24, 1, 1, 0.8);
          spawnUnitsAt(qz, "thu", 10, 1.15);
          campaign.freezeUntil.pku = campaign.elapsedHours + 24;
          const qzThreat = g.units.filter(
              (unit) =>
                unit.team === "pku" &&
                Math.hypot(unit.x - qz.x, unit.z - qz.z) < 10,
            ).length,
            emergencySources = g.sites
            .filter(
              (site) =>
                site.team === "thu" &&
                site.id !== qz.id &&
                !site.destroyed &&
                Math.hypot(site.x - qz.x, site.z - qz.z) < 20,
            )
            .sort(
              (a, b) => {
                const productionA =
                    a.type === "dorm" || a.type === "dining" ? 14 : 0,
                  productionB =
                    b.type === "dorm" || b.type === "dining" ? 14 : 0;
                return (
                  productionA + Math.hypot(a.x - qz.x, a.z - qz.z) -
                  productionB - Math.hypot(b.x - qz.x, b.z - qz.z)
                );
              },
            )
            .slice(0, 4);
          emergencySources.forEach((source) =>
            spawnUnitsAt(source, "thu", 2, 1.05, false),
          );
          rebuildUnits();
          emergencySources.forEach((source) => {
            source.stance = "guard";
            source.dispatchRatio = 0.72;
            const deployed = issueOrder(
              "thu",
              source,
              qz,
              Math.max(2, Math.ceil(qzThreat / Math.max(1, emergencySources.length))),
              false,
            );
            if (deployed) {
              source.orderTarget = undefined;
              source.orderPath = undefined;
            }
          });
        });
      const pkuSites = g.sites.filter(
          (site) => site.team === "pku" && !site.destroyed,
        ).length,
        thuSites = g.sites.filter(
          (site) => site.team === "thu" && !site.destroyed,
        ).length;
      if (campaign.warUnlocked && pkuSites > thuSites + 3)
        fireEvent("pku_advantage", () => {
          g.units
            .filter(
              (unit) =>
                unit.team === "pku" &&
                qz &&
                Math.hypot(unit.x - qz.x, unit.z - qz.z) < 18,
            )
            .forEach(
              (unit) =>
                (unit.attackModifier = (unit.attackModifier ?? 1) * 0.9),
            );
        });
      if (
        campaign.warUnlocked &&
        yuanpei &&
        siteEngagedBy(yuanpei, "thu")
      )
        fireEvent("yuanpei_attack", () => {
          addTimedStatus("freedom", "为了自由", "pku", 24, 1.25, 1, 1.35);
          spawnUnitsAt(yuanpei, "pku", 10, 1.25);
          g.units
            .filter(
              (unit) =>
                unit.team === "pku" &&
                Math.hypot(unit.x - yuanpei.x, unit.z - yuanpei.z) < 10,
            )
            .forEach((unit) => {
              unit.attackModifier = Math.max(1.25, unit.attackModifier ?? 1);
              if (unit.targetSiteId == null) {
                unit.targetSiteId = yuanpei.id;
                unit.path = findPath(unit.x, unit.z, yuanpei.x, yuanpei.z);
                unit.pathIndex = 0;
              }
            });
        });
      if (
        campaign.warUnlocked &&
        mathSchool &&
        siteEngagedBy(mathSchool, "thu")
      )
        fireEvent("double_fei", () => {
          addTimedStatus(
            "double_fei_status",
            "双菲学校",
            "thu",
            18,
            0.5,
            0.5,
            0.75,
          );
          if (!qz) return;
          g.units
            .filter(
              (unit) =>
                unit.team === "thu" &&
                Math.hypot(unit.x - qz.x, unit.z - qz.z) < 14,
            )
            .forEach((unit) => {
              unit.attackModifier = (unit.attackModifier ?? 1) * 0.5;
              unit.moveModifier = (unit.moveModifier ?? 1) * 0.5;
            });
        });
      if (
        campaign.warUnlocked &&
        g.units.some(
          (unit) =>
            unit.team === "thu" &&
            Math.hypot(unit.x + 29.413, unit.z - 18.145) < 6,
        )
      )
        fireEvent("lake_awakened", () => {
          campaign.attackBonus.pku *= 1.15;
          addTimedStatus("lake_morale", "胸中未名水", "pku", 24, 1, 1, 1.25);
        });
      if (g.deaths.pku + g.deaths.thu > 0)
        fireEvent("first_blood", () => {
          campaign.cautionUntil = campaign.elapsedHours + 12;
          addTimedStatus("first_blood_pku", "伤亡震动", "pku", 12, 0.9, 1, 0.9);
          addTimedStatus("first_blood_thu", "伤亡震动", "thu", 12, 0.9, 1, 0.9);
        });
      if (thuSites * 2 < (campaign.initialThuSites ?? 80))
        fireEvent("thu_ustc", () => {
          campaign.thuFactionName = "中科大";
          busMaterials.thu.color.set(0x2879bd);
          bikeMaterials.thu.color.set(0x4aa4df);
          campaign.attackBonus.thu *= 1.12;
          addTimedStatus(
            "ustc_transition_bonus",
            "科大化整编",
            "thu",
            24 * 365,
            1.12,
            1.1,
            1.25,
            { production: 1.15, defense: 1.1 },
          );
          g.units
            .filter((unit) => unit.team === "thu" && !unit.skin)
            .forEach((unit) => (unit.skin = "ustc"));
          g.sites
            .filter((site) => site.team === "thu" && !site.destroyed)
            .forEach(
              (site) => (site.displayName = `中科大清华园校区·${site.name}`),
            );
          rebuildUnits();
          rebuildBuildings();
        });
      const deployExternalTeam = (
        skin: NonNullable<UnitState["skin"]>,
        label: string,
        people: number,
        attack: number,
        morale: number,
        useBus = false,
      ) => {
        const pkuPeople = teamPopulation("pku"),
          thuPeople = teamPopulation("thu"),
          ally: Team = pkuPeople <= thuPeople ? "pku" : "thu",
          enemy: Team = ally === "pku" ? "thu" : "pku",
          candidateSites = g.sites.filter(
            (site) =>
              site.team === ally &&
              !site.destroyed &&
              (!useBus || siteTouchesRoad(site)),
          ),
          border = candidateSites.sort((a, b) => b.x - a.x)[0];
        if (!border) return;
        const firstId = nextUnitId();
        border.displayName = `${label}·${border.name}`;
        spawnUnitsAt(border, ally, Math.ceil(people / 5), attack, false, 130, skin);
        const guests = g.units.filter((unit) => unit.id >= firstId);
        guests.forEach((unit) => (unit.morale = morale));
        if (useBus) {
          const groupId = `${skin}-bus-${Math.floor(campaign.elapsedHours)}`;
          guests.slice(0, people).forEach((unit) => {
            unit.transport = "bus";
            unit.transportGroupId = groupId;
            unit.transportModel = "bus";
          });
        }
        const target = g.sites
          .filter((site) => site.team === enemy && !site.destroyed)
          .sort(
            (a, b) =>
              Math.hypot(a.x - border.x, a.z - border.z) -
              Math.hypot(b.x - border.x, b.z - border.z),
          )[0];
        rebuildUnits();
        rebuildBuildings();
        if (target) {
          const stance = border.stance;
          border.stance = "standby";
          const deployed = issueOrder(ally, border, target, people, true);
          border.stance = stance;
          if (deployed) {
            border.orderTarget = undefined;
            border.orderPath = undefined;
          }
        }
      };
      if (campaign.elapsedHours >= 120)
        fireEvent("zju_invasion", () => {
          const pkuPeople = g.units
              .filter((unit) => unit.team === "pku")
              .reduce((sum, unit) => sum + unit.strength, 0),
            thuPeople = g.units
              .filter((unit) => unit.team === "thu")
              .reduce((sum, unit) => sum + unit.strength, 0),
            ally: Team = pkuPeople <= thuPeople ? "pku" : "thu",
            enemy: Team = ally === "pku" ? "thu" : "pku",
            border = g.sites
              .filter((site) => site.team === ally && !site.destroyed)
              .sort((a, b) => b.x - a.x)[0];
          if (!border) return;
          const target = g.sites
            .filter((site) => site.team === enemy && !site.destroyed)
            .sort(
              (a, b) =>
                Math.hypot(a.x - border.x, a.z - border.z) -
                Math.hypot(b.x - border.x, b.z - border.z),
            )[0];
          border.displayName = `浙大先遣驻地·${border.name}`;
          spawnUnitsAt(border, ally, 14, 1.12, false, 135, "zju");
          rebuildUnits();
          if (target) {
            const previousStance = border.stance;
            border.stance = "standby";
            const deployed = issueOrder(ally, border, target, 14);
            border.stance = previousStance;
            if (deployed) {
              border.orderTarget = undefined;
              border.orderPath = undefined;
            }
          }
          rebuildBuildings();
        });
      if (campaign.elapsedHours >= 240)
        fireEvent("nju_invasion", () =>
          deployExternalTeam("nju", "南雍气象站", 20, 1.05, 135),
        );
      if (g.deaths.pku + g.deaths.thu >= 160)
        fireEvent("fdu_invasion", () =>
          deployExternalTeam("fdu", "相辉交换驻地", 20, 1.08, 145),
        );
      if (campaign.elapsedHours >= 360)
        fireEvent("sjtu_invasion", () =>
          deployExternalTeam("sjtu", "闵行导航终点", 30, 1.12, 140, true),
        );
      if (campaign.warUnlocked && qz && thuSites < 48)
        fireEvent("thu_alarm", () => {
          qz.supply = 100;
          spawnUnitsAt(qz, "thu", 8, 1.1);
        });
      const kernelProduced = kernelRunProductionCycles(
        g,
        (team, source, target, count) =>
          issueOrder(team, source, target, count),
      );
      if (kernelProduced) rebuildUnits();
      const productionCycle = Math.floor(campaign.elapsedHours / 6);
      if (false && productionCycle > campaign.lastProductionCycle) {
        const firstCycle = Math.max(
          campaign.lastProductionCycle + 1,
          productionCycle - 47,
        );
        campaign.lastProductionCycle = productionCycle;
        let produced = false;
        for (let cycle = firstCycle; cycle <= productionCycle; cycle++) {
          for (const team of ["pku", "thu"] as Team[]) {
            const population = teamPopulation(team),
              allDorms = g.sites.filter(
                (site) =>
                  site.team === team &&
                  site.type === "dorm" &&
                  !site.destroyed,
              ),
              dorms = allDorms.filter((site) =>
                hasProductionCapacity(site, population),
              ),
              productionModifier =
                teamStatusFactor(team, "production") *
                (decisionEffectsFor(campaign, team).production ?? 1),
              activeDorms = Math.min(
                Math.max(
                  productionModifier > 0 ? 1 : 0,
                  Math.round(
                    productionSlots(allDorms.length, 0.35) *
                      productionModifier,
                  ),
                ),
                dorms.length,
                Math.max(0, Math.floor((teamUnitCap(team) - population) / 5)),
              );
            for (let i = 0; i < activeDorms; i++) {
              const site = dorms[(cycle + i * 3) % dorms.length];
              spawnUnitsAt(site, team, 1, 1, false);
              produced = true;
            }
            g.resources[team] +=
              6 * (decisionEffectsFor(campaign, team).resourceIncome ?? 1);
          }
          g.sites.forEach((source) => {
            if (source.destroyed || source.orderTarget == null) return;
            const target = g.sites[source.orderTarget];
            if (!target || target.destroyed) return;
            const idle = g.units.filter(
              (unit) =>
                unit.siteId === source.id && unit.targetSiteId == null,
            ).length;
            issueOrder(
              source.team,
              source,
              target,
              Math.ceil(idle * (source.dispatchRatio ?? 0.6)),
            );
          });
        }
        if (produced) rebuildUnits();
      }
      const diningCycle = Math.floor(campaign.elapsedHours / 12);
      if (false && diningCycle > campaign.lastDiningCycle) {
        const firstCycle = Math.max(
          campaign.lastDiningCycle + 1,
          diningCycle - 47,
        );
        campaign.lastDiningCycle = diningCycle;
        const producingDining: SiteState[] = [];
        for (let cycle = firstCycle; cycle <= diningCycle; cycle++) {
          for (const team of ["pku", "thu"] as Team[]) {
            const population = teamPopulation(team),
              allDiningSites = g.sites.filter(
                (site) =>
                  site.team === team &&
                  site.type === "dining" &&
                  !site.destroyed,
              ),
              diningSites = allDiningSites.filter((site) =>
                hasProductionCapacity(site, population),
              ),
              productionModifier =
                teamStatusFactor(team, "production") *
                (decisionEffectsFor(campaign, team).production ?? 1),
              activeDining = Math.min(
                Math.max(
                  productionModifier > 0 ? 1 : 0,
                  Math.round(
                    productionSlots(allDiningSites.length, 0.4) *
                      productionModifier,
                  ),
                ),
                diningSites.length,
                Math.max(0, Math.floor((teamUnitCap(team) - population) / 5)),
              );
            for (let i = 0; i < activeDining; i++) {
              const site = diningSites[(cycle + i * 2) % diningSites.length];
              spawnUnitsAt(site, team, 1, 1, false, 145);
              producingDining.push(site);
            }
          }
        }
        if (producingDining.length) rebuildUnits();
        producingDining.forEach((source) => {
          if (source.orderTarget == null) return;
          const target = g.sites[source.orderTarget];
          if (!target || target.destroyed) return;
          issueOrder(source.team, source, target, 1);
        });
      }
      g.sites
        .filter(
          (site) => site.type === "camp" && !site.destroyed,
        )
        .forEach((camp) => {
          g.units
            .filter(
              (unit) =>
                unit.team === camp.team &&
                Math.hypot(unit.x - camp.x, unit.z - camp.z) < 2.3,
            )
            .forEach(
              (unit) => (unit.supply = Math.min(100, unit.supply + 1.2)),
            );
        });
      runCampaignEventHooks<GameData>({
        game: g,
        elapsedHours: campaign.elapsedHours,
        hasFired: (id) => campaign.firedEvents.includes(id),
        trigger: (id, card, apply) => fireEvent(id, apply, card),
      });
      captureAiBenchmarkSamples(g);
      if (!campaign.outcome) {
        const pkuAlive = g.sites.some(
            (site) => site.team === "pku" && !site.destroyed,
          ),
          thuAlive = g.sites.some(
            (site) => site.team === "thu" && !site.destroyed,
          );
        if (pkuAlive !== thuAlive)
          setOutcome(
            pkuAlive ? "pku" : "thu",
            `${pkuAlive ? g.campaign.thuFactionName : "北大"}全部据点失守`,
          );
      }
    }, 1000);
    const aiRouteRiskCache = new Map<string, boolean>(),
      nextAiThinkAt: Record<Team, number> = { pku: 0, thu: 0 },
      runAiTurn = (aiTeam: Team, aiNow: number) => {
      const g = gameRef.current,
        aiState = g.campaign.ai,
        currentDifficulty =
          aiBenchmarkDifficulties?.[aiTeam] ??
          aiState.difficultyByTeam?.[aiTeam] ??
          aiState.difficulty,
        difficultySettings = kernelDifficultyProfile(currentDifficulty),
        aiThinkInterval = Math.max(
          120,
          difficultySettings.thinkMillisecondsAt1x /
            THREE.MathUtils.clamp(timeScaleRef.current, 0.5, 64),
        );
      if (aiNow < nextAiThinkAt[aiTeam]) return;
      nextAiThinkAt[aiTeam] = aiNow + aiThinkInterval;
      aiState.difficultyByTeam ??= {
        pku: aiState.difficulty,
        thu: aiState.difficulty,
      };
      aiState.difficultyByTeam[aiTeam] = currentDifficulty;
      aiState.seedByTeam ??= {
        pku: aiState.seed ^ 0x504b5501,
        thu: aiState.seed ^ 0x54485501,
      };
      const enemyTeam: Team = aiTeam === "pku" ? "thu" : "pku",
        difficulty = currentDifficulty,
        strategicInterval = difficultySettings.strategicHours,
        random = () => {
          const nextSeed =
            (Math.imul(aiState.seedByTeam![aiTeam], 1664525) + 1013904223) >>>
            0;
          aiState.seedByTeam![aiTeam] = nextSeed;
          aiState.seed = nextSeed;
          return nextSeed / 4_294_967_296;
        },
        personality = aiState.personality[aiTeam],
        forwardPrefix =
          aiTeam === "thu" ? "清华燕园校区·" : "北大清华园校区·",
        enemyForwardPrefix =
          aiTeam === "thu" ? "北大清华园校区·" : "清华燕园校区·",
        isForwardCaptured = (site: SiteState) =>
          (site.displayName ?? "").startsWith(forwardPrefix),
        isLostHomeSite = (site: SiteState) =>
          (site.displayName ?? "").startsWith(enemyForwardPrefix),
        qz = g.sites.find(
          (site) => site.name === "求真书院" && !site.destroyed,
        ),
        activeAiRoutes = g.sites.filter(
          (site) =>
            site.team === aiTeam &&
            site.orderTarget != null &&
            g.sites[site.orderTarget]?.team === enemyTeam &&
            !site.destroyed,
        ).length,
        routeLimit =
          difficulty === "hard"
            ? aiTeam === "thu" ? difficultySettings.routeLimit : 16
            : difficultySettings.routeLimit,
        waveLimit = difficultySettings.waveLimit;
      if (!g.campaign.research.active[aiTeam]) {
        const researchChoices = researchIdsForTeam(aiTeam).filter(
          (id) =>
            !hasResearch(g.campaign, aiTeam, id) &&
            RESEARCH_DEFINITIONS[id].requires.every((required) =>
              hasResearch(g.campaign, aiTeam, required),
            ) &&
            g.resources[aiTeam] >= RESEARCH_DEFINITIONS[id].cost,
        );
        if (researchChoices.length) {
          const baseBike = aiTeam === "thu" ? "thu_bike" : "pku_bike",
            preferred =
              difficulty !== "casual" && researchChoices.includes(baseBike)
                ? baseBike
                : personality.includes("工程") && researchChoices.includes("bus")
                  ? "bus"
                  : researchChoices[Math.floor(random() * researchChoices.length)];
          beginResearch(preferred, aiTeam, true);
        }
      }
      {
        const productionLines = g.campaign.research.production[aiTeam],
          productionChoices = g.campaign.research.completed[aiTeam].filter(
          (id) =>
            !productionLines[id] &&
            g.resources[aiTeam] >= RESEARCH_DEFINITIONS[id].deploymentCost &&
            g.campaign.research.stockpile[aiTeam][id] <
              RESEARCH_DEFINITIONS[id].productionQuantity * 2,
        );
        if (productionChoices.length)
          beginProduction(
            productionChoices[Math.floor(random() * productionChoices.length)],
            aiTeam,
            true,
          );
      }
      if (g.campaign.elapsedHours >= aiState.nextStrategicAt[aiTeam]) {
        aiState.nextStrategicAt[aiTeam] =
          g.campaign.elapsedHours + strategicInterval;
        if (!g.campaign.decisions.active[aiTeam]) {
          const siteDelta =
              g.sites.filter((site) => site.team === aiTeam && !site.destroyed)
                .length -
              g.sites.filter((site) => site.team === enemyTeam && !site.destroyed)
                .length,
            supplyAverage =
              g.units
                .filter((unit) => unit.team === aiTeam)
                .reduce((sum, unit) => sum + unit.supply, 0) /
              Math.max(1, g.units.filter((unit) => unit.team === aiTeam).length),
            candidates = DECISIONS.filter(
              (item) =>
                item.team === aiTeam && decisionAvailable(item, g.campaign),
            )
              .map((item) => {
                let score = 10 + random() * (difficulty === "casual" ? 9 : 4);
                if (item.aiTags.includes("defense") && siteDelta < 0) score += 18;
                if (item.aiTags.includes("aggression") && siteDelta >= 0) score += 14;
                if (item.aiTags.includes("supply") && supplyAverage < 55) score += 22;
                if (item.aiTags.includes("production") && g.units.length < 900)
                  score += 12;
                if (personality.includes("穿插") && item.aiTags.includes("mobility"))
                  score += 18;
                if (personality.includes("坚守") && item.aiTags.includes("defense"))
                  score += 18;
                if (personality.includes("工程") && item.aiTags.includes("ai"))
                  score += 18;
                if (personality.includes("纵深") && item.aiTags.includes("defense"))
                  score += 18;
                return { item, score };
              })
              .sort((a, b) => b.score - a.score),
            choicePool = candidates.slice(
              0,
              difficulty === "hard" ? 2 : difficulty === "casual" ? 5 : 3,
            );
          if (choicePool.length) {
            const picked = choicePool[Math.floor(random() * choicePool.length)];
            beginDecision(picked.item.id, aiTeam, true);
          }
        }
      }
      const logisticsFriendlySites = g.sites.filter(
          (site) => site.team === aiTeam && !site.destroyed,
        ),
        logisticsIdleAt = (site: SiteState) =>
          g.units.filter(
            (unit) =>
              unit.team === aiTeam &&
              unit.siteId === site.id &&
              unit.targetSiteId == null &&
              Math.hypot(
                unit.x - (site.navX ?? site.x),
                unit.z - (site.navZ ?? site.z),
              ) < 3.4,
          ).length,
        logisticsThreatAt = (site: SiteState) =>
          g.units.filter(
            (unit) =>
              unit.team === enemyTeam &&
              unit.targetSiteId === site.id,
          ).length,
        stagingSites = logisticsFriendlySites.filter(
          (site) => site.type !== "dorm" && site.type !== "dining",
        ),
        stagingAssignments = new Map<number, number>();
      logisticsFriendlySites
        .filter(
          (site) =>
            (site.type === "dorm" || site.type === "dining") &&
            !isForwardCaptured(site),
        )
        .sort((a, b) => logisticsIdleAt(b) - logisticsIdleAt(a))
        .forEach((source) => {
          const idle = logisticsIdleAt(source),
            capacity = productionSitePopulationCap(source),
            releaseAt = Math.max(
              difficulty === "hard" ? 5 : 8,
              Math.floor(
                capacity *
                  (difficulty === "hard" ? 0.45 : difficulty === "casual" ? 0.92 : 0.65),
              ),
            ),
            threatened = logisticsThreatAt(source);
          source.stance = threatened ? "defend" : "guard";
          source.dispatchRatio = threatened ? 0.4 : 0.72;
          if (threatened || idle <= releaseAt || !stagingSites.length) return;
          const target = stagingSites
            .filter((site) => logisticsThreatAt(site) === 0)
            .sort((a, b) => {
              const loadA =
                  logisticsIdleAt(a) + (stagingAssignments.get(a.id) ?? 0),
                loadB =
                  logisticsIdleAt(b) + (stagingAssignments.get(b.id) ?? 0),
                distanceA = Math.hypot(a.x - source.x, a.z - source.z),
                distanceB = Math.hypot(b.x - source.x, b.z - source.z);
              return loadA * 0.35 + distanceA - loadB * 0.35 - distanceB;
            })[0];
          if (!target) return;
          const surplus = Math.min(
            idle - releaseAt,
            difficulty === "hard" ? 36 : difficulty === "casual" ? 4 : 15,
          );
          if (surplus <= 0) return;
          const deployed = issueOrder(aiTeam, source, target, surplus, true);
          if (deployed) {
            stagingAssignments.set(
              target.id,
              (stagingAssignments.get(target.id) ?? 0) + deployed,
            );
            source.orderTarget = undefined;
            source.orderPath = undefined;
          }
        });
      if (!g.campaign.warUnlocked) return;
      g.sites
        .filter(
          (source) =>
            source.team === aiTeam &&
            !source.destroyed &&
            source.orderTarget != null &&
            g.sites[source.orderTarget]?.team === aiTeam,
        )
        .forEach((source) => {
          source.orderTarget = undefined;
          source.orderPath = undefined;
        });
      if (qz && aiTeam === "thu") {
        const threat = g.units.filter(
          (unit) =>
            unit.team === "pku" &&
            unit.targetSiteId === qz.id,
        ).length;
        if (threat > 0) {
          const defenders = g.units.filter(
              (unit) =>
                unit.team === "thu" &&
                Math.hypot(unit.x - qz.x, unit.z - qz.z) < 9,
            ).length;
          let needed = Math.max(0, Math.ceil(threat * 1.25) - defenders);
          const responders = g.sites
            .filter(
              (site) =>
                site.team === "thu" &&
                site.id !== qz.id &&
                !site.destroyed &&
                Math.hypot(site.x - qz.x, site.z - qz.z) < 14,
            )
            .sort(
              (a, b) => {
                const productionA =
                    a.type === "dorm" || a.type === "dining" ? 12 : 0,
                  productionB =
                    b.type === "dorm" || b.type === "dining" ? 12 : 0;
                return (
                  productionA + Math.hypot(a.x - qz.x, a.z - qz.z) -
                  productionB - Math.hypot(b.x - qz.x, b.z - qz.z)
                );
              },
            )
            .slice(0, difficulty === "hard" ? 3 : 2);
          for (const source of responders) {
            if (needed <= 0) break;
            source.stance = "guard";
            source.dispatchRatio = 0.72;
            const deployed = issueOrder(
              "thu",
              source,
              qz,
              Math.min(Math.max(0, logisticsIdleAt(source) - 3), needed),
              false,
            );
            if (deployed) {
              source.orderTarget = undefined;
              source.orderPath = undefined;
            }
            needed -= deployed;
          }
        }
      }
      if (aiTeam === "pku") {
        const yuanpei = g.sites.find(
          (site) => site.name === "元培学院（俄文楼）" && !site.destroyed,
        );
        if (yuanpei) {
          const threat = g.units.filter(
            (unit) =>
              unit.team === "thu" &&
              unit.targetSiteId === yuanpei.id,
          ).length;
          if (threat) {
            const defenders = g.units.filter(
                (unit) =>
                  unit.team === "pku" &&
                  Math.hypot(unit.x - yuanpei.x, unit.z - yuanpei.z) < 9,
              ).length;
            let needed = Math.max(0, Math.ceil(threat * 1.25) - defenders);
            const responders = g.sites
              .filter(
                (site) =>
                  site.team === "pku" &&
                  site.id !== yuanpei.id &&
                  !site.destroyed &&
                  Math.hypot(site.x - yuanpei.x, site.z - yuanpei.z) < 14,
              )
              .sort(
                (a, b) => {
                  const productionA =
                      a.type === "dorm" || a.type === "dining" ? 12 : 0,
                    productionB =
                      b.type === "dorm" || b.type === "dining" ? 12 : 0;
                  return (
                    productionA + Math.hypot(a.x - yuanpei.x, a.z - yuanpei.z) -
                    productionB - Math.hypot(b.x - yuanpei.x, b.z - yuanpei.z)
                  );
                },
              )
              .slice(0, difficulty === "hard" ? 3 : 2);
            for (const source of responders) {
              if (needed <= 0) break;
              source.stance = "guard";
              source.dispatchRatio = 0.72;
              const deployed = issueOrder(
                "pku",
                source,
                yuanpei,
                Math.min(Math.max(0, logisticsIdleAt(source) - 3), needed),
                false,
              );
              if (deployed) {
                source.orderTarget = undefined;
                source.orderPath = undefined;
              }
              needed -= deployed;
            }
          }
        }
      }
      const enemySites = g.sites.filter(
          (site) => site.team === enemyTeam && !site.destroyed,
        ),
        friendlySites = g.sites.filter(
          (site) => site.team === aiTeam && !site.destroyed,
        ),
        idleAt = (site: SiteState) =>
          g.units.filter(
            (unit) =>
              unit.team === aiTeam &&
              unit.siteId === site.id &&
              unit.targetSiteId == null &&
              Math.hypot(
                unit.x - (site.navX ?? site.x),
                unit.z - (site.navZ ?? site.z),
              ) < 3.4,
          ).length,
        threatAt = (site: SiteState) =>
          g.units.filter(
            (unit) =>
              unit.team === enemyTeam &&
              unit.targetSiteId === site.id,
          ).length,
        immediateThreatAt = (site: SiteState) =>
          g.units.filter(
            (unit) =>
              unit.team === enemyTeam &&
              unit.targetSiteId === site.id &&
              Math.hypot(unit.x - site.x, unit.z - site.z) < 7,
          ).length,
        defendersAt = (site: SiteState) =>
          g.units.filter(
            (unit) =>
              unit.team === aiTeam &&
              Math.hypot(unit.x - site.x, unit.z - site.z) < 6,
          ).length,
        productionSites = friendlySites.filter(
          (site) => site.type === "dorm" || site.type === "dining",
        ),
        threatenedProductionSites = productionSites.filter(
          (site) => threatAt(site) > 0,
        ),
        threatenedProductionIds = new Set(
          threatenedProductionSites.map((site) => site.id),
        ),
        breakoutProductionSites = threatenedProductionSites.filter((site) => {
          const projectedThreat = threatAt(site),
            immediateThreat = immediateThreatAt(site),
            defenders = defendersAt(site),
            idle = idleAt(site),
            reserveRatio =
              difficulty === "hard" ? 1.2 : difficulty === "casual" ? 1.55 : 1.35,
            reserve = Math.max(12, Math.ceil(projectedThreat * reserveRatio) + 4),
            minimumBreakout =
              difficulty === "hard" ? 10 : difficulty === "casual" ? 28 : 16;
          return (
            defenders >= immediateThreat * 1.25 + 8 &&
            idle - reserve >= minimumBreakout
          );
        }),
        breakoutProductionIds = new Set(
          breakoutProductionSites.map((site) => site.id),
        ),
        urgentProductionSites = threatenedProductionSites.filter(
          (site) =>
            !breakoutProductionIds.has(site.id) &&
            (immediateThreatAt(site) > 0 ||
              threatAt(site) >= Math.max(8, defendersAt(site) * 0.85)),
        ),
        urgentProductionIds = new Set(
          urgentProductionSites.map((site) => site.id),
        );
      const hostileOrders = g.units.filter(
          (unit) =>
            unit.team === enemyTeam &&
            unit.targetSiteId != null &&
            g.sites[unit.targetSiteId]?.team === aiTeam,
        ),
        hostileGroups = new Map<number, UnitState[]>();
      for (const unit of hostileOrders) {
        const targetId = unit.targetSiteId!;
        hostileGroups.set(targetId, [
          ...(hostileGroups.get(targetId) ?? []),
          unit,
        ]);
      }
      const orderedHostileGroups = [...hostileGroups.entries()]
          .map(([targetId, units]) => ({
            target: g.sites[targetId],
            units,
            strength: units.reduce((sum, unit) => sum + unit.strength, 0),
          }))
          .filter(({ target }) => !!target && !target.destroyed)
          .sort((a, b) => b.strength - a.strength),
        aiPopulation = g.units
          .filter((unit) => unit.team === aiTeam)
          .reduce((sum, unit) => sum + unit.strength, 0),
        enemyPopulation = g.units
          .filter((unit) => unit.team === enemyTeam)
          .reduce((sum, unit) => sum + unit.strength, 0),
        forceRatio = aiPopulation / Math.max(1, enemyPopulation),
        primaryHostileGroup = orderedHostileGroups[0],
        currentIntent = kernelClassifyIntent(
          orderedHostileGroups.map(({ target, strength }) => ({
            target,
            strength,
          })),
          difficulty,
        );
      aiState.intent ??= { pku: "passive", thu: "passive" };
      aiState.intentUpdatedAt ??= { pku: 0, thu: 0 };
      aiState.intent[aiTeam] = currentIntent;
      aiState.intentUpdatedAt[aiTeam] = g.campaign.elapsedHours;
      for (const threatened of urgentProductionSites) {
        const threat = threatAt(threatened),
          defenderCount = g.units.filter(
            (unit) =>
              unit.team === aiTeam &&
              Math.hypot(unit.x - threatened.x, unit.z - threatened.z) < 5,
          ).length;
        threatened.stance = "defend";
        threatened.dispatchRatio = 0.4;
        threatened.orderTarget = undefined;
        threatened.orderPath = undefined;
        // 已经出发的部队继续执行命令。旧逻辑会在据点重新被判定为
        // “紧急”时清空所有目标，长兵线和高倍率下就会表现为整队回溯。
        // 防守缺口只通过保留后续产兵和调附近闲置部队来补足。
        if (defenderCount >= threat * 1.15 + 4) continue;
        const responders = friendlySites
          .filter(
            (site) =>
              site.id !== threatened.id &&
              !urgentProductionIds.has(site.id) &&
              idleAt(site) >= 5,
          )
          .sort(
            (a, b) =>
              Math.hypot(a.x - threatened.x, a.z - threatened.z) -
              Math.hypot(b.x - threatened.x, b.z - threatened.z),
          )
          .slice(0, difficulty === "hard" ? 4 : difficulty === "casual" ? 2 : 3);
        let needed = Math.max(4, Math.ceil(threat * 1.35 - defenderCount));
        for (const source of responders) {
          if (needed <= 0) break;
          const available = Math.max(0, idleAt(source) - 3),
            productionResponder =
              source.type === "dorm" || source.type === "dining";
          if (productionResponder) {
            source.stance = "guard";
            source.dispatchRatio = 0.72;
          }
          const deployed = issueOrder(
              aiTeam,
              source,
              threatened,
              Math.min(available, needed),
              !productionResponder,
            );
          if (deployed) {
            source.orderTarget = undefined;
            source.orderPath = undefined;
          }
          needed -= deployed;
        }
      }
      if (
        currentIntent === "single_breakthrough" &&
        primaryHostileGroup &&
        difficulty !== "casual"
      ) {
        const originCounts = new Map<number, number>();
        for (const unit of primaryHostileGroup.units)
          originCounts.set(
            unit.siteId,
            (originCounts.get(unit.siteId) ?? 0) + unit.strength,
          );
        const raidOriginId = [...originCounts.entries()].sort(
            (a, b) => b[1] - a[1],
          )[0]?.[0],
          raidOrigin = raidOriginId != null ? g.sites[raidOriginId] : undefined,
          cutoffKey = `cutoff-at:${aiTeam}`,
          lastCutoffAt = aiState.failedGoals[cutoffKey] ?? -999;
        if (
          raidOrigin &&
          !raidOrigin.destroyed &&
          raidOrigin.team === enemyTeam &&
          g.campaign.elapsedHours - lastCutoffAt >=
            (difficulty === "hard" ? 2 : 5)
        ) {
          const originDefenders = g.units.filter(
              (unit) =>
                unit.team === enemyTeam &&
                Math.hypot(unit.x - raidOrigin.x, unit.z - raidOrigin.z) < 5,
            ).length,
            cutoffSources = friendlySites
              .filter(
                (site) =>
                  !urgentProductionIds.has(site.id) &&
                  idleAt(site) >= (difficulty === "hard" ? 8 : 12),
              )
              .sort(
                (a, b) =>
                  Math.hypot(a.x - raidOrigin.x, a.z - raidOrigin.z) -
                  Math.hypot(b.x - raidOrigin.x, b.z - raidOrigin.z),
              )
              .slice(0, difficulty === "hard" ? 3 : 2),
            cutoffPotential = cutoffSources.reduce(
              (sum, site) => sum + idleAt(site) * 0.72,
              0,
            );
          if (cutoffPotential >= originDefenders * 1.2 + 5) {
            const lead = cutoffSources[0];
            if (lead && difficulty === "hard" && siteTouchesRoad(lead)) {
              const busKind = (["large_bus", "bus"] as ResearchId[]).find(
                (kind) =>
                  hasResearch(g.campaign, aiTeam, kind) &&
                  g.campaign.research.stockpile[aiTeam][kind] > 0,
              );
              if (busKind) allocateTransport(aiTeam, busKind, lead.id);
            }
            let committed = 0;
            for (const source of cutoffSources) {
              const available = idleAt(source);
              source.stance = "standby";
              source.dispatchRatio = 1;
              committed += issueOrder(
                aiTeam,
                source,
                raidOrigin,
                Math.max(
                  4,
                  Math.ceil(
                    available * (difficulty === "hard" ? 0.82 : 0.62),
                  ),
                ),
                false,
              );
            }
            if (committed) aiState.failedGoals[cutoffKey] = g.campaign.elapsedHours;
          }
        }
      }
      const strategicThreats = friendlySites
        .filter(
          (site) =>
            !threatenedProductionIds.has(site.id) &&
            threatAt(site) >=
              (site.type === "capital" ||
              site.type === "target" ||
              site.type === "gate"
                ? 4
                : 14),
        )
        .sort((a, b) => threatAt(b) - threatAt(a))
        .slice(0, difficulty === "hard" ? 4 : difficulty === "casual" ? 1 : 2);
      for (const threatened of strategicThreats) {
        const threat = threatAt(threatened),
          defenders = g.units.filter(
            (unit) =>
              unit.team === aiTeam &&
              Math.hypot(unit.x - threatened.x, unit.z - threatened.z) < 6,
          ).length;
        if (defenders >= threat + 5) continue;
        threatened.stance = "guard";
        threatened.dispatchRatio = 0.68;
        let needed = Math.max(3, Math.ceil(threat * 1.15 - defenders));
        const responders = friendlySites
          .filter(
            (site) =>
              site.id !== threatened.id &&
              site.type !== "dorm" &&
              site.type !== "dining" &&
              threatAt(site) === 0 &&
              idleAt(site) >= 6,
          )
          .sort(
            (a, b) =>
              Math.hypot(a.x - threatened.x, a.z - threatened.z) -
              Math.hypot(b.x - threatened.x, b.z - threatened.z),
          )
          .slice(0, difficulty === "hard" ? 3 : 2);
        for (const source of responders) {
          if (needed <= 0) break;
          const deployed = issueOrder(
            aiTeam,
            source,
            threatened,
            Math.min(Math.max(0, idleAt(source) - 3), needed),
            true,
          );
          if (deployed) {
            source.orderTarget = undefined;
            source.orderPath = undefined;
          }
          needed -= deployed;
        }
      }
      const enemyProductionRemaining = enemySites.filter(
          (site) => site.type === "dorm" || site.type === "dining",
        ).length,
        highRiskTarget = kernelIsHighRiskEventTarget,
        enemyRiskSites = enemySites.filter(highRiskTarget),
        pathCrossesEventRisk = (path?: [number, number][]) =>
          kernelPathCrossesRisk(path, enemyRiskSites),
        riskSignature = enemyRiskSites.map((site) => site.id).join(","),
        routeCrossesEventRisk = (source: SiteState, target: SiteState) => {
          if (!riskSignature) return false;
          const key = `${aiTeam}:${source.id}:${target.id}:${riskSignature}`,
            cached = aiRouteRiskCache.get(key);
          if (cached != null) return cached;
          const unsafe = pathCrossesEventRisk(
            findPath(
              source.navX ?? source.x,
              source.navZ ?? source.z,
              target.navX ?? target.x,
              target.navZ ?? target.z,
            ),
          );
          if (aiRouteRiskCache.size > 4000) aiRouteRiskCache.clear();
          aiRouteRiskCache.set(key, unsafe);
          return unsafe;
        },
        occupiedAttackTargets = new Set([
          ...friendlySites.flatMap((source) =>
            source.orderTarget != null &&
            g.sites[source.orderTarget]?.team === enemyTeam
              ? [source.orderTarget]
              : [],
          ),
          ...g.units.flatMap((unit) =>
            unit.team === aiTeam &&
            unit.targetSiteId != null &&
            g.sites[unit.targetSiteId]?.team === enemyTeam
              ? [unit.targetSiteId]
              : [],
          ),
        ]),
        forwardHubs = friendlySites
          .filter(
            (site) =>
              (isForwardCaptured(site) ||
                breakoutProductionIds.has(site.id)) &&
              !urgentProductionIds.has(site.id) &&
              idleAt(site) >=
                (difficulty === "hard" ? 6 : difficulty === "casual" ? 40 : 14),
          )
          .sort((a, b) => idleAt(b) - idleAt(a))
          .slice(0, difficulty === "hard" ? 16 : difficulty === "casual" ? 1 : 8);
      for (const hub of forwardHubs) {
        const localThreat = threatAt(hub),
          garrison = Math.max(
            difficulty === "hard" ? 3 : difficulty === "casual" ? 30 : 9,
            Math.ceil(
              localThreat *
                (difficulty === "hard" ? 1.15 : difficulty === "casual" ? 1.65 : 1.35),
            ) + 4,
          ),
          idle = idleAt(hub),
          available = Math.max(0, idle - garrison),
          dispatchBudget = Math.floor(
            available *
              (difficulty === "hard" ? 0.95 : difficulty === "casual" ? 0.15 : 0.65),
          );
        if (
          dispatchBudget <
          (difficulty === "hard" ? 2 : difficulty === "casual" ? 12 : 3)
        )
          continue;
        const scored = enemySites
            .filter(
              (target) =>
                difficulty !== "hard" ||
                enemyProductionRemaining <= 2 ||
                !highRiskTarget(target),
            )
            .map((target) => {
              const defenders = g.units.filter(
                  (unit) =>
                    unit.team === enemyTeam &&
                    Math.hypot(unit.x - target.x, unit.z - target.z) < 5,
                ).length,
                productionValue =
                  target.type === "dorm"
                    ? aiTeam === "pku"
                      ? difficulty === "hard" ? 92 : difficulty === "casual" ? 34 : 68
                      : 38
                    : target.type === "dining"
                      ? aiTeam === "pku"
                        ? difficulty === "hard" ? 66 : difficulty === "casual" ? 26 : 48
                        : 28
                      : target.type === "gate"
                        ? 14
                        : 0,
                hardPoint =
                  target.type === "capital" ||
                  target.type === "target" ||
                  target.type === "teaching",
                hardPointPenalty =
                  hardPoint && enemyProductionRemaining > 2
                    ? difficulty === "hard" ? 50 : difficulty === "casual" ? 12 : 30
                    : 0,
                qzBypassPenalty =
                  aiTeam === "pku" &&
                  target.name === "求真书院" &&
                  enemyProductionRemaining > 2
                    ? difficulty === "hard" ? 140 : difficulty === "casual" ? 35 : 95
                    : 0,
                intentValue =
                  isLostHomeSite(target)
                    ? currentIntent === "single_breakthrough" ? 95 : 42
                    : (target.type === "dorm" || target.type === "dining") &&
                        currentIntent === "positional"
                      ? 32
                      : (target.type === "dorm" || target.type === "dining") &&
                          currentIntent === "passive"
                        ? 18
                        : 0,
                congestionPenalty = occupiedAttackTargets.has(target.id)
                  ? difficulty === "hard" ? 60 : difficulty === "casual" ? 12 : 35
                  : 0,
                distance = Math.hypot(target.x - hub.x, target.z - hub.z),
                unsafeRoute =
                  difficulty === "hard" &&
                  enemyProductionRemaining > 2 &&
                  routeCrossesEventRisk(hub, target);
              return {
                target,
                defenders,
                unsafeRoute,
                score:
                  productionValue -
                  hardPointPenalty -
                  qzBypassPenalty -
                  congestionPenalty -
                  distance *
                    (aiTeam === "pku" &&
                    (target.type === "dorm" || target.type === "dining")
                      ? difficulty === "hard" ? 0.45 : difficulty === "casual" ? 0.9 : 0.65
                      : 1) -
                  defenders * 1.55 +
                  intentValue +
                  (random() - 0.5) * (difficulty === "casual" ? 12 : 4),
              };
            })
            .sort((a, b) => b.score - a.score),
          fanOutLimit = Math.min(
            breakoutProductionIds.has(hub.id)
              ? difficulty === "hard"
                ? 5
                : difficulty === "casual"
                  ? 1
                  : 4
              : difficulty === "hard"
                ? 4
                : difficulty === "casual"
                  ? 1
                  : 3,
            Math.max(1, Math.floor(dispatchBudget / 10)),
          ),
          targets = scored
            .filter(
              (choice) =>
                !choice.unsafeRoute &&
                (choice.defenders <= 1 ||
                  dispatchBudget >= Math.ceil(choice.defenders * 1.55 + 4)),
            )
            .slice(0, fanOutLimit);
        if (!targets.length) continue;
        hub.stance = "standby";
        hub.dispatchRatio = 1;
        if (
          difficulty === "hard" &&
          dispatchBudget >= 30 &&
          siteTouchesRoad(hub)
        ) {
          const busKind = (["large_bus", "bus"] as ResearchId[]).find(
            (kind) =>
              hasResearch(g.campaign, aiTeam, kind) &&
              g.campaign.research.stockpile[aiTeam][kind] > 0,
          );
          if (busKind) allocateTransport(aiTeam, busKind, hub.id);
        }
        let remaining = dispatchBudget;
        targets.forEach((choice, index) => {
          if (remaining <= 0) return;
          const targetsLeft = targets.length - index,
            requested = Math.min(
              remaining,
              Math.max(
                5,
                Math.ceil(choice.defenders * 1.55 + 4),
                Math.floor(remaining / targetsLeft),
              ),
            ),
            deployed = issueOrder(
              aiTeam,
              hub,
              choice.target,
              requested,
              false,
            );
          if (deployed) occupiedAttackTargets.add(choice.target.id);
          if (deployed && difficulty === "casual") {
            hub.orderTarget = undefined;
            hub.orderPath = undefined;
          }
          remaining -= deployed;
        });
      }
      if (
        difficulty === "hard" &&
        enemyProductionRemaining > 2 &&
        g.resources[aiTeam] >= 160 &&
        g.sites.filter(
          (site) =>
            site.team === aiTeam && site.type === "camp" && !site.destroyed,
        ).length < 2 &&
        g.campaign.elapsedHours -
          (aiState.failedGoals[`camp-at:${aiTeam}`] ?? -999) >= 24 &&
        g.campaign.elapsedHours -
          (aiState.failedGoals[`camp-plan-at:${aiTeam}`] ?? -999) >= 6
      ) {
        aiState.failedGoals[`camp-plan-at:${aiTeam}`] =
          g.campaign.elapsedHours;
        const deepTargets = enemySites
            .filter((site) => site.type === "dorm" || site.type === "dining")
            .map((site) => ({
              site,
              defenders: g.units.filter(
                (unit) =>
                  unit.team === enemyTeam &&
                  Math.hypot(unit.x - site.x, unit.z - site.z) < 5,
              ).length,
            }))
            .sort((a, b) => a.defenders - b.defenders),
          campSources = friendlySites
            .filter(
              (site) =>
                site.type !== "camp" &&
                !urgentProductionIds.has(site.id) &&
                idleAt(site) >= 18,
            )
            .sort((a, b) => idleAt(b) - idleAt(a));
        let campBuilt = false;
        for (const { site: deepTarget } of deepTargets.slice(0, 2)) {
          if (campBuilt) break;
          for (const source of campSources.slice(0, 2)) {
            const sourceX = source.navX ?? source.x,
              sourceZ = source.navZ ?? source.z,
              targetX = deepTarget.navX ?? deepTarget.x,
              targetZ = deepTarget.navZ ?? deepTarget.z,
              directPath = findPath(sourceX, sourceZ, targetX, targetZ);
            if (!directPath.length || !pathCrossesEventRisk(directPath)) continue;
            const crossedRisks = enemyRiskSites.filter((risk) =>
                directPath.some(
                  ([x, z]) => Math.hypot(x - risk.x, z - risk.z) < 5.2,
                ),
              ),
              detours: {
                x: number;
                z: number;
                pathToCamp: [number, number][];
                pathToTarget: [number, number][];
                length: number;
              }[] = [];
            for (const risk of crossedRisks.slice(0, 1))
              for (let index = 0; index < 8; index++) {
                const angle = (index / 8) * Math.PI * 2,
                  candidateX = risk.x + Math.cos(angle) * 7.2,
                  candidateZ = risk.z + Math.sin(angle) * 7.2,
                  clearIndex = nearestClearIndex(candidateX, candidateZ);
                if (clearIndex < 0) continue;
                const [campX, campZ] = navPoint(navGrid, clearIndex);
                if (
                  enemyRiskSites.some(
                    (otherRisk) =>
                      Math.hypot(campX - otherRisk.x, campZ - otherRisk.z) < 5.8,
                  ) ||
                  g.sites.some(
                    (site) =>
                      !site.destroyed &&
                      Math.hypot(campX - site.x, campZ - site.z) < 2.2,
                  )
                )
                  continue;
                const pathToCamp = findPath(sourceX, sourceZ, campX, campZ),
                  pathToTarget = findPath(campX, campZ, targetX, targetZ);
                if (
                  !pathToCamp.length ||
                  !pathToTarget.length ||
                  pathCrossesEventRisk(pathToCamp) ||
                  pathCrossesEventRisk(pathToTarget)
                )
                  continue;
                detours.push({
                  x: campX,
                  z: campZ,
                  pathToCamp,
                  pathToTarget,
                  length: pathToCamp.length + pathToTarget.length,
                });
              }
            detours.sort((a, b) => a.length - b.length);
            for (const detour of detours.slice(0, 4)) {
              const previousSiteCount = g.sites.length;
              if (
                !buildCampAt(
                  new THREE.Vector3(detour.x, 0, detour.z),
                  aiTeam,
                  true,
                ) ||
                g.sites.length === previousSiteCount
              )
                continue;
              const camp = g.sites.at(-1)!;
              camp.displayName = `绕行营地·${deepTarget.name}`;
              const busKind = (["large_bus", "bus"] as ResearchId[]).find(
                (kind) =>
                  hasResearch(g.campaign, aiTeam, kind) &&
                  g.campaign.research.stockpile[aiTeam][kind] > 0,
              );
              if (busKind && siteTouchesRoad(source))
                allocateTransport(aiTeam, busKind, source.id);
              source.stance = "standby";
              source.dispatchRatio = 1;
              const deployed = issueOrder(
                aiTeam,
                source,
                camp,
                Math.max(12, Math.floor(idleAt(source) * 0.68)),
                true,
              );
              source.orderTarget = undefined;
              source.orderPath = undefined;
              if (deployed) {
                camp.orderTarget = deepTarget.id;
                camp.orderPath = detour.pathToTarget;
                aiState.failedGoals[`camp-at:${aiTeam}`] =
                  g.campaign.elapsedHours;
                campBuilt = true;
              }
              break;
            }
            if (campBuilt) break;
          }
        }
      }
      const offensiveMomentum = kernelOffensiveMomentum(
        difficulty,
        friendlySites.length,
        enemySites.length,
        forceRatio,
      );
      if (offensiveMomentum > 0) {
        const assignedSweepTargets = new Set(occupiedAttackTargets),
          sourceLimit =
            difficulty === "hard"
              ? 6 + Math.floor(offensiveMomentum * 18)
              : 2 + Math.floor(offensiveMomentum * 8),
          minimumIdle =
            difficulty === "hard"
              ? Math.max(3, Math.round(7 - offensiveMomentum * 4))
              : Math.max(6, Math.round(14 - offensiveMomentum * 6)),
          sweepSources = friendlySites
            .filter(
              (site) =>
                !urgentProductionIds.has(site.id) &&
                (site.orderTarget == null ||
                  g.sites[site.orderTarget]?.team === aiTeam) &&
                idleAt(site) >= minimumIdle,
            )
            .sort((a, b) => idleAt(b) - idleAt(a))
            .slice(0, sourceLimit);
        for (const source of sweepSources) {
          const idle = idleAt(source),
            reserve =
              source.type === "dorm" || source.type === "dining"
                ? difficulty === "hard" ? 3 : 6
                : 1,
            available = Math.max(0, idle - reserve);
          if (available < 2) continue;
          const affordableTargets = enemySites
            .map((target) => {
              const defenders = g.units.filter(
                  (unit) =>
                    unit.team === enemyTeam &&
                    Math.hypot(unit.x - target.x, unit.z - target.z) < 5,
                ).length,
                required = Math.max(2, Math.ceil(defenders * 1.45) + 3),
                distance = Math.hypot(target.x - source.x, target.z - source.z),
                routePath = findPath(
                  source.navX ?? source.x,
                  source.navZ ?? source.z,
                  target.navX ?? target.x,
                  target.navZ ?? target.z,
                ),
                unsafeRoute =
                  difficulty === "hard" &&
                  enemyProductionRemaining > 2 &&
                  pathCrossesEventRisk(routePath);
              return { target, defenders, required, distance, unsafeRoute };
            })
            .filter(
              ({ target, required, unsafeRoute }) =>
                !assignedSweepTargets.has(target.id) &&
                !unsafeRoute &&
                (enemyProductionRemaining <= 2 ||
                  (target.type !== "teaching" &&
                    target.type !== "capital" &&
                    target.type !== "target")) &&
                (required <= available ||
                  (difficulty === "hard" && required <= available * 1.2)),
            )
            .sort(
              (a, b) =>
                a.distance + a.defenders * 1.8 -
                (b.distance + b.defenders * 1.8),
            );
          const choice = affordableTargets[0];
          if (!choice) continue;
          source.stance = "standby";
          source.dispatchRatio = 1;
          const deployed = issueOrder(
            aiTeam,
            source,
            choice.target,
            Math.min(
              available,
              Math.max(
                choice.required,
                Math.ceil(
                  available *
                    (difficulty === "hard"
                      ? 0.75 + offensiveMomentum * 0.13
                      : 0.5 + offensiveMomentum * 0.2),
                ),
              ),
            ),
            false,
          );
          if (deployed) assignedSweepTargets.add(choice.target.id);
        }
      }
      const activeRoutes = friendlySites.filter(
          (source) =>
            source.orderTarget != null &&
            g.sites[source.orderTarget]?.team === enemyTeam,
        ),
        aggressionThreshold =
          (difficulty === "hard" ? 1.22 : difficulty === "casual" ? 1.8 : 1.3) *
          (forceRatio < 0.72 ? 1.28 : forceRatio < 0.95 ? 1.1 : 1),
        reinforcementSourcesUsed = new Set<number>();
      for (const source of activeRoutes) {
        if (urgentProductionIds.has(source.id)) continue;
        const target = g.sites[source.orderTarget!];
        if (!target || target.destroyed || target.team !== enemyTeam) continue;
        const committed = g.units.filter(
            (unit) =>
              unit.team === aiTeam && unit.targetSiteId === target.id,
          ).length,
          defenders = g.units.filter(
            (unit) =>
              unit.team === enemyTeam &&
              Math.hypot(unit.x - target.x, unit.z - target.z) < 6,
          ).length,
          idle = idleAt(source),
          advantage = (committed + idle * 0.65 + 2) / (defenders + 2),
          hardPoint =
            target.type === "capital" ||
            target.type === "target" ||
            target.type === "teaching",
          observationKey = `route:${source.id}:${target.id}`,
          observationAtKey = `route-at:${source.id}`,
          stalledRouteKey = `route-stalled:${source.id}:${target.id}`,
          blockedRouteKey = `route-blocked:${source.id}:${target.id}`;
        if (committed === 0 && idle < 3) {
          const stalledSince = aiState.failedGoals[stalledRouteKey];
          if (stalledSince == null)
            aiState.failedGoals[stalledRouteKey] = g.campaign.elapsedHours;
          else if (
            g.campaign.elapsedHours - stalledSince >=
            (difficulty === "hard" ? 2 : difficulty === "casual" ? 12 : 4)
          ) {
            source.orderTarget = undefined;
            source.orderPath = undefined;
            delete aiState.failedGoals[stalledRouteKey];
          }
          continue;
        }
        delete aiState.failedGoals[stalledRouteKey];
        if (
          hardPoint &&
          enemyProductionRemaining > 2 &&
          committed + idle * 0.4 < defenders * 1.15 + 8
        ) {
          const lastObservation = aiState.failedGoals[observationAtKey] ?? -999;
          if (g.campaign.elapsedHours - lastObservation >= 6) {
            aiState.failedGoals[observationAtKey] = g.campaign.elapsedHours;
            aiState.failedGoals[observationKey] =
              (aiState.failedGoals[observationKey] ?? 0) + 1;
          }
          if (
            (aiState.failedGoals[observationKey] ?? 0) >=
            (difficulty === "hard" ? 2 : 3)
          ) {
            source.orderTarget = undefined;
            source.orderPath = undefined;
          }
          continue;
        }
        if (advantage < aggressionThreshold) {
          const supporters = friendlySites
              .filter(
                (candidate) =>
                  candidate.id !== source.id &&
                  !reinforcementSourcesUsed.has(candidate.id) &&
                  !urgentProductionIds.has(candidate.id) &&
                  (difficulty !== "casual" ||
                    (candidate.type !== "dorm" && candidate.type !== "dining")) &&
                  idleAt(candidate) >=
                    (candidate.type === "dorm" || candidate.type === "dining"
                      ? Math.max(
                          difficulty === "hard" ? 10 : 14,
                          Math.floor(productionSitePopulationCap(candidate) * 0.42),
                        )
                      : 7) &&
                  (candidate.orderTarget == null ||
                    g.sites[candidate.orderTarget]?.team === aiTeam),
              )
              .sort(
                (a, b) =>
                  Math.hypot(a.x - target.x, a.z - target.z) -
                  Math.hypot(b.x - target.x, b.z - target.z),
              ),
            supporterLimit =
              difficulty === "hard" ? 3 : difficulty === "casual" ? 1 : 2,
            selectedSupporters = supporters.slice(0, supporterLimit),
            supportPotential = selectedSupporters.reduce(
              (sum, candidate) => sum + idleAt(candidate) * 0.58,
              0,
            ),
            combinedAdvantage =
              (committed + supportPotential + 2) / (defenders + 2);
          if (combinedAdvantage >= aggressionThreshold) {
            delete aiState.failedGoals[blockedRouteKey];
            for (const supporter of selectedSupporters) {
              const supporterIdle = idleAt(supporter),
                productionSupporter =
                  supporter.type === "dorm" || supporter.type === "dining";
              supporter.stance = productionSupporter
                ? "guard"
                : combinedAdvantage > 2
                  ? "standby"
                  : "guard";
              supporter.dispatchRatio = productionSupporter
                ? 0.72
                : combinedAdvantage > 2
                  ? 1
                  : 0.78;
              const deployed = issueOrder(
                aiTeam,
                supporter,
                target,
                Math.max(
                  2,
                  Math.ceil(
                    supporterIdle *
                      (difficulty === "hard" ? 0.78 : difficulty === "casual" ? 0.18 : 0.6),
                  ),
                ),
                false,
              );
              if (deployed) reinforcementSourcesUsed.add(supporter.id);
            }
          } else {
            const blockedSince = aiState.failedGoals[blockedRouteKey];
            if (blockedSince == null)
              aiState.failedGoals[blockedRouteKey] = g.campaign.elapsedHours;
            else if (
              g.campaign.elapsedHours - blockedSince >=
              (difficulty === "hard" ? 1.5 : difficulty === "casual" ? 18 : 3)
            ) {
              source.orderTarget = undefined;
              source.orderPath = undefined;
              delete aiState.failedGoals[blockedRouteKey];
            }
          }
          continue;
        }
        delete aiState.failedGoals[blockedRouteKey];
        if (idle < 3) continue;
        aiState.failedGoals[observationKey] = Math.max(
          0,
          (aiState.failedGoals[observationKey] ?? 0) - 1,
        );
        const productionSource =
          source.type === "dorm" || source.type === "dining";
        source.stance = productionSource ? "guard" : advantage > 2 ? "standby" : "guard";
        source.dispatchRatio = productionSource ? 0.72 : advantage > 2 ? 1 : 0.78;
        const ratio =
            difficulty === "hard" ? 0.82 : difficulty === "casual" ? 0.18 : 0.62,
          requested = Math.max(1, Math.ceil(idle * ratio));
        issueOrder(aiTeam, source, target, requested, false);
      }
      if (
        (difficulty === "casual" && random() < 0.85) ||
        (difficulty === "standard" && random() < 0.08)
      )
        return;
      const initialEnemyProduction = Math.max(
          1,
          g.campaign.initialProductionSites[enemyTeam],
        ),
        enemyProductionRatio =
          enemyProductionRemaining / initialEnemyProduction,
        passiveBlitz =
          currentIntent === "passive" &&
          forceRatio >= 1.35 &&
          enemyProductionRatio <= 0.55,
        baseRouteLimit =
          difficulty === "hard" && enemyProductionRatio > 0.7
            ? Math.min(routeLimit, 10)
            : routeLimit,
        baseWaveLimit =
          difficulty === "hard" && enemyProductionRatio > 0.7
            ? Math.min(waveLimit, 4)
            : waveLimit,
        effectiveRouteLimit =
          baseRouteLimit +
          (passiveBlitz
            ? difficulty === "hard" ? 5 : difficulty === "standard" ? 2 : 0
            : currentIntent === "positional" && difficulty === "hard"
              ? 2
              : 0),
        effectiveWaveLimit =
          baseWaveLimit +
          (passiveBlitz
            ? difficulty === "hard" ? 3 : difficulty === "standard" ? 1 : 0
            : currentIntent === "positional" && difficulty === "hard"
              ? 1
              : 0);
      if (activeAiRoutes >= effectiveRouteLimit) return;
      const attackSources = friendlySites
        .filter(
          (site) =>
            !urgentProductionIds.has(site.id) &&
            site.type !== "dorm" &&
            site.type !== "dining" &&
            (site.orderTarget == null ||
              g.sites[site.orderTarget]?.team === aiTeam) &&
            idleAt(site) >= (difficulty === "casual" ? 10 : difficulty === "hard" ? 2 : 3) &&
            (aiTeam !== "thu" ||
              !qz ||
              Math.hypot(site.x - qz.x, site.z - qz.z) > 4),
        )
        .sort((a, b) => idleAt(b) - idleAt(a));
      let routesCreated = 0;
      for (const source of attackSources) {
        if (
          activeAiRoutes + routesCreated >= effectiveRouteLimit ||
          routesCreated >= effectiveWaveLimit
        )
          break;
        const sourceIdleForAttack = idleAt(source),
          nearbySupportPotential = friendlySites
            .filter(
              (friendly) =>
                friendly.id !== source.id &&
                !urgentProductionIds.has(friendly.id) &&
                Math.hypot(friendly.x - source.x, friendly.z - source.z) < 14,
            )
            .reduce((sum, friendly) => sum + idleAt(friendly) * 0.38, 0),
          scoredTargets = enemySites
            .filter(
              (site) =>
                difficulty !== "hard" ||
                enemyProductionRemaining <= 2 ||
                !highRiskTarget(site),
            )
            .map((site) => {
              const actualDefenders = g.units.filter(
                  (unit) =>
                    unit.team === enemyTeam &&
                    Math.hypot(unit.x - site.x, unit.z - site.z) < 3.4,
                ).length,
                observed = friendlySites.some(
                  (friendly) =>
                    Math.hypot(friendly.x - site.x, friendly.z - site.z) < 10,
                ),
                uncertainty =
                  difficulty === "hard" ? .1 : difficulty === "casual" ? .4 : .25,
                estimatedDefenders = observed
                  ? actualDefenders
                  : Math.max(
                      0,
                      Math.round(
                        actualDefenders * (1 + (random() * 2 - 1) * uncertainty),
                      ),
                    ),
                requiredForce = Math.ceil(estimatedDefenders * 1.55 + 4),
                availableForce =
                  sourceIdleForAttack + nearbySupportPotential,
                forceGap = Math.max(0, requiredForce - availableForce),
                coreWindow =
                  enemyProductionRemaining <= 2 ||
                  friendlySites.length >= enemySites.length + 7,
                coreValue =
                  site.type === "capital" || site.type === "target"
                    ? coreWindow
                      ? 38
                      : difficulty === "hard" ? -52 : difficulty === "casual" ? -12 : -30
                    : 0,
                productionValue =
                  site.type === "dorm"
                    ? aiTeam === "pku"
                      ? difficulty === "hard" ? 88 : difficulty === "casual" ? 30 : 64
                      : 34
                    : site.type === "dining"
                      ? aiTeam === "pku"
                        ? difficulty === "hard" ? 62 : difficulty === "casual" ? 22 : 45
                        : 24
                      : 0,
                gateValue = site.type === "gate" ? 12 : 0,
                knownBuffRisk =
                  site.type === "teaching"
                    ? (difficulty === "hard" ? 32 : 20) +
                      (/物理|数学|化学|工学院|图书馆|技物/.test(site.name)
                        ? difficulty === "hard" ? 72 : 38
                        : 0)
                    : 0,
                qzBypassPenalty =
                  aiTeam === "pku" &&
                  site.name === "求真书院" &&
                  enemyProductionRemaining > 2
                    ? difficulty === "hard" ? 150 : difficulty === "casual" ? 40 : 100
                    : 0,
                intentValue =
                  isLostHomeSite(site)
                    ? currentIntent === "single_breakthrough" ? 105 : 46
                    : (site.type === "dorm" || site.type === "dining") &&
                        currentIntent === "positional"
                      ? 36
                      : (site.type === "dorm" || site.type === "dining") &&
                          currentIntent === "passive"
                        ? 22
                        : 0,
                nearbyFriendlySupport = friendlySites.filter(
                  (friendly) =>
                    Math.hypot(friendly.x - site.x, friendly.z - site.z) < 12,
                ).length,
                routeCongestion = activeRoutes.filter((route) => {
                  const routeTarget = g.sites[route.orderTarget!];
                  return (
                    routeTarget &&
                    Math.hypot(routeTarget.x - site.x, routeTarget.z - site.z) < 11
                  );
                }).length,
                flankValue =
                  productionValue > 0 && routeCongestion === 0
                    ? difficulty === "hard" ? 16 : 8
                    : 0,
                personalityValue =
                  personality.includes("穿插") && productionValue ? 14 :
                  personality.includes("反攻") && coreValue ? 10 : 0,
                cost =
                  Math.hypot(site.x - source.x, site.z - source.z) *
                    (aiTeam === "pku" &&
                    (site.type === "dorm" || site.type === "dining")
                      ? difficulty === "hard" ? 0.42 : difficulty === "casual" ? 0.9 : 0.62
                      : 1) +
                  estimatedDefenders *
                    (difficulty === "hard" ? 1.8 : difficulty === "casual" ? 1.15 : 1.45),
                routePath = findPath(
                  source.navX ?? source.x,
                  source.navZ ?? source.z,
                  site.navX ?? site.x,
                  site.navZ ?? site.z,
                ),
                unsafeRoute =
                  difficulty === "hard" &&
                  enemyProductionRemaining > 2 &&
                  pathCrossesEventRisk(routePath);
              return {
                site,
                score:
                  coreValue +
                  productionValue +
                  gateValue +
                  flankValue +
                  nearbyFriendlySupport * 2.2 -
                  knownBuffRisk -
                  qzBypassPenalty -
                  routeCongestion * (difficulty === "hard" ? 15 : 8) +
                  personalityValue -
                  cost +
                  intentValue -
                  forceGap * (difficulty === "hard" ? 7 : 3.5) +
                  (random() - .5) * (difficulty === "casual" ? 12 : 5),
                affordable:
                  estimatedDefenders <= 1 ||
                  requiredForce <= availableForce,
                unsafeRoute,
              };
            })
            .filter(
              ({ affordable, unsafeRoute }) =>
                (difficulty !== "hard" || affordable) && !unsafeRoute,
            )
            .sort((a, b) => b.score - a.score),
          poolSize = difficulty === "hard" ? 2 : difficulty === "casual" ? 5 : 3,
          target = scoredTargets.length
            ? scoredTargets[
                difficulty === "hard" && random() < 0.78
                  ? 0
                  : Math.floor(random() * Math.min(poolSize, scoredTargets.length))
              ].site
            : undefined;
        if (target) {
          const deployed = (() => {
            const productionSource =
                source.type === "dorm" || source.type === "dining",
              defenders = g.units.filter(
                (unit) =>
                  unit.team === enemyTeam &&
                  Math.hypot(unit.x - target.x, unit.z - target.z) < 5,
              ).length,
              idle = idleAt(source);
            source.stance = productionSource ? "guard" : "standby";
            source.dispatchRatio = productionSource ? 0.72 : 1;
            return issueOrder(
              aiTeam,
              source,
              target,
              Math.min(
                idle,
                Math.max(
                  difficulty === "hard" ? 6 : 4,
                  Math.ceil(defenders * (difficulty === "hard" ? 1.7 : 1.35) + 4),
                  Math.ceil(
                    idle *
                      (difficulty === "hard" ? 0.78 : difficulty === "casual" ? 0.22 : 0.58),
                  ),
                ),
              ),
              false,
            );
          })();
          if (deployed && difficulty === "casual") {
            source.orderTarget = undefined;
            source.orderPath = undefined;
          }
          if (deployed) routesCreated++;
        }
      }
    };
    const aiTimer = resilientSetInterval(() => {
      if (kernelOwnsSimulation) return;
      if (screenRef.current === "home" || pauseOpenRef.current) return;
      if (lanChannelsRef.current.size && !lanHostRef.current) return;
      if (
        !aiBenchmarkScenario &&
        dedicatedServerHostRef.current &&
        lanChannelIdentityRef.current.size === 0
      )
        return;
      const humanTeams = new Set<Team>([
          ...(dedicatedServerHostRef.current || observerAiModeRef.current
            ? []
            : [playerTeamRef.current]),
          ...[...lanChannelIdentityRef.current.values()].map(
            (identity) => identity.team,
          ),
        ]),
        benchmarkTeams = aiBenchmarkDifficulties
          ? (Object.keys(aiBenchmarkDifficulties) as Team[])
          : null,
        aiTeams =
          benchmarkTeams ??
          (["pku", "thu"] as Team[]).filter(
            (team) => !humanTeams.has(team),
          ),
        now = performance.now();
      for (const team of aiTeams) runAiTurn(team, now);
    }, 120);
    let raf = 0,
      last = performance.now(),
      statAt = 0,
      performanceWindowAt = last,
      performanceFrameTime = 0,
      performanceFrameCount = 0,
      simulationSpentMs = 0,
      simulationSamples = 0,
      lastShadowUpdateAt = 0,
      nextStuckCheckAt = 0,
      nextLodRefreshAt = 0,
      nextMapDetailLodAt = 0,
      nextUnitSimulationAt = 0,
      lastUnitSimulationAt = last,
      unitSimulationTick = 0,
      nextKernelAiSyncAt = 0,
      nextKernelVisualSyncAt = 0,
      kernelTimeScale = -1,
      kernelUnitSignature = "",
      kernelSiteSignature = "",
      kernelOrderSignature = "",
      kernelEventCursor = gameRef.current.campaign.eventHistory?.length ?? 0,
      kernelLastBattleAlertId = gameRef.current.campaign.battleAlerts?.at(-1)?.id ?? -1,
      kernelOutcomeAt = -1;
    const fieldContactFeed = createFieldContactFeed();
    const directCenter = new THREE.Vector3(),
      directCameraGoal = new THREE.Vector3(),
      siteMenuProjection = new THREE.Vector3();
    const animate = (now: number, backgroundServerTick = false) => {
      if (!backgroundServerTick) raf = requestAnimationFrame(animate);
      if (
        !backgroundServerTick &&
        dedicatedServerHostRef.current &&
        document.visibilityState === "hidden"
      )
        return;
      const rawDelta = (now - last) / 1000,
        dt = Math.min(backgroundServerTick ? 0.25 : 0.05, rawDelta);
      last = now;
      if (!backgroundServerTick && now >= nextMapDetailLodAt) {
        nextMapDetailLodAt = now + 240;
        const distance = camera.position.distanceTo(controls.target),
          daytime = gameRef.current.timeOfDay >= 6 && gameRef.current.timeOfDay <= 19;
        windowDetailMeshes.forEach((mesh) => {
          const center=mesh.userData.campusWindowCenter as {x:number;z:number}|undefined,
            localDistance=center?Math.hypot(center.x-camera.position.x,center.z-camera.position.z):0;
          mesh.visible=activeQualityProfile.windowDetails&&(!realCampus||distance<18&&localDistance<12&&(daytime||mesh.userData.campusWindowLit));
        });
        sportDetailMeshes.forEach((mesh) => (mesh.visible = !realCampus || distance < 16));
        buildingOutlineObjects.forEach((mesh) => (mesh.visible = !realCampus || distance < 22 && daytime));
      }
      if (!backgroundServerTick && rawDelta < 0.2) {
        performanceFrameTime += rawDelta;
        performanceFrameCount++;
        performanceController.reportFrame(rawDelta * 1000, now);
      }
      if (now - performanceWindowAt > 2000 && performanceFrameCount > 20) {
        const averageFrameTime = performanceFrameTime / performanceFrameCount;
        activeQualityProfile = performanceController.profile;
        const shadowsEnabled = activeQualityProfile.shadowSize > 0;
        renderer.shadowMap.enabled = shadowsEnabled;
        sun.castShadow = shadowsEnabled;
        if (shadowsEnabled && sun.shadow.mapSize.width !== activeQualityProfile.shadowSize) {
          sun.shadow.map?.dispose();
          sun.shadow.map = null;
          sun.shadow.mapSize.set(activeQualityProfile.shadowSize, activeQualityProfile.shadowSize);
          renderer.shadowMap.needsUpdate = true;
        }
        const nextPixelRatio = Math.min(
          maximumPixelRatio,
          activeQualityProfile.pixelRatio,
        );
        if (Math.abs(nextPixelRatio - renderPixelRatio) > 0.01) {
          renderPixelRatio = nextPixelRatio;
          renderer.setPixelRatio(renderPixelRatio);
          renderer.setSize(host.clientWidth, host.clientHeight, false);
        }
        performanceController.update({
          frameMs: averageFrameTime * 1000,
          fps: 1 / Math.max(0.001, averageFrameTime),
          drawCalls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
          instancedUnits: gameRef.current.units.length,
          transportUnits:
            gameRef.current.units.filter((unit) => unit.transport === "bike")
              .length +
            new Set(
              gameRef.current.units
                .filter(
                  (unit) =>
                    unit.transport === "bus" && unit.transportGroupId,
                )
                .map((unit) => unit.transportGroupId),
            ).size,
          detailedUnits: unitObjects.size,
          simulationMs:
            simulationSamples > 0 ? simulationSpentMs / simulationSamples : 0,
          pathfindingMs:
            pathfindingSamples > 0
              ? pathfindingSpentMs / pathfindingSamples
              : 0,
        });
        performanceWindowAt = now;
        performanceFrameTime = 0;
        performanceFrameCount = 0;
        simulationSpentMs = 0;
        simulationSamples = 0;
        pathfindingSpentMs = 0;
        pathfindingSamples = 0;
      }
      const g = gameRef.current;
      if (reviewSite && Number.isFinite(forcedReviewHour) && forcedReviewHour >= 0 && forcedReviewHour < 24) g.timeOfDay = forcedReviewHour;
      if (screenRef.current === "home") {
        if (!backgroundServerTick) {
          controls.update();
          renderer.render(scene, camera);
        }
        return;
      }
      if (pauseOpenRef.current) {
        if (!backgroundServerTick) renderer.render(scene, camera);
        return;
      }
      if (
        dedicatedServerHostRef.current &&
        lanChannelIdentityRef.current.size === 0
      ) {
        if (!backgroundServerTick) renderer.render(scene, camera);
        return;
      }
      if (now >= nextStuckCheckAt) {
        nextStuckCheckAt = now + 280;
        ejectTrappedUnits();
      }
      if (directControlActive) {
        const controlled = g.units.filter(
          (unit) =>
            unit.team === playerTeamRef.current && selectedUnitIds.has(unit.id),
        );
        if (!controlled.length) exitDirectControl();
        else {
          let leader = controlled.find((unit) => unit.id === directLeaderId);
          if (!leader) {
            leader = controlled[0];
            directLeaderId = leader.id;
            nextDirectFollowerPathAt = 0;
          }
          const stick = mobileMoveRef.current,
            moveX =
              (directKeys.has("d") ? 1 : 0) -
              (directKeys.has("a") ? 1 : 0) +
              stick.x,
            moveZ =
              (directKeys.has("s") ? 1 : 0) -
              (directKeys.has("w") ? 1 : 0) +
              stick.z,
            moveLength = Math.hypot(moveX, moveZ);
          leader.path = undefined;
          leader.pathIndex = undefined;
          leader.targetSiteId = undefined;
          if (moveLength) {
            leader.tx = leader.x + (moveX / moveLength) * 1.2;
            leader.tz = leader.z + (moveZ / moveLength) * 1.2;
          } else {
            leader.tx = leader.x;
            leader.tz = leader.z;
          }
          const followers = controlled.filter((unit) => unit.id !== leader.id);
          followers.forEach((unit) => (unit.targetSiteId = undefined));
          if (now >= nextDirectFollowerPathAt) {
            nextDirectFollowerPathAt = now + 420;
            followers.forEach((unit, index) => {
              const ring = Math.floor(index / 6),
                angle = ((index % 6) / 6) * Math.PI * 2 + leader.id * 0.37,
                radius = 0.32 + ring * 0.22,
                targetX = leader.x + Math.cos(angle) * radius,
                targetZ = leader.z + Math.sin(angle) * radius,
                distance = Math.hypot(unit.x - targetX, unit.z - targetZ);
              if (distance < 0.2) {
                unit.path = undefined;
                unit.pathIndex = undefined;
                unit.tx = unit.x;
                unit.tz = unit.z;
                return;
              }
              const path = findPath(unit.x, unit.z, targetX, targetZ);
              if (!path.length) return;
              const destination = path.at(-1)!;
              unit.path = path;
              unit.pathIndex = 0;
              unit.tx = destination[0];
              unit.tz = destination[1];
            });
          }
          if (now >= nextDirectCommandAt) {
            nextDirectCommandAt = now + 100;
            if (canIssuePlayerCommandRef.current()) playerCommandSenderRef.current({ unitIds: controlled.map(u => u.id) });
          }
          controlled.forEach((unit) => {
            const object = unitObjects.get(unit.id),
              ring = object?.userData.selectionRing as
                | THREE.Sprite
                | undefined;
            ring?.scale.setScalar(unit.id === leader.id ? 2.05 : 1.42);
          });
          const averageX =
              controlled.reduce((sum, unit) => sum + unit.x, 0) /
              controlled.length,
            averageZ =
              controlled.reduce((sum, unit) => sum + unit.z, 0) /
              controlled.length,
            centerX = THREE.MathUtils.lerp(leader.x, averageX, 0.3),
            centerZ = THREE.MathUtils.lerp(leader.z, averageZ, 0.3),
            centerY = terrainHeight(regionForX(centerX), centerX, centerZ);
          directCenter.set(centerX, centerY + 0.15, centerZ);
          directCameraGoal.set(centerX, centerY + 5.4, centerZ + 4.4);
          camera.position.lerp(directCameraGoal, 0.16);
          controls.target.copy(directCenter);
          camera.lookAt(directCenter);
          const minimap = minimapRef.current;
          if (minimap) {
            const context = minimap.getContext("2d")!,
              region = regions.main,
              mapX = (x: number) =>
                ((x - (region.offsetX - region.width / 2)) / region.width) *
                minimap.width,
              mapY = (z: number) =>
                ((region.depth / 2 - z) / region.depth) * minimap.height;
            context.clearRect(0, 0, minimap.width, minimap.height);
            context.fillStyle = "rgba(6,14,18,.92)";
            context.fillRect(0, 0, minimap.width, minimap.height);
            context.strokeStyle = "rgba(255,255,255,.12)";
            context.strokeRect(0.5, 0.5, minimap.width - 1, minimap.height - 1);
            g.sites
              .filter((site) => !site.destroyed)
              .forEach((site) => {
                context.fillStyle = site.team === "pku" ? "#e52c49" : "#9855bd";
                context.beginPath();
                context.arc(mapX(site.x), mapY(site.z), 1.6, 0, Math.PI * 2);
                context.fill();
              });
            context.fillStyle = "#72edff";
            followers.forEach((unit) => {
              context.beginPath();
              context.arc(mapX(unit.x), mapY(unit.z), 2.5, 0, Math.PI * 2);
              context.fill();
            });
            context.fillStyle = "#fff2a6";
            context.beginPath();
            context.arc(mapX(leader.x), mapY(leader.z), 3.5, 0, Math.PI * 2);
            context.fill();
            context.strokeStyle = "#fff2a6";
            context.lineWidth = 2;
            context.beginPath();
            context.arc(mapX(leader.x), mapY(leader.z), 7, 0, Math.PI * 2);
            context.stroke();
          }
        }
      }
      const authoritativeGuest =
        isRemoteGuest();
      if (g.campaign.fieldEncounters?.alerts.length) for (const contact of fieldContactFeed(g.campaign)) {
        spawnCombatEffect(contact.x, contact.z);
        window.dispatchEvent(new CustomEvent("qingbei-field-contact", {detail: {id: contact.id}}));
      }
      if (authoritativeGuest) {
        const ids = new Set<number>(), alpha = 1 - Math.exp(-16 * Math.max(0, Math.min(.25, rawDelta)));
        for (const unit of g.units) {
          ids.add(unit.id);
          const previous = renderPositions.get(unit.id);
          if (!previous || Math.hypot(previous.x - unit.x, previous.z - unit.z) > 8)
            renderPositions.set(unit.id, { x: unit.x, z: unit.z });
          else { previous.x += (unit.x - previous.x) * alpha; previous.z += (unit.z - previous.z) * alpha; }
        }
        for (const id of renderPositions.keys()) if (!ids.has(id)) renderPositions.delete(id);
      }
      if (kernelOwnsSimulation && !authoritativeGuest) {
        if (kernelTimeScale !== timeScaleRef.current) {
          kernelTimeScale = timeScaleRef.current;
          sharedKernel.dispatch({ type: "set_time_scale", value: kernelTimeScale });
        }
        if (now >= nextKernelAiSyncAt) {
          nextKernelAiSyncAt = now + 500;
          const humanTeams = new Set<Team>([
            ...(dedicatedServerHostRef.current || observerAiModeRef.current
              ? []
              : [playerTeamRef.current]),
            ...[...lanChannelIdentityRef.current.values()].map(
              (identity) => identity.team,
            ),
          ]);
          for (const team of ["pku", "thu"] as Team[])
            sharedKernel.dispatch({
              type: "set_ai_enabled",
              team,
              enabled: !humanTeams.has(team),
            });
        }
        sharedKernel.advanceOnly(Math.min(250, Math.max(1, rawDelta * 1000)));
        if (now >= nextKernelVisualSyncAt) {
          nextKernelVisualSyncAt = now + 200;
          const nextUnitSignature = `${g.units.length}/${g.units.reduce(
              (sum, unit) =>
                sum + unit.id * 3 + (unit.transport ? 7 : 0) + (unit.skin ? 11 : 0),
              0,
            )}`,
            nextSiteSignature = g.sites
              .map((site) => `${site.id}:${site.team}:${site.destroyed ? 1 : 0}`)
              .join("|"),
            nextOrderSignature = g.sites
              .map((site) => `${site.id}>${site.orderTarget ?? ""}`)
              .join("|");
          if (nextUnitSignature !== kernelUnitSignature) {
            kernelUnitSignature = nextUnitSignature;
            rebuildUnits();
          }
          if (nextSiteSignature !== kernelSiteSignature) {
            kernelSiteSignature = nextSiteSignature;
            rebuildBuildings();
          }
          if (nextOrderSignature !== kernelOrderSignature) {
            kernelOrderSignature = nextOrderSignature;
            rebuildCommandLines();
          }
          const history = g.campaign.eventHistory ?? [];
          while (kernelEventCursor < history.length) {
            const { atHour: _atHour, ...event } = history[kernelEventCursor++];
            pushEvent(event);
          }
          const alerts = g.campaign.battleAlerts ?? [];
          for (const alert of alerts) {
            if (alert.id <= kernelLastBattleAlertId) continue;
            spawnCombatEffect(alert.x, alert.z);
            for (const unit of unitsNearPoint(alert.x, alert.z, 2.8))
              unitFightingUntil.set(unit.id, now + 420);
          }
          kernelLastBattleAlertId = alerts.at(-1)?.id ?? kernelLastBattleAlertId;
          if (
            g.campaign.outcome &&
            g.campaign.outcome.atHour !== kernelOutcomeAt
          ) {
            kernelOutcomeAt = g.campaign.outcome.atHour;
            const winner = g.campaign.outcome.winner;
            setVictoryBroadcast({
              winner,
              title:
                winner === "pku"
                  ? "胜利广播：北大全面胜利"
                  : `胜利广播：${g.campaign.thuFactionName}全面胜利`,
              body: `${g.campaign.outcome.reason}；地图仍可继续游玩。`,
            });
          }
        }
      } else if (!kernelOwnsSimulation && !authoritativeGuest) {
        g.campaign.elapsedHours += dt * 0.18 * timeScaleRef.current;
        if (autoDayRef.current)
          g.timeOfDay = (8 + g.campaign.elapsedHours) % 24;
      }
      if (reviewSite && Number.isFinite(forcedReviewHour) && forcedReviewHour >= 0 && forcedReviewHour < 24) g.timeOfDay = forcedReviewHour;
      const angle = ((g.timeOfDay - 6) / 24) * Math.PI * 2,
        day = THREE.MathUtils.smoothstep(Math.sin(angle), -0.12, 0.35),
        night = 1 - day;
      sun.position.set(
        Math.cos(angle) * 55,
        Math.max(-4, Math.sin(angle) * 55),
        25,
      );
      sun.intensity = day * 3.4;
      const shouldCastSunShadow =
        day > 0.08 && activeQualityProfile.dynamicLights > 0;
      if (sun.castShadow !== shouldCastSunShadow) {
        sun.castShadow = shouldCastSunShadow;
        renderer.shadowMap.needsUpdate = true;
      }
      if (
        shouldCastSunShadow &&
        now - lastShadowUpdateAt > activeQualityProfile.shadowIntervalMs
      ) {
        lastShadowUpdateAt = now;
        renderer.shadowMap.needsUpdate = true;
      }
      moon.position.set(-sun.position.x, Math.max(10, -sun.position.y), -25);
      moon.intensity = night * 1.25;
      hemi.intensity = 0.72 + day * 1.18;
      hemi.color.set(day > 0.35 ? 0xcfe8ff : 0x7890a5);
      hemi.groundColor.set(day > 0.35 ? 0x324226 : 0x303a4b);
      const sky = new THREE.Color(0x07101f).lerp(
        new THREE.Color(0x9fc5d8),
        day,
      );
      scene.background = sky;
      (scene.fog as THREE.FogExp2).color.copy(sky);
      (scene.fog as THREE.FogExp2).density = realCampus ? 0.007 + night * 0.015 : 0.007;
      windowMaterials.forEach((m) => (m.emissiveIntensity = night * 0.48));
      buildingSurfaceMaterials.forEach((m) => (m.emissiveIntensity = night * 0.32));
      sportMaterials.forEach(
        (material) =>
          (material.emissiveIntensity = 0.025 + night * 0.16),
      );
      lampBulbMaterial.emissiveIntensity = 0.08 + night * 4.8;
      lampGlowMaterial.opacity = night * (realCampus ? 0.26 : 0.14);
      if (now - lastLampLightUpdateAt > 500) {
        lastLampLightUpdateAt = now;
        const nearestLamps = lampPositions
          .map((lamp) => ({ lamp, distance: Math.hypot(lamp.x - controls.target.x, lamp.z - controls.target.z) }))
          .sort((a, b) => a.distance - b.distance)
          .slice(0, lights.length);
        lights.forEach((light, index) => {
          const candidate = nearestLamps[index];
          light.userData.hasLamp = !!candidate;
          if (!candidate) return;
          light.position.set(candidate.lamp.x, terrainHeight(candidate.lamp.r, candidate.lamp.x, candidate.lamp.z) + (realCampus ? 0.17 : 0.9), candidate.lamp.z);
        });
      }
      unitBodyMaterials.pku.emissiveIntensity = 0.035 + night * 0.24;
      unitBodyMaterials.thu.emissiveIntensity = 0.035 + night * 0.24;
      unitBodyMaterials.ustc.emissiveIntensity = 0.035 + night * 0.24;
      unitBodyMaterials.zju.emissiveIntensity = 0.035 + night * 0.24;
      unitBodyMaterials.nju.emissiveIntensity = 0.035 + night * 0.24;
      unitBodyMaterials.fdu.emissiveIntensity = 0.035 + night * 0.24;
      unitBodyMaterials.sjtu.emissiveIntensity = 0.035 + night * 0.24;
      lights.forEach(
        (light, index) =>
          (light.intensity =
            light.userData.hasLamp && index < activeQualityProfile.dynamicLights ? night * (realCampus ? 5 : 5.5) : 0),
      );
      renderer.toneMappingExposure = 0.9 + day * 0.2;
      commandAnimations.forEach((animation) => {
        animation.movers.forEach((mover, index) => {
          const t = (now * 0.00016 + animation.phase + index / 4) % 1;
          animation.curve.getPoint(t, mover.position);
          animation.curve.getTangent(t, commandTangent).normalize();
          orientCommandArrow(mover, mover.position, commandTangent);
        });
      });
      for (let i = combatEffects.length - 1; i >= 0; i--) {
        const effect = combatEffects[i],
          progress = (now - effect.born) / 720;
        if (progress >= 1) {
          combatGroup.remove(effect.sprite);
          effect.sprite.material.dispose();
          combatEffects.splice(i, 1);
          continue;
        }
        effect.sprite.position.y += dt * 0.45;
        effect.sprite.scale.setScalar(1 + progress * 1.3);
        (effect.sprite.material as THREE.SpriteMaterial).opacity = 1 - progress;
      }
      const simulationTimeScale = THREE.MathUtils.clamp(
          timeScaleRef.current,
          0.5,
          16,
        ),
        simulateUnits = now >= nextUnitSimulationAt,
        simulationDt = simulateUnits
          ? Math.min(
              0.85,
              Math.max(
                0.005,
                ((now - lastUnitSimulationAt) / 1000) * simulationTimeScale,
              ),
            )
          : 0,
        simulationStartedAt = simulateUnits ? performance.now() : 0;
      if (simulateUnits) {
        nextUnitSimulationAt = now + 50;
        lastUnitSimulationAt = now;
        unitSimulationTick++;
        refreshDynamicUnitIndex();
      }
      const separationCell = 0.24,
        separationGrid = new Map<string, UnitState[]>(),
        separationKey = (x: number, z: number) =>
          `${Math.floor(x / separationCell)}/${Math.floor(z / separationCell)}`;
      if (simulateUnits)
        g.units.forEach((unit) => {
          const key = separationKey(unit.x, unit.z),
            bucket = separationGrid.get(key);
          if (bucket) bucket.push(unit);
          else separationGrid.set(key, [unit]);
        });
      const renderUnitDetails =
        directControlActive || camera.position.distanceTo(controls.target) < 20;
      let lodRefreshed = false;
      if (!aiBenchmarkScenario && now >= nextLodRefreshAt) {
        nextLodRefreshAt = now + 250;
        syncDetailedUnits();
        lodRefreshed = true;
      }
      g.units.forEach((u) => {
        const mesh = unitObjects.get(u.id);
        const pathPoint =
            u.path && (u.pathIndex ?? 0) < u.path.length
              ? u.path[u.pathIndex ?? 0]
              : null,
          destinationX = pathPoint?.[0] ?? u.tx,
          destinationZ = pathPoint?.[1] ?? u.tz,
          dx = destinationX - u.x,
          dz = destinationZ - u.z,
          dist = Math.hypot(dx, dz),
          fighting = (unitFightingUntil.get(u.id) ?? 0) > now,
          phase = now * 0.014 + u.id;
        if (mesh && mesh.userData.detailsVisible !== renderUnitDetails) {
          (mesh.userData.detailParts as THREE.Mesh[]).forEach(
            (part) => (part.visible = renderUnitDetails),
          );
          mesh.userData.detailsVisible = renderUnitDetails;
        }
        if (mesh && renderUnitDetails) {
          (mesh.userData.arms as THREE.Mesh[]).forEach(
            (arm, index) =>
              (arm.rotation.x =
                (fighting ? 0.95 : dist > 0.18 ? 0.42 : 0) *
                Math.sin(phase + index * Math.PI)),
          );
          (mesh.userData.legs as THREE.Mesh[]).forEach(
            (leg, index) =>
              (leg.rotation.x =
                (fighting ? 0.38 : dist > 0.18 ? 0.5 : 0) *
                Math.sin(phase + index * Math.PI)),
          );
        }
        if (mesh) {
          mesh.userData.body.position.y =
            0.98 + (fighting ? Math.abs(Math.sin(phase * 1.7)) * 0.18 : 0);
          const glow = mesh.userData.glow as THREE.Mesh;
          glow.visible = fighting || selectedUnitIds.has(u.id) || night > 0.34;
          glow.scale.setScalar(fighting ? 1 + Math.sin(phase * 2) * 0.16 : 1);
        }
        if (kernelOwnsSimulation) {
          if (mesh) {
            const position = renderPosition(u);
            mesh.position.set(
              position.x,
              terrainHeight(regionForX(position.x), position.x, position.z) +
                (insideWater(position.x, position.z) ? 0.1 : 0),
              position.z,
            );
            if (dist > 0.02) mesh.rotation.y = Math.atan2(dx, dz);
          }
          return;
        }
        if (fighting || !simulateUnits) return;
        const distanceToView = Math.hypot(
            u.x - controls.target.x,
            u.z - controls.target.z,
          ),
          prioritySimulation =
            !!mesh ||
            selectedUnitIds.has(u.id) ||
            u.id === directLeaderId ||
            u.retreating,
          baseSimulationDivisor = prioritySimulation
            ? 1
            : distanceToView < 32
              ? 2
              : 4,
          maximumSimulationDivisor =
            simulationTimeScale >= 10
              ? 1
              : simulationTimeScale >= 4
                ? 2
                : 4,
          simulationDivisor = Math.min(
            baseSimulationDivisor,
            maximumSimulationDivisor,
          );
        if ((unitSimulationTick + u.id) % simulationDivisor !== 0) return;
        const unitSimulationDt = simulationDt * simulationDivisor;
        if (pathPoint && dist < 0.24) {
          u.pathIndex = (u.pathIndex ?? 0) + 1;
          return;
        }
        if (dist > 0.18) {
          if (g.campaign.freezeUntil[u.team] > g.campaign.elapsedHours) return;
          if (u.transport === "bus") {
            const currentIndex = navIndex(navGrid, u.x, u.z);
            if (
              currentIndex < 0 ||
              !navGrid.road[currentIndex] ||
              navGrid.water[currentIndex] ||
              navGrid.building[currentIndex]
            )
              disembarkBusGroup(u.transportGroupId);
          }
          const transportDefinition = u.transportModel
              ? RESEARCH_DEFINITIONS[u.transportModel]
              : undefined,
            outsideCampusPenalty =
              u.transportModel === "thu_purple_bike" &&
              !insideTsinghuaCampus(u.x, u.z);
          u.transportOutsidePenalty = outsideCampusPenalty;
          const gridIndex = navIndex(navGrid, u.x, u.z),
            unitStatus = unitStatusModifiers(u),
            unitDecision = decisionEffectsFor(g.campaign, u.team),
            roadSpeed = gridIndex >= 0 && navGrid.road[gridIndex] ? 0.78 : 0.5,
            terrainSpeed =
              (buildingAt(u.x, u.z) ? 0.34 : 1) *
              (insideWater(u.x, u.z)
                ? 0.5 * unitStatus.riverMovement * (unitDecision.riverMovement ?? 1)
                : 1),
            morningMove =
              (g.campaign.morningPenaltyUntil ?? 0) > g.campaign.elapsedHours
                ? 0.68
                : 1,
            transportSpeed =
              (transportDefinition?.movementMultiplier ?? 1) *
              (outsideCampusPenalty
                ? transportDefinition?.outsideCampusMovement ?? 1
                : 1),
            slopeLookAhead = Math.min(0.9, dist),
            elevationDelta =
              terrainHeight(
                regionForX(u.x),
                u.x + (dx / dist) * slopeLookAhead,
                u.z + (dz / dist) * slopeLookAhead,
              ) - terrainHeight(regionForX(u.x), u.x, u.z),
            slopeSpeed =
              elevationDelta > 0
                ? THREE.MathUtils.clamp(1 - elevationDelta * 1.85, 0.52, 1)
                : THREE.MathUtils.clamp(
                    1 + Math.abs(elevationDelta) * 0.38,
                    1,
                    1.16,
                  ),
            rawStep =
              roadSpeed *
              terrainSpeed *
              transportSpeed *
              slopeSpeed *
              (u.moveModifier ?? 1) *
              morningMove *
              unitStatus.movement *
              (unitDecision.movement ?? 1) *
              unitSimulationDt,
            fastPathAdvance =
              pathPoint && u.path && rawStep > dist
                ? (() => {
                    let budget = rawStep,
                      x = u.x,
                      z = u.z,
                      index = u.pathIndex ?? 0;
                    while (index < u.path!.length && budget > 0.001) {
                      const point = u.path![index],
                        segmentX = point[0] - x,
                        segmentZ = point[1] - z,
                        segmentDistance = Math.hypot(segmentX, segmentZ);
                      if (segmentDistance < 0.001) {
                        index++;
                        continue;
                      }
                      if (segmentDistance > budget) {
                        x += (segmentX / segmentDistance) * budget;
                        z += (segmentZ / segmentDistance) * budget;
                        budget = 0;
                      } else {
                        x = point[0];
                        z = point[1];
                        budget -= segmentDistance;
                        index++;
                      }
                    }
                    return { x, z, pathIndex: index };
                  })()
                : null,
            s = Math.min(rawStep, dist);
          const forwardX = dx / dist,
            forwardZ = dz / dist,
            gx = Math.floor(u.x / separationCell),
            gz = Math.floor(u.z / separationCell);
          let separateX = 0,
            separateZ = 0;
          for (let ox = -1; ox <= 1; ox++)
            for (let oz = -1; oz <= 1; oz++)
              for (const neighbor of separationGrid.get(
                `${gx + ox}/${gz + oz}`,
              ) ?? []) {
                if (neighbor.id === u.id) continue;
                const awayX = u.x - neighbor.x,
                  awayZ = u.z - neighbor.z,
                  distance = Math.hypot(awayX, awayZ);
                if (distance <= 0.001 || distance >= UNIT_SEPARATION_DISTANCE)
                  continue;
                const pressure =
                  (UNIT_SEPARATION_DISTANCE - distance) /
                  UNIT_SEPARATION_DISTANCE;
                separateX += (awayX / distance) * pressure;
                separateZ += (awayZ / distance) * pressure;
              }
          let moveX = forwardX + separateX * 0.58,
            moveZ = forwardZ + separateZ * 0.58,
            moveLength = Math.hypot(moveX, moveZ);
          if (
            moveLength < 0.001 ||
            (moveX * forwardX + moveZ * forwardZ) / moveLength < 0.3
          ) {
            moveX = forwardX;
            moveZ = forwardZ;
            moveLength = 1;
          }
          const reachesWaypoint = s >= dist * 0.98,
            nextX = fastPathAdvance
              ? fastPathAdvance.x
              : reachesWaypoint
                ? destinationX
                : u.x + (moveX / moveLength) * s,
            nextZ = fastPathAdvance
              ? fastPathAdvance.z
              : reachesWaypoint
                ? destinationZ
                : u.z + (moveZ / moveLength) * s;
          if (u.transport === "bus") {
            const nextIndex = navIndex(navGrid, nextX, nextZ);
            if (
              nextIndex < 0 ||
              !navGrid.road[nextIndex] ||
              navGrid.water[nextIndex] ||
              navGrid.building[nextIndex]
            ) {
              disembarkBusGroup(u.transportGroupId);
              return;
            }
          }
          let resolvedX = nextX,
            resolvedZ = nextZ;
          if (!pointWalkable(nextX, nextZ, u.team)) {
            const slideCandidates = [
                [nextX, u.z],
                [u.x, nextZ],
                [u.x + (moveZ / moveLength) * s, u.z],
                [u.x, u.z - (moveX / moveLength) * s],
              ].filter(([x, z]) => pointWalkable(x, z, u.team)),
              bestSlide = slideCandidates.sort(
                (a, b) =>
                  (b[0] - u.x) * forwardX +
                  (b[1] - u.z) * forwardZ -
                  ((a[0] - u.x) * forwardX + (a[1] - u.z) * forwardZ),
              )[0];
            if (!bestSlide) {
              if (directControlActive && u.id === directLeaderId) {
                const safeIndex = nearestClearIndex(u.x, u.z);
                if (safeIndex >= 0) [u.x, u.z] = navPoint(navGrid, safeIndex);
              }
              return;
            }
            [resolvedX, resolvedZ] = bestSlide;
          }
          u.x = resolvedX;
          u.z = resolvedZ;
          if (fastPathAdvance)
            u.pathIndex = fastPathAdvance.pathIndex;
          if (mesh) {
            mesh.position.set(
              u.x,
              terrainHeight(regionForX(u.x), u.x, u.z) +
                (insideWater(u.x, u.z) ? 0.1 : 0),
              u.z,
            );
            mesh.rotation.y = Math.atan2(moveX, moveZ);
          }
        }
      });
      if (!aiBenchmarkScenario && (simulateUnits || lodRefreshed))
        updateFarUnitInstances();
      if (simulateUnits) {
        simulationSpentMs += performance.now() - simulationStartedAt;
        simulationSamples++;
      }
      if (now - statAt > 1000) {
        statAt = now;
        let pkuPopulation = 0,
          thuPopulation = 0,
          pkuSiteCount = 0,
          thuSiteCount = 0;
        nearbyPopulationCache.clear();
        for (const site of g.sites) {
          if (site.destroyed) continue;
          if (site.team === "pku") pkuSiteCount++;
          else thuSiteCount++;
          nearbyPopulationCache.set(site.id, 0);
        }
        for (const unit of g.units) {
          if (unit.team === "pku") pkuPopulation += unit.strength;
          else thuPopulation += unit.strength;
          const boundSite = g.sites[unit.siteId];
          if (
            boundSite &&
            !boundSite.destroyed &&
            boundSite.team === unit.team &&
            Math.hypot(
              unit.x - (boundSite.navX ?? boundSite.x),
              unit.z - (boundSite.navZ ?? boundSite.z),
            ) < 3.4
          )
            nearbyPopulationCache.set(
              boundSite.id,
              (nearbyPopulationCache.get(boundSite.id) ?? 0) + unit.strength,
            );
        }
        setStats({
          pku: pkuPopulation,
          thu: thuPopulation,
          pkuSites: pkuSiteCount,
          thuSites: thuSiteCount,
          pkuGrowth: productionGrowthPerHour("pku"),
          thuGrowth: productionGrowthPerHour("thu"),
        });
        const campaignDate = new Date(
          new Date(g.campaign.startDateISO).getTime() +
            g.campaign.elapsedHours * 3_600_000,
        );
        setClock(
          campaignDate.toLocaleString("zh-CN", {
            timeZone: "Asia/Shanghai",
            month: "numeric",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }),
        );
        siteObjects.forEach((object, id) => {
          const site = g.sites[id],
            badge = object.userData.countBadge as
              | {
                  context: CanvasRenderingContext2D;
                  texture: THREE.CanvasTexture;
                  last: number;
                }
              | undefined;
          if (!site || !badge) return;
          const count = nearbyFriendlyPeople(site);
          if (count === badge.last) return;
          drawSiteCount(badge.context, site, count);
          badge.texture.needsUpdate = true;
          badge.last = count;
        });
      }
      if (!directControlActive) controls.update();
      const markerCameraDistance = camera.position.distanceTo(controls.target),
        fixedRingScale = THREE.MathUtils.clamp(
          markerCameraDistance / Math.hypot(24, 22),
          0.45,
          1.9,
        ),
        showSiteLabels = markerCameraDistance <= 27;
      updateSiteNodeBatches(fixedRingScale);
      siteObjects.forEach((object, id) => {
        const selectionHighlight = object.userData.routeHighlight as
          THREE.Object3D | undefined;
        if (selectionHighlight)
          selectionHighlight.visible = selectedRef.current === id;
        const label = object.userData.labelSprite as THREE.Sprite | undefined;
        if (label)
          label.visible =
            showSiteLabels || selectedRef.current === id || hoveredSiteId === id;
        const icons = object.userData.fixedMarkerIcons as
          | {
              object: THREE.Sprite;
              x: number;
              y: number;
              scaleX: number;
              scaleY: number;
            }[]
          | undefined;
        icons?.forEach((icon) => {
          icon.object.position.x = icon.x * fixedRingScale;
          icon.object.position.y = 1.75 + (icon.y - 1.75) * fixedRingScale;
          icon.object.scale.set(
            icon.scaleX * fixedRingScale,
            icon.scaleY * fixedRingScale,
            1,
          );
        });
      });
      const active = regions[regionRef.current],
        marginX = Math.min(18, active.width * 0.32),
        marginZ = Math.min(14, active.depth * 0.32),
        cx = THREE.MathUtils.clamp(
          controls.target.x,
          active.offsetX - active.width / 2 + marginX,
          active.offsetX + active.width / 2 - marginX,
        ),
        cz = THREE.MathUtils.clamp(
          controls.target.z,
          -active.depth / 2 + marginZ,
          active.depth / 2 - marginZ,
        ),
        shiftX = cx - controls.target.x,
        shiftZ = cz - controls.target.z;
      if (shiftX || shiftZ) {
        controls.target.x = cx;
        controls.target.z = cz;
        camera.position.x += shiftX;
        camera.position.z += shiftZ;
      }
      const siteMenu = siteMenuRef.current,
        selectedSiteId = selectedRef.current;
      if (siteMenu && selectedSiteId != null) {
        const selectedSite = g.sites[selectedSiteId];
        if (!selectedSite || selectedSite.destroyed)
          siteMenu.style.display = "none";
        else {
          camera.updateMatrixWorld();
          siteNodeWorldPosition(selectedSite, siteMenuProjection).project(
            camera,
          );
          if (siteMenuProjection.z < -1 || siteMenuProjection.z > 1)
            siteMenu.style.display = "none";
          else {
            const rect = renderer.domElement.getBoundingClientRect(),
              menuWidth = siteMenu.offsetWidth || 220,
              menuHeight = siteMenu.offsetHeight || 110,
              screenX =
                rect.left + ((siteMenuProjection.x + 1) * rect.width) / 2,
              screenY =
                rect.top + ((1 - siteMenuProjection.y) * rect.height) / 2,
              left = THREE.MathUtils.clamp(
                screenX,
                menuWidth / 2 + 8,
                innerWidth - menuWidth / 2 - 8,
              ),
              top = THREE.MathUtils.clamp(
                screenY - 34,
                menuHeight + 8,
                innerHeight - 8,
              );
            siteMenu.style.display = "block";
            siteMenu.style.left = `${left}px`;
            siteMenu.style.top = `${top}px`;
          }
        }
      }
      if (!backgroundServerTick && (!aiBenchmarkScenario || renderBenchmark))
        renderer.render(scene, camera);
    };
    let serverClockWorker: Worker | null = null;
    if (dedicatedServerHostRef.current) {
      serverClockWorker = new ServerClockWorker();
      serverClockWorker.onmessage = () => {
        if (
          !dedicatedServerHostRef.current ||
          document.visibilityState !== "hidden"
        )
          return;
        const tickNow = performance.now();
        for (const task of resilientTasks.values()) {
          let iterations = 0;
          while (tickNow >= task.nextAt && iterations < 4) {
            task.callback();
            task.nextAt += task.interval;
            iterations++;
          }
          if (tickNow >= task.nextAt) task.nextAt = tickNow + task.interval;
        }
        animate(tickNow, true);
      };
      serverClockWorker.postMessage({ type: "start" });
    }
    raf = requestAnimationFrame(animate);
    const resize = () => {
      renderer.setSize(host.clientWidth, host.clientHeight);
      camera.aspect = host.clientWidth / host.clientHeight;
      const nextPortrait = mobileClient && host.clientHeight > host.clientWidth;
      camera.fov = nextPortrait ? 58 : 38;
      if (nextPortrait !== portraitViewport && nextPortrait) {
        const offset = camera.position.clone().sub(controls.target);
        if (offset.length() < 48)
          camera.position.copy(controls.target).add(offset.setLength(48));
      }
      portraitViewport = nextPortrait;
      camera.updateProjectionMatrix();
      commandLineMaterials.forEach((material) =>
        material.resolution.set(host.clientWidth, host.clientHeight),
      );
    };
    addEventListener("resize", resize);
    sceneApi.current = {
      sync: (lightweight = false) => {
        if (isRemoteGuest()) {
          // No pathfinding, relocation or destination writes on received state.
          if (!lightweight) { rebuildBuildings(); rebuildUnits(); }
          else rebuildSiteNodeBatches();
          rebuildCommandLines();
          return;
        }
        refreshNavAnchors();
        gameRef.current.sites.forEach((source) => {
          if (source.destroyed || source.orderTarget == null) return;
          const target = gameRef.current.sites[source.orderTarget];
          if (!target || target.destroyed) return;
          const orderPath = findPath(
            source.navX ?? source.x,
            source.navZ ?? source.z,
            target.navX ?? target.x,
            target.navZ ?? target.z,
          );
          source.orderPath = orderPath;
          if (!orderPath.length) {
            source.orderPath = undefined;
            source.orderTarget = undefined;
          }
        });
        gameRef.current.units.forEach((unit) => {
          if (unit.targetSiteId == null) return;
          const target = gameRef.current.sites[unit.targetSiteId];
          if (!target || target.destroyed) return;
          const unitPath = findPath(
            unit.x,
            unit.z,
            target.navX ?? target.x,
            target.navZ ?? target.z,
          );
          unit.path = unitPath;
          if (!unitPath.length) {
            unit.path = undefined;
            unit.targetSiteId = undefined;
            unit.tx = unit.x;
            unit.tz = unit.z;
            return;
          }
          unit.pathIndex = 0;
        });
        rebuildBuildings();
        rebuildUnits();
        rebuildCommandLines();
      },
      focus: (id) => {
        regionRef.current = id;
        const [x, z] = [-22, 14];
        controls.target.set(x, 0, z);
        camera.position.set(
          x,
          portraitViewport ? 36 : 24,
          z + (portraitViewport ? 36 : 22),
        );
        controls.update();
      },
      applyMaterials,
      clearUnitSelection: () => {
        selectedUnitIds.clear();
        refreshUnitSelection();
      },
      setLayers: (sites, control) => {
        buildingGroup.visible = sites && !reviewSite;
        siteNodeBatchGroup.visible = sites && !reviewSite;
        territoryGroup.visible = control && !reviewSite;
      },
      setPerspective: (team) => {
        const target = controls.target.clone(),
          height = portraitViewport ? 36 : 24,
          depth =
            team === "thu"
              ? portraitViewport
                ? -36
                : -22
              : portraitViewport
                ? 36
                : 22;
        camera.position.set(target.x, height, target.z + depth);
        camera.lookAt(target);
        controls.update();
      },
      buildCampAt: (x, z, team) =>
        buildCampAt(
          new THREE.Vector3(x, terrainHeight(regionForX(x), x, z), z),
          team,
        ),
      enterDirectControl,
      exitDirectControl,
      refreshSiteStance,
      zoomBy: (factor) => {
        const offset = camera.position.clone().sub(controls.target),
          distance = THREE.MathUtils.clamp(
            offset.length() * factor,
            controls.minDistance,
            controls.maxDistance,
          );
        camera.position.copy(controls.target).add(offset.setLength(distance));
        controls.update();
      },
      beginTouchRoute: (siteId) => {
        const source = gameRef.current.sites[siteId];
        if (!source || source.team !== playerTeamRef.current || source.destroyed) return;
        touchRouteSourceId = siteId;
        setSelected(null);
        setNotice(
          `点按目标据点，为${source.displayName ?? source.name}建立持续兵线；再次点按原据点可取消`,
        );
      },
      setToolMode: (mode) => {
        activeToolMode = mode;
        setNotice(
          mode === "simplify-lines"
            ? "兵线简化工具：按住左键划过链式兵线"
            : mode === "multi-route"
              ? "多目标兵线工具：拖动依次经过据点，松开后建立连续路线"
              : "已退出战场工具",
        );
      },
      mobilizeAll: (team, stance) => {
        const ratio = stance === "defend" ? 0.4 : stance === "guard" ? 0.7 : 1;
        gameRef.current.sites
          .filter((site) => site.team === team && !site.destroyed)
          .forEach((site) => {
            site.stance = stance;
            site.dispatchRatio = ratio;
          });
        rebuildSiteNodeBatches();
        setNotice(
          `${team === "pku" ? "北大" : gameRef.current.campaign.thuFactionName}全部据点已切换为${stance === "defend" ? "防守" : stance === "guard" ? "守卫" : "待命"}`,
        );
      },
    };
    sceneApi.current.setLayers(showSites, showControl);
    if (!reviewSite) sceneApi.current.setPerspective(playerTeamRef.current);
    applyMaterials(
      customMaterialsRef.current.unit,
      customMaterialsRef.current.site,
      customMaterialsRef.current.teamUnit,
    );
    return () => {
      cancelAnimationFrame(raf);
      serverClockWorker?.postMessage({ type: "stop" });
      serverClockWorker?.terminate();
      resilientClearInterval(combatTimer);
      resilientClearInterval(campaignTimer);
      resilientClearInterval(aiTimer);
      pathWorkerPool.dispose();
      removeEventListener("resize", resize);
      removeEventListener("keydown", onDirectKeyDown);
      removeEventListener("keyup", onDirectKeyUp);
      controls.removeEventListener("start", beginCameraInteraction);
      controls.removeEventListener("end", endCameraInteraction);
      clearTimeout(cameraInteractionEndTimer);
      controls.dispose();
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose?.();
        const materials = Array.isArray(mesh.material)
          ? mesh.material
          : mesh.material
            ? [mesh.material]
            : [];
        materials.forEach((material) => {
          Object.values(material).forEach((value) => {
            if (value instanceof THREE.Texture) value.dispose();
          });
          material.dispose();
        });
      });
      siteHitGeometry.dispose();
      siteHitMaterial.dispose();
      renderer.renderLists.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      sceneApi.current = null;
      if (renderer.domElement.parentNode === host)
        host.removeChild(renderer.domElement);
    };
  }, [screen]);
}

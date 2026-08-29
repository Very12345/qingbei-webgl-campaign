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
import { osmRegions } from "../../osm-map-data";
import { runCampaignEventHooks, type CampaignEventCardSpec } from "../../event-api";
import { ACADEMIC_YEAR_END_ISO, CALENDAR_EVENTS, DECISIONS } from "../../campaign-content";
import { TACTICAL_EVENTS, type TacticalEventDefinition } from "../../tactical-events";
import { PathfindingWorkerPool } from "../../pathfinding-pool";
import { PerformanceController } from "../../performance-controller";
import { EVENT_CARDS } from "../events/event-cards";
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

type VictoryBroadcast = {
  winner: Team;
  title: string;
  body: string;
};

type BattlefieldEngineContext = {
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
  setSelectedUnitCount: Dispatch<SetStateAction<number>>;
  customMaterialsRef: RefObject<{ unit: string | null; site: string | null }>;
  pushEvent: (event: EventCard) => void;
  pauseOpenRef: RefObject<boolean>;
  screenRef: RefObject<GameScreen>;
  lanChannelsRef: RefObject<Set<RTCDataChannel>>;
  lanChannelIdentityRef: RefObject<Map<RTCDataChannel, PlayerIdentity>>;
  lanHostRef: RefObject<boolean>;
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
    setSelectedUnitCount,
    customMaterialsRef,
    pushEvent,
    pauseOpenRef,
    screenRef,
    lanChannelsRef,
    lanChannelIdentityRef,
    lanHostRef,
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
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
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
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x9fc5d8);
    scene.fog = new THREE.FogExp2(0x9fc5d8, 0.007);
    const camera = new THREE.PerspectiveCamera(
      38,
      host.clientWidth / host.clientHeight,
      0.1,
      300,
    );
    camera.position.set(-22, 24, 36);
    camera.lookAt(-22, 0, 14);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(-22, 0, 14);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enableRotate = false;
    controls.enableZoom = true;
    controls.minDistance = 13;
    controls.maxDistance = 58;
    controls.zoomSpeed = 0.72;
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
    sun.castShadow = true;
    sun.shadow.mapSize.set(
      activeQualityProfile.shadowSize,
      activeQualityProfile.shadowSize,
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
    const regions = osmRegions as unknown as Record<string, any>;
    const windowMaterials: THREE.MeshStandardMaterial[] = [],
      windowDetailMeshes: THREE.InstancedMesh[] = [];
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
      const filtered = r.buildings.filter((building: any) => {
        const smallAnonymous =
          !building.name && footprintArea(building.points) < 0.13;
        return !smallAnonymous || Math.abs(building.osmId) % 4 !== 0;
      });
      gameplayBuildingCache.set(r, filtered);
      return filtered;
    };
    const terrainHeight = (r: any, x: number, z: number) => {
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
          heights[Math.min(rows - 1, jj) * cols + Math.min(cols - 1, ii)] || 0;
      return THREE.MathUtils.lerp(
        THREE.MathUtils.lerp(at(i, j), at(i + 1, j), fu),
        THREE.MathUtils.lerp(at(i, j + 1), at(i + 1, j + 1), fu),
        fv,
      );
    };
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
      component: Int32Array;
      mainComponent: number;
    };
    const buildNavGrid = (r: any): NavGrid => {
      const cell = 0.42,
        minX = r.offsetX - r.width / 2,
        minZ = -r.depth / 2,
        cols = Math.ceil(r.width / cell),
        rows = Math.ceil(r.depth / cell),
        blocked = new Uint8Array(cols * rows),
        building = new Uint8Array(cols * rows),
        water = new Uint8Array(cols * rows),
        road = new Uint8Array(cols * rows),
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
      findPath = (
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
            const stepCost =
                Math.hypot(dx, dz) *
                (grid.water[next]
                  ? 7.2
                  : grid.building[next]
                  ? 5.8
                  : grid.road[next]
                    ? 0.68
                    : 1.18),
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
            : findPath(fromX, fromZ, toX, toZ, true);
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
      gameRef.current.sites.forEach((site) => {
        if (site.destroyed) return;
        let anchor = nearestOpenIndex(navGrid, site.x, site.z);
        if (anchor < 0) return;
        let anchorPoint = navPoint(navGrid, anchor),
          needsPortal =
            Math.hypot(anchorPoint[0] - site.x, anchorPoint[1] - site.z) > 2.2;
        if (needsPortal) {
          const roadAnchor = nearestRoadIndex(navGrid, site.x, site.z);
          if (roadAnchor >= 0) {
            anchor = roadAnchor;
            anchorPoint = navPoint(navGrid, roadAnchor);
          }
        }
        [site.navX, site.navZ] = anchorPoint;
        site.hasPortal =
          needsPortal &&
          Math.hypot(anchorPoint[0] - site.x, anchorPoint[1] - site.z) > 0.6;
      });
      gameRef.current.units.forEach((unit, index) => {
        const current = navIndex(navGrid, unit.x, unit.z);
        if (current >= 0 && !navGrid.blocked[current]) return;
        const home = gameRef.current.sites[unit.siteId];
        if (!home) return;
        const angle = ((index % 9) / 9) * Math.PI * 2;
        unit.x = (home.navX ?? home.x) + Math.cos(angle) * 0.45;
        unit.z = (home.navZ ?? home.z) + Math.sin(angle) * 0.45;
        unit.tx = home.navX ?? home.x;
        unit.tz = home.navZ ?? home.z;
      });
    };
    refreshNavAnchors();
    const surfaceGeometry = (r: any, points: number[][], lift: number) => {
      const clean = points.filter(
        (p, i, a) =>
          !i || Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) > 0.001,
      );
      if (
        clean.length > 2 &&
        Math.hypot(
          clean[0][0] - clean.at(-1)![0],
          clean[0][1] - clean.at(-1)![1],
        ) < 0.001
      )
        clean.pop();
      const contour = clean.map((p) => new THREE.Vector2(p[0], p[1])),
        faces = THREE.ShapeUtils.triangulateShape(contour, []),
        g = new THREE.BufferGeometry();
      g.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(
          clean.flatMap((p) => [
            p[0],
            terrainHeight(r, p[0], p[1]) + lift,
            p[1],
          ]),
          3,
        ),
      );
      g.setIndex(faces.flat());
      g.computeVertexNormals();
      return g;
    };
    const addRegion = (r: any) => {
      const { cols, rows, heights } = r.terrain,
        pos: number[] = [],
        idx: number[] = [];
      for (let j = 0; j < rows; j++)
        for (let i = 0; i < cols; i++) {
          const x = r.offsetX - r.width / 2 + (i / (cols - 1)) * r.width,
            z = r.depth / 2 - (j / (rows - 1)) * r.depth;
          pos.push(x, heights[j * cols + i] || 0, z);
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
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const terrain = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({
          color: r.offsetX ? 0x6d8955 : 0x718d58,
          roughness: 0.98,
          side: THREE.FrontSide,
        }),
      );
      terrain.receiveShadow = true;
      mapGroup.add(terrain);
      terrainMeshes.push(terrain);
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
      type RoadBucket = {
        positions: number[];
        indices: number[];
        vertexIndex: number;
        color: number;
        lift: number;
        renderOrder: number;
      };
      const roadBuckets: Record<"asphalt" | "path" | "dirt", RoadBucket> = {
          asphalt: {
            positions: [],
            indices: [],
            vertexIndex: 0,
            color: 0x303840,
            lift: 0.035,
            renderOrder: 2,
          },
          dirt: {
            positions: [],
            indices: [],
            vertexIndex: 0,
            color: 0x9a805a,
            lift: 0.042,
            renderOrder: 3,
          },
          path: {
            positions: [],
            indices: [],
            vertexIndex: 0,
            color: 0xb9ad91,
            lift: 0.048,
            renderOrder: 4,
          },
        },
        waterAreas = r.waters.map((water: any) => ({
          points: water.points,
          minX: Math.min(...water.points.map((point: number[]) => point[0])),
          maxX: Math.max(...water.points.map((point: number[]) => point[0])),
          minZ: Math.min(...water.points.map((point: number[]) => point[1])),
          maxZ: Math.max(...water.points.map((point: number[]) => point[1])),
        })),
        inWater = (x: number, z: number) =>
          waterAreas.some(
            (water: any) =>
              x >= water.minX &&
              x <= water.maxX &&
              z >= water.minZ &&
              z <= water.maxZ &&
              pointInPolygon(x, z, water.points),
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
          bucket.vertexIndex++;
          ring.forEach(([edgeX, edgeZ], step) => {
            bucket.positions.push(edgeX, flatY, edgeZ);
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
        ]),
        vehicleCell = 3,
        vehicleSegments: {
          x1: number;
          z1: number;
          x2: number;
          z2: number;
          radius: number;
        }[] = [],
        vehicleIndex = new Map<string, number[]>();
      for (const road of r.roads) {
        if (pedestrianKinds.has(road.kind)) continue;
        const radius = Math.max(road.width, 0.24) / 2;
        for (let index = 1; index < road.points.length; index++) {
          const [x1, z1] = road.points[index - 1],
            [x2, z2] = road.points[index],
            segmentIndex = vehicleSegments.length;
          vehicleSegments.push({ x1, z1, x2, z2, radius });
          for (
            let gx = Math.floor((Math.min(x1, x2) - radius) / vehicleCell);
            gx <= Math.floor((Math.max(x1, x2) + radius) / vehicleCell);
            gx++
          )
            for (
              let gz = Math.floor((Math.min(z1, z2) - radius) / vehicleCell);
              gz <= Math.floor((Math.max(z1, z2) + radius) / vehicleCell);
              gz++
            ) {
              const key = `${gx}/${gz}`,
                bucket = vehicleIndex.get(key);
              if (bucket) bucket.push(segmentIndex);
              else vehicleIndex.set(key, [segmentIndex]);
            }
        }
      }
      const onVehicleSurface = (x: number, z: number) =>
        (
          vehicleIndex.get(
            `${Math.floor(x / vehicleCell)}/${Math.floor(z / vehicleCell)}`,
          ) ?? []
        ).some((index) => {
          const segment = vehicleSegments[index],
            dx = segment.x2 - segment.x1,
            dz = segment.z2 - segment.z1,
            lengthSquared = dx * dx + dz * dz,
            t = lengthSquared
              ? THREE.MathUtils.clamp(
                  ((x - segment.x1) * dx + (z - segment.z1) * dz) /
                    lengthSquared,
                  0,
                  1,
                )
              : 0,
            closestX = segment.x1 + dx * t,
            closestZ = segment.z1 + dz * t;
          return (
            Math.hypot(x - closestX, z - closestZ) <= segment.radius + 0.055
          );
        });
      for (const road of r.roads) {
        const kind = road.kind as string,
          pedestrianRoad = pedestrianKinds.has(kind),
          bucket = pedestrianRoad
            ? roadBuckets.path
            : kind === "track"
              ? roadBuckets.dirt
              : roadBuckets.asphalt,
          displayWidth = Math.max(road.width, pedestrianRoad ? 0.15 : 0.24);
        let chunk: [number, number][] = [];
        const flushChunk = () => {
          if (chunk.length > 1) addRoadStrip(bucket, chunk, displayWidth);
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
              inWater(sampleX, sampleZ) ||
              (pedestrianRoad && onVehicleSurface(sampleX, sampleZ))
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
      Object.values(roadBuckets).forEach((bucket) => {
        if (!bucket.positions.length) return;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(bucket.positions, 3),
        );
        geometry.setIndex(bucket.indices);
        geometry.computeVertexNormals();
        const roads = new THREE.Mesh(
          geometry,
          new THREE.MeshStandardMaterial({
            color: bucket.color,
            roughness: 0.94,
            metalness: 0,
            polygonOffset: true,
            polygonOffsetFactor: -bucket.renderOrder,
            polygonOffsetUnits: -bucket.renderOrder,
          }),
        );
        roads.receiveShadow = false;
        roads.renderOrder = bucket.renderOrder;
        mapGroup.add(roads);
      });
      const bp: number[] = [],
        bi: number[] = [],
        bc: number[] = [],
        buildingPalette = [
          0x9aa7a3, 0xaca99f, 0xa49a90, 0x93a2aa, 0xb1a58f, 0x9da69a,
        ];
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
          base = terrainHeight(r, x, z),
          h = b.levels
            ? Math.min(7, b.levels * 0.58)
            : 0.95 + (b.osmId % 6) * 0.17,
          start = bv,
          tone = new THREE.Color(
            buildingPalette[Math.abs(b.osmId) % buildingPalette.length],
          ),
          wallTone = tone.clone().multiplyScalar(0.78),
          roofTone = tone.clone().lerp(new THREE.Color(0xd0b09b), 0.26);
        for (const p of pts) {
          bp.push(p[0], base, p[1], p[0], base + h, p[1]);
          bc.push(
            wallTone.r,
            wallTone.g,
            wallTone.b,
            roofTone.r,
            roofTone.g,
            roofTone.b,
          );
          bv += 2;
        }
        for (let i = 0; i < pts.length; i++) {
          const j = (i + 1) % pts.length,
            a = start + i * 2,
            c = start + j * 2;
          bi.push(a, c, a + 1, a + 1, c, c + 1);
        }
        for (const face of THREE.ShapeUtils.triangulateShape(
          pts.map((p: number[]) => new THREE.Vector2(p[0], p[1])),
          [],
        ))
          bi.push(
            start + face[0] * 2 + 1,
            start + face[1] * 2 + 1,
            start + face[2] * 2 + 1,
          );
      }
      const bg = new THREE.BufferGeometry();
      bg.setAttribute("position", new THREE.Float32BufferAttribute(bp, 3));
      bg.setAttribute("color", new THREE.Float32BufferAttribute(bc, 3));
      bg.setIndex(bi);
      bg.computeVertexNormals();
      const buildings = new THREE.Mesh(
        bg,
        new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.82,
          side: THREE.DoubleSide,
          flatShading: true,
        }),
      );
      buildings.receiveShadow = false;
      buildings.castShadow = true;
      mapGroup.add(buildings);
      const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(bg, 32),
        new THREE.LineBasicMaterial({
          color: 0x65706e,
          transparent: true,
          opacity: 0.48,
        }),
      );
      outline.renderOrder = 5;
      mapGroup.add(outline);
      const windowMatrices: THREE.Matrix4[] = [],
        doorMatrices: THREE.Matrix4[] = [],
        roofMatrices: THREE.Matrix4[] = [],
        detailDummy = new THREE.Object3D(),
        windowLimit = r === regions.main ? 13500 : 2600;
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
        const signedArea = pts.reduce((sum: number, p: number[], i: number) => {
            const next = pts[(i + 1) % pts.length];
            return sum + p[0] * next[1] - next[0] * p[1];
          }, 0),
          outwardSign = signedArea > 0 ? -1 : 1;
        const x =
            pts.reduce((a: number, p: number[]) => a + p[0], 0) / pts.length,
          z = pts.reduce((a: number, p: number[]) => a + p[1], 0) / pts.length,
          base = terrainHeight(r, x, z),
          h = b.levels
            ? Math.min(7, b.levels * 0.58)
            : 0.95 + (b.osmId % 6) * 0.17,
          rows = Math.min(4, Math.max(1, Math.floor(h / 0.48)));
        let longest: { a: number[]; c: number[]; len: number } | null = null;
        for (
          let i = 0;
          i < pts.length && windowMatrices.length < windowLimit;
          i++
        ) {
          const a = pts[i],
            c = pts[(i + 1) % pts.length],
            dx = c[0] - a[0],
            dz = c[1] - a[1],
            len = Math.hypot(dx, dz);
          if (!longest || len > longest.len) longest = { a, c, len };
          if (len < 0.42) continue;
          const cols = Math.min(5, Math.max(1, Math.floor(len / 0.42))),
            angle = Math.atan2(-dz, dx),
            nx = (-dz / len) * outwardSign,
            nz = (dx / len) * outwardSign;
          for (
            let row = 0;
            row < rows && windowMatrices.length < windowLimit;
            row++
          )
            for (
              let col = 0;
              col < cols && windowMatrices.length < windowLimit;
              col++
            ) {
              const t = (col + 1) / (cols + 1);
              detailDummy.position.set(
                a[0] + dx * t + nx * 0.025,
                base + (h * (row + 1)) / (rows + 1),
                a[1] + dz * t + nz * 0.025,
              );
              detailDummy.rotation.set(0, angle, 0);
              detailDummy.scale.set(
                Math.min(0.18, (len / (cols + 1)) * 0.5),
                0.12,
                1,
              );
              detailDummy.updateMatrix();
              windowMatrices.push(detailDummy.matrix.clone());
            }
        }
        if (longest && longest.len > 0.45) {
          const dx = longest.c[0] - longest.a[0],
            dz = longest.c[1] - longest.a[1],
            len = longest.len,
            nx = (-dz / len) * outwardSign,
            nz = (dx / len) * outwardSign;
          detailDummy.position.set(
            (longest.a[0] + longest.c[0]) / 2 + nx * 0.03,
            base + 0.17,
            (longest.a[1] + longest.c[1]) / 2 + nz * 0.03,
          );
          detailDummy.rotation.set(0, Math.atan2(-dz, dx), 0);
          detailDummy.scale.set(0.23, 0.34, 1);
          detailDummy.updateMatrix();
          doorMatrices.push(detailDummy.matrix.clone());
        }
        if (
          h > 1.2 &&
          Math.abs(b.osmId) % 4 === 0 &&
          roofMatrices.length < 1400
        ) {
          const xs = pts.map((p: number[]) => p[0]),
            zs = pts.map((p: number[]) => p[1]),
            width = Math.max(...xs) - Math.min(...xs),
            depth = Math.max(...zs) - Math.min(...zs);
          detailDummy.position.set(x, base + h + 0.035, z);
          detailDummy.rotation.set(0, ((b.osmId % 12) * Math.PI) / 12, 0);
          detailDummy.scale.set(
            Math.min(0.24, width * 0.16),
            0.07,
            Math.min(0.22, depth * 0.15),
          );
          detailDummy.updateMatrix();
          roofMatrices.push(detailDummy.matrix.clone());
        }
      }
      const windowMaterial = new THREE.MeshStandardMaterial({
        color: 0x31566a,
        emissive: 0xffc45e,
        emissiveIntensity: 0,
        roughness: 0.28,
        metalness: 0.08,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      windowMaterials.push(windowMaterial);
      const windows = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(1, 1),
        windowMaterial,
        windowMatrices.length,
      );
      windowMatrices.forEach((m, i) => windows.setMatrixAt(i, m));
      windows.instanceMatrix.needsUpdate = true;
      windows.renderOrder = 6;
      windowDetailMeshes.push(windows);
      mapGroup.add(windows);
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
      const roofFixtures = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({
          color: 0x87918d,
          roughness: 0.82,
          metalness: 0.04,
        }),
        roofMatrices.length,
      );
      roofMatrices.forEach((m, i) => roofFixtures.setMatrixAt(i, m));
      roofFixtures.instanceMatrix.needsUpdate = true;
      roofFixtures.castShadow = false;
      roofFixtures.receiveShadow = true;
      mapGroup.add(roofFixtures);
      const waterMat = new THREE.MeshStandardMaterial({
        color: 0x478ca5,
        transparent: true,
        opacity: 0.83,
        roughness: 0.24,
        metalness: 0.1,
        side: THREE.DoubleSide,
      });
      for (const water of r.waters) {
        if (water.points.length < 3) continue;
        const wm = new THREE.Mesh(
          surfaceGeometry(r, water.points, 0.15),
          waterMat,
        );
        wm.renderOrder = 4;
        mapGroup.add(wm);
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
    scene.add(buildingGroup);
    const siteNodeBatchGroup = new THREE.Group();
    scene.add(siteNodeBatchGroup);
    const unitGroup = new THREE.Group();
    scene.add(unitGroup);
    const commandGroup = new THREE.Group();
    scene.add(commandGroup);
    const combatGroup = new THREE.Group();
    scene.add(combatGroup);
    const battleAlertGroup = new THREE.Group();
    scene.add(battleAlertGroup);
    const territoryGroup = new THREE.Group();
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
      customUnitTexture: THREE.Texture | null = null,
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
          curve = new THREE.LineCurve3(start, end),
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
      const color = 0xb9eaf4,
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
            `${attack ? "⚔ 进攻" : "✚ 增援"} · ${troops ? `${troops}人` : `持续${Math.round(dispatchRatio * 100)}%`}`,
            attack ? "#ff684d" : "#79dcff",
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
        if (s.team !== playerTeamRef.current) return;
        if (s.destroyed || s.orderTarget == null) return;
        const t = gameRef.current.sites[s.orderTarget];
        if (!t || t.destroyed) return;
        const troops = gameRef.current.units
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
          s.orderPath,
          s.dispatchRatio ?? 0.6,
          s.id,
        );
        route.traverse((object) => {
          object.userData.commandSourceId = s.id;
        });
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
            ) < 3.2,
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
              terrainHeight(regionForX(site.x), site.x, site.z) + 1.75,
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
      hpGeometry = new THREE.PlaneGeometry(1, 0.1),
      hpBackMaterial = new THREE.MeshBasicMaterial({
        color: 0x241014,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
      hpFillMaterials = {
        pku: new THREE.MeshBasicMaterial({
          color: 0xff5368,
          depthTest: false,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
        thu: new THREE.MeshBasicMaterial({
          color: 0xb67aff,
          depthTest: false,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      },
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
        hpGeometry,
        unitBodyGeometry,
        farUnitBodyGeometry,
        unitLimbGeometry,
        unitHandGeometry,
        unitGlowGeometry,
      ]),
      sharedUnitMaterials = new Set<THREE.Material>([
        hpBackMaterial,
        hpFillMaterials.pku,
        hpFillMaterials.thu,
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
    const busGeometry = new THREE.BoxGeometry(1.5, 0.62, 0.68),
      bikeGeometry = new THREE.BoxGeometry(0.58, 0.08, 0.28),
      busMaterials = {
        pku: new THREE.MeshStandardMaterial({ color: 0xb71934, roughness: 0.48 }),
        thu: new THREE.MeshStandardMaterial({ color: 0x704096, roughness: 0.48 }),
      },
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
        pkuBike: new THREE.InstancedMesh(bikeGeometry, bikeMaterials.pku, 3200),
        pkuSlogan: new THREE.InstancedMesh(
          bikeGeometry,
          new THREE.MeshStandardMaterial({ color: 0xffd51f, emissive: 0x5a4400 }),
          3200,
        ),
        pkuPhone: new THREE.InstancedMesh(
          bikeGeometry,
          new THREE.MeshStandardMaterial({ color: 0xff9f31, emissive: 0x5b2700 }),
          3200,
        ),
        thuBike: new THREE.InstancedMesh(bikeGeometry, bikeMaterials.thu, 3200),
        thuPurple: new THREE.InstancedMesh(
          bikeGeometry,
          new THREE.MeshStandardMaterial({ color: 0x9b55cc, emissive: 0x2d103e }),
          3200,
        ),
      },
      transportDummy = new THREE.Object3D();
    Object.values(transportMeshes).forEach((mesh) => {
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = false;
      unitGroup.add(mesh);
    });
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
      const hpBack = new THREE.Mesh(hpGeometry, hpBackMaterial),
        hpFill = new THREE.Mesh(hpGeometry, hpFillMaterials[u.team]);
      hpBack.scale.set(0.78, 1, 1);
      hpBack.position.set(0, 1.72, 0.05);
      hpBack.renderOrder = 42;
      hpBack.visible = false;
      hpFill.scale.set(0.74, 0.62, 1);
      hpFill.position.set(0, 1.72, 0.06);
      hpFill.renderOrder = 43;
      hpFill.visible = false;
      g.add(hpBack, hpFill);
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
        hpBack,
        hpFill,
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
    const updateFarUnitInstances = () => {
      if (useLegacyUnitRenderer) return;
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
        farUnitDummy.position.set(
          unit.x,
          terrainHeight(regionForX(unit.x), unit.x, unit.z) +
            0.98 * UNIT_RENDER_SCALE +
            (insideWater(unit.x, unit.z) ? 0.1 : 0),
          unit.z,
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
          index = transportCounts[key]++;
        transportDummy.position.set(
          unit.x,
          terrainHeight(regionForX(unit.x), unit.x, unit.z) + 0.18,
          unit.z,
        );
        transportDummy.rotation.set(0, Math.atan2(unit.tx - unit.x, unit.tz - unit.z), 0);
        transportDummy.scale.set(1, 1, 1);
        transportDummy.updateMatrix();
        transportMeshes[key].setMatrixAt(index, transportDummy.matrix);
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
        transportDummy.position.set(
          leader.x,
          terrainHeight(regionForX(leader.x), leader.x, leader.z) + 0.34,
          leader.z,
        );
        transportDummy.rotation.set(
          0,
          Math.atan2(leader.tx - leader.x, leader.tz - leader.z),
          0,
        );
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
    const applyMaterials = (unitUrl: string | null, siteUrl: string | null) => {
      const unitRequest = ++unitMaterialRequest,
        siteRequest = ++siteMaterialRequest;
      if (unitUrl) {
        textureLoader.load(unitUrl, (texture) => {
          if (unitRequest !== unitMaterialRequest) {
            texture.dispose();
            return;
          }
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
          customUnitTexture?.dispose();
          customUnitTexture = texture;
          unitBodyMaterials.pku.map = texture;
          unitBodyMaterials.thu.map = texture;
          unitBodyMaterials.pku.needsUpdate = true;
          unitBodyMaterials.thu.needsUpdate = true;
        });
      } else {
        customUnitTexture?.dispose();
        customUnitTexture = null;
        unitBodyMaterials.pku.map = unitBallTextures.pku;
        unitBodyMaterials.thu.map = unitBallTextures.thu;
        unitBodyMaterials.pku.needsUpdate = true;
        unitBodyMaterials.thu.needsUpdate = true;
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
    const tg = new THREE.CylinderGeometry(0.07, 0.11, 0.86, 7),
      tm = new THREE.MeshStandardMaterial({ color: 0x61412f, roughness: 1 }),
      cg = new THREE.SphereGeometry(0.52, 10, 8),
      cms = [0x315d36, 0x467648, 0x5b8a4e].map(
        (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.92 }),
      ),
      treePositions: { x: number; y: number; z: number }[] = [];
    for (const [r, count] of [[regions.main, 340]] as [any, number][]) {
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
        treePositions.push({ x, y: terrainHeight(r, x, z), z });
      }
    }
    const treeTrunks = new THREE.InstancedMesh(tg, tm, treePositions.length),
      treeCrowns = cms.map(
        (material) =>
          new THREE.InstancedMesh(cg, material, treePositions.length),
      ),
      treeDummy = new THREE.Object3D();
    treePositions.forEach((position, index) => {
      treeDummy.position.set(position.x, position.y + 0.43, position.z);
      treeDummy.scale.set(1, 1, 1);
      treeDummy.updateMatrix();
      treeTrunks.setMatrixAt(index, treeDummy.matrix);
      treeCrowns.forEach((mesh, layer) => {
        treeDummy.position.y = position.y + 0.92 + layer * 0.32;
        treeDummy.scale.set(1.1 - layer * 0.18, 0.65, 1.1 - layer * 0.18);
        treeDummy.updateMatrix();
        mesh.setMatrixAt(index, treeDummy.matrix);
      });
    });
    treeTrunks.instanceMatrix.needsUpdate = true;
    treeCrowns.forEach((mesh) => (mesh.instanceMatrix.needsUpdate = true));
    treeTrunks.castShadow = true;
    treeCrowns.forEach((mesh) => (mesh.castShadow = true));
    treeGroup.add(treeTrunks, ...treeCrowns);
    const lampPositions: { x: number; z: number; r: any }[] = [],
      lampSeen = new Set<string>();
    for (const r of [regions.main]) {
      const cap = r === regions.main ? 650 : 90,
        pushLamp = (x: number, z: number) => {
          const key = `${Math.round(x * 2)}/${Math.round(z * 2)}`;
          if (
            lampSeen.has(key) ||
            lampPositions.filter((p) => p.r === r).length >= cap
          )
            return;
          lampSeen.add(key);
          lampPositions.push({ x, z, r });
        };
      for (const [x, z] of r.lamps ?? []) pushLamp(x, z);
      for (const road of r.roads) {
        if (
          ["footway", "path", "steps", "corridor", "track"].includes(road.kind)
        )
          continue;
        for (let k = 1; k < road.points.length; k++) {
          const [x1, z1] = road.points[k - 1],
            [x2, z2] = road.points[k],
            dx = x2 - x1,
            dz = z2 - z1,
            len = Math.hypot(dx, dz);
          if (len < 1.8) continue;
          const count = Math.floor(len / 3.1),
            nx = -dz / len,
            nz = dx / len;
          for (let n = 1; n <= count; n++) {
            const t = n / (count + 1),
              side = (n + k) % 2 ? 1 : -1;
            pushLamp(
              x1 + dx * t + nx * (road.width / 2 + 0.16) * side,
              z1 + dz * t + nz * (road.width / 2 + 0.16) * side,
            );
          }
        }
      }
    }
    const poleGeometry = new THREE.CylinderGeometry(0.025, 0.038, 0.82, 6),
      poleMaterial = new THREE.MeshStandardMaterial({
        color: 0x303735,
        roughness: 0.76,
      }),
      bulbGeometry = new THREE.SphereGeometry(0.065, 8, 6),
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
      lampDummy = new THREE.Object3D();
    lampPositions.forEach((p, i) => {
      const base = terrainHeight(p.r, p.x, p.z);
      lampDummy.position.set(p.x, base + 0.41, p.z);
      lampDummy.updateMatrix();
      poles.setMatrixAt(i, lampDummy.matrix);
      lampDummy.position.y = base + 0.86;
      lampDummy.updateMatrix();
      bulbs.setMatrixAt(i, lampDummy.matrix);
    });
    poles.instanceMatrix.needsUpdate = true;
    bulbs.instanceMatrix.needsUpdate = true;
    scene.add(poles, bulbs);
    const lights: THREE.PointLight[] = [];
    lampPositions
      .filter((_, i) => i % 41 === 0)
      .slice(0, 22)
      .forEach((p) => {
        const l = new THREE.PointLight(0xffc66f, 0, 5, 2);
        l.position.set(p.x, terrainHeight(p.r, p.x, p.z) + 0.9, p.z);
        scene.add(l);
        lights.push(l);
      });
    const ray = new THREE.Raycaster(),
      mouse = new THREE.Vector2(),
      projectedSiteNode = new THREE.Vector3(),
      projectedSiteEdge = new THREE.Vector3(),
      siteNodeWorld = new THREE.Vector3(),
      siteNodeCameraRight = new THREE.Vector3(),
      siteNodeWorldPosition = (site: SiteState, target = new THREE.Vector3()) =>
        target.set(
          site.x,
          terrainHeight(regionForX(site.x), site.x, site.z) + 1.75,
          site.z,
        );
    let down: {
        x: number;
        y: number;
        site?: number;
        sourceSite?: number;
        selection?: boolean;
        tool?: boolean;
        eraseLines?: boolean;
        erasedLines?: Set<number>;
      } | null = null,
      previewLine: THREE.Object3D | null = null,
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
            candidate.distance <= candidate.radius * radiusMultiplier,
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
          closestDistance = 32;
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
          closestDistance = 11;
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
        if (sourceId == null) return false;
        const source = gameRef.current.sites[sourceId];
        if (!source || source.orderTarget == null) return false;
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
        rebuildCommandLines();
        rebuildBuildings();
        return true;
      },
      simplifyCommandChain = (sourceId?: number) => {
        if (sourceId == null) return false;
        const game = gameRef.current,
          source = game.sites[sourceId];
        if (!source || source.orderTarget == null) return false;
        const chain: SiteState[] = [source],
          visited = new Set([source.id]);
        let cursor = source;
        while (cursor.orderTarget != null) {
          const next = game.sites[cursor.orderTarget];
          if (!next || next.destroyed || visited.has(next.id)) break;
          chain.push(next);
          visited.add(next.id);
          cursor = next;
        }
        if (chain.length < 3) return false;
        const terminal = chain.at(-1)!;
        source.orderTarget = terminal.id;
        source.orderPath = findPath(
          source.navX ?? source.x,
          source.navZ ?? source.z,
          terminal.navX ?? terminal.x,
          terminal.navZ ?? terminal.z,
        );
        chain.slice(1, -1).forEach((site) => {
          site.orderTarget = undefined;
          site.orderPath = undefined;
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
        return true;
      };
    const buildCampAt = (point: THREE.Vector3) => {
      const g = gameRef.current,
        index = navIndex(navGrid, point.x, point.z),
        activeCamps = g.sites.filter(
          (site) => site.type === "camp" && !site.destroyed,
        );
      const campTeam = playerTeamRef.current;
      if (g.resources[campTeam] < 80)
        return (setNotice("建立营地需要80战略资源"), false);
      if (activeCamps.length >= 4)
        return (setNotice("主战场最多同时维持4座临时营地"), false);
      if (
        index < 0 ||
        navGrid.blocked[index] ||
        navGrid.component[index] !== navGrid.mainComponent
      )
        return (
          setNotice("这里被建筑、水体或封闭庭院占用，无法建立营地"),
          false
        );
      if (
        g.sites.some(
          (site) =>
            !site.destroyed &&
            Math.hypot(site.x - point.x, site.z - point.z) < 2.2,
        )
      )
        return (setNotice("营地距离现有据点过近"), false);
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
      if (nearbyPku < 3 || nearbyEnemy)
        return (
          setNotice(
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
      setSelected(id);
      setRenameDraft(name);
      if (!g.campaign.firedEvents.includes("first_camp")) {
        g.campaign.firedEvents.push("first_camp");
        pushEvent({ id: "first_camp", ...EVENT_CARDS.first_camp });
      }
      setNotice("临时营地已建立；敌军攻克后会直接拆除");
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
    let hoveredSiteId: number | null = null;
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
        tool = activeToolMode === "simplify-lines" && !eraseLines;
      down = {
        x: e.clientX,
        y: e.clientY,
        site,
        sourceSite,
        selection,
        tool,
        eraseLines,
        erasedLines: eraseLines ? new Set<number>() : undefined,
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
      setHoveredSite(
        hovered != null && hovered !== down.sourceSite ? hovered : null,
      );
      previewLine = addCommandLine(
        siteNodeWorldPosition(s),
        hovered != null && hovered !== down.sourceSite
          ? siteNodeWorldPosition(gameRef.current.sites[hovered])
          : p.clone(),
        true,
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
            path = findPath(center.x, center.z, destinationX, destinationZ);
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
      if (
        moved &&
        down.sourceSite != null &&
        end != null &&
        end !== down.sourceSite
      ) {
        const source = gameRef.current.sites[down.sourceSite],
          target = gameRef.current.sites[end];
        if (source.team === playerTeamRef.current) {
          if (
            target.team !== playerTeamRef.current &&
            !gameRef.current.campaign.warUnlocked
          ) {
            setNotice("8月19日前尚未开放交战：可以自由调兵或增援友方据点");
            down = null;
            return;
          }
          const troops = issueOrder(playerTeamRef.current, source, target);
          setNotice(
            troops
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
        key: "production" | "defense" | "supplyUse" | "healing" | "riverMovement",
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
    let combatPulse = 0;
    const combatTimer = window.setInterval(() => {
      if (screenRef.current === "home" || pauseOpenRef.current) return;
      const g = gameRef.current,
        now = performance.now(),
        combatTimeScale = THREE.MathUtils.clamp(timeScaleRef.current, 0.5, 16),
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
      for (const unit of g.units) {
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
        if (
          combatPulse % 3 === 0 &&
          combatEffects.length < activeQualityProfile.combatParticles
        )
          spawnCombatEffect((unit.x + enemy.x) / 2, (unit.z + enemy.z) / 2);
        if (combatPulse % 5 === 0)
          addBattleAlert((unit.x + enemy.x) / 2, (unit.z + enemy.z) / 2);
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
          if (target.team === unit.team && distance < 1.18) {
            unit.siteId = target.id;
            if (unit.retreating) {
              unit.retreating = false;
              unit.morale = Math.min(100, (unit.morale ?? 40) + 28);
            }
            unit.targetSiteId = undefined;
            unit.path = undefined;
            unit.pathIndex = undefined;
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
                unit.tx = unit.x;
                unit.tz = unit.z;
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
          oldTeam = site.team;
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
          const angle = (index / attackers.length) * Math.PI * 2;
          unit.tx = siteX + Math.cos(angle) * 0.9;
          unit.tz = siteZ + Math.sin(angle) * 0.9;
        });
        site.orderTarget = undefined;
        site.orderPath = undefined;
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
        if (!(site.type === "target" && newTeam === "pku")) {
          rebuildBuildings();
          rebuildCommandLines();
        }
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
      allocateTransport = (team: Team, kind: ResearchId) => {
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
                  ) < 3.2,
              ),
            }))
            .filter((candidate) => candidate.idle.length >= peopleRequired);
        if (!candidates.length) return false;
        let chosen = candidates[0];
        if (!isBus) {
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
        } else chosen = candidates[Math.floor(Math.random() * candidates.length)];
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
    const campaignTimer = window.setInterval(() => {
      if (screenRef.current === "home" || pauseOpenRef.current) return;
      if (lanChannelsRef.current.size && !lanHostRef.current) return;
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
        const production = campaign.research.production[team];
        if (!production || production.completesAt > campaign.elapsedHours)
          continue;
        const definition = RESEARCH_DEFINITIONS[production.researchId];
        campaign.research.stockpile[team][production.researchId] +=
          definition.productionQuantity;
        campaign.research.production[team] = null;
        setNotice(
          `${team === "pku" ? "北大" : campaign.thuFactionName}生产完成：${definition.title} × ${definition.productionQuantity}`,
        );
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
                    Math.hypot(unit.x - site.x, unit.z - site.z) < 4.5,
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
      const thuArrivedAt = (site?: SiteState) =>
        !!site &&
        g.units.some(
          (unit) =>
            unit.team === "thu" &&
            Math.hypot(
              unit.x - (site.navX ?? site.x),
              unit.z - (site.navZ ?? site.z),
            ) < 1.8,
        );
      if (campaign.warUnlocked && thuArrivedAt(library))
        fireEvent("pku_librarian", () =>
          addTimedStatus("librarian", "图书管理员", "pku", 24, 1.1, 1, 1.5),
        );
      if (campaign.warUnlocked && thuArrivedAt(physics))
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
      if (campaign.warUnlocked && thuArrivedAt(chemistry))
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
        g.units.some(
          (unit) =>
            unit.team === "pku" &&
            Math.hypot(unit.x - (qz.navX ?? qz.x), unit.z - (qz.navZ ?? qz.z)) <
              1.8,
        )
      )
        fireEvent("qz_approach", () => {
          addTimedStatus("qz_defense", "水向下流", "thu", 24, 1, 1, 1.25);
          addTimedStatus("qz_stall", "前锋受阻", "pku", 24, 1, 1, 0.8);
          spawnUnitsAt(qz, "thu", 10, 1.15);
          campaign.freezeUntil.pku = campaign.elapsedHours + 24;
          const emergencySources = g.sites
            .filter(
              (site) =>
                site.team === "thu" &&
                site.id !== qz.id &&
                !site.destroyed &&
                Math.hypot(site.x - qz.x, site.z - qz.z) < 20,
            )
            .sort(
              (a, b) =>
                Math.hypot(a.x - qz.x, a.z - qz.z) -
                Math.hypot(b.x - qz.x, b.z - qz.z),
            )
            .slice(0, 6);
          emergencySources.forEach((source) =>
            spawnUnitsAt(source, "thu", 2, 1.05, false),
          );
          rebuildUnits();
          emergencySources.forEach((source) => {
            source.stance = "guard";
            source.dispatchRatio = 0.9;
            issueOrder("thu", source, qz, 6, true);
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
        g.units.some(
          (unit) =>
            unit.team === "thu" &&
            Math.hypot(unit.x - yuanpei.x, unit.z - yuanpei.z) < 1.8,
        )
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
        g.units.some(
          (unit) =>
            unit.team === "thu" &&
            Math.hypot(unit.x - mathSchool.x, unit.z - mathSchool.z) < 1.8,
        )
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
          issueOrder(ally, border, target, people, true);
          border.stance = stance;
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
            issueOrder(ally, border, target, 14);
            border.stance = previousStance;
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
      const productionCycle = Math.floor(campaign.elapsedHours / 6);
      if (productionCycle > campaign.lastProductionCycle) {
        campaign.lastProductionCycle = productionCycle;
        let produced = false;
        for (const team of ["pku", "thu"] as Team[]) {
          const population = teamPopulation(team),
            allDorms = g.sites.filter(
            (site) =>
              site.team === team && site.type === "dorm" && !site.destroyed,
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
                Math.round(productionSlots(allDorms.length, 0.35) * productionModifier),
              ),
              dorms.length,
              Math.max(0, Math.floor((teamUnitCap(team) - population) / 5)),
            );
          for (let i = 0; i < activeDorms; i++) {
            const site = dorms[(productionCycle + i * 3) % dorms.length];
            spawnUnitsAt(site, team, 1, 1, false);
            produced = true;
          }
          g.resources[team] +=
            6 * (decisionEffectsFor(campaign, team).resourceIncome ?? 1);
        }
        if (produced) rebuildUnits();
        g.sites.forEach((source) => {
          if (source.destroyed || source.orderTarget == null) return;
          const target = g.sites[source.orderTarget];
          if (!target || target.destroyed) return;
          const idle = g.units.filter(
            (unit) => unit.siteId === source.id && unit.targetSiteId == null,
          ).length;
          issueOrder(
            source.team,
            source,
            target,
            Math.ceil(idle * (source.dispatchRatio ?? 0.6)),
          );
        });
      }
      const diningCycle = Math.floor(campaign.elapsedHours / 12);
      if (diningCycle > campaign.lastDiningCycle) {
        campaign.lastDiningCycle = diningCycle;
        const producingDining: SiteState[] = [];
        for (const team of ["pku", "thu"] as Team[]) {
          const population = teamPopulation(team),
            allDiningSites = g.sites.filter(
            (site) =>
              site.team === team && site.type === "dining" && !site.destroyed,
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
            const site =
              diningSites[(diningCycle + i * 2) % diningSites.length];
            spawnUnitsAt(site, team, 1, 1, false, 145);
            producingDining.push(site);
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
          (site) =>
            site.type === "camp" && !site.destroyed && site.team === "pku",
        )
        .forEach((camp) => {
          g.units
            .filter(
              (unit) =>
                unit.team === "pku" &&
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
    const aiTimer = window.setInterval(() => {
      if (screenRef.current === "home" || pauseOpenRef.current) return;
      if (lanChannelsRef.current.size && !lanHostRef.current) return;
      const g = gameRef.current;
      const humanTeams = new Set<Team>([
          playerTeamRef.current,
          ...[...lanChannelIdentityRef.current.values()].map(
            (identity) => identity.team,
          ),
        ]),
        aiTeam = (["pku", "thu"] as Team[]).find(
          (team) => !humanTeams.has(team),
        );
      if (!aiTeam) return;
      const enemyTeam: Team = aiTeam === "pku" ? "thu" : "pku",
        aiState = g.campaign.ai,
        difficulty = aiState.difficulty,
        strategicInterval =
          difficulty === "hard" ? 3 : difficulty === "casual" ? 12 : 6,
        random = () => {
          aiState.seed = (Math.imul(aiState.seed, 1664525) + 1013904223) >>> 0;
          return aiState.seed / 4_294_967_296;
        },
        personality = aiState.personality[aiTeam],
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
        routeLimit = aiTeam === "thu" ? 10 : 8,
        waveLimit = aiTeam === "thu" ? 4 : 3;
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
          const preferred =
            personality.includes("工程") && researchChoices.includes("bus")
              ? "bus"
              : researchChoices[Math.floor(random() * researchChoices.length)];
          beginResearch(preferred, aiTeam, true);
        }
      }
      if (!g.campaign.research.production[aiTeam]) {
        const productionChoices = g.campaign.research.completed[aiTeam].filter(
          (id) =>
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
      if (!g.campaign.warUnlocked) return;
      if (qz && aiTeam === "thu") {
        const threat = g.units.filter(
          (unit) =>
            unit.team === "pku" &&
            (unit.targetSiteId === qz.id ||
              Math.hypot(unit.x - qz.x, unit.z - qz.z) < 10),
        ).length;
        if (threat > 0) {
          g.sites
            .filter(
              (site) =>
                site.team === "thu" &&
                site.id !== qz.id &&
                !site.destroyed &&
                Math.hypot(site.x - qz.x, site.z - qz.z) < 14,
            )
            .sort(
              (a, b) =>
                Math.hypot(a.x - qz.x, a.z - qz.z) -
                Math.hypot(b.x - qz.x, b.z - qz.z),
            )
            .slice(0, 3)
            .forEach((source) =>
              issueOrder("thu", source, qz, Math.ceil(threat / 2) + 2, true),
            );
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
              (unit.targetSiteId === yuanpei.id ||
                Math.hypot(unit.x - yuanpei.x, unit.z - yuanpei.z) < 10),
          ).length;
          if (threat)
            g.sites
              .filter(
                (site) =>
                  site.team === "pku" &&
                  site.id !== yuanpei.id &&
                  !site.destroyed &&
                  Math.hypot(site.x - yuanpei.x, site.z - yuanpei.z) < 14,
              )
              .sort(
                (a, b) =>
                  Math.hypot(a.x - yuanpei.x, a.z - yuanpei.z) -
                  Math.hypot(b.x - yuanpei.x, b.z - yuanpei.z),
              )
              .slice(0, 3)
              .forEach((source) =>
                issueOrder("pku", source, yuanpei, Math.ceil(threat / 2) + 2, true),
              );
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
              ) < 3.2,
          ).length,
        threatAt = (site: SiteState) =>
          g.units.filter(
            (unit) =>
              unit.team === enemyTeam &&
              (unit.targetSiteId === site.id ||
                Math.hypot(unit.x - site.x, unit.z - site.z) < 7),
          ).length,
        frontier = friendlySites
          .slice()
          .sort((a, b) => {
            const da = Math.min(
                ...enemySites.map((site) =>
                  Math.hypot(site.x - a.x, site.z - a.z),
                ),
              ),
              db = Math.min(
                ...enemySites.map((site) =>
                  Math.hypot(site.x - b.x, site.z - b.z),
                ),
              );
            return threatAt(b) * 8 - threatAt(a) * 8 + da - db;
          })
          .slice(0, 8),
        rearSources = friendlySites
          .filter(
            (site) =>
              (site.type === "dorm" || site.type === "dining") &&
              site.orderTarget == null &&
              idleAt(site) >= 3,
          )
          .sort((a, b) => idleAt(b) - idleAt(a));
      for (
        let i = 0;
        i < Math.min(3, rearSources.length, frontier.length);
        i++
      ) {
        const source = rearSources[i],
          target = frontier[i % frontier.length];
        if (source.id !== target.id)
          issueOrder(
            aiTeam,
            source,
            target,
            Math.max(1, idleAt(source) - 1),
            true,
          );
      }
      if (activeAiRoutes >= routeLimit) return;
      const attackSources = friendlySites
        .filter(
          (site) =>
            (site.orderTarget == null ||
              g.sites[site.orderTarget]?.team === aiTeam) &&
            idleAt(site) >= 3 &&
            (!qz || Math.hypot(site.x - qz.x, site.z - qz.z) > 4),
        )
        .sort((a, b) => idleAt(b) - idleAt(a));
      let routesCreated = 0;
      for (const source of attackSources) {
        if (
          activeAiRoutes + routesCreated >= routeLimit ||
          routesCreated >= waveLimit
        )
          break;
        const scoredTargets = enemySites
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
                coreValue =
                  site.type === "capital" || site.type === "target" ? 22 : 0,
                productionValue =
                  site.type === "dorm" || site.type === "dining" ? 8 : 0,
                eventValue =
                  !g.campaign.firedEvents.includes("two_bombs_one_satellite") &&
                  site.name.includes("物理学院")
                    ? -6
                    : 0,
                personalityValue =
                  personality.includes("穿插") && productionValue ? 9 :
                  personality.includes("反攻") && coreValue ? 10 : 0,
                cost =
                  Math.hypot(site.x - source.x, site.z - source.z) +
                  estimatedDefenders * 1.35;
              return {
                site,
                score:
                  coreValue +
                  productionValue +
                  personalityValue +
                  eventValue -
                  cost +
                  (random() - .5) * (difficulty === "casual" ? 12 : 5),
              };
            })
            .sort((a, b) => b.score - a.score),
          poolSize = difficulty === "hard" ? 2 : difficulty === "casual" ? 5 : 3,
          target = scoredTargets.length
            ? scoredTargets[Math.floor(random() * Math.min(poolSize, scoredTargets.length))]
                .site
            : undefined;
        if (
          target &&
          issueOrder(
            aiTeam,
            source,
            target,
            Math.max(1, idleAt(source) - 1),
            true,
          )
        )
          routesCreated++;
      }
    }, 1700);
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
      nextUnitSimulationAt = 0,
      lastUnitSimulationAt = last,
      unitSimulationTick = 0;
    const directCenter = new THREE.Vector3(),
      directCameraGoal = new THREE.Vector3(),
      siteMenuProjection = new THREE.Vector3();
    const animate = (now: number) => {
      raf = requestAnimationFrame(animate);
      const rawDelta = (now - last) / 1000,
        dt = Math.min(0.05, rawDelta);
      last = now;
      if (rawDelta < 0.2) {
        performanceFrameTime += rawDelta;
        performanceFrameCount++;
        performanceController.reportFrame(rawDelta * 1000, now);
      }
      if (now - performanceWindowAt > 2000 && performanceFrameCount > 20) {
        const averageFrameTime = performanceFrameTime / performanceFrameCount;
        activeQualityProfile = performanceController.profile;
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
          detailedUnits: unitObjects.size,
          simulationMs:
            simulationSamples > 0 ? simulationSpentMs / simulationSamples : 0,
          pathfindingMs:
            pathfindingSamples > 0
              ? pathfindingSpentMs / pathfindingSamples
              : 0,
        });
        windowDetailMeshes.forEach(
          (mesh) => (mesh.visible = activeQualityProfile.windowDetails),
        );
        performanceWindowAt = now;
        performanceFrameTime = 0;
        performanceFrameCount = 0;
        simulationSpentMs = 0;
        simulationSamples = 0;
        pathfindingSpentMs = 0;
        pathfindingSamples = 0;
      }
      const g = gameRef.current;
      if (screenRef.current === "home") {
        controls.update();
        renderer.render(scene, camera);
        return;
      }
      if (pauseOpenRef.current) {
        renderer.render(scene, camera);
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
      g.campaign.elapsedHours += dt * 0.18 * timeScaleRef.current;
      if (autoDayRef.current) {
        g.timeOfDay = (8 + g.campaign.elapsedHours) % 24;
      }
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
      moon.intensity = night * 0.9;
      hemi.intensity = 0.36 + day * 1.54;
      hemi.color.set(day > 0.35 ? 0xcfe8ff : 0x486795);
      hemi.groundColor.set(day > 0.35 ? 0x324226 : 0x182437);
      const sky = new THREE.Color(0x07101f).lerp(
        new THREE.Color(0x9fc5d8),
        day,
      );
      scene.background = sky;
      (scene.fog as THREE.FogExp2).color.copy(sky);
      windowMaterials.forEach((m) => (m.emissiveIntensity = night * 3.2));
      lampBulbMaterial.emissiveIntensity = 0.08 + night * 4.8;
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
            index < activeQualityProfile.dynamicLights ? night * 5.5 : 0),
      );
      renderer.toneMappingExposure = 0.72 + day * 0.38;
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
      if (now >= nextLodRefreshAt) {
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
          const hpRatio = THREE.MathUtils.clamp(u.hp / 100, 0, 1),
            hpBack = mesh.userData.hpBack as THREE.Mesh,
            hpFill = mesh.userData.hpFill as THREE.Mesh;
          hpBack.visible = fighting;
          hpFill.visible = fighting;
          hpFill.scale.x = 0.74 * hpRatio;
          hpFill.position.x = -0.37 * (1 - hpRatio);
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
          simulationDivisor = prioritySimulation
            ? 1
            : distanceToView < 32
              ? 2
              : 4;
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
            s =
              roadSpeed *
              terrainSpeed *
              transportSpeed *
              (u.moveModifier ?? 1) *
              morningMove *
              unitStatus.movement *
              (unitDecision.movement ?? 1) *
              unitSimulationDt;
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
          const nextX = u.x + (moveX / moveLength) * s,
            nextZ = u.z + (moveZ / moveLength) * s;
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
      if (simulateUnits || lodRefreshed) updateFarUnitInstances();
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
        const populationCellSize = 4,
          sitePopulationGrid = new Map<string, SiteState[]>(),
          populationKey = (x: number, z: number) =>
            `${Math.floor(x / populationCellSize)}/${Math.floor(z / populationCellSize)}`;
        nearbyPopulationCache.clear();
        for (const site of g.sites) {
          if (site.destroyed) continue;
          if (site.team === "pku") pkuSiteCount++;
          else thuSiteCount++;
          nearbyPopulationCache.set(site.id, 0);
          const key = populationKey(site.navX ?? site.x, site.navZ ?? site.z),
            bucket = sitePopulationGrid.get(key);
          if (bucket) bucket.push(site);
          else sitePopulationGrid.set(key, [site]);
        }
        for (const unit of g.units) {
          if (unit.team === "pku") pkuPopulation += unit.strength;
          else thuPopulation += unit.strength;
          const gridX = Math.floor(unit.x / populationCellSize),
            gridZ = Math.floor(unit.z / populationCellSize);
          let nearestSite: SiteState | undefined,
            nearestDistance = 3.4;
          for (let offsetX = -1; offsetX <= 1; offsetX++)
            for (let offsetZ = -1; offsetZ <= 1; offsetZ++)
              for (const site of
                sitePopulationGrid.get(`${gridX + offsetX}/${gridZ + offsetZ}`) ??
                [])
                if (site.team === unit.team) {
                  const distance = Math.hypot(
                    unit.x - (site.navX ?? site.x),
                    unit.z - (site.navZ ?? site.z),
                  );
                  if (distance < nearestDistance) {
                    nearestDistance = distance;
                    nearestSite = site;
                  }
                }
          if (nearestSite)
            nearbyPopulationCache.set(
              nearestSite.id,
              (nearbyPopulationCache.get(nearestSite.id) ?? 0) + unit.strength,
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
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(animate);
    const resize = () => {
      renderer.setSize(host.clientWidth, host.clientHeight);
      camera.aspect = host.clientWidth / host.clientHeight;
      camera.updateProjectionMatrix();
      commandLineMaterials.forEach((material) =>
        material.resolution.set(host.clientWidth, host.clientHeight),
      );
    };
    addEventListener("resize", resize);
    sceneApi.current = {
      sync: () => {
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
        camera.position.set(x, 24, z + 22);
        controls.update();
      },
      applyMaterials,
      clearUnitSelection: () => {
        selectedUnitIds.clear();
        refreshUnitSelection();
      },
      setLayers: (sites, control) => {
        buildingGroup.visible = sites;
        siteNodeBatchGroup.visible = sites;
        territoryGroup.visible = control;
      },
      setPerspective: (team) => {
        const target = controls.target.clone(),
          height = 24,
          depth = team === "thu" ? -22 : 22;
        camera.position.set(target.x, height, target.z + depth);
        camera.lookAt(target);
        controls.update();
      },
      buildCampAt: (x, z) =>
        buildCampAt(
          new THREE.Vector3(x, terrainHeight(regionForX(x), x, z), z),
        ),
      enterDirectControl,
      exitDirectControl,
      refreshSiteStance,
      setToolMode: (mode) => {
        activeToolMode = mode;
        setNotice(
          mode === "simplify-lines"
            ? "兵线简化工具：按住左键划过链式兵线"
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
    sceneApi.current.setPerspective(playerTeamRef.current);
    applyMaterials(
      customMaterialsRef.current.unit,
      customMaterialsRef.current.site,
    );
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(combatTimer);
      clearInterval(campaignTimer);
      clearInterval(aiTimer);
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

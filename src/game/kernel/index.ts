import type {
  AiDifficulty,
  CompactUnitNetworkState,
  GameData,
  SiteState,
  Stance,
  Team,
  UnitNetworkState,
  UnitState,
} from "../types";
import { defaultResearchState } from "../research";
import {
  KernelPathfinder,
  compactKernelNavGrid,
  navPoint,
  nearestOpenIndex,
  type KernelNavGrid,
} from "./navigation";
import { resolveAggregateCombat, routeCollapsedUnits } from "./combat";
import { runProductionCycles } from "./production";
import { AI_TACTICS_VERSION, planStrategicOrders } from "./ai";
import { simulateKernelMovement } from "./movement";
import { captureSite } from "./capture";
import { interceptRoute } from "./control";
import {
  applyProgressionAction,
  progressDecisions,
  progressResearchAndProduction,
  runAiProgression,
  type ProgressionAction,
} from "./progression";
import { processKernelEvents, recordKernelEvent } from "./events";
import { EVENT_CARDS } from "../events/event-cards";
import { cancelSiteMovement, migrateLegacyOrders, ORDER_RULES_VERSION } from "./orders";
import { prepareServerDeployment } from "./deployment";
import { dispatchPlayerRoutes, PLAYER_DISPATCH_VERSION } from "./player-dispatch";
import { withModifierCache } from "./modifiers";
import { FieldEncounters, FIELD_ENCOUNTER_VERSION } from "./encounters";
export {
  KernelPathfinder,
  navIndex,
  navPoint,
  nearestOpenIndex,
  nearestRoadIndex,
  type KernelNavGrid,
} from "./navigation";
export {
  resolveAggregateCombat,
  routeCollapsedUnits,
  type AggregateCombatResult,
} from "./combat";
export {
  classifyIntent,
  offensiveMomentum,
  isHighRiskEventTarget,
  type AiIntent,
  type HostileGroupSummary,
  planStrategicOrders,
  type PlannedAiCamp,
  type PlannedAiOrder,
} from "./ai";
export {
  runProductionCycles,
  spawnKernelUnits,
  type KernelIssueOrder,
} from "./production";
export { simulateKernelMovement, parkBikeAtSite } from "./movement";
export { captureSite, type CaptureResult } from "./capture";
export { firstEnemyControlSite, siteControlRadius } from "./control";
export {
  addTimedStatus,
  statusModifiersFor,
  unitModifiers,
} from "./modifiers";
export {
  allocateTransport,
  applyProgressionAction,
  progressDecisions,
  progressResearchAndProduction,
  runAiProgression,
  type ProgressionAction,
} from "./progression";
export {
  processKernelEvents,
  recordKernelEvent,
  type KernelEventContext,
} from "./events";

export const KERNEL_API_VERSION = 2;

export type KernelAction =
  | { type: "set_time_scale"; value: number }
  | { type: "set_resource"; team: Team; value: number }
  | { type: "set_ai_difficulty"; team: Team; value: AiDifficulty }
  | {
      type: "order_site";
      team: Team;
      sourceId: number;
      targetId: number;
      count?: number;
    }
  | {
      type: "order_units";
      team: Team;
      unitIds: number[];
      targetId?: number;
      tx?: number;
      tz?: number;
    }
  | {
      type: "configure_site";
      team: Team;
      siteId: number;
      stance?: Stance;
      dispatchRatio?: number;
      orderTarget?: number | null;
      plannedOrderTarget?: number | null;
      displayName?: string;
    }
  | { type: "build_camp"; team: Team; x: number; z: number }
  | { type: "set_ai_enabled"; team: Team; enabled: boolean }
  | ProgressionAction;

export type KernelOptions = {
  fieldEncounters?: "light-v1";
  profile?: boolean;
  networkEpoch?: number;
  serverOpening?: "standard" | "blitz";
  navGrid?: KernelNavGrid;
  fixedStepMilliseconds?: number;
  aiTeams?: Team[];
  mutateInitialState?: boolean;
  randomSeed?: number;
};

export type KernelEnvelope = {
  revision: number;
  elapsedHours: number;
  state: GameData;
};

export type KernelInstance = {
  performanceProfile(): {stages:Record<string,number>;frames:number;fieldEncounters?: FieldEncounters["stats"]};
  dispatchMany(actions: KernelAction[], token?: string): void;
  drainCommandReceipts(): { tokens: string[] };
  networkDeltaJSON(): string;
  battleStats(): { version: number; elapsedHours: number; kills: Record<Team, number>; captures: Record<Team, number> };
  dispatch(action: KernelAction): void;
  step(realMilliseconds: number): KernelEnvelope;
  run(iterations: number, realMilliseconds: number): KernelEnvelope;
  advanceOnly(realMilliseconds: number): void;
  snapshot(): KernelEnvelope;
  networkFull(): { type: "state"; game: GameData; role: "host" };
  networkDelta(): {
    type: "state_delta";
    revision: number;
    role: "host";
    units: CompactUnitNetworkState[];
    unitHp?: Array<[number, number, number]>;
    newUnits?: UnitNetworkState[];
    removedUnitIds: number[];
    sites: SiteState[];
    campaign?: GameData["campaign"];
    timeOfDay: number;
    timeScale: number;
    elapsedHours: number;
    resources: GameData["resources"];
    deaths: GameData["deaths"];
  };
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const copyPath = (path: [number,number][]) => path.map(point=>[point[0],point[1]] as [number,number]);

const normalizeKernelState = (state: GameData) => {
  state.timeOfDay ??= 8;
  state.resources ??= { pku: 0, thu: 0 };
  state.deaths ??= { pku: 0, thu: 0 };
  state.sites ??= [];
  state.units ??= [];
  const campaign = state.campaign;
  campaign.rulesVersion ??= 3;
  campaign.startDateISO ??= "2026-08-16T08:00:00+08:00";
  campaign.elapsedHours ??= 0;
  campaign.firedEvents ??= [];
  campaign.warUnlocked ??= false;
  campaign.attackBonus ??= { pku: 1, thu: 1 };
  campaign.freezeUntil ??= { pku: 0, thu: 0 };
  campaign.nextSiteId ??= state.sites.length;
  campaign.lastProductionCycle ??= 0;
  campaign.lastDiningCycle ??= 0;
  campaign.lastMorningEventDay ??= -1;
  campaign.thuFactionName ??= "清华";
  campaign.statuses ??= [];
  campaign.eventHistory ??= [];
  campaign.battleAlerts ??= [];
  campaign.initialPkuSites ??= state.sites.filter((site) => site.team === "pku").length;
  campaign.initialThuSites ??= state.sites.filter((site) => site.team === "thu").length;
  campaign.initialProductionSites ??= { pku: 1, thu: 1 };
  campaign.decisions ??= {
    active: { pku: null, thu: null },
    completed: [],
    locked: [],
  };
  campaign.research ??= defaultResearchState();
  campaign.ai ??= {
    difficulty: "standard",
    seed: 1,
    personality: { pku: "学术联动", thu: "工程统筹" },
    nextStrategicAt: { pku: 0, thu: 0 },
    failedGoals: {},
  };
  campaign.ai.seed ??= 1;
  campaign.ai.personality ??= { pku: "学术联动", thu: "工程统筹" };
  campaign.ai.nextStrategicAt ??= { pku: 0, thu: 0 };
  campaign.ai.failedGoals ??= {};
};

export function createKernel(
  initialState: GameData,
  options: KernelOptions = {},
): KernelInstance {
  const state = options.mutateInitialState ? initialState : clone(initialState);
  normalizeKernelState(state);
  if (options.fieldEncounters === "light-v1" && !state.campaign.fieldEncounters)
    state.campaign.fieldEncounters = {version: 1, tick: 0, nextId: 1, alerts: [], unitStates: []};
  if (state.campaign.fieldEncounters && state.campaign.fieldEncounters.activeSlowUntil == null)
    state.campaign.fieldEncounters.activeSlowUntil = state.campaign.fieldEncounters.unitStates.reduce<number>((latest, value, index) => index % 4 === 3 ? Math.max(latest, typeof value === "number" ? value : 0) : latest, 0);
  if (state.campaign.fieldEncounters && (state.campaign.fieldEncounters.version !== 1 || !options.navGrid))
    throw new Error("Unsupported field encounter state or missing navigation grid");
  if (Number.isFinite(options.randomSeed)) {
    const seed = (options.randomSeed as number) >>> 0;
    state.campaign.ai.seed = seed;
    state.campaign.ai.seedByTeam = {
      pku: seed ^ 0x504b5501,
      thu: seed ^ 0x54485501,
    };
    state.campaign.ai.personality = {
      pku: ["学术联动", "快速穿插", "燕园坚守"][seed % 3],
      thu: ["工程统筹", "紫荆纵深", "主楼反攻"][(seed >>> 3) % 3],
    };
  }
  let revision = 0,
    timeScale = 1,
    accumulator = 0,
    combatAccumulator = 0;
  let combatPulse = 0;
  let lastEventHour = Number.NEGATIVE_INFINITY;
  let fightingUnitIds = new Set<number>();
  const pending: Array<KernelAction | {type:"_command_receipt";token:string}> = [];
  const stageTimes:Record<string,number>={};let profiledFrames=0;
  const stage=(key:string,from:number)=>{
    if(!options.profile)return 0;
    const now=Date.now();stageTimes[key]=(stageTimes[key]??0)+now-from;return now;
  };
  const commandReceipts: string[] = [];
  const playerBatchLimits = new Map<number, number>();
  const enabledAiTeams = new Set(options.aiTeams ?? []);
  const campResourceReserve = (team: Team) => enabledAiTeams.has(team) ? state.campaign.ai.campResourceReserve?.[team] ?? 0 : 0;
  migrateLegacyOrders(state, enabledAiTeams);
  let networkRevision = 0,
    networkBaselineInitialized = false,
    networkCampaignSignature = "",
    networkFieldContactId = 0;
  const networkUnitSignatures = new Map<number, CompactUnitNetworkState>(),
    networkSiteSignatures = new Map<number, string>();
  if (options.navGrid) options = {...options, navGrid: compactKernelNavGrid(options.navGrid)};
  const pathfinder = options.navGrid
      ? new KernelPathfinder(options.navGrid, 12_000)
      : null,
    fixedStep = Math.max(10, options.fixedStepMilliseconds ?? 50);
  if (options.navGrid)
    for (const site of state.sites) {
      const open = nearestOpenIndex(options.navGrid, site.navX ?? site.x, site.navZ ?? site.z);
      if (open < 0) continue;
      [site.navX, site.navZ] = navPoint(options.navGrid, open);
    }
  if (options.serverOpening) prepareServerDeployment(state, options.navGrid, options.serverOpening);
  const fieldEncounters = state.campaign.fieldEncounters?.version === 1 ? new FieldEncounters(options.navGrid!) : null;
  const fieldExcluded = new Set<number>();
  const fieldCandidates: number[] = [];

  const randomFor = (team: Team) => () => {
    state.campaign.ai.seedByTeam ??= {
      pku: state.campaign.ai.seed ^ 0x504b5501,
      thu: state.campaign.ai.seed ^ 0x54485501,
    };
    const next =
      (Math.imul(state.campaign.ai.seedByTeam[team], 1664525) + 1013904223) >>>
      0;
    state.campaign.ai.seedByTeam[team] = next;
    state.campaign.ai.seed = next;
    return next / 4_294_967_296;
  };

  const issueOrder = (
    team: Team,
    sourceId: number,
    targetId: number,
    count = Number.POSITIVE_INFINITY,
    purpose: "combat" | "logistics" | "probe" = "combat",
    owner: "player" | "ai" = "ai",
    selectedUnits?: ReadonlySet<number>,
  ) => {
    const source = state.sites[sourceId],
      target = state.sites[targetId];
    if (
      !source ||
      !target ||
      source.team !== team ||
      source.destroyed ||
      target.destroyed
    )
      return 0;
    fieldEncounters?.invalidate();
    if (owner === "ai" && source.orderOwner === "player") return 0;
    // Player intent persists even when no unit or path is currently available.
    if (owner === "player") {
      const stanceLimit = source.stance === "defend" ? .45 : source.stance === "guard" ? .72 : 1;
      source.dispatchRatio = Math.min(source.dispatchRatio ?? stanceLimit, stanceLimit);
      if (source.orderTarget !== targetId) source.orderIssuedAt = state.campaign.elapsedHours;
      source.orderTarget = targetId;
      source.orderPurpose = purpose;
      source.orderOwner = "player";
      source.orderIssuedAt ??= state.campaign.elapsedHours;
    }
    const path = pathfinder
      ? pathfinder.find(
          source.navX ?? source.x,
          source.navZ ?? source.z,
          target.navX ?? target.x,
          target.navZ ?? target.z,
        )
      : ([[target.navX ?? target.x, target.navZ ?? target.z]] as [
          number,
          number,
        ][]);
    if (!path.length) {
      if (owner === "player") source.orderPath = undefined;
      return 0;
    }
    if (owner === "player") source.orderPath = copyPath(path);
    if (owner === "player" && !selectedUnits) return 0;
    const route = purpose === "logistics"
      ? { path, blocker: undefined, continuationPath: undefined }
      : interceptRoute(state, team, path, pathfinder, targetId, [source.navX ?? source.x, source.navZ ?? source.z]);
    const effectiveTarget = route.blocker ?? target, effectivePath = route.path;
    if (!effectivePath.length) return 0;
    const idle = state.units.filter(
      (unit) =>
        unit.team === team &&
        unit.siteId === sourceId &&
        unit.targetSiteId == null && !unit.movementOrder &&
        (!selectedUnits || selectedUnits.has(unit.id)),
    );
    const moving = idle.slice(0, Math.max(0, Math.min(idle.length, count)));
    for (const unit of moving) {
      unit.movementOrder = {
        team, goalSiteId: target.id, goalX: target.navX ?? target.x, goalZ: target.navZ ?? target.z,
        sourceSiteId: owner === "player" ? sourceId : undefined,
        purpose, effectiveSiteId: effectiveTarget.id, continuationPath: route.continuationPath,
      };
      unit.targetSiteId = effectiveTarget.id;
      unit.path = copyPath(effectivePath);
      unit.pathIndex = 0;
      [unit.tx, unit.tz] = effectivePath.at(-1)!;
    }
    const orderChanged =
      source.orderTarget !== targetId || source.orderPurpose !== purpose;
    source.orderTarget = targetId;
    source.orderPath = copyPath(path);
    if (orderChanged)
      source.orderIssuedAt = state.campaign.elapsedHours;
    source.orderPurpose = purpose;
    source.orderOwner = owner;
    source.orderIssuedAt ??= state.campaign.elapsedHours;
    return moving.length;
  };

  const applyAction = (action: KernelAction) => {
    if (action.type === "set_time_scale") {
      timeScale = Math.max(0.5, Math.min(64, action.value));
      return;
    }
    if (action.type === "set_resource") {
      if (Number.isFinite(action.value))
        state.resources[action.team] = Math.max(0, Math.floor(action.value));
      return;
    }
    if (action.type === "order_site") {
      if (Number.isFinite(action.count)) playerBatchLimits.set(action.sourceId, Math.max(0, Math.floor(action.count!)));
      issueOrder(
        action.team,
        action.sourceId,
        action.targetId,
        action.count,
        "combat",
        "player",
      );
      return;
    }
    if (action.type === "set_ai_enabled") {
      if (action.enabled) enabledAiTeams.add(action.team);
      else enabledAiTeams.delete(action.team);
      return;
    }
    if (action.type === "order_units") {
      fieldEncounters?.invalidate();
      const target =
          action.targetId == null ? undefined : state.sites[action.targetId],
        tx = target?.navX ?? target?.x ?? action.tx,
        tz = target?.navZ ?? target?.z ?? action.tz;
      if (
        tx == null ||
        tz == null ||
        !Number.isFinite(tx) ||
        !Number.isFinite(tz) ||
        Math.abs(tx) > 70 ||
        Math.abs(tz) > 70 ||
        target?.destroyed
      )
        return;
      const allowed = new Set(action.unitIds.slice(0, 3_500));
      for (const unit of state.units) {
        if (
          !allowed.has(unit.id) ||
          unit.team !== action.team ||
          unit.retreating
        )
          continue;
        const path = pathfinder
          ? pathfinder.find(unit.x, unit.z, tx, tz)
          : ([[tx, tz]] as [number, number][]);
        if (!path.length) continue;
        const route = interceptRoute(state, action.team, path, pathfinder, target?.id, [unit.x, unit.z]);
        const blocker = route.blocker, effectivePath = route.path;
        if (!effectivePath.length) continue;
        unit.movementOrder = {
          team: action.team, goalSiteId: target?.id, goalX: tx, goalZ: tz,
          purpose: "combat", effectiveSiteId: blocker?.id ?? target?.id, continuationPath: route.continuationPath,
        };
        unit.targetSiteId = blocker?.id ?? target?.id;
        unit.path = effectivePath;
        unit.pathIndex = 0;
        [unit.tx, unit.tz] = effectivePath.at(-1)!;
      }
      return;
    }
    if (action.type === "configure_site") {
      fieldEncounters?.invalidate();
      const site = state.sites[action.siteId];
      if (!site || site.destroyed) return;
      if (site.team === action.team) {
        if (action.stance) {
          site.stance = action.stance;
          if (action.dispatchRatio == null) site.dispatchRatio = action.stance === "defend" ? .4 : action.stance === "guard" ? .7 : 1;
        }
        if (action.dispatchRatio != null && Number.isFinite(action.dispatchRatio))
          site.dispatchRatio = Math.max(0.1, Math.min(1, action.dispatchRatio));
        if (action.displayName?.trim())
          site.displayName = action.displayName.trim().slice(0, 24);
        if (action.orderTarget === null) {
          cancelSiteMovement(state, action.team, site.id);
          site.orderTarget = undefined;
          site.orderPath = undefined;
          site.orderPurpose = undefined;
          site.orderIssuedAt = undefined;
          site.orderOwner = undefined;
          site.playerDispatch = undefined;
        } else if (action.orderTarget != null) {
          issueOrder(action.team, site.id, action.orderTarget, undefined, "combat", "player");
        }
      }
      if (Object.prototype.hasOwnProperty.call(action, "plannedOrderTarget")) {
        site.plannedOrderTargets ??= {};
        site.plannedOrderPaths ??= {};
        if (site.plannedOrderTargets[action.team] !== (action.plannedOrderTarget ?? undefined))
          site.plannedOrderPaths[action.team] = undefined;
        site.plannedOrderTargets[action.team] = action.plannedOrderTarget ?? undefined;
        site.plannedOrderOwners ??= {};
        site.plannedOrderOwners[action.team] = action.plannedOrderTarget == null ? undefined : "player";
      }
      return;
    }
    if (action.type === "build_camp") {
      if (
        state.resources[action.team] < 80 ||
        !Number.isFinite(action.x) ||
        !Number.isFinite(action.z) ||
        Math.abs(action.x) > 70 ||
        Math.abs(action.z) > 70 ||
        state.sites.some(
          (site) => !site.destroyed && Math.hypot(site.x - action.x, site.z - action.z) < 2.2,
        )
      )
        return;
      const open = options.navGrid
          ? nearestOpenIndex(options.navGrid, action.x, action.z)
          : -1,
        [x, z] =
          open >= 0 && options.navGrid
            ? navPoint(options.navGrid, open)
            : [action.x, action.z];
      state.resources[action.team] -= 80;
      const id = state.campaign.nextSiteId++;
      state.sites.push({
        id,
        name: `临时营地 ${id}`,
        displayName: `临时营地 ${id}`,
        team: action.team,
        x,
        z,
        navX: x,
        navZ: z,
        type: "camp",
        stance: "guard",
        supply: 45,
        temporary: true,
        dispatchRatio: 0.65,
      });
      recordKernelEvent(state, "first_camp", EVENT_CARDS.first_camp);
      return;
    }
    if (
      action.type === "research_start" ||
      action.type === "decision_start" ||
      action.type === "decision_cancel" ||
      action.type === "production_start" ||
      action.type === "production_stop" ||
      action.type === "mobilize"
    ) {
      fieldEncounters?.invalidate();
      applyProgressionAction(state, action);
      return;
    }
    state.campaign.ai.difficultyByTeam ??= {
      pku: state.campaign.ai.difficulty,
      thu: state.campaign.ai.difficulty,
    };
    state.campaign.ai.difficultyByTeam[action.team] = action.value;
  };

  const simulateCombatAndCapture = () => {
    const dead = new Set<number>(),
      attackersByTarget = new Map<number, UnitState[]>(),
      defendersByHome = new Map<number, UnitState[]>();
    const checkField = state.campaign.warUnlocked && fieldEncounters?.due(state) ? fieldEncounters : null;
    const resumeField = checkField?.canResume(state) ? checkField : null;
    const skipField = !resumeField && checkField?.canSkip(state) ? checkField : null;
    const inspectField = resumeField || skipField ? null : checkField;
    combatPulse++;
    let fieldHasBuses = false, fieldInputsUnchanged = true;
    if (inspectField) { fieldExcluded.clear(); fieldCandidates.length = 0; }
    fightingUnitIds = new Set<number>();
    for (let unitIndex = 0; unitIndex < state.units.length; unitIndex++) {
      const unit = state.units[unitIndex];
      if (unit.hp <= 0) continue;
      let stationed = false;
      if (unit.targetSiteId != null) {
        const target = state.sites[unit.targetSiteId];
        if (
          target &&
          !target.destroyed &&
          target.team !== unit.team &&
          Math.hypot(
            unit.x - (target.navX ?? target.x),
            unit.z - (target.navZ ?? target.z),
          ) < 12
        ) {
          const attackers = attackersByTarget.get(target.id);
          if (attackers) attackers.push(unit);
          else attackersByTarget.set(target.id, [unit]);
        }
      }
      const home = state.sites[unit.siteId];
      if (home && !home.destroyed && home.team === unit.team) {
        const homeDistance = Math.hypot(unit.x - (home.navX ?? home.x), unit.z - (home.navZ ?? home.z));
        if (homeDistance < 12) {
          const defenders = defendersByHome.get(home.id);
          if (defenders) defenders.push(unit);
          else defendersByHome.set(home.id, [unit]);
        }
        if (inspectField && homeDistance < 3.4 && unit.targetSiteId == null && !unit.movementOrder)
          stationed = true;
      }
      if (inspectField) {
        if (stationed) {
          inspectField.clearNear(state, unit, state.campaign.elapsedHours);
          if (unit.transport === "bus" && unit.transportGroupId) { fieldHasBuses = true; fieldExcluded.add(unit.id); }
        } else if (unit.retreating || state.campaign.freezeUntil[unit.team] > state.campaign.elapsedHours) {
          inspectField.clearNear(state, unit, state.campaign.elapsedHours);
        } else if (unit.strength > 0) {
          fieldHasBuses ||= unit.transport === "bus" && !!unit.transportGroupId;
          fieldInputsUnchanged &&= inspectField.matchesCandidate(state, unit, fieldCandidates.length);
          fieldCandidates.push(unitIndex);
        }
      }
    }
    for (const site of state.sites) {
      if (site.destroyed) continue;
      const x = site.navX ?? site.x,
        z = site.navZ ?? site.z,
        attackers = attackersByTarget.get(site.id) ?? [],
        defenders = defendersByHome.get(site.id) ?? [];
      if (!attackers.length) continue;
      if (inspectField && fieldCandidates.length) {
        for (const unit of attackers) fieldExcluded.add(unit.id);
        for (const unit of defenders) fieldExcluded.add(unit.id);
      }
      if (defenders.length) {
        if (combatPulse % 8 === 0) {
          state.campaign.battleAlerts.push({
            id: combatPulse * 1_000 + site.id,
            x,
            z,
            atHour: state.campaign.elapsedHours,
            seen: false,
          });
          if (state.campaign.battleAlerts.length > 60)
            state.campaign.battleAlerts.splice(
              0,
              state.campaign.battleAlerts.length - 60,
            );
        }
        const group = [...attackers, ...defenders],
          result = resolveAggregateCombat(
            state,
            group.filter((unit) => unit.team === "pku"),
            group.filter((unit) => unit.team === "thu"),
            timeScale,
            combatPulse,
          );
        for (const id of result.deadIds) dead.add(id);
        for (const id of result.affectedIds) fightingUnitIds.add(id);
        continue;
      }
      const occupiers = attackers.filter(
        (unit) => Math.hypot(unit.x - x, unit.z - z) < 1.55,
      );
      if (!occupiers.length) continue;
      captureSite(state, site, occupiers, pathfinder, (team, sourceId, targetId) => {
        issueOrder(team, sourceId, targetId, undefined, "combat", state.sites[sourceId]?.orderOwner ?? "ai");
      });
    }
    if (resumeField) {
      const at = options.profile ? Date.now() : 0;
      resumeField.resume(state, dead);
      stage('field-encounters', at);
    }
    else if (skipField) skipField.skip(state);
    else if (inspectField) {
      const at = options.profile ? Date.now() : 0;
      fieldInputsUnchanged &&= inspectField.candidateCountMatches(fieldCandidates.length);
      inspectField.step(state, fieldExcluded, dead, fieldCandidates, fieldHasBuses, fieldInputsUnchanged);
      stage('field-encounters', at);
    }
    if (dead.size) {
      for (const unit of state.units)
        if (dead.has(unit.id)) {
          state.deaths[unit.team] += unit.strength;
          if (state.campaign.battleStats)
            state.campaign.battleStats.kills[unit.team === "pku" ? "thu" : "pku"] += unit.strength;
        }
      fieldEncounters?.remove(state, dead);
      state.units = state.units.filter((unit) => !dead.has(unit.id));
    }
    routeCollapsedUnits(state, fightingUnitIds, pathfinder);
  };

  const fixedTick = () => {
    let stamp=options.profile?Date.now():0;
    simulateKernelMovement(
      state,
      fixedStep / 1000,
      timeScale,
      pathfinder,
      options.navGrid,
    );
    stamp=stage('movement',stamp);
    combatAccumulator += fixedStep;
    while (combatAccumulator >= 120) {
      simulateCombatAndCapture();
      combatAccumulator -= 120;
    }
    stage('combat',stamp);
  };

  const runAi = (elapsedMilliseconds: number) => {
    void elapsedMilliseconds;
    for (const team of enabledAiTeams) {
      const difficulty =
          state.campaign.ai.difficultyByTeam?.[team] ??
          state.campaign.ai.difficulty,
        profile = difficultyProfile(difficulty);
      if (
        state.campaign.ai.nextStrategicAt[team] > state.campaign.elapsedHours
      )
        continue;
      const enemy: Team = team === "pku" ? "thu" : "pku",
        friendlySiteCount = state.sites.filter(
          (site) => site.team === team && !site.destroyed,
        ).length,
        enemySiteCount = state.sites.filter(
          (site) => site.team === enemy && !site.destroyed,
        ).length,
        strategicHours =
          difficulty === "standard" && state.campaign.serverOpening === "blitz"
            ? 4
            : difficulty === "standard"
            ? profile.strategicHours *
              (friendlySiteCount < enemySiteCount ? 1.5 : 1)
            : profile.strategicHours;
      state.campaign.ai.nextStrategicAt[team] =
        state.campaign.elapsedHours + strategicHours;
      const random = randomFor(team),
        plan = planStrategicOrders(
          state,
          team,
          difficulty,
          pathfinder,
          random,
          enabledAiTeams.has(team === "pku" ? "thu" : "pku"),
        );
      state.campaign.ai.intent ??= { pku: "passive", thu: "passive" };
      state.campaign.ai.intent[team] = plan.intent;
      state.campaign.ai.campResourceReserve ??= {};
      state.campaign.ai.campResourceReserve[team] = plan.reserveForCamp;
      state.campaign.ai.intentUpdatedAt ??= { pku: 0, thu: 0 };
      state.campaign.ai.intentUpdatedAt[team] = state.campaign.elapsedHours;
      for (const plannedCamp of plan.camps) {
        if (state.resources[team] < 80) break;
        const source = state.sites[plannedCamp.sourceId],
          target = state.sites[plannedCamp.targetId];
        if (!source || !target || source.destroyed || target.destroyed) continue;
        if (source.orderOwner === "player" && source.orderTarget != null) continue;
        const id = state.campaign.nextSiteId++,
          camp: SiteState = {
            id,
            name: `临时营地 ${id}`,
            displayName: `绕行营地·${target.name}`,
            team,
            x: plannedCamp.x,
            z: plannedCamp.z,
            navX: plannedCamp.x,
            navZ: plannedCamp.z,
            type: "camp",
            stance: "guard",
            supply: 45,
            temporary: true,
            dispatchRatio: 0.65,
            orderTarget: target.id,
            orderPath: clone(plannedCamp.pathToTarget),
            orderPurpose: "combat",
            orderOwner: "ai",
            orderIssuedAt: state.campaign.elapsedHours,
          };
        state.resources[team] -= 80;
        state.sites.push(camp);
        recordKernelEvent(state, "first_camp", EVENT_CARDS.first_camp);
        issueOrder(
          team,
          source.id,
          camp.id,
          plannedCamp.count ?? Math.max(12, Math.floor(state.units.filter(
            (unit) =>
              unit.team === team &&
              unit.siteId === source.id &&
              unit.targetSiteId == null,
          ).length * 0.68)),
        );
        source.orderTarget = undefined;
        source.orderPath = undefined;
        source.orderPurpose = undefined;
        source.orderIssuedAt = undefined;
      }
      for (const order of plan.orders)
        {
          const commandedSource = state.sites[order.sourceId];
          if (commandedSource?.orderOwner === "player" && commandedSource.orderTarget != null) continue;
          const deployed = issueOrder(
            team,
            order.sourceId,
            order.targetId,
            order.count,
            order.purpose ?? "combat",
          );
          const issuedSource = state.sites[order.sourceId];
          if (deployed && issuedSource)
            issuedSource.orderIssuedAt = state.campaign.elapsedHours;
          if (
            (difficulty !== "hard" || order.purpose === "probe") &&
            order.purpose !== "logistics" &&
            state.sites[order.sourceId]?.type !== "camp"
          ) {
            const source = state.sites[order.sourceId];
            if (source) {
              source.orderTarget = undefined;
              source.orderPath = undefined;
              source.orderPurpose = undefined;
              source.orderIssuedAt = undefined;
            }
          }
        }
      const activeCamps = state.sites.filter(
        (site) => site.team === team && site.type === "camp" && !site.destroyed,
      ).length;
      fieldEncounters?.invalidate();
      runAiProgression(
        state,
        team,
        difficulty,
        random,
        Math.max(difficulty === "hard" && activeCamps < 2 ? 80 : 0, campResourceReserve(team)),
      );
    }
  };

  const envelope = (): KernelEnvelope => ({
    revision,
    elapsedHours: state.campaign.elapsedHours,
    state: clone(state),
  });
  const advance = (realMilliseconds: number) => {
    let stamp=options.profile?Date.now():0;
    while (pending.length) {
      const action=pending.shift()!;
      if(action.type==="_command_receipt") commandReceipts.push(action.token);
      else applyAction(action);
    }
    const elapsed = Math.max(0, Math.min(250, realMilliseconds));
    stamp=stage('commands',stamp);
    state.campaign.elapsedHours += elapsed * 0.00018 * timeScale;
    state.timeOfDay = (8 + state.campaign.elapsedHours) % 24;
    if (state.campaign.elapsedHours >= 84) state.campaign.warUnlocked = true;
    runProductionCycles(
      state,
      (team, source, target, count, purpose) =>
        issueOrder(
          team,
          source.id,
          target.id,
          count,
          purpose ?? source.orderPurpose ?? "combat",
          source.orderOwner ?? "ai",
        ),
    );
    progressResearchAndProduction(state, randomFor("pku"), options.navGrid, campResourceReserve);
    stamp=stage('production',stamp);
    progressDecisions(state);
    const campSupply = 1.2 * (elapsed / 1_000);
    if (campSupply > 0)
      for (const camp of state.sites) {
        if (camp.type !== "camp" || camp.destroyed) continue;
        for (const unit of state.units)
          if (
            unit.team === camp.team &&
            Math.hypot(unit.x - camp.x, unit.z - camp.z) < 2.3
          )
            unit.supply = Math.min(100, unit.supply + campSupply);
      }
    runAi(elapsed);
    stamp=stage('ai',stamp);
    accumulator += elapsed;
    withModifierCache(state,()=>{
      while (accumulator >= fixedStep) {
        fixedTick();
        accumulator -= fixedStep;
      }
    });
    stamp=stage('movement-combat',stamp);
    if (state.campaign.elapsedHours - lastEventHour >= 0.5) {
      processKernelEvents(state, { fightingUnitIds, issueOrder });
      lastEventHour = state.campaign.elapsedHours;
    }
    stamp=stage('events',stamp);
    dispatchPlayerRoutes(state, (source, units) => issueOrder(
      source.team, source.id, source.orderTarget!, units.length,
      source.orderPurpose ?? "combat", "player", new Set(units.map(unit => unit.id)),
    ), playerBatchLimits);
    playerBatchLimits.clear();
    stamp=stage('player-dispatch',stamp);
    if (!state.campaign.outcome) {
      const pkuAlive = state.sites.some(
          (site) => site.team === "pku" && !site.destroyed,
        ),
        thuAlive = state.sites.some(
          (site) => site.team === "thu" && !site.destroyed,
        );
      if (pkuAlive !== thuAlive)
        state.campaign.outcome = {
          winner: pkuAlive ? "pku" : "thu",
          reason: `${pkuAlive ? "清华" : "北大"}全部据点失守`,
          atHour: state.campaign.elapsedHours,
        };
    }
    revision++;
    if(options.profile)profiledFrames++;
  };

  if (options.serverOpening) {
    processKernelEvents(state, { fightingUnitIds, issueOrder });
    prepareServerDeployment(state, options.navGrid, options.serverOpening);
  }

  return {
    performanceProfile(){return {stages:{...stageTimes},frames:profiledFrames,fieldEncounters:fieldEncounters?{...fieldEncounters.stats}:undefined};},
    battleStats() {
      return { version: 1, elapsedHours: state.campaign.elapsedHours,
        kills: clone(state.campaign.battleStats?.kills ?? { pku: 0, thu: 0 }),
        captures: clone(state.campaign.battleStats?.captures ?? { pku: 0, thu: 0 }) };
    },
    dispatch(action) {
      pending.push(clone(action));
    },
    dispatchMany(actions, token) {
      if(pending.length+actions.length>4096) throw new Error("command queue full");
      pending.push(...clone(actions));
      if(token) pending.push({type:"_command_receipt",token});
    },
    drainCommandReceipts() { return {tokens:commandReceipts.splice(0)}; },
    step(realMilliseconds) {
      advance(realMilliseconds);
      return envelope();
    },
    run(iterations, realMilliseconds) {
      for (let index = 0; index < Math.max(0, iterations); index++)
        advance(realMilliseconds);
      return envelope();
    },
    advanceOnly(realMilliseconds) {
      advance(realMilliseconds);
    },
    snapshot: envelope,
    networkFull() {
      // A snapshot for one joining peer cannot consume the next broadcast's
      // changes for peers already connected to this kernel.
      if (!networkBaselineInitialized) {
        for (const unit of state.units)
          networkUnitSignatures.set(unit.id, encodeCompactUnit(unit));
        for (const site of state.sites)
          networkSiteSignatures.set(site.id, networkSiteSignature(site));
        networkCampaignSignature = campaignNetworkSignature(state.campaign);
        networkFieldContactId = state.campaign.fieldEncounters?.alerts.at(-1)?.id ?? 0;
        networkBaselineInitialized = true;
      }
      return { type: "state", game: clone({...state, campaign: networkCampaignView(state.campaign), sites: state.sites.map(networkSiteView)}), role: "host", revision: networkRevision, networkEpoch: options.networkEpoch };
    },
    networkDelta() {
      networkBaselineInitialized = true;
      const currentIds = new Set<number>(),
        units: CompactUnitNetworkState[] = [],
        unitHp: Array<[number, number, number]> = [],
        newUnits: UnitNetworkState[] = [];
      for (const unit of state.units) {
        currentIds.add(unit.id);
        const previous = networkUnitSignatures.get(unit.id);
        if (previous && fieldEncounters && compactUnitExceptHpUnchanged(unit, previous)) {
          const hp10 = Math.round(unit.hp * 10);
          if (previous[6] === hp10) continue;
          previous[6] = hp10;
          const run = unitHp.at(-1);
          if (run && run[0] + run[1] === unit.id && run[2] === hp10) run[1]++;
          else unitHp.push([unit.id, 1, hp10]);
          continue;
        }
        if (previous && compactUnitUnchanged(unit, previous)) continue;
        const compact = encodeCompactUnit(unit);
        networkUnitSignatures.set(unit.id, compact);
        if (previous == null) {
          const { path: _path, pathIndex: _pathIndex, ...networkUnit } = unit;
          newUnits.push(clone(networkUnit));
        } else units.push(compact);
      }
      const removedUnitIds: number[] = [];
      for (const id of networkUnitSignatures.keys())
        if (!currentIds.has(id)) {
          removedUnitIds.push(id);
          networkUnitSignatures.delete(id);
        }
      const sites: SiteState[] = [];
      for (const site of state.sites) {
        const signature = networkSiteSignature(site);
        if (networkSiteSignatures.get(site.id) === signature) continue;
        networkSiteSignatures.set(site.id, signature);
        sites.push(clone(networkSiteView(site)));
      }
      const campaignSignature = campaignNetworkSignature(state.campaign),
        campaignChanged = campaignSignature !== networkCampaignSignature;
      if (campaignChanged) networkCampaignSignature = campaignSignature;
      const fieldContacts = (state.campaign.fieldEncounters?.alerts ?? []).filter(alert => alert.id > networkFieldContactId);
      if (fieldContacts.length) networkFieldContactId = fieldContacts.at(-1)!.id;
      return {
        type: "state_delta" as const,
        networkEpoch: options.networkEpoch,
        revision: ++networkRevision,
        role: "host" as const,
        units,
        unitHp: unitHp.length ? unitHp : undefined,
        newUnits: newUnits.length ? newUnits : undefined,
        removedUnitIds,
        sites,
        campaign: campaignChanged ? clone(networkCampaignView(state.campaign)) : undefined,
        fieldContacts: fieldContacts.length ? clone(fieldContacts) : undefined,
        timeOfDay: state.timeOfDay,
        timeScale,
        elapsedHours: state.campaign.elapsedHours,
        resources: clone(state.resources),
        deaths: clone(state.deaths),
      };
    },
    networkDeltaJSON() { return JSON.stringify(this.networkDelta()); },
  };
}

const networkSiteView = (site: SiteState) => {
  const { playerDispatch: _dispatch, ...view } = site;
  return view;
};

const networkCampaignView = (campaign: GameData["campaign"]): GameData["campaign"] => ({
  ...campaign,
  fieldEncounters: campaign.fieldEncounters ? {
    version: 1, tick: 0, nextId: campaign.fieldEncounters.nextId,
    alerts: campaign.fieldEncounters.alerts, unitStates: [],
  } : undefined,
});

// Time is already a top-level delta field. PRNG state cannot affect UI and
// must not force resending the entire event/research history on every tick.
const campaignNetworkSignature = (campaign: GameData["campaign"]) => JSON.stringify({
  ...networkCampaignView(campaign), elapsedHours: 0,
  ai: {...campaign.ai, seed: 0, seedByTeam: undefined},
  fieldEncounters: campaign.fieldEncounters ? {version: campaign.fieldEncounters.version} : undefined,
});

const NETWORK_SKINS: Array<UnitState["skin"]> = [
  undefined,
  "ustc",
  "zju",
  "nju",
  "fdu",
  "sjtu",
];

const encodeCompactUnit = (unit: UnitState): CompactUnitNetworkState => [
  unit.id,
  unit.team === "pku" ? 0 : 1,
  Math.round(unit.x * 100),
  Math.round(unit.z * 100),
  Math.round(unit.tx * 100),
  Math.round(unit.tz * 100),
  Math.round(unit.hp * 10),
  Math.round(unit.supply * 10),
  unit.strength,
  unit.siteId,
  unit.targetSiteId ?? -1,
  unit.attackModifier == null ? null : Math.round(unit.attackModifier * 100),
  unit.moveModifier == null ? null : Math.round(unit.moveModifier * 100),
  unit.morale == null ? -1 : Math.round(unit.morale * 10),
  (unit.retreating ? 1 : 0) | (unit.transportOutsidePenalty ? 2 : 0),
  Math.max(0, NETWORK_SKINS.indexOf(unit.skin)),
  unit.transport === "bus" ? 1 : unit.transport === "bike" ? 2 : 0,
  unit.transportGroupId ?? "",
  unit.transportModel ?? "",
  unit.movementOrder?.goalSiteId ?? -1,
  unit.movementOrder ? Math.round(unit.movementOrder.goalX*100) : null,
  unit.movementOrder ? Math.round(unit.movementOrder.goalZ*100) : null,
];

// Compare directly against the previous wire view, allocating a new tuple only
// when needed. Keep all wire fields and rounding identical to encodeCompactUnit.
// A future tuple length change fails closed and sends a full update.
const compactUnitExceptHpUnchanged = (unit: UnitState, previous: CompactUnitNetworkState) =>
  previous.length === 22 &&
  previous[0] === (unit.id) &&
  previous[1] === (unit.team === "pku" ? 0 : 1) &&
  previous[2] === (Math.round(unit.x * 100)) &&
  previous[3] === (Math.round(unit.z * 100)) &&
  previous[4] === (Math.round(unit.tx * 100)) &&
  previous[5] === (Math.round(unit.tz * 100)) &&
  previous[7] === (Math.round(unit.supply * 10)) &&
  previous[8] === (unit.strength) &&
  previous[9] === (unit.siteId) &&
  previous[10] === (unit.targetSiteId ?? -1) &&
  previous[11] === (unit.attackModifier == null ? null : Math.round(unit.attackModifier * 100)) &&
  previous[12] === (unit.moveModifier == null ? null : Math.round(unit.moveModifier * 100)) &&
  previous[13] === (unit.morale == null ? -1 : Math.round(unit.morale * 10)) &&
  previous[14] === ((unit.retreating ? 1 : 0) | (unit.transportOutsidePenalty ? 2 : 0)) &&
  previous[15] === (Math.max(0, NETWORK_SKINS.indexOf(unit.skin))) &&
  previous[16] === (unit.transport === "bus" ? 1 : unit.transport === "bike" ? 2 : 0) &&
  previous[17] === (unit.transportGroupId ?? "") &&
  previous[18] === (unit.transportModel ?? "") &&
  previous[19] === (unit.movementOrder?.goalSiteId ?? -1) &&
  previous[20] === (unit.movementOrder ? Math.round(unit.movementOrder.goalX*100) : null) &&
  previous[21] === (unit.movementOrder ? Math.round(unit.movementOrder.goalZ*100) : null);

const compactUnitUnchanged = (unit: UnitState, previous: CompactUnitNetworkState) =>
  compactUnitExceptHpUnchanged(unit, previous) && previous[6] === Math.round(unit.hp * 10);

const networkSiteSignature = (site: SiteState) =>
  JSON.stringify({
    team: site.team,
    stance: site.stance,
    orderTarget: site.orderTarget,
    orderOwner: site.orderOwner,
    plannedOrderTargets: site.plannedOrderTargets,
    dispatchRatio: site.dispatchRatio,
    displayName: site.displayName,
    destroyed: site.destroyed,
    temporary: site.temporary,
  });

export function siteEngagedBy(
  site: SiteState | undefined,
  attackingTeam: Team,
  units: UnitState[],
  fightingUnitIds: ReadonlySet<number>,
  radius = 12,
) {
  if (!site) return false;
  const x = site.navX ?? site.x,
    z = site.navZ ?? site.z;
  return units.some(
    (unit) =>
      unit.team === attackingTeam &&
      (unit.targetSiteId === site.id || fightingUnitIds.has(unit.id)) &&
      Math.hypot(unit.x - x, unit.z - z) < radius,
  );
}

export function pathCrossesRisk(
  path: [number, number][] | undefined,
  riskSites: SiteState[],
  radius = 5.2,
) {
  return !!path?.some(([x, z]) =>
    riskSites.some((site) => Math.hypot(x - site.x, z - site.z) < radius),
  );
}

export function difficultyProfile(difficulty: AiDifficulty) {
  if (difficulty === "hard")
    return {
      thinkMillisecondsAt1x: 1250,
      strategicHours: 3,
      routeLimit: 18,
      waveLimit: 11,
    } as const;
  if (difficulty === "casual")
    return {
      thinkMillisecondsAt1x: 19200,
      strategicHours: 30,
      routeLimit: 2,
      waveLimit: 1,
    } as const;
  return {
    thinkMillisecondsAt1x: 33000,
    strategicHours: 24,
    routeLimit: 6,
    waveLimit: 1,
  } as const;
}

export function healthCheck() {
  return {
    apiVersion: KERNEL_API_VERSION,
    language: "typescript",
    deterministic: true,
    authoritative: true,
    orderRulesVersion: ORDER_RULES_VERSION,
    decisionCancellation: true,
    fieldEncountersVersion: FIELD_ENCOUNTER_VERSION,
    serverScenariosVersion: 1,
    playerDispatchVersion: PLAYER_DISPATCH_VERSION,
    networkPerformanceVersion: 1,
    aiTacticsVersion: AI_TACTICS_VERSION,
    migrated: [
      "navigation",
      "aggregate_combat",
      "event_engagement",
      "difficulty_profile",
      "production_cycles",
      "movement_and_terrain",
      "capture_and_retreat",
      "calendar_and_tactical_events",
      "research_equipment_and_decisions",
      "temporary_camps_and_transport",
      "adaptive_ai",
      "authoritative_network_deltas",
    ],
  } as const;
}

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
  navPoint,
  nearestOpenIndex,
  type KernelNavGrid,
} from "./navigation";
import { resolveAggregateCombat, routeCollapsedUnits } from "./combat";
import { runProductionCycles } from "./production";
import { planStrategicOrders } from "./ai";
import { simulateKernelMovement } from "./movement";
import { captureSite } from "./capture";
import {
  applyProgressionAction,
  progressDecisions,
  progressResearchAndProduction,
  runAiProgression,
  type ProgressionAction,
} from "./progression";
import { processKernelEvents, recordKernelEvent } from "./events";
import { EVENT_CARDS } from "../events/event-cards";
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
  navGrid?: KernelNavGrid;
  fixedStepMilliseconds?: number;
  aiTeams?: Team[];
  mutateInitialState?: boolean;
};

export type KernelEnvelope = {
  revision: number;
  elapsedHours: number;
  state: GameData;
};

export type KernelInstance = {
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
  let revision = 0,
    timeScale = 1,
    accumulator = 0,
    combatAccumulator = 0;
  let combatPulse = 0;
  let lastEventHour = Number.NEGATIVE_INFINITY;
  let fightingUnitIds = new Set<number>();
  const pending: KernelAction[] = [];
  const enabledAiTeams = new Set(options.aiTeams ?? []);
  let networkRevision = 0,
    networkCampaignSignature = "";
  const networkUnitSignatures = new Map<number, string>(),
    networkSiteSignatures = new Map<number, string>();
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
    if (!path.length) return 0;
    const idle = state.units.filter(
      (unit) =>
        unit.team === team &&
        unit.siteId === sourceId &&
        unit.targetSiteId == null,
    );
    const moving = idle.slice(0, Math.max(0, Math.min(idle.length, count)));
    for (const unit of moving) {
      unit.targetSiteId = targetId;
      unit.path = clone(path);
      unit.pathIndex = 0;
      [unit.tx, unit.tz] = path.at(-1)!;
    }
    source.orderTarget = targetId;
    source.orderPath = clone(path);
    return moving.length;
  };

  const applyAction = (action: KernelAction) => {
    if (action.type === "set_time_scale") {
      timeScale = Math.max(0.5, Math.min(16, action.value));
      return;
    }
    if (action.type === "set_resource") {
      if (Number.isFinite(action.value))
        state.resources[action.team] = Math.max(0, Math.floor(action.value));
      return;
    }
    if (action.type === "order_site") {
      issueOrder(
        action.team,
        action.sourceId,
        action.targetId,
        action.count,
      );
      return;
    }
    if (action.type === "set_ai_enabled") {
      if (action.enabled) enabledAiTeams.add(action.team);
      else enabledAiTeams.delete(action.team);
      return;
    }
    if (action.type === "order_units") {
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
        unit.targetSiteId = target?.id;
        unit.path = path;
        unit.pathIndex = 0;
        unit.tx = tx;
        unit.tz = tz;
      }
      return;
    }
    if (action.type === "configure_site") {
      const site = state.sites[action.siteId];
      if (!site || site.destroyed) return;
      if (site.team === action.team) {
        if (action.stance) site.stance = action.stance;
        if (action.dispatchRatio != null && Number.isFinite(action.dispatchRatio))
          site.dispatchRatio = Math.max(0.1, Math.min(1, action.dispatchRatio));
        if (action.displayName?.trim())
          site.displayName = action.displayName.trim().slice(0, 24);
        if (action.orderTarget === null) {
          site.orderTarget = undefined;
          site.orderPath = undefined;
        } else if (action.orderTarget != null) {
          issueOrder(action.team, site.id, action.orderTarget);
        }
      }
      site.plannedOrderTargets ??= {};
      site.plannedOrderPaths ??= {};
      site.plannedOrderTargets[action.team] =
        action.plannedOrderTarget ?? undefined;
      site.plannedOrderPaths[action.team] = undefined;
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
      action.type === "production_start" ||
      action.type === "production_stop" ||
      action.type === "mobilize"
    ) {
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
    combatPulse++;
    fightingUnitIds = new Set<number>();
    for (const unit of state.units) {
      if (unit.hp <= 0) continue;
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
      if (
        home &&
        !home.destroyed &&
        home.team === unit.team &&
        Math.hypot(
          unit.x - (home.navX ?? home.x),
          unit.z - (home.navZ ?? home.z),
        ) < 12
      ) {
        const defenders = defendersByHome.get(home.id);
        if (defenders) defenders.push(unit);
        else defendersByHome.set(home.id, [unit]);
      }
    }
    for (const site of state.sites) {
      if (site.destroyed) continue;
      const x = site.navX ?? site.x,
        z = site.navZ ?? site.z,
        attackers = attackersByTarget.get(site.id) ?? [],
        defenders = defendersByHome.get(site.id) ?? [];
      if (!attackers.length) continue;
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
        issueOrder(team, sourceId, targetId);
      });
    }
    if (dead.size) {
      for (const unit of state.units)
        if (dead.has(unit.id)) state.deaths[unit.team] += unit.strength;
      state.units = state.units.filter((unit) => !dead.has(unit.id));
    }
    routeCollapsedUnits(state, fightingUnitIds, pathfinder);
  };

  const fixedTick = () => {
    simulateKernelMovement(
      state,
      fixedStep / 1000,
      timeScale,
      pathfinder,
      options.navGrid,
    );
    combatAccumulator += fixedStep;
    while (combatAccumulator >= 120) {
      simulateCombatAndCapture();
      combatAccumulator -= 120;
    }
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
        initialEnemySites =
          enemy === "pku"
            ? state.campaign.initialPkuSites
            : state.campaign.initialThuSites,
        strategicHours =
          difficulty === "standard"
            ? profile.strategicHours *
              (initialEnemySites < 75
                ? 96 / Math.max(40, initialEnemySites)
                : 1)
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
        );
      state.campaign.ai.intent ??= { pku: "passive", thu: "passive" };
      state.campaign.ai.intent[team] = plan.intent;
      state.campaign.ai.intentUpdatedAt ??= { pku: 0, thu: 0 };
      state.campaign.ai.intentUpdatedAt[team] = state.campaign.elapsedHours;
      runAiProgression(state, team, difficulty, random);
      for (const plannedCamp of plan.camps) {
        if (state.resources[team] < 80) break;
        const source = state.sites[plannedCamp.sourceId],
          target = state.sites[plannedCamp.targetId];
        if (!source || !target || source.destroyed || target.destroyed) continue;
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
          };
        state.resources[team] -= 80;
        state.sites.push(camp);
        recordKernelEvent(state, "first_camp", EVENT_CARDS.first_camp);
        issueOrder(
          team,
          source.id,
          camp.id,
          Math.max(12, Math.floor(state.units.filter(
            (unit) =>
              unit.team === team &&
              unit.siteId === source.id &&
              unit.targetSiteId == null,
          ).length * 0.68)),
        );
        source.orderTarget = undefined;
        source.orderPath = undefined;
      }
      for (const order of plan.orders)
        {
          issueOrder(team, order.sourceId, order.targetId, order.count);
          if (
            difficulty !== "hard" &&
            state.sites[order.sourceId]?.type !== "camp"
          ) {
            const source = state.sites[order.sourceId];
            if (source) {
              source.orderTarget = undefined;
              source.orderPath = undefined;
            }
          }
        }
    }
  };

  const envelope = (): KernelEnvelope => ({
    revision,
    elapsedHours: state.campaign.elapsedHours,
    state: clone(state),
  });
  const advance = (realMilliseconds: number) => {
    while (pending.length) applyAction(pending.shift()!);
    const elapsed = Math.max(0, Math.min(250, realMilliseconds));
    state.campaign.elapsedHours += elapsed * 0.00018 * timeScale;
    state.timeOfDay = (8 + state.campaign.elapsedHours) % 24;
    if (state.campaign.elapsedHours >= 84) state.campaign.warUnlocked = true;
    runProductionCycles(
      state,
      (team, source, target, count) =>
        issueOrder(team, source.id, target.id, count),
    );
    progressResearchAndProduction(state, randomFor("pku"), options.navGrid);
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
    accumulator += elapsed;
    while (accumulator >= fixedStep) {
      fixedTick();
      accumulator -= fixedStep;
    }
    if (state.campaign.elapsedHours - lastEventHour >= 0.5) {
      processKernelEvents(state, { fightingUnitIds, issueOrder });
      lastEventHour = state.campaign.elapsedHours;
    }
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
  };

  return {
    dispatch(action) {
      pending.push(clone(action));
    },
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
      networkUnitSignatures.clear();
      networkSiteSignatures.clear();
      for (const unit of state.units)
        networkUnitSignatures.set(unit.id, networkUnitSignature(unit));
      for (const site of state.sites)
        networkSiteSignatures.set(site.id, networkSiteSignature(site));
      networkCampaignSignature = JSON.stringify(state.campaign);
      return { type: "state", game: clone(state), role: "host" };
    },
    networkDelta() {
      const currentIds = new Set<number>(),
        units: CompactUnitNetworkState[] = [],
        newUnits: UnitNetworkState[] = [];
      for (const unit of state.units) {
        currentIds.add(unit.id);
        const signature = networkUnitSignature(unit),
          previous = networkUnitSignatures.get(unit.id);
        if (previous === signature) continue;
        networkUnitSignatures.set(unit.id, signature);
        if (previous == null) {
          const { path: _path, pathIndex: _pathIndex, ...networkUnit } = unit;
          newUnits.push(clone(networkUnit));
        } else units.push(encodeCompactUnit(unit));
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
        sites.push(clone(site));
      }
      const campaignSignature = JSON.stringify(state.campaign),
        campaignChanged = campaignSignature !== networkCampaignSignature;
      if (campaignChanged) networkCampaignSignature = campaignSignature;
      return {
        type: "state_delta" as const,
        revision: ++networkRevision,
        role: "host" as const,
        units,
        newUnits: newUnits.length ? newUnits : undefined,
        removedUnitIds,
        sites,
        campaign: campaignChanged ? clone(state.campaign) : undefined,
        timeOfDay: state.timeOfDay,
        timeScale,
        elapsedHours: state.campaign.elapsedHours,
        resources: clone(state.resources),
        deaths: clone(state.deaths),
      };
    },
  };
}

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
];

const networkUnitSignature = (unit: UnitState) =>
  [
    unit.team,
    unit.x.toFixed(2),
    unit.z.toFixed(2),
    unit.tx.toFixed(2),
    unit.tz.toFixed(2),
    unit.hp.toFixed(1),
    unit.supply.toFixed(1),
    unit.morale?.toFixed(1) ?? "",
    unit.siteId,
    unit.targetSiteId ?? "",
    unit.retreating ? 1 : 0,
    unit.skin ?? "",
    unit.transport ?? "",
    unit.transportModel ?? "",
  ].join("/");

const networkSiteSignature = (site: SiteState) =>
  JSON.stringify({
    team: site.team,
    stance: site.stance,
    orderTarget: site.orderTarget,
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
      strategicHours: 24,
      routeLimit: 2,
      waveLimit: 1,
    } as const;
  return {
    thinkMillisecondsAt1x: 30000,
    strategicHours: 8.2,
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

import type { AiDifficulty, GameData, SiteState, Team, UnitState } from "../types";
import { KernelPathfinder, type KernelNavGrid } from "./navigation";
import { resolveAggregateCombat } from "./combat";
import { runProductionCycles } from "./production";
import { planStrategicOrders } from "./ai";
export {
  KernelPathfinder,
  navIndex,
  navPoint,
  nearestOpenIndex,
  nearestRoadIndex,
  type KernelNavGrid,
} from "./navigation";
export { resolveAggregateCombat, type AggregateCombatResult } from "./combat";
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

export const KERNEL_API_VERSION = 1;

export type KernelAction =
  | { type: "set_time_scale"; value: number }
  | { type: "set_ai_difficulty"; team: Team; value: AiDifficulty }
  | {
      type: "order_site";
      team: Team;
      sourceId: number;
      targetId: number;
      count?: number;
    };

export type KernelOptions = {
  navGrid?: KernelNavGrid;
  fixedStepMilliseconds?: number;
  aiTeams?: Team[];
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
  snapshot(): KernelEnvelope;
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function createKernel(
  initialState: GameData,
  options: KernelOptions = {},
): KernelInstance {
  const state = clone(initialState);
  let revision = 0,
    timeScale = 1,
    accumulator = 0,
    combatAccumulator = 0;
  let combatPulse = 0;
  const pending: KernelAction[] = [];
  const aiAccumulator: Record<Team, number> = { pku: 0, thu: 0 };
  const pathfinder = options.navGrid
      ? new KernelPathfinder(options.navGrid)
      : null,
    fixedStep = Math.max(10, options.fixedStepMilliseconds ?? 50);

  const issueOrder = (
    team: Team,
    sourceId: number,
    targetId: number,
    count = Number.POSITIVE_INFINITY,
  ) => {
    const source = state.sites[sourceId],
      target = state.sites[targetId];
    if (!source || !target || source.destroyed || target.destroyed) return 0;
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
    if (action.type === "order_site") {
      issueOrder(
        action.team,
        action.sourceId,
        action.targetId,
        action.count,
      );
      return;
    }
    state.campaign.ai.difficultyByTeam ??= {
      pku: state.campaign.ai.difficulty,
      thu: state.campaign.ai.difficulty,
    };
    state.campaign.ai.difficultyByTeam[action.team] = action.value;
  };

  const simulateMovement = (seconds: number) => {
    for (const unit of state.units) {
      if (unit.targetSiteId == null || unit.hp <= 0) continue;
      const target = state.sites[unit.targetSiteId];
      if (!target || target.destroyed) {
        unit.targetSiteId = undefined;
        unit.path = undefined;
        unit.pathIndex = undefined;
        continue;
      }
      let budget = 0.5 * seconds * timeScale,
        index = unit.pathIndex ?? 0;
      while (budget > 0.0001) {
        const point = unit.path?.[index] ?? [unit.tx, unit.tz],
          dx = point[0] - unit.x,
          dz = point[1] - unit.z,
          distance = Math.hypot(dx, dz);
        if (distance <= budget) {
          unit.x = point[0];
          unit.z = point[1];
          budget -= distance;
          if (unit.path && index < unit.path.length) {
            index++;
            unit.pathIndex = index;
            continue;
          }
          break;
        }
        unit.x += (dx / Math.max(distance, 0.0001)) * budget;
        unit.z += (dz / Math.max(distance, 0.0001)) * budget;
        budget = 0;
      }
      const targetX = target.navX ?? target.x,
        targetZ = target.navZ ?? target.z;
      if (target.team === unit.team && Math.hypot(unit.x - targetX, unit.z - targetZ) < 1.85) {
        unit.siteId = target.id;
        unit.targetSiteId = undefined;
        unit.path = undefined;
        unit.pathIndex = undefined;
        unit.tx = targetX;
        unit.tz = targetZ;
      }
    }
  };

  const simulateCombatAndCapture = () => {
    const dead = new Set<number>(),
      attackersByTarget = new Map<number, UnitState[]>(),
      defendersByHome = new Map<number, UnitState[]>();
    combatPulse++;
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
        const group = [...attackers, ...defenders],
          result = resolveAggregateCombat(
            state,
            group.filter((unit) => unit.team === "pku"),
            group.filter((unit) => unit.team === "thu"),
            timeScale,
            combatPulse,
          );
        for (const id of result.deadIds) dead.add(id);
        continue;
      }
      const occupiers = attackers.filter(
        (unit) => Math.hypot(unit.x - x, unit.z - z) < 1.55,
      );
      if (!occupiers.length) continue;
      site.team = occupiers[0].team;
      for (const unit of occupiers) {
        unit.siteId = site.id;
        unit.targetSiteId = undefined;
        unit.path = undefined;
        unit.pathIndex = undefined;
      }
    }
    if (dead.size) {
      for (const unit of state.units)
        if (dead.has(unit.id)) state.deaths[unit.team] += unit.strength;
      state.units = state.units.filter((unit) => !dead.has(unit.id));
    }
  };

  const fixedTick = () => {
    simulateMovement(fixedStep / 1000);
    combatAccumulator += fixedStep;
    while (combatAccumulator >= 120) {
      simulateCombatAndCapture();
      combatAccumulator -= 120;
    }
  };

  const runAi = (elapsedMilliseconds: number) => {
    for (const team of options.aiTeams ?? []) {
      const difficulty =
          state.campaign.ai.difficultyByTeam?.[team] ??
          state.campaign.ai.difficulty,
        profile = difficultyProfile(difficulty),
        interval = Math.max(
          120,
          profile.thinkMillisecondsAt1x / timeScale,
        );
      aiAccumulator[team] += elapsedMilliseconds;
      if (aiAccumulator[team] < interval) continue;
      aiAccumulator[team] %= interval;
      state.campaign.ai.seedByTeam ??= {
        pku: state.campaign.ai.seed ^ 0x504b5501,
        thu: state.campaign.ai.seed ^ 0x54485501,
      };
      const random = () => {
          const next =
            (Math.imul(state.campaign.ai.seedByTeam![team], 1664525) +
              1013904223) >>>
            0;
          state.campaign.ai.seedByTeam![team] = next;
          state.campaign.ai.seed = next;
          return next / 4_294_967_296;
        },
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
    if (state.campaign.elapsedHours >= 84) state.campaign.warUnlocked = true;
    runProductionCycles(
      state,
      (team, source, target, count) =>
        issueOrder(team, source.id, target.id, count),
    );
    runAi(elapsed);
    accumulator += elapsed;
    while (accumulator >= fixedStep) {
      fixedTick();
      accumulator -= fixedStep;
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
    snapshot: envelope,
  };
}

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
    thinkMillisecondsAt1x: 24000,
    strategicHours: 6,
    routeLimit: 6,
    waveLimit: 1,
  } as const;
}

export function healthCheck() {
  return {
    apiVersion: KERNEL_API_VERSION,
    language: "typescript",
    deterministic: true,
    authoritative: false,
    migrated: [
      "navigation",
      "aggregate_combat",
      "event_engagement",
      "difficulty_profile",
      "production_cycles",
    ],
  } as const;
}

import type { GameData, Team, UnitMovementOrder, UnitState } from "../types";
import { interceptRoute } from "./control";
import type { KernelPathfinder } from "./navigation";

export const ORDER_RULES_VERSION = 1;

export function migrateLegacyOrders(
  game: GameData,
  aiTeams: ReadonlySet<Team>,
) {
  for (const site of game.sites) {
    if (site.orderTarget != null && site.orderOwner == null)
      site.orderOwner = aiTeams.has(site.team) ? "ai" : "player";
  }
  if (game.campaign.orderRulesVersion === ORDER_RULES_VERSION) return;
  for (const site of game.sites)
    for (const team of ["pku", "thu"] as Team[]) {
      const targetId = site.plannedOrderTargets?.[team];
      if (targetId == null) continue;
      const path = site.plannedOrderPaths?.[team];
      // Legacy automatic plans copied the original source path onto an enemy site.
      // Genuine drawn plans start at this site, or have no supplied path at all.
      const automatic =
        site.plannedOrderOwners?.[team] === "ai" ||
        (path?.length &&
          Math.hypot(
            path[0][0] - (site.navX ?? site.x),
            path[0][1] - (site.navZ ?? site.z),
          ) > 4.5);
      if (!automatic) continue;
      const goal = game.sites[targetId];
      if (goal && !goal.destroyed)
        for (const unit of game.units) {
          const source = game.sites[unit.siteId];
          if (
            unit.team !== team ||
            unit.targetSiteId !== site.id ||
            unit.movementOrder ||
            source?.team !== team ||
            source.orderTarget !== targetId
          )
            continue;
          unit.movementOrder = {
            team,
            goalSiteId: targetId,
            goalX: goal.navX ?? goal.x,
            goalZ: goal.navZ ?? goal.z,
            sourceSiteId:
              source.orderOwner === "player" ? source.id : undefined,
            purpose: source.orderPurpose ?? "combat",
            effectiveSiteId: site.id,
          };
        }
      delete site.plannedOrderTargets?.[team];
      delete site.plannedOrderPaths?.[team];
      delete site.plannedOrderOwners?.[team];
    }
  game.campaign.orderRulesVersion = ORDER_RULES_VERSION;
}

export function stopUnitMovement(unit: UnitState) {
  unit.movementOrder = undefined;
  unit.targetSiteId = undefined;
  unit.path = undefined;
  unit.pathIndex = undefined;
  unit.tx = unit.x;
  unit.tz = unit.z;
}

export function cancelSiteMovement(
  game: GameData,
  team: Team,
  sourceId: number,
) {
  for (const unit of game.units)
    if (unit.team === team && unit.movementOrder?.sourceSiteId === sourceId)
      stopUnitMovement(unit);
}

// Never writes site orders or capture plans: the intermediate target belongs
// only to the dispatched units. Two armies crossing the same point stay separate.
function routeUnit(
  game: GameData,
  unit: UnitState,
  pathfinder: KernelPathfinder | null,
) {
  const order = unit.movementOrder!;
  const goal =
    order.goalSiteId == null ? undefined : game.sites[order.goalSiteId];
  const x = goal?.navX ?? goal?.x ?? order.goalX;
  const z = goal?.navZ ?? goal?.z ?? order.goalZ;
  const corridor = order.continuationPath;
  const path = corridor?.length ? corridor : pathfinder
    ? pathfinder.find(unit.x, unit.z, x, z)
    : [[x, z] as [number, number]];
  const connector = corridor?.length
    ? pathfinder ? pathfinder.find(unit.x, unit.z, path[0][0], path[0][1]) : [path[0]]
    : [];
  const route = order.purpose === "logistics"
    ? { path, blocker: undefined, continuationPath: undefined }
    : interceptRoute(game, unit.team, path, pathfinder, goal?.id);
  const target = route.blocker ?? goal;
  const effectivePath = route.path.length && (!corridor?.length || connector.length)
    ? [...connector, ...route.path] : [];
  if (effectivePath.length) order.continuationPath = route.continuationPath;
  order.goalX = x;
  order.goalZ = z;
  order.effectiveSiteId = target?.id;
  order.awaitingContinuation = undefined;
  unit.targetSiteId = target?.id;
  unit.path = effectivePath;
  unit.pathIndex = 0;
  unit.tx = target?.navX ?? target?.x ?? x;
  unit.tz = target?.navZ ?? target?.z ?? z;
  if (!effectivePath.length) {
    // A transient path failure pauses travel, never deletes the player's line.
    order.retryAt = game.campaign.elapsedHours + 0.25;
    return false;
  }
  order.retryAt = undefined;
  return true;
}

export function assignUnitMovement(
  game: GameData,
  unit: UnitState,
  order: Omit<UnitMovementOrder, "team" | "effectiveSiteId" | "retryAt">,
  pathfinder: KernelPathfinder | null,
) {
  unit.movementOrder = { ...order, team: unit.team };
  return routeUnit(game, unit, pathfinder);
}

// Called before movement; it also adopts local UI/legacy-save unit commands.
export function prepareUnitMovement(
  game: GameData,
  unit: UnitState,
  pathfinder: KernelPathfinder | null,
) {
  let order = unit.movementOrder;
  if (unit.retreating) {
    unit.movementOrder = undefined;
    return true;
  }
  if (order && order.team !== unit.team) {
    stopUnitMovement(unit);
    return false;
  }
  if (
    order &&
    ((unit.targetSiteId !== order.effectiveSiteId &&
      !(order.awaitingContinuation && unit.targetSiteId == null)) ||
      (order.effectiveSiteId == null &&
        unit.targetSiteId == null &&
        Math.hypot(unit.tx - order.goalX, unit.tz - order.goalZ) > 0.01))
  ) {
    // An explicit local unit command supersedes its previous movement intent.
    unit.movementOrder = order = undefined;
  }
  if (!order) {
    const target =
      unit.targetSiteId == null ? undefined : game.sites[unit.targetSiteId];
    if (!target || target.destroyed) return true;
    const source = game.sites[unit.siteId];
    return assignUnitMovement(
      game,
      unit,
      {
        goalSiteId: target.id,
        goalX: target.navX ?? target.x,
        goalZ: target.navZ ?? target.z,
        sourceSiteId:
          source?.team === unit.team &&
          source.orderOwner === "player" &&
          source.orderTarget === target.id
            ? source.id
            : undefined,
        purpose: source?.orderPurpose ?? "combat",
      },
      pathfinder,
    );
  }
  let changed = false;
  if (order.sourceSiteId != null) {
    const source = game.sites[order.sourceSiteId];
    if (
      !source ||
      source.destroyed ||
      source.team !== unit.team ||
      source.orderTarget == null
    ) {
      stopUnitMovement(unit);
      return false;
    }
    if (source.orderTarget !== order.goalSiteId) {
      order.goalSiteId = source.orderTarget;
      order.purpose = source.orderPurpose ?? "combat";
      order.continuationPath = undefined;
      changed = true;
    }
  }
  const goal =
    order.goalSiteId == null ? undefined : game.sites[order.goalSiteId];
  if (order.goalSiteId != null && (!goal || goal.destroyed)) {
    stopUnitMovement(unit);
    return false;
  }
  const effective =
    order.effectiveSiteId == null
      ? undefined
      : game.sites[order.effectiveSiteId];
  const released =
    order.effectiveSiteId != null &&
    order.effectiveSiteId !== order.goalSiteId &&
    (!effective ||
      effective.destroyed ||
      (effective.team === unit.team &&
        Math.hypot(
          unit.x - (effective.navX ?? effective.x),
          unit.z - (effective.navZ ?? effective.z),
        ) < 1.85));
  if (changed || released || unit.targetSiteId !== order.effectiveSiteId)
    return routeUnit(game, unit, pathfinder);
  if (!unit.path?.length && order.retryAt != null) {
    if (game.campaign.elapsedHours < order.retryAt) return false;
    return routeUnit(game, unit, pathfinder);
  }
  return true;
}

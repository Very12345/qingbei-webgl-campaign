import { RESEARCH_DEFINITIONS } from "../research";
import type { GameData, SiteState, UnitState } from "../types";
import { navIndex, type KernelNavGrid, type KernelPathfinder } from "./navigation";
import { unitModifiers } from "./modifiers";

const insideTsinghuaCampus = (x: number, z: number) =>
  x > -18 && x < 38 && z > -48 && z < 17;

export function parkBikeAtSite(
  game: GameData,
  unit: UnitState,
  site: SiteState,
) {
  if (unit.transport !== "bike") return;
  const model = unit.transportModel;
  unit.transport = undefined;
  unit.transportGroupId = undefined;
  unit.transportModel = undefined;
  unit.transportOutsidePenalty = false;
  if (!model || RESEARCH_DEFINITIONS[model].category !== "bike") return;
  game.campaign.research.stockpile[unit.team][model] += 1;
  site.bikeCooldownUntil = Math.max(
    site.bikeCooldownUntil ?? 0,
    game.campaign.elapsedHours + RESEARCH_DEFINITIONS[model].cooldownHours,
  );
}

const disembarkBusGroup = (game: GameData, groupId?: string) => {
  if (!groupId) return;
  for (const unit of game.units) {
    if (unit.transportGroupId !== groupId) continue;
    unit.transport = undefined;
    unit.transportGroupId = undefined;
    unit.transportModel = undefined;
  }
};

const finishFriendlyArrival = (
  game: GameData,
  unit: UnitState,
  target: SiteState,
) => {
  unit.siteId = target.id;
  unit.targetSiteId = undefined;
  unit.path = undefined;
  unit.pathIndex = undefined;
  if (unit.retreating) {
    unit.retreating = false;
    unit.morale = Math.min(100, (unit.morale ?? 40) + 28);
  }
  parkBikeAtSite(game, unit, target);
  const angle = ((unit.id % 7) / 7) * Math.PI * 2,
    x = target.navX ?? target.x,
    z = target.navZ ?? target.z;
  unit.tx = x + Math.cos(angle) * 0.92;
  unit.tz = z + Math.sin(angle) * 0.92;
};

export function simulateKernelMovement(
  game: GameData,
  seconds: number,
  timeScale: number,
  pathfinder: KernelPathfinder | null,
  grid?: KernelNavGrid,
) {
  for (const unit of game.units) {
    if (unit.targetSiteId == null || unit.hp <= 0) continue;
    if (game.campaign.freezeUntil[unit.team] > game.campaign.elapsedHours)
      continue;
    const target = game.sites[unit.targetSiteId];
    if (!target || target.destroyed) {
      unit.targetSiteId = undefined;
      unit.path = undefined;
      unit.pathIndex = undefined;
      continue;
    }
    const targetX = target.navX ?? target.x,
      targetZ = target.navZ ?? target.z;
    if (!unit.path || (unit.pathIndex ?? 0) >= unit.path.length) {
      const nextPath = pathfinder
        ? pathfinder.find(unit.x, unit.z, targetX, targetZ)
        : ([[targetX, targetZ]] as [number, number][]);
      if (!nextPath.length) {
        unit.targetSiteId = undefined;
        unit.path = undefined;
        unit.pathIndex = undefined;
        continue;
      }
      unit.path = nextPath;
      unit.pathIndex = 0;
    }
    let budgetSeconds = seconds * timeScale,
      index = unit.pathIndex ?? 0;
    while (budgetSeconds > 0.00001 && index < unit.path.length) {
      const point: [number, number] = unit.path[index],
        dx = point[0] - unit.x,
        dz = point[1] - unit.z,
        distance = Math.hypot(dx, dz);
      if (distance < 0.001) {
        unit.pathIndex = ++index;
        continue;
      }
      const currentIndex = grid ? navIndex(grid, unit.x, unit.z) : -1,
        nextIndex = grid ? navIndex(grid, point[0], point[1]) : -1;
      if (
        unit.transport === "bus" &&
        grid &&
        (currentIndex < 0 ||
          !grid.road[currentIndex] ||
          grid.water[currentIndex] ||
          grid.building[currentIndex])
      )
        disembarkBusGroup(game, unit.transportGroupId);
      const modifiers = unitModifiers(
          game,
          unit,
          !insideTsinghuaCampus(unit.x, unit.z),
        ),
        roadSpeed =
          currentIndex >= 0 && grid?.road[currentIndex] ? 0.78 : 0.5,
        terrainSpeed =
          currentIndex >= 0 && grid?.water[currentIndex]
            ? 0.5 * modifiers.riverMovement
            : 1,
        morningMove =
          (game.campaign.morningPenaltyUntil ?? 0) > game.campaign.elapsedHours
            ? 0.68
            : 1,
        elevationDelta =
          currentIndex >= 0 && nextIndex >= 0 && grid
            ? grid.elevation[nextIndex] - grid.elevation[currentIndex]
            : 0,
        slopeSpeed =
          elevationDelta > 0
            ? Math.max(0.52, Math.min(1, 1 - elevationDelta * 1.85))
            : Math.max(1, Math.min(1.16, 1 + Math.abs(elevationDelta) * 0.38)),
        speed =
          roadSpeed *
          terrainSpeed *
          slopeSpeed *
          modifiers.movement *
          (unit.moveModifier ?? 1) *
          morningMove,
        budget = speed * budgetSeconds;
      unit.transportOutsidePenalty =
        unit.transportModel === "thu_purple_bike" &&
        !insideTsinghuaCampus(unit.x, unit.z);
      if (distance <= budget) {
        unit.x = point[0];
        unit.z = point[1];
        budgetSeconds -= distance / Math.max(0.001, speed);
        unit.pathIndex = ++index;
      } else {
        unit.x += (dx / distance) * budget;
        unit.z += (dz / distance) * budget;
        budgetSeconds = 0;
      }
      if (
        unit.transport === "bus" &&
        grid &&
        nextIndex >= 0 &&
        (!grid.road[nextIndex] || grid.water[nextIndex] || grid.building[nextIndex])
      )
        disembarkBusGroup(game, unit.transportGroupId);
    }
    if (
      target.team === unit.team &&
      Math.hypot(unit.x - targetX, unit.z - targetZ) < 1.85
    )
      finishFriendlyArrival(game, unit, target);
    else {
      unit.tx = targetX + ((unit.id % 5) - 2) * 0.24;
      unit.tz = targetZ + ((unit.id % 4) - 1.5) * 0.24;
    }
  }
}

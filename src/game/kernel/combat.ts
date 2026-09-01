import type { GameData, UnitState } from "../types";
import { unitModifiers } from "./modifiers";
import type { KernelPathfinder } from "./navigation";

export type AggregateCombatResult = {
  affectedIds: number[];
  deadIds: number[];
};

const insideTsinghuaCampus = (x: number, z: number) =>
  x > -18 && x < 38 && z > -48 && z < 17;

const homeDefense = (game: GameData, unit: UnitState) => {
  const home = game.sites[unit.siteId];
  if (
    !home ||
    home.destroyed ||
    home.team !== unit.team ||
    Math.hypot(
      unit.x - (home.navX ?? home.x),
      unit.z - (home.navZ ?? home.z),
    ) > 2.3
  )
    return { attack: 1, defense: 1 };
  if (home.type === "gate") return { attack: 1.22, defense: 1 / 0.8 };
  if (
    home.type === "teaching" ||
    home.type === "capital" ||
    home.type === "target"
  )
    return { attack: 1.1, defense: 1 / 0.91 };
  return { attack: 1, defense: 1 };
};

export function resolveAggregateCombat(
  game: GameData,
  pku: UnitState[],
  thu: UnitState[],
  combatScale: number,
  pulse: number,
): AggregateCombatResult {
  if (!pku.length || !thu.length)
    return { affectedIds: [], deadIds: [] };
  const aggregateSide = (members: UnitState[], enemyStrength: number) => {
      const ownStrength = members.reduce(
          (sum, unit) => sum + unit.strength,
          0,
        ),
        team = members[0].team,
        averageSupply =
          members.reduce((sum, unit) => sum + unit.supply, 0) /
          Math.max(1, members.length),
        unitStats = members.map((unit) => ({
          unit,
          modifiers: unitModifiers(
            game,
            unit,
            !insideTsinghuaCampus(unit.x, unit.z),
          ),
          home: homeDefense(game, unit),
        })),
        averageAttack =
          unitStats.reduce(
            (sum, entry) =>
              sum * 1 +
              (entry.unit.attackModifier ?? 1) *
                entry.modifiers.attack *
                entry.home.attack,
            0,
          ) / Math.max(1, unitStats.length),
        averageMoraleFactor =
          unitStats.reduce(
            (sum, entry) =>
              sum +
              Math.min(
                150,
                (entry.unit.morale ?? 100) * entry.modifiers.morale,
              ) /
                100,
            0,
          ) / Math.max(1, unitStats.length),
        averageDefense =
          unitStats.reduce(
            (sum, entry) => sum + entry.modifiers.defense * entry.home.defense,
            0,
          ) / Math.max(1, unitStats.length),
        averageSupplyUse =
          unitStats.reduce(
            (sum, entry) => sum + entry.modifiers.supplyUse,
            0,
          ) / Math.max(1, unitStats.length),
        pressure = Math.max(
          0.35,
          Math.min(1.8, enemyStrength / Math.max(1, ownStrength)),
        );
      return {
        attack:
          (1.25 + averageSupply * 0.007) *
          game.campaign.attackBonus[team] *
          averageAttack *
          (0.62 + (averageMoraleFactor * 100) / 250) *
          ((game.campaign.cautionUntil ?? 0) > game.campaign.elapsedHours
            ? 0.9
            : 1) *
          ((game.campaign.morningPenaltyUntil ?? 0) > game.campaign.elapsedHours
            ? 0.72
            : 1),
        defense: averageDefense,
        supplyUse: averageSupplyUse,
        pressure,
      };
    },
    pkuStrength = pku.reduce((sum, unit) => sum + unit.strength, 0),
    thuStrength = thu.reduce((sum, unit) => sum + unit.strength, 0),
    pkuSide = aggregateSide(pku, thuStrength),
    thuSide = aggregateSide(thu, pkuStrength),
    damageToPku =
      (thuSide.attack / Math.max(0.35, pkuSide.defense)) *
      pkuSide.pressure *
      combatScale,
    damageToThu =
      (pkuSide.attack / Math.max(0.35, thuSide.defense)) *
      thuSide.pressure *
      combatScale,
    affectedIds: number[] = [],
    deadIds: number[] = [],
    applySide = (
      side: UnitState[],
      enemyCount: number,
      damage: number,
      supplyUse: number,
    ) => {
      const affectedCount = Math.max(
          1,
          Math.min(
            side.length,
            Math.ceil(side.length * Math.min(1, enemyCount / side.length)),
          ),
        ),
        start = (pulse * 17) % side.length;
      for (let index = 0; index < affectedCount; index++) {
        const unit = side[(start + index) % side.length];
        affectedIds.push(unit.id);
        if (unit.transport === "bike") {
          unit.transport = undefined;
          unit.transportModel = undefined;
          const home = game.sites[unit.siteId];
          if (home) home.bikeCooldownUntil = game.campaign.elapsedHours + 1;
        }
        unit.hp -= damage;
        unit.morale = Math.max(0, (unit.morale ?? 100) - damage * 0.72);
        unit.supply = Math.max(
          0,
          unit.supply - 0.07 * combatScale * supplyUse,
        );
        if (unit.hp <= 0) deadIds.push(unit.id);
      }
    };
  applySide(pku, thu.length, damageToPku, pkuSide.supplyUse);
  applySide(thu, pku.length, damageToThu, thuSide.supplyUse);
  return { affectedIds, deadIds };
}

export function routeCollapsedUnits(
  game: GameData,
  candidateIds: ReadonlySet<number>,
  pathfinder: KernelPathfinder | null,
) {
  const alive = { pku: 0, thu: 0 };
  for (const unit of game.units) if (unit.hp > 0) alive[unit.team]++;
  let routed = 0;
  for (const unit of game.units) {
    if (
      !candidateIds.has(unit.id) ||
      unit.hp <= 0 ||
      unit.retreating
    )
      continue;
    const modifiers = unitModifiers(
        game,
        unit,
        !insideTsinghuaCampus(unit.x, unit.z),
      ),
      morale = Math.min(150, (unit.morale ?? 100) * modifiers.morale),
      casualtyRatio =
        game.deaths[unit.team] /
        Math.max(1, game.deaths[unit.team] + alive[unit.team] * unit.strength),
      collapse =
        (1 - morale / 100) * 0.58 +
        (1 - Math.max(0, unit.hp) / 100) * 0.22 +
        casualtyRatio * 0.42;
    if (collapse < 0.62) continue;
    const contestedHome = game.units.some(
        (enemy) =>
          enemy.team !== unit.team &&
          enemy.targetSiteId === unit.siteId &&
          Math.hypot(enemy.x - unit.x, enemy.z - unit.z) < 12,
      ),
      fallback = game.sites
      .filter(
        (site) =>
          site.team === unit.team &&
          !site.destroyed &&
          (!contestedHome || site.id !== unit.siteId),
      )
      .sort(
        (a, b) =>
          Math.hypot(a.x - unit.x, a.z - unit.z) -
          Math.hypot(b.x - unit.x, b.z - unit.z),
      )[0];
    if (!fallback) continue;
    const targetX = fallback.navX ?? fallback.x,
      targetZ = fallback.navZ ?? fallback.z,
      path = pathfinder
        ? pathfinder.find(unit.x, unit.z, targetX, targetZ)
        : ([[targetX, targetZ]] as [number, number][]);
    if (!path.length) continue;
    unit.retreating = true;
    unit.targetSiteId = fallback.id;
    unit.path = path;
    unit.pathIndex = 0;
    unit.tx = targetX;
    unit.tz = targetZ;
    routed++;
  }
  return routed;
}

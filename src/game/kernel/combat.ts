import { decisionEffectsFor } from "../decisions";
import type { GameData, Team, UnitState } from "../types";

export type AggregateCombatResult = {
  affectedIds: number[];
  deadIds: number[];
};

const teamStatusFactor = (
  game: GameData,
  team: Team,
  key: "attack" | "morale" | "defense" | "supplyUse",
) =>
  (game.campaign.statuses ?? [])
    .filter(
      (status) =>
        status.team === team && status.until > game.campaign.elapsedHours,
    )
    .reduce((factor, status) => factor * (status[key] ?? 1), 1);

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
        status = {
          attack: teamStatusFactor(game, team, "attack"),
          morale: teamStatusFactor(game, team, "morale"),
          defense: teamStatusFactor(game, team, "defense"),
          supplyUse: teamStatusFactor(game, team, "supplyUse"),
        },
        decision = decisionEffectsFor(game.campaign, team),
        averageSupply =
          members.reduce((sum, unit) => sum + unit.supply, 0) /
          Math.max(1, members.length),
        averageMorale =
          members.reduce((sum, unit) => sum + (unit.morale ?? 100), 0) /
          Math.max(1, members.length),
        pressure = Math.max(
          0.35,
          Math.min(1.8, enemyStrength / Math.max(1, ownStrength)),
        );
      return {
        attack:
          (1.25 + averageSupply * 0.007) *
          game.campaign.attackBonus[team] *
          status.attack *
          (decision.attack ?? 1) *
          (0.62 + Math.min(150, averageMorale * status.morale) / 250),
        defense: status.defense * (decision.defense ?? 1),
        supplyUse: status.supplyUse * (decision.supplyUse ?? 1),
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

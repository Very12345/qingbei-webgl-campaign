import { decisionEffectsFor } from "../decisions";
import { RESEARCH_DEFINITIONS } from "../research";
import type { GameData, Team, TimedStatus, UnitState } from "../types";

export type CombatModifiers = {
  attack: number;
  movement: number;
  morale: number;
  production: number;
  defense: number;
  supplyUse: number;
  healing: number;
  riverMovement: number;
};

const identity = (): CombatModifiers => ({
  attack: 1,
  movement: 1,
  morale: 1,
  production: 1,
  defense: 1,
  supplyUse: 1,
  healing: 1,
  riverMovement: 1,
});

const statusApplies = (
  game: GameData,
  status: TimedStatus,
  team: Team,
  unitId?: number,
) =>
  status.team === team &&
  status.until > game.campaign.elapsedHours &&
  (unitId == null || !status.unitIds.length || status.unitIds.includes(unitId));

export function statusModifiersFor(
  game: GameData,
  team: Team,
  unitId?: number,
): CombatModifiers {
  return (game.campaign.statuses ?? [])
    .filter((status) => statusApplies(game, status, team, unitId))
    .reduce((result, status) => {
      result.attack *= status.attack;
      result.movement *= status.movement;
      result.morale *= status.morale;
      result.production *= status.production ?? 1;
      result.defense *= status.defense ?? 1;
      result.supplyUse *= status.supplyUse ?? 1;
      result.healing *= status.healing ?? 1;
      result.riverMovement *= status.riverMovement ?? 1;
      return result;
    }, identity());
}

export function unitModifiers(
  game: GameData,
  unit: UnitState,
  outsideTsinghuaCampus = false,
) {
  const status = statusModifiersFor(game, unit.team, unit.id),
    decision = decisionEffectsFor(game.campaign, unit.team),
    transport = unit.transportModel
      ? RESEARCH_DEFINITIONS[unit.transportModel]
      : undefined,
    outsidePenalty =
      unit.transportModel === "thu_purple_bike" && outsideTsinghuaCampus;
  return {
    attack:
      status.attack *
      (decision.attack ?? 1) *
      (transport?.attackMultiplier ?? 1),
    movement:
      status.movement *
      (decision.movement ?? 1) *
      (transport?.movementMultiplier ?? 1) *
      (outsidePenalty ? transport?.outsideCampusMovement ?? 1 : 1),
    morale:
      status.morale *
      (decision.morale ?? 1) *
      (transport?.moraleMultiplier ?? 1) *
      (outsidePenalty ? transport?.outsideCampusMorale ?? 1 : 1),
    defense:
      status.defense *
      (decision.defense ?? 1) /
      (transport?.damageTakenMultiplier ?? 1),
    supplyUse: status.supplyUse * (decision.supplyUse ?? 1),
    riverMovement: status.riverMovement * (decision.riverMovement ?? 1),
  };
}

export function addTimedStatus(
  game: GameData,
  status: Omit<TimedStatus, "until" | "unitIds"> & {
    durationHours: number;
    unitIds?: number[];
  },
) {
  const { durationHours, unitIds, ...values } = status;
  game.campaign.statuses = (game.campaign.statuses ?? []).filter(
    (candidate) => candidate.id !== status.id,
  );
  game.campaign.statuses.push({
    ...values,
    until: game.campaign.elapsedHours + durationHours,
    unitIds:
      unitIds ??
      game.units
        .filter((unit) => unit.team === status.team)
        .map((unit) => unit.id),
  });
}

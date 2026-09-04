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

const membershipCache = new WeakMap<TimedStatus, {ids:number[];size:number;members:Set<number>}>();
type ModifierCache = {
  statuses: TimedStatus[]; key:string; lists:number[][]; at:number; expires:number;
  active: TimedStatus[]; values: Record<Team,Map<number,CombatModifiers>>;
};
const modifierCaches=new WeakMap<GameData,ModifierCache>();
const modifierFrames=new WeakSet<GameData>();
const prepareCache=(game:GameData,check:boolean) => {
  const statuses=game.campaign.statuses ?? [],hour=game.campaign.elapsedHours;
  let cache=modifierCaches.get(game);
  if(!check && cache && cache.statuses===statuses && cache.lists.length===statuses.length && hour>=cache.at && hour<cache.expires) return cache;
  const key=statuses.map(s=>[s.team,s.until,s.attack,s.movement,s.morale,s.production,s.defense,s.supplyUse,s.healing,s.riverMovement,s.unitIds.length].join('/')).join('|');
  if(cache && cache.key===key && cache.lists.length===statuses.length && cache.lists.every((list,i)=>list===statuses[i]?.unitIds) && hour>=cache.at && hour<cache.expires) {cache.statuses=statuses;return cache;}
  const active=statuses.filter(s=>s.until>hour);
  cache={statuses,key,lists:statuses.map(s=>s.unitIds),at:hour,expires:active.reduce((end,s)=>Math.min(end,s.until),Infinity),active,values:{pku:new Map(),thu:new Map()}};
  modifierCaches.set(game,cache);return cache;
};

// Validate mutable status inputs once per authoritative movement/combat frame.
// addTimedStatus replaces the array, so mid-frame additions invalidate it too.
export function withModifierCache<T>(game:GameData,run:()=>T):T {
  prepareCache(game,true);modifierFrames.add(game);
  try{return run();}finally{modifierFrames.delete(game);}
}
const includesUnit = (status: TimedStatus, id: number) => {
  let cached=membershipCache.get(status);
  // The engine replaces membership arrays on load/remapping. Also tolerate
  // additions/removals without making every per-soldier lookup linear.
  if(!cached || cached.ids!==status.unitIds || cached.size!==status.unitIds.length) {
    cached={ids:status.unitIds,size:status.unitIds.length,members:new Set(status.unitIds)};
    membershipCache.set(status,cached);
  }
  return cached.members.has(id);
};

const statusApplies = (
  game: GameData,
  status: TimedStatus,
  team: Team,
  unitId?: number,
) =>
  status.team === team &&
  status.until > game.campaign.elapsedHours &&
  (unitId == null || !status.unitIds.length || includesUnit(status,unitId));

function cachedStatusModifiers(
  game: GameData,
  team: Team,
  unitId?: number,
): CombatModifiers {
  const cache=prepareCache(game,!modifierFrames.has(game)),key=unitId??-1;
  const found=cache.values[team].get(key);if(found)return found;
  if(cache.values[team].size>8192)cache.values[team].clear();
  const result=identity();
  for(const status of cache.active) {
    if (!statusApplies(game,status,team,unitId)) continue;
      result.attack *= status.attack;
      result.movement *= status.movement;
      result.morale *= status.morale;
      result.production *= status.production ?? 1;
      result.defense *= status.defense ?? 1;
      result.supplyUse *= status.supplyUse ?? 1;
      result.healing *= status.healing ?? 1;
      result.riverMovement *= status.riverMovement ?? 1;
  }
  cache.values[team].set(key,result);
  return result;
}

export function statusModifiersFor(game:GameData,team:Team,unitId?:number):CombatModifiers {
  return {...cachedStatusModifiers(game,team,unitId)};
}

export function unitModifiers(
  game: GameData,
  unit: UnitState,
  outsideTsinghuaCampus = false,
) {
  const status = cachedStatusModifiers(game, unit.team, unit.id),
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

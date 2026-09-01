import { BASE_TEAM_UNIT_CAP, INITIAL_PRODUCTION_POPULATION_BUDGET, productionSlots } from "../config";
import { decisionEffectsFor } from "../decisions";
import type { GameData, SiteState, Team } from "../types";

export type KernelIssueOrder = (
  team: Team,
  source: SiteState,
  target: SiteState,
  count: number,
) => number | void;

const teamStatusFactor = (game: GameData, team: Team, key: "production") =>
  (game.campaign.statuses ?? [])
    .filter(
      (status) =>
        status.team === team && status.until > game.campaign.elapsedHours,
    )
    .reduce((factor, status) => factor * (status[key] ?? 1), 1);

const teamPopulation = (game: GameData, team: Team) =>
  game.units
    .filter((unit) => unit.team === team)
    .reduce((sum, unit) => sum + unit.strength, 0);

const teamUnitCap = (game: GameData, team: Team) => {
  const initialSites = Math.max(
      1,
      team === "pku"
        ? game.campaign.initialPkuSites
        : game.campaign.initialThuSites,
    ),
    currentSites = game.sites.filter(
      (site) => site.team === team && !site.destroyed,
    ).length;
  return Math.max(
    100,
    Math.floor(
      ((BASE_TEAM_UNIT_CAP * currentSites) / initialSites) *
        (decisionEffectsFor(game.campaign, team).populationCap ?? 1),
    ),
  );
};

const productionSitePopulationCap = (game: GameData, site: SiteState) => {
  const initialCount = Math.max(
      1,
      game.campaign.initialProductionSites[site.team],
    ),
    productionSites = game.sites
      .filter(
        (candidate) =>
          candidate.team === site.team &&
          !candidate.destroyed &&
          (candidate.type === "dorm" || candidate.type === "dining"),
      )
      .sort((a, b) => a.id - b.id),
    rank = Math.max(
      0,
      productionSites.findIndex((candidate) => candidate.id === site.id),
    ),
    base = Math.floor(INITIAL_PRODUCTION_POPULATION_BUDGET / initialCount),
    remainder = INITIAL_PRODUCTION_POPULATION_BUDGET % initialCount;
  return base + (rank < remainder ? 1 : 0);
};

const boundPopulation = (game: GameData, site: SiteState) =>
  game.units
    .filter(
      (unit) =>
        unit.team === site.team &&
        unit.siteId === site.id &&
        unit.targetSiteId == null,
    )
    .reduce((sum, unit) => sum + unit.strength, 0);

const hasProductionCapacity = (
  game: GameData,
  site: SiteState,
  population: number,
) =>
  population < teamUnitCap(game, site.team) &&
  boundPopulation(game, site) < productionSitePopulationCap(game, site);

const nextUnitId = (game: GameData) =>
  game.units.reduce((maximum, unit) => Math.max(maximum, unit.id), -1) + 1;

export function spawnKernelUnits(
  game: GameData,
  site: SiteState,
  team: Team,
  squads: number,
  attackModifier = 1,
  supply = 130,
  skin?: import("../types").UnitState["skin"],
) {
  let id = nextUnitId(game);
  const count = squads * 5,
    anchorX = site.navX ?? site.x,
    anchorZ = site.navZ ?? site.z;
  for (let index = 0; index < count; index++) {
    const angle = (index / Math.max(1, count)) * Math.PI * 2,
      radius = 0.48 + (index % 3) * 0.15;
    game.units.push({
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
  return count;
}

export function runProductionCycles(
  game: GameData,
  issueOrder: KernelIssueOrder,
) {
  let produced = 0;
  const productionCycle = Math.floor(game.campaign.elapsedHours / 6);
  if (productionCycle > game.campaign.lastProductionCycle) {
    const firstCycle = Math.max(
      game.campaign.lastProductionCycle + 1,
      productionCycle - 47,
    );
    game.campaign.lastProductionCycle = productionCycle;
    for (let cycle = firstCycle; cycle <= productionCycle; cycle++) {
      for (const team of ["pku", "thu"] as Team[]) {
        const population = teamPopulation(game, team),
          allDorms = game.sites.filter(
            (site) => site.team === team && site.type === "dorm" && !site.destroyed,
          ),
          dorms = allDorms.filter((site) =>
            hasProductionCapacity(game, site, population),
          ),
          modifier =
            teamStatusFactor(game, team, "production") *
            (decisionEffectsFor(game.campaign, team).production ?? 1),
          active = Math.min(
            Math.max(
              modifier > 0 ? 1 : 0,
              Math.round(productionSlots(allDorms.length, 0.35) * modifier),
            ),
            dorms.length,
            Math.max(0, Math.floor((teamUnitCap(game, team) - population) / 5)),
          );
        for (let index = 0; index < active; index++)
          produced += spawnKernelUnits(
            game,
            dorms[(cycle + index * 3) % dorms.length],
            team,
            1,
          );
        game.resources[team] +=
          6 * (decisionEffectsFor(game.campaign, team).resourceIncome ?? 1);
      }
      for (const source of game.sites) {
        if (
          source.destroyed ||
          source.type === "camp" ||
          source.orderTarget == null
        )
          continue;
        const target = game.sites[source.orderTarget];
        const preparationRoute =
          !game.campaign.warUnlocked &&
          target?.team === source.team &&
          (source.type === "dorm" || source.type === "dining") &&
          target.type !== "dorm" &&
          target.type !== "dining";
        if (
          !target ||
          target.destroyed ||
          (target.team === source.team && !preparationRoute)
        ) {
          source.orderTarget = undefined;
          source.orderPath = undefined;
          continue;
        }
        const idle = game.units.filter(
          (unit) => unit.siteId === source.id && unit.targetSiteId == null,
        ).length;
        issueOrder(
          source.team,
          source,
          target,
          Math.ceil(idle * (source.dispatchRatio ?? 0.6)),
        );
      }
    }
  }

  const diningCycle = Math.floor(game.campaign.elapsedHours / 12);
  if (diningCycle > game.campaign.lastDiningCycle) {
    const firstCycle = Math.max(
      game.campaign.lastDiningCycle + 1,
      diningCycle - 47,
    );
    game.campaign.lastDiningCycle = diningCycle;
    const producing: SiteState[] = [];
    for (let cycle = firstCycle; cycle <= diningCycle; cycle++)
      for (const team of ["pku", "thu"] as Team[]) {
        const population = teamPopulation(game, team),
          allDining = game.sites.filter(
            (site) => site.team === team && site.type === "dining" && !site.destroyed,
          ),
          dining = allDining.filter((site) =>
            hasProductionCapacity(game, site, population),
          ),
          modifier =
            teamStatusFactor(game, team, "production") *
            (decisionEffectsFor(game.campaign, team).production ?? 1),
          active = Math.min(
            Math.max(
              modifier > 0 ? 1 : 0,
              Math.round(productionSlots(allDining.length, 0.4) * modifier),
            ),
            dining.length,
            Math.max(0, Math.floor((teamUnitCap(game, team) - population) / 5)),
          );
        for (let index = 0; index < active; index++) {
          const site = dining[(cycle + index * 2) % dining.length];
          produced += spawnKernelUnits(game, site, team, 1, 1, 145);
          producing.push(site);
        }
      }
    for (const source of producing) {
      if (source.orderTarget == null) continue;
      const target = game.sites[source.orderTarget];
      if (target && !target.destroyed)
        issueOrder(source.team, source, target, 1);
    }
  }
  return produced;
}

import { DECISIONS } from "../../campaign-content";
import { decisionAvailable } from "../decisions";
import {
  RESEARCH_DEFINITIONS,
  hasResearch,
  researchIdsForTeam,
  type ResearchId,
} from "../research";
import type { AiDifficulty, GameData, SiteState, Stance, Team } from "../types";
import { navIndex, type KernelNavGrid } from "./navigation";

export type ProgressionAction =
  | { type: "research_start"; team: Team; id: ResearchId }
  | { type: "production_start"; team: Team; id: ResearchId }
  | { type: "production_stop"; team: Team; id: ResearchId }
  | { type: "mobilize"; team: Team; stance: Stance };

const createId = (game: GameData, prefix: string) =>
  `${prefix}-${Math.floor(game.campaign.elapsedHours * 1000)}-${game.campaign.ai.seed >>> 0}`;

export function applyProgressionAction(
  game: GameData,
  action: ProgressionAction,
) {
  const { team } = action;
  if (action.type === "mobilize") {
    for (const site of game.sites)
      if (site.team === team && !site.destroyed) site.stance = action.stance;
    return true;
  }
  const definition = RESEARCH_DEFINITIONS[action.id];
  if (!definition || (definition.team !== "both" && definition.team !== team))
    return false;
  if (action.type === "production_stop") {
    delete game.campaign.research.production[team][action.id];
    return true;
  }
  if (action.type === "research_start") {
    if (
      game.campaign.research.active[team] ||
      hasResearch(game.campaign, team, action.id) ||
      definition.requires.some((id) => !hasResearch(game.campaign, team, id)) ||
      game.resources[team] < definition.cost
    )
      return false;
    game.resources[team] -= definition.cost;
    game.campaign.research.active[team] = {
      id: action.id,
      team,
      startedAt: game.campaign.elapsedHours,
      completesAt: game.campaign.elapsedHours + definition.hours,
    };
    return true;
  }
  if (
    !hasResearch(game.campaign, team, action.id) ||
    game.campaign.research.production[team][action.id] ||
    game.resources[team] < definition.deploymentCost
  )
    return false;
  game.resources[team] -= definition.deploymentCost;
  game.campaign.research.production[team][action.id] = {
    id: createId(game, "production"),
    researchId: action.id,
    startedAt: game.campaign.elapsedHours,
    completesAt: game.campaign.elapsedHours + definition.productionHours,
  };
  return true;
}

const siteTouchesRoad = (grid: KernelNavGrid | undefined, site: SiteState) => {
  if (!grid) return true;
  const center = navIndex(grid, site.navX ?? site.x, site.navZ ?? site.z);
  if (center < 0) return false;
  const gridX = center % grid.cols,
    gridZ = Math.floor(center / grid.cols);
  for (let offsetX = -3; offsetX <= 3; offsetX++)
    for (let offsetZ = -3; offsetZ <= 3; offsetZ++) {
      const x = gridX + offsetX,
        z = gridZ + offsetZ;
      if (x < 0 || z < 0 || x >= grid.cols || z >= grid.rows) continue;
      if (grid.road[z * grid.cols + x]) return true;
    }
  return false;
};

export function allocateTransport(
  game: GameData,
  team: Team,
  kind: ResearchId,
  random: () => number,
  grid?: KernelNavGrid,
  preferredSiteId?: number,
) {
  const definition = RESEARCH_DEFINITIONS[kind],
    isBus = definition.category === "bus",
    equipmentRequired = isBus ? 1 : definition.passengers;
  if (
    !hasResearch(game.campaign, team, kind) ||
    game.campaign.research.stockpile[team][kind] < equipmentRequired
  )
    return false;
  const candidates = game.sites
    .filter(
      (site) =>
        site.team === team &&
        !site.destroyed &&
        (!isBus || siteTouchesRoad(grid, site)) &&
        (isBus
          ? (site.busCooldownUntil ?? 0) <= game.campaign.elapsedHours
          : (site.bikeCooldownUntil ?? 0) <= game.campaign.elapsedHours),
    )
    .map((site) => ({
      site,
      idle: game.units.filter(
        (unit) =>
          unit.team === team &&
          unit.siteId === site.id &&
          unit.targetSiteId == null &&
          !unit.transport &&
          Math.hypot(
            unit.x - (site.navX ?? site.x),
            unit.z - (site.navZ ?? site.z),
          ) < 3.4,
      ),
    }))
    .filter(({ idle }) => idle.length >= definition.passengers);
  if (!candidates.length) return false;
  let chosen = candidates.find(({ site }) => site.id === preferredSiteId);
  if (!chosen) {
    if (isBus) chosen = candidates[Math.floor(random() * candidates.length)];
    else {
      const total = candidates.reduce((sum, item) => sum + item.idle.length, 0),
        roll = random() * total;
      let cursor = 0;
      chosen = candidates[0];
      for (const candidate of candidates) {
        cursor += candidate.idle.length;
        if (roll <= cursor) {
          chosen = candidate;
          break;
        }
      }
    }
  }
  game.campaign.research.stockpile[team][kind] -= equipmentRequired;
  const groupId = isBus
    ? `bus-${team}-${Math.floor(game.campaign.elapsedHours)}-${chosen.site.id}`
    : undefined;
  for (const unit of chosen.idle.slice(0, definition.passengers)) {
    unit.transport = isBus ? "bus" : "bike";
    unit.transportGroupId = groupId;
    unit.transportModel = kind;
  }
  if (isBus) {
    chosen.site.busCooldownUntil =
      game.campaign.elapsedHours + definition.cooldownHours;
    game.campaign.research.lastBusAllocation[team] = game.campaign.elapsedHours;
  } else {
    chosen.site.bikeCooldownUntil =
      game.campaign.elapsedHours + definition.cooldownHours;
    game.campaign.research.lastBikeAllocation[team] = game.campaign.elapsedHours;
  }
  return true;
}

export function progressResearchAndProduction(
  game: GameData,
  random: () => number,
  grid?: KernelNavGrid,
) {
  for (const team of ["pku", "thu"] as Team[]) {
    const active = game.campaign.research.active[team];
    if (active && active.completesAt <= game.campaign.elapsedHours) {
      if (!hasResearch(game.campaign, team, active.id))
        game.campaign.research.completed[team].push(active.id);
      game.campaign.research.active[team] = null;
    }
    const lines = game.campaign.research.production[team];
    for (const id of Object.keys(lines) as ResearchId[]) {
      const production = lines[id];
      if (!production || production.completesAt > game.campaign.elapsedHours)
        continue;
      const definition = RESEARCH_DEFINITIONS[id];
      game.campaign.research.stockpile[team][id] +=
        definition.productionQuantity;
      if (game.resources[team] < definition.deploymentCost) {
        delete lines[id];
        continue;
      }
      game.resources[team] -= definition.deploymentCost;
      production.id = createId(game, "production");
      production.startedAt = game.campaign.elapsedHours;
      production.completesAt =
        game.campaign.elapsedHours + definition.productionHours;
    }
    for (const kind of [...researchIdsForTeam(team)].reverse()) {
      if (!hasResearch(game.campaign, team, kind)) continue;
      if (game.campaign.research.stockpile[team][kind] <= 0) continue;
      const definition = RESEARCH_DEFINITIONS[kind],
        last =
          definition.category === "bus"
            ? game.campaign.research.lastBusAllocation[team]
            : game.campaign.research.lastBikeAllocation[team];
      if (game.campaign.elapsedHours - last < definition.cooldownHours) continue;
      if (random() < (definition.category === "bus" ? 0.32 : 0.62))
        allocateTransport(game, team, kind, random, grid);
    }
  }
}

export function runAiProgression(
  game: GameData,
  team: Team,
  difficulty: AiDifficulty,
  random: () => number,
) {
  if (!game.campaign.research.active[team]) {
    const choices = researchIdsForTeam(team).filter((id) => {
      const definition = RESEARCH_DEFINITIONS[id];
      return (
        !hasResearch(game.campaign, team, id) &&
        definition.requires.every((required) =>
          hasResearch(game.campaign, team, required),
        ) &&
        game.resources[team] >= definition.cost
      );
    });
    if (choices.length) {
      const baseBike = team === "pku" ? "pku_bike" : "thu_bike",
        preferred =
          difficulty !== "casual" && choices.includes(baseBike)
            ? baseBike
            : choices.includes("bus")
              ? "bus"
              : choices[Math.floor(random() * choices.length)];
      applyProgressionAction(game, { type: "research_start", team, id: preferred });
    }
  }
  const production = game.campaign.research.production[team],
    productionChoice = game.campaign.research.completed[team].find(
      (id) =>
        !production[id] &&
        game.resources[team] >= RESEARCH_DEFINITIONS[id].deploymentCost,
    );
  if (productionChoice)
    applyProgressionAction(game, {
      type: "production_start",
      team,
      id: productionChoice,
    });

  if (!game.campaign.decisions.active[team]) {
    const choices = DECISIONS.filter(
      (decision) =>
        decision.team === team &&
        decisionAvailable(decision, game.campaign) &&
        game.resources[team] >= decision.cost,
    );
    const selected = choices[Math.floor(random() * Math.min(3, choices.length))];
    if (selected) {
      game.resources[team] -= selected.cost;
      game.campaign.decisions.active[team] = {
        id: selected.id,
        team,
        startedAt: game.campaign.elapsedHours,
        completesAt: game.campaign.elapsedHours + selected.days * 24,
      };
    }
  }
}

export function progressDecisions(game: GameData) {
  for (const team of ["pku", "thu"] as Team[]) {
    const active = game.campaign.decisions.active[team];
    if (!active || active.completesAt > game.campaign.elapsedHours) continue;
    const definition = DECISIONS.find((candidate) => candidate.id === active.id);
    if (definition) {
      if (!game.campaign.decisions.completed.includes(definition.id))
        game.campaign.decisions.completed.push(definition.id);
      for (const excluded of definition.exclusiveWith ?? [])
        if (!game.campaign.decisions.locked.includes(excluded))
          game.campaign.decisions.locked.push(excluded);
    }
    game.campaign.decisions.active[team] = null;
  }
}

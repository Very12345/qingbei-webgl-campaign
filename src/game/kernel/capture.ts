import type { GameData, SiteState, Team, UnitState } from "../types";
import { EVENT_CARDS } from "../events/event-cards";
import { recordKernelEvent } from "./events";
import { addTimedStatus } from "./modifiers";
import { parkBikeAtSite } from "./movement";
import type { KernelPathfinder } from "./navigation";

export type CaptureResult =
  | { kind: "none" }
  | { kind: "qz_conversion"; siteId: number }
  | { kind: "camp_destroyed"; siteId: number }
  | { kind: "captured"; siteId: number; oldTeam: Team; newTeam: Team };

const clearOrder = (unit: UnitState) => {
  unit.targetSiteId = undefined;
  unit.path = undefined;
  unit.pathIndex = undefined;
};

const fallbackUnit = (
  game: GameData,
  unit: UnitState,
  excludedSiteId: number,
  pathfinder: KernelPathfinder | null,
) => {
  const fallback = game.sites
    .filter(
      (candidate) =>
        candidate.team === unit.team &&
        !candidate.destroyed &&
        candidate.id !== excludedSiteId,
    )
    .sort(
      (a, b) =>
        Math.hypot(a.x - unit.x, a.z - unit.z) -
        Math.hypot(b.x - unit.x, b.z - unit.z),
    )[0];
  clearOrder(unit);
  if (!fallback) {
    unit.tx = unit.x;
    unit.tz = unit.z;
    return;
  }
  unit.siteId = fallback.id;
  const targetX = fallback.navX ?? fallback.x,
    targetZ = fallback.navZ ?? fallback.z,
    path = pathfinder
      ? pathfinder.find(unit.x, unit.z, targetX, targetZ)
      : ([[targetX, targetZ]] as [number, number][]);
  if (!path.length) return;
  unit.targetSiteId = fallback.id;
  unit.path = path;
  unit.pathIndex = 0;
  unit.tx = targetX;
  unit.tz = targetZ;
};

export function captureSite(
  game: GameData,
  site: SiteState,
  attackers: UnitState[],
  pathfinder: KernelPathfinder | null,
  issueFollowUp: (team: Team, sourceId: number, targetId: number) => void,
): CaptureResult {
  if (!attackers.length || site.destroyed) return { kind: "none" };
  const newTeam = attackers[0].team,
    oldTeam = site.team,
    siteX = site.navX ?? site.x,
    siteZ = site.navZ ?? site.z;
  if (
    site.type === "target" &&
    newTeam === "pku" &&
    !game.campaign.firedEvents.includes("qz_captured")
  ) {
    recordKernelEvent(game, "qz_captured", EVENT_CARDS.qz_captured);
    site.team = "thu";
    site.supply = Math.max(65, site.supply);
    site.stance = "defend";
    site.dispatchRatio = 0.4;
    site.displayName = site.name;
    const converted = game.units.filter(
      (unit) =>
        unit.team === "pku" && Math.hypot(unit.x - site.x, unit.z - site.z) < 6,
    );
    converted.forEach((unit, index) => {
      unit.team = "thu";
      unit.skin = undefined;
      unit.siteId = site.id;
      clearOrder(unit);
      const angle = (index / Math.max(1, converted.length)) * Math.PI * 2;
      unit.x = siteX + Math.cos(angle) * 0.9;
      unit.z = siteZ + Math.sin(angle) * 0.9;
      unit.tx = unit.x;
      unit.tz = unit.z;
    });
    site.orderTarget = undefined;
    site.orderPath = undefined;
    return { kind: "qz_conversion", siteId: site.id };
  }
  if (site.type === "camp") {
    site.destroyed = true;
    site.orderTarget = undefined;
    site.orderPath = undefined;
    for (const source of game.sites)
      if (source.orderTarget === site.id) {
        source.orderTarget = undefined;
        source.orderPath = undefined;
      }
    for (const unit of game.units)
      if (unit.targetSiteId === site.id || unit.siteId === site.id)
        fallbackUnit(game, unit, site.id, pathfinder);
    return { kind: "camp_destroyed", siteId: site.id };
  }
  const plannedTargetId = site.plannedOrderTargets?.[newTeam],
    plannedPath = site.plannedOrderPaths?.[newTeam];
  site.team = newTeam;
  site.supply = 45;
  site.stance = "standby";
  site.dispatchRatio = 1;
  const baseName = site.name.replace(/^北大清华园校区·|^清华燕园校区·/, "");
  site.displayName =
    newTeam === "pku"
      ? `北大清华园校区·${baseName}`
      : `清华燕园校区·${baseName}`;
  attackers.forEach((unit, index) => {
    unit.siteId = site.id;
    clearOrder(unit);
    parkBikeAtSite(game, unit, site);
    const angle = (index / Math.max(1, attackers.length)) * Math.PI * 2;
    unit.x = siteX + Math.cos(angle) * 0.9;
    unit.z = siteZ + Math.sin(angle) * 0.9;
    unit.tx = unit.x;
    unit.tz = unit.z;
  });
  site.orderTarget = plannedTargetId;
  site.orderPath = plannedPath;
  if (site.plannedOrderTargets) delete site.plannedOrderTargets[newTeam];
  if (site.plannedOrderPaths) delete site.plannedOrderPaths[newTeam];
  if (site.type === "target" && newTeam === "pku") {
    if (recordKernelEvent(game, "qz_strategic_buff", EVENT_CARDS.qz_strategic_buff)) {
      game.resources.pku += 120;
      game.campaign.attackBonus.pku *= 1.12;
      addTimedStatus(game, {
        id: "qz_strategic_buff_status",
        title: "求真突破",
        team: "pku",
        durationHours: 336,
        attack: 1.12,
        movement: 1.05,
        morale: 1.15,
        production: 1.1,
      });
    }
  }
  if (
    (site.type === "capital" || site.name.includes("元培学院")) &&
    oldTeam === "pku" &&
    newTeam === "thu"
  ) {
    if (recordKernelEvent(game, "yuanpei_fallen", EVENT_CARDS.yuanpei_fallen)) {
      game.resources.thu += 120;
      game.campaign.attackBonus.thu *= 1.12;
      addTimedStatus(game, {
        id: "yuanpei_strategic_buff_status",
        title: "元培突破",
        team: "thu",
        durationHours: 336,
        attack: 1.12,
        movement: 1.05,
        morale: 1.15,
        production: 1.1,
      });
    }
  }
  if (plannedTargetId != null) issueFollowUp(newTeam, site.id, plannedTargetId);
  return { kind: "captured", siteId: site.id, oldTeam, newTeam };
}

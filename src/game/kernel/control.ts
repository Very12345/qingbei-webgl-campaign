import type { GameData, SiteState, Team } from "../types";

export const siteControlRadius = (site: SiteState) => {
  if (site.type === "camp") return 3.8;
  if (site.stance === "defend") return 4.2;
  if (site.stance === "guard") return 3.2;
  return 2.2;
};

export function firstEnemyControlSite(
  game: GameData,
  team: Team,
  path: [number, number][],
  intendedTargetId?: number,
) {
  let selected: { site: SiteState; pathIndex: number; distance: number } | null =
    null;
  for (const site of game.sites) {
    if (
      site.destroyed ||
      site.team === team ||
      site.id === intendedTargetId
    )
      continue;
    const radius = siteControlRadius(site),
      siteX = site.navX ?? site.x,
      siteZ = site.navZ ?? site.z;
    for (let pathIndex = 0; pathIndex < path.length; pathIndex++) {
      const [x, z] = path[pathIndex],
        distance = Math.hypot(x - siteX, z - siteZ);
      if (distance > radius) continue;
      if (
        !selected ||
        pathIndex < selected.pathIndex ||
        (pathIndex === selected.pathIndex && distance < selected.distance)
      )
        selected = { site, pathIndex, distance };
      break;
    }
  }
  return selected?.site;
}

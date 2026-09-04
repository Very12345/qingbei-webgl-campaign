import type { GameData, SiteState, Team } from "../types";
import type { KernelPathfinder } from "./navigation";

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

export function interceptRoute(
  game: GameData, team: Team, path: [number, number][],
  pathfinder: KernelPathfinder | null, goalId?: number,
) {
  const blocker = firstEnemyControlSite(game, team, path, goalId);
  if (!blocker) return { path, blocker, continuationPath: undefined };
  const x = blocker.navX ?? blocker.x, z = blocker.navZ ?? blocker.z;
  // Approach on the intended corridor. Only the short final approach to the
  // blocker is replanned, never the whole journey from the original source.
  const entry = path.findIndex(p => Math.hypot(p[0] - x, p[1] - z) <= siteControlRadius(blocker));
  let closest = entry;
  for (let i = entry + 1; i < path.length; i++) {
    if (Math.hypot(path[i][0] - x, path[i][1] - z) > siteControlRadius(blocker)) break;
    if (Math.hypot(path[i][0] - x, path[i][1] - z) < Math.hypot(path[closest][0] - x, path[closest][1] - z)) closest = i;
  }
  const approach = path[closest];
  const tail = pathfinder ? pathfinder.find(approach[0], approach[1], x, z) : [[x, z] as [number, number]];
  return {
    blocker,
    path: tail.length ? [...path.slice(0, closest + 1), ...tail] : [],
    continuationPath: path.slice(closest),
  };
}

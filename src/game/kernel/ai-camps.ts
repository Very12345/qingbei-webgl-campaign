import type { GameData, SiteState, Team } from "../types";
import { firstEnemyControlSite, siteControlRadius } from "./control";
import {
  navPoint,
  nearestOpenIndex,
  type KernelPathfinder,
} from "./navigation";
import type { PlannedAiCamp } from "./ai";

// A camp must change the real A* route. Merely placing a marker beside a
// strongpoint does not bypass it; both legs are checked against control areas.
export function planFlankingCamp(
  game: GameData,
  team: Team,
  sources: SiteState[],
  targets: SiteState[],
  pathfinder: KernelPathfinder,
  defendersAt: (site: SiteState) => number,
  idleAt: (site: SiteState) => number,
): PlannedAiCamp | undefined {
  const clearOf = (path: [number, number][], site: SiteState) =>
    !path.some(
      ([x, z]) =>
        Math.hypot(x - (site.navX ?? site.x), z - (site.navZ ?? site.z)) <=
        siteControlRadius(site) + 0.4,
    );
  for (const source of sources.slice(0, 3)) {
    const available = idleAt(source);
    for (const target of targets.slice(0, 3)) {
      const direct = pathfinder.find(
        source.navX ?? source.x,
        source.navZ ?? source.z,
        target.navX ?? target.x,
        target.navZ ?? target.z,
      );
      if (!direct.length) continue;
      const blocker = firstEnemyControlSite(game, team, direct, target.id);
      if (
        !blocker ||
        defendersAt(blocker) < 3 ||
        defendersAt(blocker) <= defendersAt(target)
      )
        continue;
      const x = blocker.navX ?? blocker.x,
        z = blocker.navZ ?? blocker.z;
      const heading = Math.atan2(
        (target.navZ ?? target.z) - (source.navZ ?? source.z),
        (target.navX ?? target.x) - (source.navX ?? source.x),
      );
      const candidates: Array<PlannedAiCamp & { score: number }> = [];
      for (const radius of [
        siteControlRadius(blocker) + 3,
        siteControlRadius(blocker) + 6,
      ]) {
        for (const offset of [
          Math.PI / 2,
          -Math.PI / 2,
          Math.PI / 3,
          -Math.PI / 3,
          (2 * Math.PI) / 3,
          (-2 * Math.PI) / 3,
        ]) {
          const angle = heading + offset,
            index = nearestOpenIndex(
              pathfinder.grid,
              x + Math.cos(angle) * radius,
              z + Math.sin(angle) * radius,
            );
          if (
            index < 0 ||
            pathfinder.grid.water[index] ||
            pathfinder.grid.building[index]
          )
            continue;
          const [cx, cz] = navPoint(pathfinder.grid, index);
          if (
            game.sites.some(
              (site) =>
                !site.destroyed && Math.hypot(site.x - cx, site.z - cz) < 2.3,
            )
          )
            continue;
          const approach = pathfinder.find(
            source.navX ?? source.x,
            source.navZ ?? source.z,
            cx,
            cz,
          );
          if (!approach.length || firstEnemyControlSite(game, team, approach))
            continue;
          const onward = pathfinder.find(
            cx,
            cz,
            target.navX ?? target.x,
            target.navZ ?? target.z,
          );
          if (
            !onward.length ||
            !clearOf(onward, blocker) ||
            !clearOf(approach, blocker)
          )
            continue;
          if (approach.length + onward.length > direct.length * 2.5 + 8)
            continue;
          const encounter =
            firstEnemyControlSite(game, team, onward, target.id) ?? target;
          if (
            encounter.id !== target.id &&
            defendersAt(encounter) >= defendersAt(blocker)
          )
            continue;
          const required = Math.max(
            12,
            Math.ceil(
              Math.max(defendersAt(target), defendersAt(encounter)) * 1.55 + 4,
            ),
          );
          if (available < required) continue;
          const count = Math.min(
            available,
            Math.max(required, Math.floor(available * 0.68)),
          );
          candidates.push({
            sourceId: source.id,
            targetId: target.id,
            x: cx,
            z: cz,
            pathToTarget: onward,
            count,
            score: approach.length + onward.length + defendersAt(encounter) * 6,
          });
        }
      }
      candidates.sort((a, b) => a.score - b.score);
      if (candidates[0]) return candidates[0];
    }
  }
  return undefined;
}

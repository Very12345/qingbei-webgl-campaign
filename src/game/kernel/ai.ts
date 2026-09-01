import type { AiDifficulty, GameData, SiteState, Team } from "../types";
import { navPoint, nearestOpenIndex, type KernelPathfinder } from "./navigation";

export type AiIntent =
  | "passive"
  | "single_breakthrough"
  | "positional"
  | "probing";

export type HostileGroupSummary = {
  target: SiteState;
  strength: number;
};

const routeRiskCaches = new WeakMap<KernelPathfinder, Map<string, boolean>>();

const routeIsUnsafe = (
  pathfinder: KernelPathfinder,
  source: SiteState,
  target: SiteState,
  riskSites: SiteState[],
) => {
  let cache = routeRiskCaches.get(pathfinder);
  if (!cache) {
    cache = new Map();
    routeRiskCaches.set(pathfinder, cache);
  }
  const signature = riskSites.map((site) => site.id).join(","),
    key = `${source.id}:${target.id}:${signature}`,
    cached = cache.get(key);
  if (cached != null) return cached;
  const unsafe = pathCrossesPlannerRisk(
    pathfinder.find(
      source.navX ?? source.x,
      source.navZ ?? source.z,
      target.navX ?? target.x,
      target.navZ ?? target.z,
    ),
    riskSites,
  );
  if (cache.size > 8000) cache.clear();
  cache.set(key, unsafe);
  return unsafe;
};

export function classifyIntent(
  groups: HostileGroupSummary[],
  difficulty: AiDifficulty,
): AiIntent {
  const ordered = [...groups].sort((a, b) => b.strength - a.strength),
    total = ordered.reduce((sum, group) => sum + group.strength, 0),
    primary = ordered[0];
  if (total < (difficulty === "hard" ? 10 : 16)) return "passive";
  if (
    primary &&
    (primary.target.type === "dorm" || primary.target.type === "dining") &&
    primary.strength >= Math.max(12, total * 0.48)
  )
    return "single_breakthrough";
  if (ordered.length >= 3 && total >= 24) return "positional";
  return "probing";
}

export function offensiveMomentum(
  difficulty: AiDifficulty,
  friendlySiteCount: number,
  enemySiteCount: number,
  forceRatio: number,
) {
  if (difficulty === "casual") return 0;
  const siteAdvantage = friendlySiteCount / Math.max(1, enemySiteCount),
    start = difficulty === "hard" ? 0.95 : 1.05,
    range = difficulty === "hard" ? 0.55 : 1.15,
    siteMomentum = Math.max(0, Math.min(1, (siteAdvantage - start) / range)),
    forceMomentum = Math.max(0.28, Math.min(1, forceRatio / 0.9));
  return siteMomentum * forceMomentum;
}

export function isHighRiskEventTarget(site: SiteState) {
  return (
    site.type === "capital" ||
    site.type === "target" ||
    (site.type === "teaching" &&
      /物理|数学|化学|工学院|图书馆|技物|百周年|纪念讲堂/.test(site.name))
  );
}

export type PlannedAiOrder = {
  sourceId: number;
  targetId: number;
  count: number;
};

export type PlannedAiCamp = {
  sourceId: number;
  targetId: number;
  x: number;
  z: number;
  pathToTarget: [number, number][];
};

export function planStrategicOrders(
  game: GameData,
  team: Team,
  difficulty: AiDifficulty,
  pathfinder: KernelPathfinder | null,
  random: () => number,
) {
  if (!game.campaign.warUnlocked)
    return {
      intent: "passive" as AiIntent,
      orders: [] as PlannedAiOrder[],
      camps: [] as PlannedAiCamp[],
    };
  const enemy: Team = team === "pku" ? "thu" : "pku",
    friendlySites = game.sites.filter(
      (site) => site.team === team && !site.destroyed,
    ),
    enemySites = game.sites.filter(
      (site) => site.team === enemy && !site.destroyed,
    ),
    idleCounts = new Map<number, number>(),
    defenderCounts = new Map<number, number>(),
    idleAt = (site: SiteState) => idleCounts.get(site.id) ?? 0,
    defendersAt = (site: SiteState) => defenderCounts.get(site.id) ?? 0,
    hostileGroups = new Map<number, number>();
  for (const unit of game.units) {
    if (
      unit.team === team &&
      unit.targetSiteId == null &&
      unit.hp > 0
    )
      idleCounts.set(unit.siteId, (idleCounts.get(unit.siteId) ?? 0) + 1);
    if (unit.team === enemy && unit.hp > 0)
      defenderCounts.set(
        unit.siteId,
        (defenderCounts.get(unit.siteId) ?? 0) + 1,
      );
    if (
      unit.team === enemy &&
      unit.targetSiteId != null &&
      game.sites[unit.targetSiteId]?.team === team
    )
      hostileGroups.set(
        unit.targetSiteId,
        (hostileGroups.get(unit.targetSiteId) ?? 0) + unit.strength,
      );
  }
  const intent = classifyIntent(
      [...hostileGroups].map(([targetId, strength]) => ({
        target: game.sites[targetId],
        strength,
      })),
      difficulty,
    ),
    enemyProduction = enemySites.filter(
      (site) => site.type === "dorm" || site.type === "dining",
    ),
    riskSites = enemySites.filter(isHighRiskEventTarget),
    profile = difficultyProfileForPlanner(difficulty),
    sources = friendlySites
      .filter(
        (site) =>
          (site.orderTarget == null ||
            game.sites[site.orderTarget]?.team === team ||
            site.type === "camp") &&
          idleAt(site) >=
            (site.type === "dorm" || site.type === "dining"
              ? profile.minimumSource + 8
              : profile.minimumSource),
      )
      .sort((a, b) => idleAt(b) - idleAt(a)),
    assignedTargets = new Set<number>(),
    committedByTarget = new Map<number, number>(),
    orders: PlannedAiOrder[] = [],
    reinforcementSources = new Set<number>();
  for (const camp of friendlySites.filter(
    (site) =>
      site.type === "camp" &&
      site.orderTarget != null &&
      game.sites[site.orderTarget]?.team === enemy,
  )) {
    const target = game.sites[camp.orderTarget!],
      required = Math.max(12, Math.ceil(defendersAt(target) * 1.55 + 4)),
      campIdle = idleAt(camp);
    if (campIdle >= required) continue;
    let needed = required - campIdle;
    for (const source of sources) {
      if (
        needed <= 0 ||
        source.id === camp.id ||
        source.type === "camp" ||
        reinforcementSources.has(source.id)
      )
        continue;
      const available = Math.max(0, idleAt(source) - 4);
      if (available <= 0) continue;
      const count = Math.min(available, needed);
      orders.push({ sourceId: source.id, targetId: camp.id, count });
      reinforcementSources.add(source.id);
      needed -= count;
    }
  }
  for (const source of sources) {
    if (reinforcementSources.has(source.id)) continue;
    if (orders.length >= profile.waveLimit) break;
    const available = idleAt(source),
      candidates = enemySites
        .map((target) => {
          const defenders = defendersAt(target),
            required = Math.max(3, Math.ceil(defenders * 1.55 + 4)),
            productionValue =
              target.type === "dorm" ? 80 : target.type === "dining" ? 55 : 0,
            riskPenalty =
              enemyProduction.length > 2 && isHighRiskEventTarget(target)
                ? 180
                : 0,
            distance = Math.hypot(target.x - source.x, target.z - source.z),
            concentrationPenalty = assignedTargets.has(target.id) ? 20 : 0,
            committed = committedByTarget.get(target.id) ?? 0,
            concentrationBonus = committed > 0 && committed < required ? 48 : 0,
            score =
              productionValue -
              riskPenalty -
              distance -
              defenders * 2.2 -
              concentrationPenalty +
              concentrationBonus +
              (random() - 0.5) * profile.randomness;
          return { target, defenders, required, score };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, profile.pathCandidates)
        .map((candidate) => ({
          ...candidate,
          unsafe:
            difficulty === "hard" &&
            enemyProduction.length > 2 &&
            !!pathfinder &&
            routeIsUnsafe(pathfinder, source, candidate.target, riskSites),
        }))
        .filter(
          (candidate) =>
            !candidate.unsafe &&
            (difficulty !== "casual" ||
              candidate.defenders <= 1 ||
              candidate.required <= available),
        );
    const target = candidates[0];
    if (!target) continue;
    const alreadyCommitted = committedByTarget.get(target.target.id) ?? 0,
      remainingRequired = Math.max(1, target.required - alreadyCommitted),
      count = Math.min(
        available,
        Math.max(
          remainingRequired,
          Math.ceil(available * profile.dispatchRatio),
        ),
      );
    orders.push({
      sourceId: source.id,
      targetId: target.target.id,
      count,
    });
    const committed = alreadyCommitted + count;
    committedByTarget.set(target.target.id, committed);
    if (committed >= target.required) assignedTargets.add(target.target.id);
  }
  const camps: PlannedAiCamp[] = [];
  if (
    difficulty !== "casual" &&
    pathfinder &&
    enemyProduction.length > 2 &&
    friendlySites.filter(
      (site) =>
        site.type === "camp" &&
        site.orderTarget != null &&
        game.sites[site.orderTarget]?.team === enemy,
    ).length <
      (difficulty === "hard" ? 2 : 1) &&
    game.resources[team] >= 80
  ) {
    outer: for (const source of sources.slice(0, 3))
      for (const target of [...enemyProduction]
        .sort((a, b) => defendersAt(a) - defendersAt(b))
        .slice(0, 4)) {
        const direct = pathfinder.find(
          source.navX ?? source.x,
          source.navZ ?? source.z,
          target.navX ?? target.x,
          target.navZ ?? target.z,
        );
        if (!pathCrossesPlannerRisk(direct, riskSites)) continue;
        const crossed = riskSites.find((risk) =>
          direct.some(
            ([x, z]) => Math.hypot(x - risk.x, z - risk.z) < 5.2,
          ),
        );
        if (!crossed) continue;
        const detours: PlannedAiCamp[] = [];
        for (let index = 0; index < 8; index++) {
          const angle = (index / 8) * Math.PI * 2,
            candidateX = crossed.x + Math.cos(angle) * 7.2,
            candidateZ = crossed.z + Math.sin(angle) * 7.2,
            open = nearestOpenIndex(pathfinder.grid, candidateX, candidateZ);
          if (open < 0) continue;
          const [x, z] = navPoint(pathfinder.grid, open);
          if (
            riskSites.some(
              (risk) => Math.hypot(x - risk.x, z - risk.z) < 5.8,
            ) ||
            game.sites.some(
              (site) =>
                !site.destroyed && Math.hypot(x - site.x, z - site.z) < 2.2,
            )
          )
            continue;
          const first = pathfinder.find(
              source.navX ?? source.x,
              source.navZ ?? source.z,
              x,
              z,
            ),
            second = pathfinder.find(
              x,
              z,
              target.navX ?? target.x,
              target.navZ ?? target.z,
            );
          if (
            !first.length ||
            !second.length ||
            pathCrossesPlannerRisk(first, riskSites) ||
            pathCrossesPlannerRisk(second, riskSites)
          )
            continue;
          detours.push({
            sourceId: source.id,
            targetId: target.id,
            x,
            z,
            pathToTarget: second,
          });
        }
        detours.sort(
          (a, b) => a.pathToTarget.length - b.pathToTarget.length,
        );
        if (detours[0]) {
          camps.push(detours[0]);
          break outer;
        }
      }
  }
  return { intent, orders, camps };
}

const difficultyProfileForPlanner = (difficulty: AiDifficulty) =>
  difficulty === "hard"
    ? { waveLimit: 6, minimumSource: 6, dispatchRatio: 0.78, randomness: 4, pathCandidates: 10 }
    : difficulty === "casual"
      ? { waveLimit: 1, minimumSource: 12, dispatchRatio: 0.22, randomness: 14, pathCandidates: 4 }
      : { waveLimit: 1, minimumSource: 10, dispatchRatio: 0.5, randomness: 8, pathCandidates: 7 };

const pathCrossesPlannerRisk = (
  path: [number, number][] | undefined,
  sites: SiteState[],
) =>
  !!path?.some(([x, z]) =>
    sites.some((site) => Math.hypot(x - site.x, z - site.z) < 5.2),
  );

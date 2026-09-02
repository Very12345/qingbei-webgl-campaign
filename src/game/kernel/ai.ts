import type { AiDifficulty, GameData, SiteState, Team } from "../types";
import type { KernelPathfinder } from "./navigation";
import { firstEnemyControlSite } from "./control";
import { planFlankingCamp } from "./ai-camps";

export const AI_TACTICS_VERSION = 1;

export type AiIntent =
  "passive" | "single_breakthrough" | "positional" | "probing";

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
  purpose?: "combat" | "logistics" | "probe";
};

export type PlannedAiCamp = {
  sourceId: number;
  targetId: number;
  x: number;
  z: number;
  pathToTarget: [number, number][];
  count?: number;
};

const planPreparationOrders = (
  game: GameData,
  team: Team,
  difficulty: AiDifficulty,
) => {
  if (difficulty !== "hard")
    return {
      intent: "passive" as AiIntent,
      orders: [] as PlannedAiOrder[],
      camps: [] as PlannedAiCamp[],
      reserveForCamp: 0,
    };
  for (const site of game.sites) {
    if (site.team !== team || site.destroyed) continue;
    const valuable = site.type === "capital" || site.type === "target";
    site.stance = valuable ? "guard" : "standby";
    site.dispatchRatio = valuable ? 0.7 : 1;
  }
  const idleCounts = new Map<number, number>(),
    incomingCounts = new Map<number, number>();
  for (const unit of game.units) {
    if (unit.team !== team || unit.hp <= 0) continue;
    if (unit.targetSiteId == null)
      idleCounts.set(unit.siteId, (idleCounts.get(unit.siteId) ?? 0) + 1);
    else
      incomingCounts.set(
        unit.targetSiteId,
        (incomingCounts.get(unit.targetSiteId) ?? 0) + unit.strength,
      );
  }
  const stagingSites = game.sites.filter(
      (site) =>
        site.team === team &&
        !site.destroyed &&
        site.type !== "dorm" &&
        site.type !== "dining" &&
        site.type !== "camp",
    ),
    stagingLoad = new Map(
      stagingSites.map((site) => [
        site.id,
        (idleCounts.get(site.id) ?? 0) + (incomingCounts.get(site.id) ?? 0),
      ]),
    ),
    sources = game.sites
      .filter(
        (site) =>
          site.team === team &&
          !site.destroyed &&
          (site.type === "dorm" || site.type === "dining") &&
          site.orderTarget == null &&
          (idleCounts.get(site.id) ?? 0) >= 12,
      )
      .sort((a, b) => (idleCounts.get(b.id) ?? 0) - (idleCounts.get(a.id) ?? 0))
      .slice(0, 10),
    orders: PlannedAiOrder[] = [];
  for (const source of sources) {
    const target = [...stagingSites].sort(
      (a, b) =>
        Math.hypot(a.x - source.x, a.z - source.z) +
        (stagingLoad.get(a.id) ?? 0) * 0.32 -
        Math.hypot(b.x - source.x, b.z - source.z) -
        (stagingLoad.get(b.id) ?? 0) * 0.32,
    )[0];
    if (!target) continue;
    const count = Math.max(5, (idleCounts.get(source.id) ?? 0) - 6);
    orders.push({
      sourceId: source.id,
      targetId: target.id,
      count,
      purpose: "logistics",
    });
    stagingLoad.set(target.id, (stagingLoad.get(target.id) ?? 0) + count);
  }
  return {
    intent: "passive" as AiIntent,
    orders,
    camps: [] as PlannedAiCamp[],
    reserveForCamp: 0,
  };
};

export function planStrategicOrders(
  game: GameData,
  team: Team,
  difficulty: AiDifficulty,
  pathfinder: KernelPathfinder | null,
  random: () => number,
  opponentAiEnabled = false,
) {
  if (!game.campaign.warUnlocked)
    return planPreparationOrders(game, team, difficulty);
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
    hostileGroups = new Map<number, number>(),
    hostileOrigins = new Map<number, number>();
  for (const unit of game.units) {
    if (unit.team === team && unit.targetSiteId == null && unit.hp > 0)
      idleCounts.set(unit.siteId, (idleCounts.get(unit.siteId) ?? 0) + 1);
    const home = game.sites[unit.siteId];
    if (
      unit.team === enemy &&
      unit.hp > 0 &&
      home?.team === enemy &&
      !home.destroyed &&
      Math.hypot(
        unit.x - (home.navX ?? home.x),
        unit.z - (home.navZ ?? home.z),
      ) < 12
    )
      defenderCounts.set(
        unit.siteId,
        (defenderCounts.get(unit.siteId) ?? 0) + 1,
      );
    if (
      unit.team === enemy &&
      unit.targetSiteId != null &&
      game.sites[unit.targetSiteId]?.team === team
    ) {
      hostileGroups.set(
        unit.targetSiteId,
        (hostileGroups.get(unit.targetSiteId) ?? 0) + unit.strength,
      );
      if (game.sites[unit.siteId]?.team === enemy)
        hostileOrigins.set(
          unit.siteId,
          (hostileOrigins.get(unit.siteId) ?? 0) + unit.strength,
        );
    }
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
    riskSites = enemySites.filter(
      (site) =>
        isHighRiskEventTarget(site) ||
        site.stance === "defend" ||
        site.type === "camp" ||
        defendersAt(site) >= 8,
    ),
    peerHard =
      difficulty === "hard" &&
      opponentAiEnabled &&
      (game.campaign.ai.difficultyByTeam?.[enemy] ??
        game.campaign.ai.difficulty) === "hard",
    baseProfile = difficultyProfileForPlanner(difficulty, peerHard),
    hostileStrength = [...hostileGroups.values()].reduce(
      (sum, strength) => sum + strength,
      0,
    ),
    casualtyPressure = game.deaths[team] / Math.max(1, game.deaths[enemy]),
    friendlyStrength = game.units
      .filter((unit) => unit.team === team && unit.hp > 0)
      .reduce((sum, unit) => sum + unit.strength, 0),
    enemyStrength = game.units
      .filter((unit) => unit.team === enemy && unit.hp > 0)
      .reduce((sum, unit) => sum + unit.strength, 0),
    forceDisadvantage =
      peerHard && friendlyStrength < Math.max(500, enemyStrength * 0.68),
    stalemateEscalation = Math.max(
      0,
      Math.min(1, (game.deaths.pku + game.deaths.thu - 18_000) / 18_000),
    ),
    adaptiveResistance =
      difficulty === "hard" &&
      !peerHard &&
      (opponentAiEnabled ||
        hostileGroups.size >= 2 ||
        hostileStrength >= 20 ||
        (game.deaths[team] >= 120 && casualtyPressure >= 0.9)),
    initialFriendlySites =
      team === "pku"
        ? game.campaign.initialPkuSites
        : game.campaign.initialThuSites,
    initialEnemySites =
      enemy === "pku"
        ? game.campaign.initialPkuSites
        : game.campaign.initialThuSites,
    controlAdvantage =
      friendlySites.length / Math.max(1, initialFriendlySites) -
      enemySites.length / Math.max(1, initialEnemySites),
    profile = peerHard
      ? forceDisadvantage
        ? {
            ...baseProfile,
            waveLimit: 0,
            dispatchRatio: 0.35,
          }
        : stalemateEscalation >= 0.72
          ? {
              ...baseProfile,
              waveLimit: 3,
              dispatchRatio: 0.72,
            }
          : {
              ...baseProfile,
              waveLimit: 1,
              dispatchRatio:
                controlAdvantage < -0.05
                  ? 0.68
                  : controlAdvantage > 0.05
                    ? 0.08
                    : 0.44,
              cautiousProbe: controlAdvantage > 0.05,
            }
      : difficulty === "hard"
        ? adaptiveResistance
          ? {
              ...baseProfile,
              waveLimit: casualtyPressure > 1.15 ? 2 : 3,
              dispatchRatio: casualtyPressure > 1.15 ? 0.94 : 0.88,
            }
          : initialEnemySites >= 75
            ? { ...baseProfile, waveLimit: 8 }
            : baseProfile
        : difficulty === "standard" && enemySites.length <= 10
          ? {
              ...baseProfile,
              waveLimit: 5,
              dispatchRatio: 0.58,
            }
          : baseProfile,
    staleAfterHours =
      difficulty === "hard"
        ? adaptiveResistance
          ? 6
          : 12
        : difficulty === "standard"
          ? 24
          : 48,
    isStaleCombatOrder = (site: SiteState) => {
      if (
        site.orderOwner === "player" ||
        site.orderTarget == null ||
        site.orderPurpose === "logistics"
      )
        return false;
      const target = game.sites[site.orderTarget];
      return (
        !!target &&
        target.team === enemy &&
        game.campaign.elapsedHours - (site.orderIssuedAt ?? 0) >=
          staleAfterHours
      );
    },
    sources = friendlySites
      .filter(
        (site) =>
          !(
            (site.type === "dorm" || site.type === "dining") &&
            site.orderPurpose === "logistics"
          ) &&
          (site.orderTarget == null ||
            game.sites[site.orderTarget]?.team === team ||
            site.type === "camp" ||
            isStaleCombatOrder(site)) &&
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
  if (peerHard && stalemateEscalation < 0.72 && controlAdvantage > 0.05)
    for (const site of friendlySites) {
      if (site.orderOwner === "player" || site.type === "camp") continue;
      const target =
        site.orderTarget == null ? undefined : game.sites[site.orderTarget];
      if (!target || target.team === team) continue;
      site.orderTarget = undefined;
      site.orderPath = undefined;
      site.orderPurpose = undefined;
      site.orderIssuedAt = undefined;
    }
  for (const site of friendlySites) {
    if (site.orderTarget == null) continue;
    const target = game.sites[site.orderTarget];
    if (target && !target.destroyed) continue;
    site.orderTarget = undefined;
    site.orderPath = undefined;
    site.orderPurpose = undefined;
    site.orderIssuedAt = undefined;
  }
  for (const site of friendlySites) {
    if (!isStaleCombatOrder(site) || site.orderTarget == null) continue;
    if (
      site.type === "camp" &&
      (idleAt(site) > 0 ||
        game.units.some(
          (unit) => unit.team === team && unit.targetSiteId === site.id,
        ))
    )
      continue;
    const hasCommittedUnits = game.units.some(
      (unit) =>
        unit.team === team &&
        unit.siteId === site.id &&
        (unit.targetSiteId === site.orderTarget ||
          unit.movementOrder?.goalSiteId === site.orderTarget),
    );
    if (hasCommittedUnits || idleAt(site) >= profile.minimumSource) continue;
    site.orderTarget = undefined;
    site.orderPath = undefined;
    site.orderPurpose = undefined;
    site.orderIssuedAt = undefined;
  }
  const logisticsStaging = friendlySites.filter(
      (site) =>
        site.type !== "dorm" &&
        site.type !== "dining" &&
        site.type !== "camp" &&
        !hostileGroups.has(site.id),
    ),
    logisticsLoad = new Map(
      logisticsStaging.map((site) => [
        site.id,
        idleAt(site) +
          game.units.filter(
            (unit) => unit.team === team && unit.targetSiteId === site.id,
          ).length,
      ]),
    ),
    logisticsLimit =
      difficulty === "hard" ? 8 : difficulty === "standard" ? 4 : 2,
    logisticsReserve =
      difficulty === "hard" ? 5 : difficulty === "standard" ? 9 : 14;
  let logisticsCreated = 0;
  for (const source of friendlySites
    .filter(
      (site) =>
        (site.type === "dorm" || site.type === "dining") &&
        !hostileGroups.has(site.id) &&
        (site.orderTarget == null ||
          (site.orderPurpose === "logistics" &&
            (game.sites[site.orderTarget]?.team !== team ||
              hostileGroups.has(site.orderTarget)))) &&
        (idleAt(site) > logisticsReserve || hostileGroups.has(site.id)),
    )
    .sort(
      (a, b) =>
        (hostileGroups.get(b.id) ?? 0) - (hostileGroups.get(a.id) ?? 0) ||
        idleAt(b) - idleAt(a),
    )) {
    if (logisticsCreated >= logisticsLimit) break;
    const target = [...logisticsStaging].sort(
      (a, b) =>
        Math.hypot(a.x - source.x, a.z - source.z) +
        (logisticsLoad.get(a.id) ?? 0) * 0.34 -
        Math.hypot(b.x - source.x, b.z - source.z) -
        (logisticsLoad.get(b.id) ?? 0) * 0.34,
    )[0];
    if (!target) continue;
    const count = Math.max(
      1,
      idleAt(source) - (hostileGroups.has(source.id) ? 2 : logisticsReserve),
    );
    orders.push({
      sourceId: source.id,
      targetId: target.id,
      count,
      purpose: "logistics",
    });
    reinforcementSources.add(source.id);
    logisticsLoad.set(target.id, (logisticsLoad.get(target.id) ?? 0) + count);
    logisticsCreated++;
  }
  const unsafeGoalKey = `${team}:unsafe_breakthrough`,
    allowUnsafeBreakthrough =
      (game.campaign.ai.failedGoals[unsafeGoalKey] ?? 0) >= 3;
  let unsafeRouteBlocked = false,
    safeRouteFound = false;
  for (const unit of game.units) {
    if (
      unit.team !== team ||
      unit.targetSiteId == null ||
      game.sites[unit.targetSiteId]?.team !== enemy
    )
      continue;
    committedByTarget.set(
      unit.targetSiteId,
      (committedByTarget.get(unit.targetSiteId) ?? 0) + unit.strength,
    );
  }
  const threatened = [...hostileGroups]
    .map(([targetId, strength]) => ({
      target: game.sites[targetId],
      strength,
    }))
    .filter(({ target }) => target && target.team === team && !target.destroyed)
    .sort((a, b) => {
      const value = (site: SiteState) =>
        site.type === "dorm" || site.type === "dining"
          ? 100
          : site.type === "capital" || site.type === "target"
            ? 80
            : 0;
      return value(b.target) + b.strength - value(a.target) - a.strength;
    })
    .slice(0, difficulty === "hard" ? 3 : 1);
  if (difficulty === "hard")
    for (const site of friendlySites) {
      if (site.orderOwner === "player") continue;
      const incoming = hostileGroups.get(site.id) ?? 0,
        production = site.type === "dorm" || site.type === "dining",
        valuable =
          production || site.type === "capital" || site.type === "target",
        frontline = enemySites.some(
          (enemySite) =>
            Math.hypot(enemySite.x - site.x, enemySite.z - site.z) < 8,
        );
      if (incoming > 0 || (forceDisadvantage && (frontline || valuable))) {
        site.stance = "defend";
        site.dispatchRatio = 0.35;
        if (
          site.type !== "camp" &&
          site.orderTarget != null &&
          game.sites[site.orderTarget]?.team === enemy
        ) {
          site.orderTarget = undefined;
          site.orderPath = undefined;
          site.orderPurpose = undefined;
          site.orderIssuedAt = undefined;
        }
      } else if (frontline || (valuable && !production)) {
        site.stance = "guard";
        site.dispatchRatio = 0.7;
      } else {
        site.stance = "standby";
        site.dispatchRatio = 1;
      }
    }
  for (const threat of threatened) {
    let needed = Math.max(
      0,
      Math.ceil(threat.strength * (difficulty === "hard" ? 1.35 : 1.05)) -
        idleAt(threat.target),
    );
    if (needed <= 0) continue;
    const reserves = [...sources].sort(
      (a, b) =>
        Math.hypot(a.x - threat.target.x, a.z - threat.target.z) -
        Math.hypot(b.x - threat.target.x, b.z - threat.target.z),
    );
    for (const source of reserves) {
      if (
        needed <= 0 ||
        source.id === threat.target.id ||
        reinforcementSources.has(source.id)
      )
        continue;
      const reserve =
          source.type === "dorm" || source.type === "dining" ? 8 : 4,
        available = Math.max(0, idleAt(source) - reserve);
      if (!available) continue;
      const count = Math.min(available, needed);
      orders.push({ sourceId: source.id, targetId: threat.target.id, count });
      reinforcementSources.add(source.id);
      needed -= count;
    }
  }
  if (difficulty === "hard" && intent === "single_breakthrough") {
    const cutoff = [...hostileOrigins]
      .map(([siteId, strength]) => ({ site: game.sites[siteId], strength }))
      .filter(({ site }) => site && site.team === enemy && !site.destroyed)
      .sort((a, b) => b.strength - a.strength)[0];
    if (cutoff) {
      const source = sources.find(
        (candidate) =>
          !reinforcementSources.has(candidate.id) &&
          idleAt(candidate) >= Math.max(8, defendersAt(cutoff.site) + 5),
      );
      if (source) {
        const count = Math.min(
          idleAt(source) - 4,
          Math.max(8, Math.ceil(defendersAt(cutoff.site) * 1.4 + 4)),
        );
        orders.push({ sourceId: source.id, targetId: cutoff.site.id, count });
        reinforcementSources.add(source.id);
      }
    }
  }
  // Forward camps are vulnerable before the approaching column arrives.
  // A nearby reserve can deny that staging point instead of waiting until a
  // large enemy force has assembled behind our defended production sites.
  if (difficulty === "hard" && pathfinder) {
    for (const camp of enemySites.filter((site) => site.type === "camp")) {
      const required = Math.max(8, Math.ceil(defendersAt(camp) * 1.55 + 4));
      if ((committedByTarget.get(camp.id) ?? 0) >= required) continue;
      const reserve = [...friendlySites]
        .filter(
          (site) =>
            site.orderOwner !== "player" &&
            !reinforcementSources.has(site.id) &&
            !hostileGroups.has(site.id) &&
            idleAt(site) >=
              required +
                (site.type === "dorm" || site.type === "dining" ? 8 : 4) &&
            Math.hypot(site.x - camp.x, site.z - camp.z) <= 16,
        )
        .sort(
          (a, b) =>
            Math.hypot(a.x - camp.x, a.z - camp.z) -
            Math.hypot(b.x - camp.x, b.z - camp.z),
        )
        .find((site) => {
          const path = pathfinder.find(
            site.navX ?? site.x,
            site.navZ ?? site.z,
            camp.navX ?? camp.x,
            camp.navZ ?? camp.z,
          );
          return (
            path.length > 0 &&
            path.length * pathfinder.grid.cell <= 24 &&
            !firstEnemyControlSite(game, team, path, camp.id)
          );
        });
      if (!reserve) continue;
      orders.push({
        sourceId: reserve.id,
        targetId: camp.id,
        count: required,
        purpose: "combat",
      });
      reinforcementSources.add(reserve.id);
      break;
    }
  }
  for (const camp of friendlySites.filter(
    (site) =>
      site.type === "camp" &&
      site.orderTarget != null &&
      game.sites[site.orderTarget]?.team === enemy,
  )) {
    if (hostileGroups.has(camp.id)) {
      reinforcementSources.add(camp.id);
      continue;
    }
    const target = game.sites[camp.orderTarget!],
      encounter = pathfinder
        ? (firstEnemyControlSite(
            game,
            team,
            pathfinder.find(
              camp.navX ?? camp.x,
              camp.navZ ?? camp.z,
              target.navX ?? target.x,
              target.navZ ?? target.z,
            ),
            target.id,
          ) ?? target)
        : target,
      required = Math.max(
        12,
        Math.ceil(
          Math.max(defendersAt(target), defendersAt(encounter)) * 1.55 + 4,
        ),
      ),
      campIdle = idleAt(camp);
    if (campIdle >= required) {
      const cautious =
        "cautiousProbe" in profile && profile.cautiousProbe === true;
      const rallyRatio =
        difficulty === "hard"
          ? Math.min(camp.dispatchRatio ?? 0.65, profile.dispatchRatio)
          : (camp.dispatchRatio ?? 0.65);
      if (
        orders.filter((order) => order.purpose !== "logistics").length <
        profile.waveLimit
      )
        orders.push({
          sourceId: camp.id,
          targetId: target.id,
          count: Math.min(
            campIdle,
            cautious
              ? Math.max(
                  2,
                  Math.min(
                    profile.minimumSource,
                    Math.ceil(campIdle * profile.dispatchRatio),
                  ),
                )
              : Math.max(required, Math.ceil(campIdle * rallyRatio)),
          ),
          purpose: cautious ? "probe" : "combat",
        });
      reinforcementSources.add(camp.id);
      continue;
    }
    let needed = required - campIdle;
    for (const source of [...sources].sort(
      (a, b) =>
        Math.hypot(a.x - camp.x, a.z - camp.z) -
        Math.hypot(b.x - camp.x, b.z - camp.z),
    )) {
      if (
        needed <= 0 ||
        source.id === camp.id ||
        source.type === "camp" ||
        reinforcementSources.has(source.id)
      )
        continue;
      if (
        pathfinder &&
        firstEnemyControlSite(
          game,
          team,
          pathfinder.find(
            source.navX ?? source.x,
            source.navZ ?? source.z,
            camp.navX ?? camp.x,
            camp.navZ ?? camp.z,
          ),
          camp.id,
        )
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
    if (
      orders.filter((order) => order.purpose !== "logistics").length >=
      profile.waveLimit
    )
      break;
    const available = idleAt(source),
      candidates = enemySites
        .map((target) => {
          const defenders = defendersAt(target),
            required = Math.max(3, Math.ceil(defenders * 1.55 + 4)),
            productionValue =
              target.type === "dorm"
                ? adaptiveResistance
                  ? 150
                  : 80
                : target.type === "dining"
                  ? adaptiveResistance
                    ? 110
                    : 55
                  : 0,
            recaptureValue =
              (team === "pku" &&
                target.displayName?.startsWith("清华燕园校区·")) ||
              (team === "thu" &&
                target.displayName?.startsWith("北大清华园校区·"))
                ? 72
                : 0,
            riskPenalty =
              enemyProduction.length > 2 && isHighRiskEventTarget(target)
                ? adaptiveResistance
                  ? 280
                  : 180
                : 0,
            distance = Math.hypot(target.x - source.x, target.z - source.z),
            committed = committedByTarget.get(target.id) ?? 0,
            concentrationPenalty =
              committed >= required || assignedTargets.has(target.id)
                ? adaptiveResistance
                  ? 180
                  : 20
                : 0,
            concentrationBonus =
              committed > 0 && committed < required
                ? adaptiveResistance
                  ? 140
                  : 48
                : 0,
            staleSameTargetPenalty =
              source.orderTarget === target.id && isStaleCombatOrder(source)
                ? 120
                : 0,
            score =
              productionValue +
              recaptureValue -
              riskPenalty -
              distance -
              defenders * (adaptiveResistance ? 4.8 : 2.2) -
              concentrationPenalty +
              concentrationBonus -
              staleSameTargetPenalty +
              (random() - 0.5) * profile.randomness;
          return {
            target,
            defenders,
            required,
            score,
            engagementId: target.id,
          };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, profile.pathCandidates)
        .filter(
          (candidate) =>
            difficulty !== "casual" ||
            candidate.defenders <= 1 ||
            candidate.required <= available,
        );
    let target: (typeof candidates)[number] | undefined = candidates[0],
      unsafeFallback: (typeof candidates)[number] | undefined;
    if (difficulty === "standard" && pathfinder) {
      // Budget for the enemy that will actually intercept this march, not just
      // the often empty production site at its far end. A weak column cannot
      // count its remote destination's low garrison as a safe attack.
      const encounters = candidates.flatMap((candidate) => {
        const path = pathfinder.find(
          source.navX ?? source.x,
          source.navZ ?? source.z,
          candidate.target.navX ?? candidate.target.x,
          candidate.target.navZ ?? candidate.target.z,
        );
        if (!path.length) return [];
        const encounter =
          firstEnemyControlSite(game, team, path, candidate.target.id) ??
          candidate.target;
        const defenders = defendersAt(encounter);
        const required = Math.max(
          candidate.required,
          Math.ceil(defenders * 1.55 + 4),
        );
        const committed = committedByTarget.get(encounter.id) ?? 0;
        if (available < Math.max(1, required - committed)) return [];
        const extraRisk =
          encounter.id !== candidate.target.id &&
          enemyProduction.length > 2 &&
          isHighRiskEventTarget(encounter)
            ? 180
            : 0;
        return [
          {
            ...candidate,
            engagementId: encounter.id,
            required,
            score:
              candidate.score -
              Math.max(0, defenders - candidate.defenders) * 2.2 -
              extraRisk,
          },
        ];
      });
      encounters.sort((a, b) => b.score - a.score);
      target = encounters[0];
    }
    if (difficulty === "hard" && enemyProduction.length > 2 && pathfinder) {
      target = undefined;
      for (const candidate of candidates) {
        if (!routeIsUnsafe(pathfinder, source, candidate.target, riskSites)) {
          target = candidate;
          safeRouteFound = true;
          break;
        }
        unsafeFallback ??= candidate;
      }
      if (!target && unsafeFallback) {
        if (adaptiveResistance && !allowUnsafeBreakthrough) {
          unsafeRouteBlocked = true;
          continue;
        }
        target = unsafeFallback;
      }
    }
    if (!target) continue;
    const alreadyCommitted = committedByTarget.get(target.engagementId) ?? 0,
      remainingRequired = Math.max(1, target.required - alreadyCommitted),
      cautiousProbe =
        "cautiousProbe" in profile && profile.cautiousProbe === true,
      count = Math.min(
        available,
        cautiousProbe
          ? Math.max(
              2,
              Math.min(
                profile.minimumSource,
                Math.ceil(available * profile.dispatchRatio),
              ),
            )
          : Math.max(
              remainingRequired,
              Math.ceil(available * profile.dispatchRatio),
            ),
      );
    orders.push({
      sourceId: source.id,
      targetId: target.target.id,
      count,
      purpose: cautiousProbe ? "probe" : "combat",
    });
    const committed = alreadyCommitted + count;
    committedByTarget.set(target.engagementId, committed);
    if (committed >= target.required) assignedTargets.add(target.engagementId);
  }
  if (adaptiveResistance) {
    if (unsafeRouteBlocked && !safeRouteFound)
      game.campaign.ai.failedGoals[unsafeGoalKey] =
        (game.campaign.ai.failedGoals[unsafeGoalKey] ?? 0) + 1;
    else if (safeRouteFound || allowUnsafeBreakthrough)
      game.campaign.ai.failedGoals[unsafeGoalKey] = 0;
  }
  const camps: PlannedAiCamp[] = [];
  let reserveForCamp = 0;
  if (
    difficulty !== "casual" &&
    profile.waveLimit > 0 &&
    pathfinder &&
    enemyProduction.length > 0 &&
    friendlySites.filter(
      (site) =>
        site.type === "camp" &&
        site.orderTarget != null &&
        game.sites[site.orderTarget]?.team === enemy,
    ).length < (difficulty === "hard" ? 2 : 1)
  ) {
    const camp = planFlankingCamp(
      game,
      team,
      sources.filter(
        (source) =>
          source.type !== "camp" &&
          source.orderOwner !== "player" &&
          !reinforcementSources.has(source.id),
      ),
      enemyProduction
        .filter(
          (target) =>
            !friendlySites.some(
              (site) => site.type === "camp" && site.orderTarget === target.id,
            ),
        )
        .sort((a, b) => defendersAt(a) - defendersAt(b)),
      pathfinder,
      defendersAt,
      idleAt,
    );
    if (camp) {
      if (game.resources[team] >= 80) {
        camps.push(camp);
        // Reserve this column for the detour instead of issuing an additional
        // regular attack from the same source in this strategic tick.
        for (let i = orders.length - 1; i >= 0; i--)
          if (orders[i].sourceId === camp.sourceId) orders.splice(i, 1);
      } else reserveForCamp = 80;
    }
  }
  return { intent, orders, camps, reserveForCamp };
}

const difficultyProfileForPlanner = (
  difficulty: AiDifficulty,
  peerHard = false,
) =>
  difficulty === "hard"
    ? peerHard
      ? {
          waveLimit: 1,
          minimumSource: 13,
          dispatchRatio: 0.44,
          randomness: 7,
          pathCandidates: 8,
        }
      : {
          waveLimit: 6,
          minimumSource: 6,
          dispatchRatio: 0.78,
          randomness: 4,
          pathCandidates: 10,
        }
    : difficulty === "casual"
      ? {
          waveLimit: 1,
          minimumSource: 14,
          dispatchRatio: 0.16,
          randomness: 14,
          pathCandidates: 4,
        }
      : {
          waveLimit: 2,
          minimumSource: 10,
          dispatchRatio: 0.4,
          randomness: 8,
          pathCandidates: 7,
        };

const pathCrossesPlannerRisk = (
  path: [number, number][] | undefined,
  sites: SiteState[],
) =>
  !!path?.some(([x, z]) =>
    sites.some((site) => Math.hypot(x - site.x, z - site.z) < 5.2),
  );

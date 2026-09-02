import { makeFreshGame } from "../src/game/create-game";
import { osmRegions } from "../src/osm-map-data";
import { buildKernelNavGrid } from "../src/game/kernel/build-navigation";
import {
  createKernel,
  KernelPathfinder,
  planStrategicOrders,
} from "../src/game/kernel";
import type { AiDifficulty, GameData, Team } from "../src/game/types";

const scenario = process.argv[2] ?? "thu-hard-idle",
  configurations: Record<
    string,
    { teams: Team[]; difficulty: Record<Team, AiDifficulty> }
  > = {
    "pku-hard-idle": { teams: ["pku"], difficulty: { pku: "hard", thu: "standard" } },
    "thu-hard-idle": { teams: ["thu"], difficulty: { pku: "standard", thu: "hard" } },
    "pku-standard-idle": { teams: ["pku"], difficulty: { pku: "standard", thu: "standard" } },
    "thu-standard-idle": { teams: ["thu"], difficulty: { pku: "standard", thu: "standard" } },
    "pku-casual-idle": { teams: ["pku"], difficulty: { pku: "casual", thu: "standard" } },
    "thu-casual-idle": { teams: ["thu"], difficulty: { pku: "standard", thu: "casual" } },
    "pku-hard-vs-thu-standard": { teams: ["pku", "thu"], difficulty: { pku: "hard", thu: "standard" } },
    "thu-hard-vs-pku-standard": { teams: ["pku", "thu"], difficulty: { pku: "standard", thu: "hard" } },
    "hard-mirror": { teams: ["pku", "thu"], difficulty: { pku: "hard", thu: "hard" } },
  },
  configuration = configurations[scenario];
if (!configuration) throw new Error(`未知基准场景 ${scenario}`);

const benchmarkSeed = process.argv[3] == null ? 0x51a7c0de : Number(process.argv[3]);
if (!Number.isInteger(benchmarkSeed) || benchmarkSeed < 0 || benchmarkSeed > 0xffffffff)
  throw new Error("随机种子必须为0至4294967295的整数");
const game = makeFreshGame();
game.campaign.ai.difficultyByTeam = configuration.difficulty;
// 固定种子保证每次调优的差异来自代码，而不是一次随机开局。
game.campaign.ai.seed = benchmarkSeed;
game.campaign.ai.seedByTeam = {
  pku: game.campaign.ai.seed ^ 0x504b5501,
  thu: game.campaign.ai.seed ^ 0x54485501,
};
const navGrid = buildKernelNavGrid(osmRegions.main),
  kernel = createKernel(game, {
  aiTeams: configuration.teams,
  navGrid,
  fixedStepMilliseconds: 500,
});
kernel.dispatch({ type: "set_time_scale", value: 16 });

const start = Date.parse("2026-08-16T08:00:00+08:00"),
  baseDates = [
    "2026-08-19T20:00:00+08:00",
    "2026-08-22T00:00:00+08:00",
    "2026-08-25T00:00:00+08:00",
    "2026-08-29T00:00:00+08:00",
    "2026-09-02T00:00:00+08:00",
    "2026-09-06T00:00:00+08:00",
    "2026-09-16T00:00:00+08:00",
    "2026-09-18T00:00:00+08:00",
    "2026-09-20T00:00:00+08:00",
    "2026-09-26T00:00:00+08:00",
  ],
  longMirrorDates = [
    ...baseDates,
    "2026-10-01T00:00:00+08:00",
    "2026-10-15T00:00:00+08:00",
    "2026-11-01T00:00:00+08:00",
    "2026-12-01T00:00:00+08:00",
    "2027-02-01T00:00:00+08:00",
    "2027-05-01T00:00:00+08:00",
    "2027-08-15T00:00:00+08:00",
  ],
  dates = scenario === "hard-mirror"
    ? longMirrorDates
    : scenario.includes("hard-idle")
    ? baseDates.slice(0, 6)
    : scenario.includes("standard-idle") || scenario.includes("-vs-")
      ? baseDates.slice(0, 9)
      : baseDates;

const summarize = (state: GameData, date: string) => {
  const sites = { pku: 0, thu: 0 },
    population = { pku: 0, thu: 0 },
    routeGroups = new Map<string, { sourceId: number; targetId: number; committed: number }>();
  for (const site of state.sites) if (!site.destroyed) sites[site.team]++;
  for (const unit of state.units) {
    population[unit.team] += unit.strength;
    if (unit.targetSiteId == null) continue;
    const key = `${unit.siteId}>${unit.targetSiteId}`,
      route = routeGroups.get(key);
    if (route) route.committed += unit.strength;
    else routeGroups.set(key, { sourceId: unit.siteId, targetId: unit.targetSiteId, committed: unit.strength });
  }
  const routes = [...routeGroups.values()]
    .sort((a, b) => b.committed - a.committed)
    .slice(0, 10)
    .map((route) => {
      const source = state.sites.find((site) => site.id === route.sourceId),
        target = state.sites.find((site) => site.id === route.targetId),
        path = source?.orderTarget === target?.id
          ? source?.orderPath
          : state.units.find(
              (unit) => unit.siteId === route.sourceId && unit.targetSiteId === route.targetId,
            )?.path;
      return {
        team: source?.team,
        source: source?.displayName ?? source?.name,
        target: target?.displayName ?? target?.name,
        committed: route.committed,
        path: path
          ?.filter((_, index) => index === 0 || index === path.length - 1 || index % Math.max(1, Math.floor(path.length / 5)) === 0)
          .slice(0, 7),
      };
    });
  return {
    date: date.slice(0, 10),
    elapsedHours: state.campaign.elapsedHours,
    sites,
    population,
    deaths: state.deaths,
    casualtyRatio: {
      pku: state.deaths.pku / Math.max(1, state.deaths.thu),
      thu: state.deaths.thu / Math.max(1, state.deaths.pku),
    },
    remaining: {
      pku: state.sites
        .filter((site) => site.team === "pku" && !site.destroyed)
        .map((site) => site.displayName ?? site.name),
      thu: state.sites
        .filter((site) => site.team === "thu" && !site.destroyed)
        .map((site) => site.displayName ?? site.name),
    },
    intent: state.campaign.ai.intent,
    orders: state.sites
      .filter((site) => site.orderTarget != null && !site.destroyed)
      .map((site) => ({
        source: site.displayName ?? site.name,
        sourceTeam: site.team,
        target: state.sites.find((target) => target.id === site.orderTarget)?.displayName ??
          state.sites.find((target) => target.id === site.orderTarget)?.name,
        targetTeam: state.sites.find((target) => target.id === site.orderTarget)?.team,
        idle: state.units.filter(
          (unit) => unit.siteId === site.id && unit.targetSiteId == null,
        ).length,
      })),
    routes,
    camps: state.sites.filter(site=>site.type==="camp").map(site=>({
      id:site.id,team:site.team,destroyed:!!site.destroyed,targetId:site.orderTarget,
      stationed:state.units.filter(unit=>unit.team===site.team&&unit.siteId===site.id&&unit.targetSiteId==null).length,
      departing:state.units.filter(unit=>unit.team===site.team&&unit.siteId===site.id&&unit.targetSiteId!=null).length,
    })),
    outcome: state.campaign.outcome ?? null,
  };
};

const samples = [];
let elapsed = 0;
for (const date of dates) {
  const target = (Date.parse(date) - start) / 3_600_000,
    iterations = Math.max(0, Math.ceil((target - elapsed) / 0.72)),
    segment = performance.now(),
    snapshot = kernel.run(iterations, 250);
  elapsed = snapshot.elapsedHours;
  const sample = summarize(snapshot.state, date);
  samples.push(sample);
  console.error(
    `${sample.date} ${(performance.now() - segment).toFixed(0)}ms sites=${sample.sites.pku}/${sample.sites.thu} population=${sample.population.pku}/${sample.population.thu} deaths=${sample.deaths.pku}/${sample.deaths.thu}`,
  );
  if (Math.min(sample.sites.pku, sample.sites.thu) <= 35)
    console.error(
      `remaining=${JSON.stringify(sample.sites.pku <= sample.sites.thu ? sample.remaining.pku : sample.remaining.thu)}`,
    );
  if (Math.min(sample.sites.pku, sample.sites.thu) <= 35)
    console.error(`orders=${JSON.stringify(sample.orders.slice(0, 20))}`);
  if (Math.min(sample.sites.pku, sample.sites.thu) <= 35) {
    const winningTeam: Team = sample.sites.pku > sample.sites.thu ? "pku" : "thu",
      difficulty = configuration.difficulty[winningTeam],
      debugPlan = planStrategicOrders(
        snapshot.state,
        winningTeam,
        difficulty,
        new KernelPathfinder(navGrid, 200),
        () => 0.5,
      );
    console.error(`debugPlan=${JSON.stringify({ orders: debugPlan.orders, camps: debugPlan.camps.length })}`);
  }
  if (Math.min(sample.sites.pku, sample.sites.thu) <= 35)
    console.error(
      `routes=${JSON.stringify(sample.routes.map((route) => ({ source: route.source, target: route.target, committed: route.committed })))}`,
    );
  if (sample.outcome) break;
}
console.log(JSON.stringify({ scenario, seed: benchmarkSeed, samples }, null, 2));

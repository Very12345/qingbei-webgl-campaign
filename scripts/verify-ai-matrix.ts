import { spawn } from "node:child_process";
import { resolve } from "node:path";

type Sample = {
  date: string;
  elapsedHours: number;
  sites: { pku: number; thu: number };
  population: { pku: number; thu: number };
  deaths: { pku: number; thu: number };
  routes: Array<{ path?: [number, number][] }>;
  orders: Array<{ source: string; target?: string; sourceTeam: string }>;
  camps?: Array<{team:string;stationed:number;departing:number;destroyed:boolean}>;
  outcome: null | { winner: "pku" | "thu"; atHour: number };
};

type Benchmark = { scenario: string; samples: Sample[] };

const scenarios = [
    "pku-hard-idle",
    "thu-hard-idle",
    "pku-standard-idle",
    "thu-standard-idle",
    "pku-casual-idle",
    "thu-casual-idle",
    "pku-hard-vs-thu-standard",
    "thu-hard-vs-pku-standard",
    "hard-mirror",
  ],
  run = (scenario: string) =>
    new Promise<Benchmark>((resolveRun, reject) => {
      const child = spawn(
          process.execPath,
          ["--import", "tsx", resolve("scripts/ai-benchmark.ts"), scenario],
          { cwd: resolve("."), stdio: ["ignore", "pipe", "pipe"] },
        ),
        stdout: Buffer[] = [],
        stderr: Buffer[] = [];
      child.stdout.on("data", (chunk) => stdout.push(chunk));
      child.stderr.on("data", (chunk) => stderr.push(chunk));
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code !== 0)
          reject(
            new Error(
              `${scenario} 退出码 ${code}\n${Buffer.concat(stderr).toString("utf8")}`,
            ),
          );
        else resolveRun(JSON.parse(Buffer.concat(stdout).toString("utf8")));
      });
    }),
  results = await Promise.all(scenarios.map(run)),
  failures: string[] = [],
  hoursAt = (iso: string) =>
    (Date.parse(iso) - Date.parse("2026-08-16T08:00:00+08:00")) / 3_600_000,
  sep6 = hoursAt("2026-09-06T00:00:00+08:00"),
  sep12 = hoursAt("2026-09-12T00:00:00+08:00"),
  sep19 = hoursAt("2026-09-19T23:59:00+08:00"),
  sep16 = hoursAt("2026-09-16T23:59:00+08:00");

const expect = (condition: boolean, message: string) => {
  if (!condition) failures.push(message);
};

for (const result of results) {
  const final = result.samples.at(-1)!;
  for (const sample of result.samples)
    for (const route of sample.routes)
      for (const [x, z] of route.path ?? [])
        expect(
          Number.isFinite(x) && Number.isFinite(z) && Math.abs(x) <= 70 && Math.abs(z) <= 70,
          `${result.scenario} 在 ${sample.date} 产生越界路径 ${x},${z}`,
        );
  if (!result.scenario.includes("casual") && result.scenario !== "hard-mirror")
    expect(
      result.samples.some((sample) => sample.routes.length > 0),
      `${result.scenario} 没有记录到任何进攻路径`,
    );
  if (result.scenario.endsWith("hard-idle")) {
    const attacker = result.scenario.startsWith("pku") ? "pku" : "thu",
      defender = attacker === "pku" ? "thu" : "pku";
    expect(final.outcome?.winner === attacker, `${result.scenario} 未由进攻方获胜`);
    expect((final.outcome?.atHour ?? Infinity) <= sep6, `${result.scenario} 未在9月6日前获胜`);
    expect(
      final.deaths[attacker] <= final.deaths[defender] * 1.1,
      `${result.scenario} 交换比超出1.1：${final.deaths[attacker]}/${final.deaths[defender]}`,
    );
  }
  if (result.scenario.endsWith("standard-idle")) {
    const attacker = result.scenario.startsWith("pku") ? "pku" : "thu",
      defender = attacker === "pku" ? "thu" : "pku";
    expect(final.outcome?.winner === attacker, `${result.scenario} 未由进攻方获胜`);
    expect(
      (final.outcome?.atHour ?? Infinity) >= sep12 &&
        (final.outcome?.atHour ?? -Infinity) <= sep19,
      `${result.scenario} 未在9月16日前后获胜：${final.outcome?.atHour}`,
    );
    expect(
      final.deaths[attacker] <= final.deaths[defender] * 1.1,
      `${result.scenario} 交换比超出1.1：${final.deaths[attacker]}/${final.deaths[defender]}`,
    );
    expect(result.samples.some(sample=>sample.camps?.some(camp=>camp.team===attacker&&!camp.destroyed&&(camp.stationed>0||camp.departing>0))),`${result.scenario} 没有实际使用临时营地`);
  }
  if (result.scenario.includes("-vs-")) {
    const attacker = result.scenario.startsWith("pku") ? "pku" : "thu",
      defender = attacker === "pku" ? "thu" : "pku";
    expect(final.outcome?.winner === attacker, `${result.scenario} 困难AI未获胜`);
    expect((final.outcome?.atHour ?? Infinity) <= sep16, `${result.scenario} 未在9月16日前获胜`);
    expect(
      final.deaths[attacker] <= final.deaths[defender] * 1.5,
      `${result.scenario} 交换比超出1.5：${final.deaths[attacker]}/${final.deaths[defender]}`,
    );
  }
  if (result.scenario.includes("casual")) {
    expect(!final.outcome, `${result.scenario} 在9月26日前过早结束`);
    expect(
      final.population.pku >= 500 && final.population.thu >= 500,
      `${result.scenario} 有阵营耗尽：${final.population.pku}/${final.population.thu}`,
    );
  }
  if (result.scenario === "hard-mirror") {
    const september26 = result.samples.find(
      (sample) => sample.date === "2026-09-26",
    ) ?? final;
    expect(!september26.outcome, "hard-mirror 在9月26日前结束");
    expect(
      Math.abs(september26.sites.pku - september26.sites.thu) <= 22,
      `hard-mirror 据点优势过大：${september26.sites.pku}/${september26.sites.thu}`,
    );
    expect(
      september26.population.pku >= 500 && september26.population.thu >= 500,
      `hard-mirror 有阵营耗尽：${september26.population.pku}/${september26.population.thu}`,
    );
    const autumnSamples = result.samples.filter(
      (sample) =>
        sample.date >= "2026-10-01" &&
        sample.date <= "2026-11-01" &&
        !sample.outcome,
    );
    if (autumnSamples.length >= 2) {
      const signatures = new Set(
        autumnSamples.map((sample) =>
          JSON.stringify({
            sites: sample.sites,
            deaths: sample.deaths,
            orders: sample.orders.map((order) => [
              order.sourceTeam,
              order.source,
              order.target,
            ]),
          }),
        ),
      );
      expect(
        signatures.size >= 2,
        "hard-mirror 在10月到11月间据点、伤亡和兵线完全冻结",
      );
      expect(
        autumnSamples.some(
          (sample) => sample.routes.length > 0 || sample.orders.length > 0,
        ),
        "hard-mirror 在10月后没有任何活动兵线",
      );
    }
  }
}

const summary = results.map((result) => {
  const final = result.samples.at(-1)!;
  return {
    scenario: result.scenario,
    outcome: final.outcome,
    sites: final.sites,
    population: final.population,
    deaths: final.deaths,
  };
});
console.log(JSON.stringify({ ok: failures.length === 0, failures, summary }, null, 2));
if (failures.length) process.exitCode = 1;

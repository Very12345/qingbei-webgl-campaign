import assert from "node:assert/strict";
import { makeFreshGame } from "../src/game/create-game";
import { createKernel } from "../src/game/kernel";
import { planStrategicOrders } from "../src/game/kernel/ai";
import { firstEnemyControlSite } from "../src/game/kernel/control";
import {
  KernelPathfinder,
  type KernelNavGrid,
} from "../src/game/kernel/navigation";
import { progressResearchAndProduction } from "../src/game/kernel/progression";
import { RESEARCH_DEFINITIONS, researchIdsForTeam } from "../src/game/research";
import type { Team } from "../src/game/types";

function fixture(team: Team, rows = 24, troops = 60) {
  const game = makeFreshGame(),
    enemy: Team = team === "pku" ? "thu" : "pku",
    site = game.sites[0],
    unit = game.units[0];
  game.sites = [
    {
      ...site,
      id: 0,
      name: "source",
      team,
      type: "teaching" as const,
      x: 1.5,
      z: 1.5,
      navX: 1.5,
      navZ: 1.5,
    },
    {
      ...site,
      id: 1,
      name: "strongpoint",
      team: enemy,
      type: "teaching" as const,
      stance: "defend" as const,
      x: 11.5,
      z: 1.5,
      navX: 11.5,
      navZ: 1.5,
    },
    {
      ...site,
      id: 2,
      name: "rear production",
      team: enemy,
      type: "dorm" as const,
      x: 30.5,
      z: 1.5,
      navX: 30.5,
      navZ: 1.5,
    },
  ];
  game.units = [
    ...Array.from({ length: troops }, (_, id) => ({
      ...unit,
      id,
      team,
      siteId: 0,
      x: 1.5,
      z: 1.5,
      tx: 1.5,
      tz: 1.5,
      hp: 100,
      strength: 1,
      targetSiteId: undefined,
    })),
    ...Array.from({ length: 30 }, (_, n) => ({
      ...unit,
      id: troops + n,
      team: enemy,
      siteId: 1,
      x: 11.5,
      z: 1.5,
      tx: 11.5,
      tz: 1.5,
      hp: 100,
      strength: 1,
      targetSiteId: undefined,
    })),
  ];
  game.resources = { pku: 1000, thu: 1000 };
  game.campaign.elapsedHours = 100;
  game.campaign.warUnlocked = true;
  game.campaign.nextSiteId = 3;
  game.campaign.initialPkuSites = team === "pku" ? 1 : 2;
  game.campaign.initialThuSites = team === "thu" ? 1 : 2;
  const size = 40 * rows,
    grid: KernelNavGrid = {
      cell: 1,
      cols: 40,
      rows,
      minX: 0,
      minZ: 0,
      blocked: new Uint8Array(size),
      building: new Uint8Array(size),
      water: new Uint8Array(size),
      road: new Uint8Array(size).fill(1),
      elevation: new Float32Array(size),
      component: new Int32Array(size).fill(1),
      mainComponent: 1,
    };
  return { game, grid, pathfinder: new KernelPathfinder(grid) };
}

for (const team of ["pku", "thu"] as Team[])
  for (const difficulty of ["standard", "hard"] as const) {
    const { game, pathfinder } = fixture(team);
    const plan = planStrategicOrders(
      game,
      team,
      difficulty,
      pathfinder,
      () => 0.5,
    );
    assert.equal(
      plan.camps.length,
      1,
      `${team}/${difficulty}: did not build a useful detour`,
    );
    const camp = plan.camps[0],
      source = game.sites[camp.sourceId],
      target = game.sites[camp.targetId];
    const approach = pathfinder.find(source.x, source.z, camp.x, camp.z);
    assert.equal(
      firstEnemyControlSite(game, team, approach),
      undefined,
      "camp approach still enters an enemy control area",
    );
    assert.equal(
      firstEnemyControlSite(game, team, camp.pathToTarget, target.id),
      undefined,
      "camp onward route still crosses the strongpoint",
    );
    assert.ok(camp.count! >= 12);
    assert.ok(
      !plan.orders.some((order) => order.sourceId === camp.sourceId),
      "same column assigned to detour and direct attack",
    );
  }

{
  const { game, pathfinder } = fixture("thu");
  game.resources.thu = 40;
  const plan = planStrategicOrders(
    game,
    "thu",
    "standard",
    pathfinder,
    () => 0.5,
  );
  assert.equal(plan.camps.length, 0);
  assert.equal(
    plan.reserveForCamp,
    80,
    "research spending will starve a feasible camp",
  );
}
{
  const { game, pathfinder } = fixture("pku", 3);
  const plan = planStrategicOrders(
    game,
    "pku",
    "standard",
    pathfinder,
    () => 0.5,
  );
  assert.equal(
    plan.camps.length,
    0,
    "built a fake bypass in a corridor with no room to flank",
  );
  assert.equal(plan.reserveForCamp, 0, "reserved funds for an impossible camp");
}
{
  const { game, pathfinder } = fixture("pku");
  game.sites[1].team = "pku";
  assert.equal(
    planStrategicOrders(game, "pku", "standard", pathfinder, () => 0.5).camps
      .length,
    0,
    "unnecessary camp on an already safe route",
  );
}

for (const reserve of [0, 80]) {
  const game = makeFreshGame(),
    team = "pku",
    id = researchIdsForTeam(team)[0],
    definition = RESEARCH_DEFINITIONS[id];
  const before = definition.deploymentCost + 79;
  game.resources[team] = before;
  game.campaign.research.production[team][id] = {
    id: "paid-batch",
    researchId: id,
    startedAt: 0,
    completesAt: 0,
  };
  const stock = game.campaign.research.stockpile[team][id];
  progressResearchAndProduction(
    game,
    () => 1,
    undefined,
    () => reserve,
  );
  assert.equal(
    game.campaign.research.stockpile[team][id],
    stock + definition.productionQuantity,
    "lost an already paid production batch",
  );
  assert.equal(
    game.resources[team],
    reserve ? before : before - definition.deploymentCost,
  );
  assert.equal(Boolean(game.campaign.research.production[team][id]), !reserve);
}

{
  const { game, grid } = fixture("thu", 24, 200);
  const kernel = createKernel(game, {
    aiTeams: ["thu"],
    navGrid: grid,
    mutateInitialState: true,
    fixedStepMilliseconds: 500,
  });
  kernel.dispatch({ type: "set_time_scale", value: 16 });
  let created = false,
    arrived = false,
    departed = false;
  for (let step = 0; step < 180 && !departed; step++) {
    kernel.advanceOnly(250);
    const camps = game.sites.filter(
      (site) => site.type === "camp" && site.team === "thu" && !site.destroyed,
    );
    created ||= camps.length > 0;
    for (const camp of camps)
      for (const unit of game.units.filter(
        (unit) => unit.team === "thu" && unit.siteId === camp.id,
      )) {
        arrived = true;
        if (unit.targetSiteId != null && unit.targetSiteId !== camp.id)
          departed = true;
      }
  }
  assert.ok(
    created && arrived && departed,
    `camp lifecycle incomplete: ${JSON.stringify({ created, arrived, departed })}`,
  );
}
{
  const { game, pathfinder } = fixture("thu");
  game.sites.push({
    ...game.sites[0],
    id: 3,
    name: "enemy staging camp",
    team: "pku",
    type: "camp",
    x: 1.5,
    z: 9.5,
    navX: 1.5,
    navZ: 9.5,
    orderTarget: 0,
  });
  const raid = planStrategicOrders(
    game,
    "thu",
    "hard",
    pathfinder,
    () => 0.5,
  ).orders.find((order) => order.targetId === 3);
  assert.ok(
    raid && raid.count >= 8,
    "nearby hard-AI reserve ignored an exposed enemy staging camp",
  );
  game.units.push(
    ...Array.from({ length: 150 }, (_, id) => ({
      ...game.units[0],
      id: 1000 + id,
      team: "pku" as const,
      siteId: 3,
      x: 1.5,
      z: 9.5,
      targetSiteId: undefined,
    })),
  );
  assert.ok(
    !planStrategicOrders(
      game,
      "thu",
      "hard",
      pathfinder,
      () => 0.5,
    ).orders.some((order) => order.targetId === 3),
    "raided an overwhelmingly defended camp with an inadequate reserve",
  );
  for (const unit of game.units.filter((unit) => unit.id >= 1000)) {
    unit.x = 35.5;
    unit.z = 20.5;
    unit.tx = 35.5;
    unit.tz = 20.5;
  }
  assert.ok(
    planStrategicOrders(game, "thu", "hard", pathfinder, () => 0.5).orders.some(
      (order) => order.targetId === 3,
    ),
    "troops far away from their registered camp were still counted as its garrison",
  );
}
{
  const { game, pathfinder } = fixture("thu");
  const camp = {
    ...game.sites[0],
    id: 3,
    name: "assembling camp",
    type: "camp" as const,
    x: 1.5,
    z: 9.5,
    navX: 1.5,
    navZ: 9.5,
    orderTarget: 2,
    orderOwner: "ai" as const,
    orderPurpose: "combat" as const,
    orderIssuedAt: 0,
  };
  game.sites.push(camp);
  game.units[0].targetSiteId = 3;
  planStrategicOrders(game, "thu", "hard", pathfinder, () => 0.5);
  assert.equal(
    camp.orderTarget,
    2,
    "camp goal expired while its assigned column was still approaching",
  );
}
{
  const { game, pathfinder } = fixture("thu");
  game.campaign.ai.difficultyByTeam = { pku: "hard", thu: "hard" };
  for (const id of [3, 4]) {
    game.sites.push({
      ...game.sites[0],
      id,
      name: "ready camp " + id,
      type: "camp",
      x: 5.5,
      z: 8.5 + (id - 3) * 6,
      navX: 5.5,
      navZ: 8.5 + (id - 3) * 6,
      orderTarget: 2,
      orderOwner: "ai",
      orderPurpose: "combat",
      orderIssuedAt: 0,
    });
    game.units.push(
      ...Array.from({ length: 200 }, (_, n) => ({
        ...game.units[0],
        id: id * 1000 + n,
        siteId: id,
        targetSiteId: undefined,
      })),
    );
  }
  const plan = planStrategicOrders(
    game,
    "thu",
    "hard",
    pathfinder,
    () => 0.5,
    true,
  );
  const campAttacks = plan.orders.filter((order) => order.sourceId >= 3);
  assert.ok(
    campAttacks.length <= 1,
    "camps bypassed the commander's wave budget",
  );
  assert.ok(
    campAttacks.every(
      (order) => order.purpose === "probe" && order.count <= 13,
    ),
    "a huge camp concentration was disguised as a small probe",
  );
}
console.log(
  "PASS: standard/hard camps; safe approach and onward route; no fake bypass or double dispatch; reserved funds; troops arrive and depart",
);

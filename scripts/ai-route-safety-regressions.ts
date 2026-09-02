import assert from "node:assert/strict";
import { makeFreshGame } from "../src/game/create-game";
import { planStrategicOrders } from "../src/game/kernel/ai";
import {
  KernelPathfinder,
  type KernelNavGrid,
} from "../src/game/kernel/navigation";
import type { Team } from "../src/game/types";

function scenario(
  team: Team,
  available: number,
  alternative: boolean,
  committed = 0,
) {
  const game = makeFreshGame(),
    enemy: Team = team === "pku" ? "thu" : "pku";
  const baseSite = game.sites[0],
    baseUnit = game.units[0];
  game.sites = [
    {
      ...baseSite,
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
      ...baseSite,
      id: 1,
      name: "defended approach",
      team: enemy,
      type: "teaching" as const,
      x: 11.5,
      z: 1.5,
      navX: 11.5,
      navZ: 1.5,
      stance: "defend" as const,
    },
    {
      ...baseSite,
      id: 2,
      name: "empty production",
      team: enemy,
      type: "dorm" as const,
      x: 30.5,
      z: 1.5,
      navX: 30.5,
      navZ: 1.5,
    },
    ...(alternative
      ? [
          {
            ...baseSite,
            id: 3,
            name: "open flank",
            team: enemy,
            type: "teaching" as const,
            x: 1.5,
            z: 20.5,
            navX: 1.5,
            navZ: 20.5,
          },
        ]
      : []),
  ];
  game.units = [
    ...Array.from({ length: available }, (_, id) => ({
      ...baseUnit,
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
    ...Array.from({ length: 30 }, (_, index) => ({
      ...baseUnit,
      id: available + index,
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
    ...Array.from({ length: committed }, (_, index) => ({
      ...baseUnit,
      id: available + 30 + index,
      team,
      siteId: 0,
      x: 5.5,
      z: 1.5,
      tx: 11.5,
      tz: 1.5,
      hp: 100,
      strength: 1,
      targetSiteId: 1,
    })),
  ];
  game.campaign.warUnlocked = true;
  game.campaign.elapsedHours = 100;
  game.resources = { pku: 0, thu: 0 };
  const size = 40 * 24;
  const grid: KernelNavGrid = {
    cell: 1,
    cols: 40,
    rows: 24,
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
  return planStrategicOrders(
    game,
    team,
    "standard",
    new KernelPathfinder(grid),
    () => 0.5,
  );
}

for (const team of ["pku", "thu"] as Team[]) {
  const flank = scenario(team, 20, true);
  assert.equal(
    flank.orders.find((o) => o.sourceId === 0)?.targetId,
    3,
    `${team}: attacked a weak remote target through a stronger blocking force`,
  );
  assert.equal(
    scenario(team, 20, false).orders.length,
    0,
    `${team}: launched an understrength column instead of waiting for reinforcement`,
  );
  const strong = scenario(team, 60, false).orders.find((o) => o.sourceId === 0);
  assert.equal(
    strong?.targetId,
    2,
    `${team}: sufficient force was never allowed to advance`,
  );
  assert.ok(
    strong.count >= 51,
    `${team}: allocated for the empty destination rather than the defended approach`,
  );
  const reinforced = scenario(team, 21, false, 30).orders.find(
    (o) => o.sourceId === 0,
  );
  assert.equal(
    reinforced?.targetId,
    2,
    `${team}: ignored forces already committed to the same encounter`,
  );
  assert.equal(
    reinforced.count,
    21,
    `${team}: failed to top up the force at the actual encounter`,
  );
}

console.log(
  "PASS: both factions assess intercepted defenders, choose an open flank, wait when understrength, and account for committed reinforcement",
);

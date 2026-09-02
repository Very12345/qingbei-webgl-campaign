import assert from "node:assert/strict";
import { makeFreshGame } from "../src/game/create-game";
import {
  createKernel,
  KernelPathfinder,
  type KernelNavGrid,
} from "../src/game/kernel";
import { captureSite } from "../src/game/kernel/capture";
import { simulateKernelMovement } from "../src/game/kernel/movement";
import {
  assignUnitMovement,
  prepareUnitMovement,
} from "../src/game/kernel/orders";
import type { GameData, Team } from "../src/game/types";

function fixture() {
  const game = makeFreshGame(),
    template = game.sites[0],
    unit = game.units[0];
  const points = [
    [1.5, 1.5],
    [11.5, 1.5],
    [21.5, 1.5],
    [32.5, 1.5],
    [2.5, 2.5],
    [39.5, 2.5],
  ];
  game.sites = points.map(([x, z], id) => ({
    ...template,
    id,
    name: ["A", "B", "C", "D", "E", "F"][id],
    team: id === 0 || id === 4 ? "pku" : "thu",
    type: "teaching",
    stance: "defend",
    x,
    z,
    navX: x,
    navZ: z,
    orderTarget: undefined,
    orderOwner: undefined,
    plannedOrderTargets: {},
    plannedOrderPaths: {},
    plannedOrderOwners: {},
  }));
  game.units = [0, 4].map((source, id) => ({
    ...unit,
    id,
    team: "pku",
    siteId: source,
    x: points[source][0],
    z: points[source][1],
    tx: points[source][0],
    tz: points[source][1],
    targetSiteId: undefined,
    movementOrder: undefined,
    path: undefined,
  }));
  const size = 150,
    grid: KernelNavGrid = {
      cell: 1,
      cols: 50,
      rows: 3,
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
  const pathfinder = new KernelPathfinder(grid);
  return { game, grid, pathfinder };
}

function noAutomaticSiteOrders(game: GameData) {
  for (const id of [1, 2]) {
    assert.equal(
      game.sites[id].orderTarget,
      undefined,
      `intermediate ${id} acquired an automatic line`,
    );
    assert.equal(
      game.sites[id].plannedOrderTargets?.pku,
      undefined,
      `intermediate ${id} acquired a capture plan`,
    );
  }
}

{
  const { game, grid, pathfinder } = fixture(),
    kernel = createKernel(game, {
      navGrid: grid,
      aiTeams: [],
      mutateInitialState: true,
    });
  kernel.dispatch({
    type: "order_site",
    team: "pku",
    sourceId: 0,
    targetId: 3,
  });
  kernel.dispatch({
    type: "order_site",
    team: "pku",
    sourceId: 4,
    targetId: 5,
  });
  kernel.step(1);
  assert.deepEqual(
    game.units.map((u) => u.targetSiteId),
    [1, 1],
  );
  noAutomaticSiteOrders(game);
  for (const id of [1, 2]) {
    captureSite(game, game.sites[id], game.units, pathfinder, () =>
      assert.fail("interception created a site follow-up"),
    );
    simulateKernelMovement(game, 0, 1, pathfinder, grid);
    assert.deepEqual(
      game.units.map((u) => u.movementOrder?.goalSiteId),
      [3, 5],
    );
    assert.deepEqual(
      game.units.map((u) => u.movementOrder?.sourceSiteId),
      [0, 4],
    );
    assert.equal(game.sites[0].orderTarget, 3);
    assert.equal(game.sites[4].orderTarget, 5);
    noAutomaticSiteOrders(game);
  }
  assert.equal(game.units[0].targetSiteId, 3);
  // Capturing D finishes only the army whose actual order ends at D.
  captureSite(game, game.sites[3], game.units, pathfinder, () =>
    assert.fail("unexpected follow-up"),
  );
  simulateKernelMovement(game, 0, 1, pathfinder, grid);
  assert.equal(game.units[0].movementOrder, undefined);
  assert.equal(game.units[1].targetSiteId, 5);
  assert.equal(game.units[1].movementOrder?.goalSiteId, 5);
}

{
  const { game, grid, pathfinder } = fixture(),
    kernel = createKernel(game, {
      navGrid: grid,
      aiTeams: [],
      mutateInitialState: true,
    });
  kernel.dispatch({
    type: "order_site",
    team: "pku",
    sourceId: 0,
    targetId: 3,
  });
  kernel.step(1);
  captureSite(game, game.sites[1], [game.units[0]], pathfinder, () =>
    assert.fail("unexpected follow-up"),
  );
  simulateKernelMovement(game, 0, 1, pathfinder, grid);
  assert.equal(game.units[0].siteId, 1);
  kernel.dispatch({
    type: "configure_site",
    team: "pku",
    siteId: 0,
    orderTarget: null,
  });
  kernel.step(1);
  assert.equal(game.units[0].movementOrder, undefined);
  assert.equal(game.units[0].targetSiteId, undefined);
  kernel.run(8, 250);
  noAutomaticSiteOrders(game);
  assert.equal(game.sites[0].orderTarget, undefined, "cancelled line returned");
}

{
  const { game, grid, pathfinder } = fixture(),
    kernel = createKernel(game, {
      navGrid: grid,
      aiTeams: [],
      mutateInitialState: true,
    });
  kernel.dispatch({
    type: "order_site",
    team: "pku",
    sourceId: 0,
    targetId: 3,
  });
  kernel.step(1);
  kernel.dispatch({
    type: "configure_site",
    team: "pku",
    siteId: 0,
    orderTarget: 5,
  });
  kernel.step(1);
  simulateKernelMovement(game, 0, 1, pathfinder, grid);
  assert.equal(
    game.units[0].movementOrder?.goalSiteId,
    5,
    "redrawing retained an old final target",
  );
  // A separate unit command is not cancelled by cancelling its former source.
  kernel.dispatch({
    type: "order_units",
    team: "pku",
    unitIds: [0],
    targetId: 3,
  });
  kernel.step(1);
  assert.equal(game.units[0].movementOrder?.sourceSiteId, undefined);
  kernel.dispatch({
    type: "configure_site",
    team: "pku",
    siteId: 0,
    orderTarget: null,
  });
  kernel.step(1);
  assert.equal(game.units[0].movementOrder?.goalSiteId, 3);
  // Local explicit stop also must not reconstitute the old movement order.
  game.units[0].targetSiteId = undefined;
  game.units[0].path = undefined;
  game.units[0].tx = game.units[0].x;
  game.units[0].tz = game.units[0].z;
  simulateKernelMovement(game, 0, 1, pathfinder, grid);
  assert.equal(game.units[0].movementOrder, undefined);
}

{
  const { game, grid, pathfinder } = fixture(),
    kernel = createKernel(game, {
      navGrid: grid,
      aiTeams: [],
      mutateInitialState: true,
    });
  kernel.dispatch({
    type: "configure_site",
    team: "pku",
    siteId: 1,
    plannedOrderTarget: 5,
  });
  kernel.dispatch({
    type: "order_site",
    team: "pku",
    sourceId: 0,
    targetId: 3,
  });
  kernel.step(1);
  assert.equal(
    game.sites[1].plannedOrderTargets?.pku,
    5,
    "automatic interception overwrote a drawn future line",
  );
  kernel.dispatch({
    type: "configure_site",
    team: "pku",
    siteId: 1,
    stance: "guard",
  });
  kernel.step(1);
  assert.equal(
    game.sites[1].plannedOrderTargets?.pku,
    5,
    "unrelated site update erased a future line",
  );
  captureSite(
    game,
    game.sites[1],
    [game.units[0]],
    pathfinder,
    (team, sourceId, targetId) =>
      kernel.dispatch({ type: "order_site", team, sourceId, targetId }),
  );
  kernel.step(1);
  assert.equal(
    game.sites[1].orderTarget,
    5,
    "explicit post-capture line did not survive capture",
  );
  simulateKernelMovement(game, 0, 1, pathfinder, grid);
  assert.equal(
    game.units[0].movementOrder?.goalSiteId,
    3,
    "transiting squad was recruited into another command",
  );
}

for (const team of ["pku", "thu"] as Team[]) {
  const { game, grid } = fixture();
  game.sites[0].team = team;
  game.sites[4].team = team;
  game.units.forEach((u) => (u.team = team));
  game.campaign.freezeUntil = { pku: 1e9, thu: 1e9 };
  game.sites[0].orderTarget = 4; // Old saves and direct local controls may omit owner.
  const kernel = createKernel(game, {
    navGrid: grid,
    aiTeams: [],
    mutateInitialState: true,
  });
  assert.equal(game.sites[0].orderOwner, "player");
  kernel.dispatch({ type: "set_time_scale", value: 64 });
  kernel.run(84, 250); // > 10 game days, 40 production cycles.
  assert.ok(game.campaign.elapsedHours > 240);
  assert.equal(
    game.sites[0].orderTarget,
    4,
    `${team}: persistent reinforcement line expired`,
  );
  const saved = kernel.snapshot().state,
    resumed = createKernel(saved, { navGrid: grid, aiTeams: [] });
  resumed.run(50, 250);
  assert.equal(
    resumed.snapshot().state.sites[0].orderTarget,
    4,
    "saving/resuming lost the line",
  );
}

{
  const { game, grid } = fixture();
  game.sites[0].orderTarget = 3;
  game.sites[1].plannedOrderTargets = { pku: 3 };
  game.sites[1].plannedOrderOwners = { pku: "player" };
  game.sites[1].plannedOrderPaths = {
    pku: [
      [2.5, 1.5],
      [32.5, 1.5],
    ],
  };
  game.units[0].targetSiteId = 1;
  game.sites[2].plannedOrderTargets = { pku: 5 };
  game.sites[2].plannedOrderOwners = { pku: "player" };
  game.sites[2].plannedOrderPaths = {
    pku: [
      [22.5, 1.5],
      [34.5, 2.5],
    ],
  };
  createKernel(game, { navGrid: grid, aiTeams: [], mutateInitialState: true });
  assert.equal(
    game.sites[1].plannedOrderTargets?.pku,
    undefined,
    "legacy implicit line retained",
  );
  assert.equal(
    game.units[0].movementOrder?.goalSiteId,
    3,
    "legacy transit goal lost",
  );
  assert.equal(
    game.sites[2].plannedOrderTargets?.pku,
    5,
    "legacy explicit line erased",
  );
}

{
  const { game, grid, pathfinder } = fixture(),
    kernel = createKernel(game, {
      navGrid: grid,
      aiTeams: [],
      mutateInitialState: true,
    });
  kernel.dispatch({
    type: "order_site",
    team: "pku",
    sourceId: 0,
    targetId: 3,
  });
  kernel.step(1);
  game.sites[0].team = "thu";
  simulateKernelMovement(game, 0, 1, pathfinder, grid);
  assert.equal(
    game.units[0].movementOrder,
    undefined,
    "lost source still controlled transit orders",
  );
  assert.equal(game.units[0].targetSiteId, undefined);
}

{
  const { game, pathfinder } = fixture();
  game.sites[0].orderTarget = 3;
  game.sites[0].orderOwner = "player";
  let attempts = 0;
  const unavailable = {
    find: () => {
      attempts++;
      return [];
    },
  } as unknown as KernelPathfinder;
  assignUnitMovement(
    game,
    game.units[0],
    {
      goalSiteId: 3,
      goalX: 32.5,
      goalZ: 1.5,
      sourceSiteId: 0,
      purpose: "combat",
    },
    unavailable,
  );
  assert.equal(prepareUnitMovement(game, game.units[0], unavailable), false);
  assert.equal(attempts, 1, "unreachable route retried every frame");
  assert.equal(
    game.sites[0].orderTarget,
    3,
    "path failure deleted logical intent",
  );
  game.campaign.elapsedHours += 0.5;
  assert.equal(prepareUnitMovement(game, game.units[0], pathfinder), true);
  assert.equal(game.units[0].targetSiteId, 1);
  assert.equal(game.sites[0].orderTarget, 3);
}

{
  const { game, grid } = fixture();
  game.campaign.freezeUntil = { pku: 1e9, thu: 1e9 };
  game.campaign.warUnlocked = true;
  const kernel = createKernel(game, {
    navGrid: grid,
    aiTeams: ["pku"],
    mutateInitialState: true,
  });
  kernel.dispatch({
    type: "configure_site",
    team: "pku",
    siteId: 0,
    orderTarget: 3,
  });
  kernel.dispatch({ type: "set_time_scale", value: 64 });
  kernel.run(84, 250);
  assert.equal(
    game.sites[0].orderTarget,
    3,
    "AI housekeeping erased an explicit player line",
  );
  assert.equal(game.sites[0].orderOwner, "player");
}

console.log(
  "PASS: immutable site intent; multi-hop interception; independent transit goals; cancellation/retargeting; explicit future lines; ten-day persistence; save migration and source ownership",
);

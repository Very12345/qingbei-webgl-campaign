import { makeFreshGame } from "../src/game/create-game";
import { createKernel } from "../src/game/kernel";
import { strict as assert } from "node:assert";

const state = makeFreshGame();
state.campaign.warUnlocked = true;
const kernel = createKernel(state, { aiTeams: ["pku", "thu"] });
kernel.dispatch({ type: "set_time_scale", value: 16 });
for (let index = 0; index < 200; index++) kernel.step(250);
const snapshot = kernel.snapshot(),
  sites = { pku: 0, thu: 0 },
  population = { pku: 0, thu: 0 };
for (const site of snapshot.state.sites)
  if (!site.destroyed) sites[site.team]++;
for (const unit of snapshot.state.units)
  population[unit.team] += unit.strength;
console.log(
  JSON.stringify(
    {
      revision: snapshot.revision,
      elapsedHours: snapshot.elapsedHours,
      sites,
      population,
      deaths: snapshot.state.deaths,
      intent: snapshot.state.campaign.ai.intent,
    },
    null,
    2,
  ),
);

const commandState = makeFreshGame();
commandState.campaign.warUnlocked = true;
const commandKernel = createKernel(commandState),
  source = commandState.sites.find((site) =>
    commandState.units.some(
      (unit) => unit.team === "pku" && unit.siteId === site.id,
    ),
  )!,
  target = commandState.sites.find((site) => site.team === "thu")!;
commandKernel.networkFull();
commandKernel.dispatch({
  type: "order_site",
  team: "pku",
  sourceId: source.id,
  targetId: target.id,
  count: 5,
});
commandKernel.advanceOnly(100);
let commandSnapshot = commandKernel.snapshot();
assert.equal(
  commandSnapshot.state.units.filter(
    (unit) => unit.team === "pku" && unit.targetSiteId === target.id,
  ).length,
  5,
  "authoritative order action did not select exactly five units",
);
commandKernel.dispatch({
  type: "configure_site",
  team: "pku",
  siteId: source.id,
  orderTarget: null,
});
commandKernel.advanceOnly(100);
commandSnapshot = commandKernel.snapshot();
assert.equal(
  commandSnapshot.state.sites[source.id].orderTarget,
  undefined,
  "authoritative site action did not clear the route",
);
const delta = commandKernel.networkDelta();
assert.equal(delta.type, "state_delta");
assert.ok(delta.revision > 0);

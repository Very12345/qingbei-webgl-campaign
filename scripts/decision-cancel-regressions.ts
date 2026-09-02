import assert from "node:assert/strict";
import { DECISIONS } from "../src/campaign-content";
import { makeFreshGame } from "../src/game/create-game";
import { decisionAvailable } from "../src/game/decisions";
import { createKernel } from "../src/game/kernel";
import { applyProgressionAction } from "../src/game/kernel/progression";

const game = makeFreshGame();
game.resources.pku = 1000;
const decision = DECISIONS.find(
  (d) => d.team === "pku" && decisionAvailable(d, game.campaign),
)!;
assert.ok(decision);
assert.equal(
  applyProgressionAction(game, {
    type: "decision_start",
    team: "pku",
    id: decision.id,
  }),
  true,
);
const first = { ...game.campaign.decisions.active.pku! };
const cancel = {
  type: "decision_cancel" as const,
  team: "pku" as const,
  id: first.id,
  startedAt: first.startedAt,
  instanceId: first.instanceId,
};
const charged = 1000 - decision.cost;
assert.equal(applyProgressionAction(game, { ...cancel, team: "thu" }), false);
assert.equal(
  applyProgressionAction(game, { ...cancel, instanceId: undefined }),
  false,
);
assert.equal(game.resources.pku, charged);
assert.equal(applyProgressionAction(game, cancel), true);
assert.equal(game.resources.pku, charged + Math.floor(decision.cost * 0.5));
assert.equal(game.campaign.decisions.active.pku, null);
assert.equal(applyProgressionAction(game, cancel), false);
assert.equal(game.resources.pku, charged + Math.floor(decision.cost * 0.5));

// Same decision restarted in the very same simulation tick is a new instance.
assert.equal(
  applyProgressionAction(game, {
    type: "decision_start",
    team: "pku",
    id: decision.id,
  }),
  true,
);
const second = { ...game.campaign.decisions.active.pku! };
assert.equal(second.startedAt, first.startedAt);
assert.notEqual(second.instanceId, first.instanceId);
const beforeReplay = game.resources.pku;
assert.equal(applyProgressionAction(game, cancel), false);
assert.equal(game.resources.pku, beforeReplay);
assert.deepEqual(game.campaign.decisions.active.pku, second);
game.campaign.elapsedHours = second.completesAt;
assert.equal(
  applyProgressionAction(game, { ...cancel, instanceId: second.instanceId }),
  false,
);
assert.equal(game.resources.pku, beforeReplay, "completed decision refunded");

const state = makeFreshGame();
state.resources.pku = 1000;
const kernel = createKernel(state, { aiTeams: [] });
kernel.dispatch({ type: "decision_start", team: "pku", id: decision.id });
kernel.step(1);
const active = kernel.snapshot().state.campaign.decisions.active.pku!;
kernel.networkFull();
kernel.dispatch({
  type: "decision_cancel",
  team: "pku",
  id: active.id,
  startedAt: active.startedAt,
  instanceId: active.instanceId,
});
kernel.step(1);
const delta = kernel.networkDelta();
assert.equal(delta.campaign?.decisions.active.pku, null);
assert.equal(
  delta.resources.pku,
  1000 - decision.cost + Math.floor(decision.cost * 0.5),
);
console.log(
  "PASS: authoritative cancel; one refund; team checks; same-tick replay protection; expired decisions; network delta",
);

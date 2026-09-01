import { makeFreshGame } from "../src/game/create-game";
import { createKernel } from "../src/game/kernel";

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

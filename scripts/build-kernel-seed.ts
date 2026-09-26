import { gzipSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { makeFreshGame } from "../src/game/create-game";
import { osmRegions } from "../src/osm-map-data";
import { buildKernelNavGrid } from "../src/game/kernel/build-navigation";

const state = makeFreshGame(),
  deterministicSeed = 0x51a7c0de;
state.campaign.ai.seed = deterministicSeed;
state.campaign.ai.seedByTeam = {
  pku: deterministicSeed ^ 0x504b5501,
  thu: deterministicSeed ^ 0x54485501,
};
state.campaign.ai.personality = {
  pku: "学术联动",
  thu: "工程统筹",
};

const grid = buildKernelNavGrid(osmRegions.main),
  serializableGrid = {
    ...grid,
    blocked: [...grid.blocked],
    building: [...grid.building],
    water: [...grid.water],
    road: [...grid.road],
    elevation: [...grid.elevation],
    component: [...grid.component],
  },
  seed = JSON.stringify({ state, navGrid: serializableGrid });
writeFileSync(
  resolve("native-server/kernel_seed.json.gz"),
  gzipSync(Buffer.from(seed), { level: 9 }),
);

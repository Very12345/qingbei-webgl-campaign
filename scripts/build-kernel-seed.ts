import { gzipSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { makeFreshGame } from "../src/game/create-game";
import { osmRegions } from "../src/osm-map-data";
import { buildKernelNavGrid } from "../src/game/kernel/build-navigation";

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
  seed = JSON.stringify({ state: makeFreshGame(), navGrid: serializableGrid });
writeFileSync(
  resolve("native-server/kernel_seed.json.gz"),
  gzipSync(Buffer.from(seed), { level: 9 }),
);

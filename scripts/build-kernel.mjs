import { build } from "esbuild";
import { resolve } from "node:path";

await build({
  entryPoints: [resolve("src/game/kernel/index.ts")],
  outfile: resolve("native-server/kernel_bundle.js"),
  bundle: true,
  format: "iife",
  globalName: "QingbeiKernel",
  platform: "neutral",
  target: "es2015",
  minify: true,
  legalComments: "none",
});

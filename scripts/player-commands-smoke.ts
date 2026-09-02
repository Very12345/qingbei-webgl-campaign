import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { collectPlayerCommands } from "../src/game/player-commands";
import { makeFreshGame } from "../src/game/create-game";

const game=makeFreshGame(),source=game.sites.find(s=>s.team==="pku")!;
const before=JSON.stringify(game);
assert.deepEqual(collectPlayerCommands(game,"pku",{}),{sites:[],units:[]});
assert.equal(JSON.stringify(game),before);
for(const unit of game.units){unit.x+=1;unit.tx+=2;} // mimic a renderer correction
assert.deepEqual(collectPlayerCommands(game,"pku",{}),{sites:[],units:[]});
source.orderTarget=game.sites.find(s=>s.team==="pku"&&s.id!==source.id)!.id;
const route=collectPlayerCommands(game,"pku",{siteIds:[source.id]});
assert.equal(route.sites.length,1);assert.equal(route.units.length,0);
assert.equal(route.sites[0].orderTarget,source.orderTarget);
const selected=game.units.find(u=>u.team==="pku")!, enemy=game.units.find(u=>u.team==="thu")!;
assert.equal(collectPlayerCommands(game,"pku",{unitIds:[selected.id,enemy.id]}).units.length,1);
const app=readFileSync("app/game-3d.tsx","utf8"),engine=readFileSync("src/game/engine/use-battlefield.ts","utf8");
assert.ok(!app.includes("clientUnitCommandPendingSinceRef"));
assert.ok(!app.includes("clientSiteCommandSignaturesRef"));
assert.ok(engine.includes("if (isRemoteGuest()) return; // Visual refresh"));
assert.ok(app.includes('intent: "player"'));
console.log("PASS: idle/render changes send zero commands; explicit routes, units, and authoritative guards verified");

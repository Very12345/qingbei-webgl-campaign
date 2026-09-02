import assert from "node:assert/strict";
import { NetworkHealth } from "../src/game/network-health";
import { createSportMarkings } from "../src/game/engine/sport-markings";
import { makeFreshGame } from "../src/game/create-game";
import { createKernel } from "../src/game/kernel";

const health = new NetworkHealth();
health.start(1000);
health.state(1100,1);
assert.equal(health.warning(5000),null);
assert.match(health.warning(7100)!,/6秒/); // no incoming callback required
health.state(12000,1);
assert.match(health.warning(12000)!,/10秒/); // live packets do not prove simulation is moving
health.state(12100,1.1);
assert.equal(health.warning(12100),null);
health.connected=false;
assert.match(health.warning(12101)!,/断开/);
assert.equal(health.warning(12101,true),null);
health.reset();
assert.equal(health.warning(99999),null);

const paint=createSportMarkings([{points:[[0,0],[1,0],[1,1]],closed:true}],3);
assert.ok(paint.material.isMeshStandardMaterial);
assert.equal(paint.material.emissive.getHex(),0);
assert.ok(paint.receiveShadow);
const positions=paint.geometry.getAttribute("position"),normals=paint.geometry.getAttribute("normal");
for(let i=0;i<positions.count;i++) { assert.equal(positions.getY(i),3); assert.ok(normals.getY(i)>.99); }
paint.geometry.dispose();paint.material.dispose();

for(const team of ["pku","thu"] as const){
  const game=makeFreshGame(), own=game.sites.filter(s=>s.team===team&&s.type!=="camp");
  const [source,target,aiSource]=own;
  const kernel=createKernel(game,{aiTeams:[],mutateInitialState:true});
  kernel.dispatch({type:"configure_site",team,siteId:source.id,orderTarget:target.id,dispatchRatio:.6});
  kernel.dispatch({type:"set_time_scale",value:16});
  kernel.step(1);
  assert.equal(source.orderOwner,"player");
  aiSource.orderTarget=target.id;aiSource.orderPurpose="combat";aiSource.orderOwner="ai";
  kernel.run(30,250); // > 18 game hours, crosses several cleanup/production cycles
  assert.equal(source.orderTarget,target.id,`${team}: player reinforcement route was removed`);
  assert.equal(source.orderOwner,"player");
  assert.equal(aiSource.orderTarget,undefined,"AI temporary route policy was changed");
  kernel.dispatch({type:"configure_site",team,siteId:source.id,orderTarget:null});kernel.step(1);
  assert.equal(source.orderTarget,undefined,"explicit cancellation must still work");
}
console.log("PASS: shadow-receiving markings; silent/stalled/recovered simulation; persistent player routes for both teams");

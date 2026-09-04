import assert from "node:assert/strict";
import { makeFreshGame } from "../src/game/create-game";
import { createNetworkEventFeed } from "../src/game/network-events";
import { assignUnitMovement, prepareUnitMovement } from "../src/game/kernel/orders";
import { createKernel, type KernelPathfinder } from "../src/game/kernel";
import { buildKernelNavGrid } from "../src/game/kernel/build-navigation";
import { osmRegions } from "../src/osm-map-data";

{
  const campaign = makeFreshGame().campaign, feed = createNetworkEventFeed();
  const event = {id: "new-event", title:"新事件", effect:"效果", atHour:84};
  campaign.elapsedHours = 84;
  campaign.eventHistory = [event] as typeof campaign.eventHistory;
  assert.equal(feed(campaign, "room1").length, 1, "opening event hidden");
  assert.equal(feed(structuredClone(campaign), "room1").length, 0, "snapshot replayed popup");
  campaign.elapsedHours = 90;
  campaign.eventHistory.push({...campaign.eventHistory[0], id:"delayed", atHour:85});
  assert.equal(feed(campaign, "room1")[0].id, "delayed", "coalesced delta lost an event");
  assert.equal(feed(campaign, "room2").length, 0, "old history replayed on late join");
  campaign.elapsedHours = 84; campaign.eventHistory = [campaign.eventHistory[0]];
  assert.equal(feed(campaign, "room2").length, 1, "restored timeline could not show events");
}
{
  const game = makeFreshGame(), template = game.sites[0];
  game.campaign.serverOpening = "standard";
  const points = [[0,10],[20,10],[10,8],[5,3]];
  game.sites = points.map(([x,z],id)=>({...template,id,team:id===0?"pku":"thu",type:"teaching",stance:"guard",x,z,navX:x,navZ:z}));
  const unit = {...game.units[0],team:"pku" as const,siteId:0,x:0,z:10,tx:0,tz:10};
  game.units = [unit];
  const corridor = Array.from({length:21},(_,x)=>[x,10] as [number,number]);
  const calls: number[][]=[];
  const finder = {find(x:number,z:number,tx:number,tz:number){
    calls.push([x,z,tx,tz]);
    if(tx===20 && tz===10) return z===10 ? corridor : [[5,3],[20,10]];
    if(x===0 && tx===10 && tz===8) return [[5,3],[10,8]];
    return [[tx,tz]];
  }} as KernelPathfinder;
  assignUnitMovement(game,unit,{goalSiteId:1,goalX:20,goalZ:10,purpose:"combat"},finder);
  assert.equal(unit.targetSiteId,2);
  assert.ok(!unit.path?.some(([x,z])=>x===5&&z===3),"interception rerouted through C");
  assert.ok(!calls.some(([x,,tx,tz])=>x===0&&tx===10&&tz===8),"global route to auxiliary target");
  // Saving between encounter and continuation preserves the original corridor.
  const saved = structuredClone(game), resumed = saved.units[0];
  saved.sites[2].team="pku";resumed.x=10;resumed.z=8;
  prepareUnitMovement(saved,resumed,finder);
  assert.equal(resumed.targetSiteId,1,"off-corridor C became a nested goal");
  assert.ok(!resumed.path?.some(([x,z])=>x===5&&z===3));
  assert.equal(saved.sites[2].orderTarget,undefined,"auxiliary capture created a persistent line");
}
const navGrid = buildKernelNavGrid(osmRegions.main);
for (const team of ["pku","thu"] as const) {
  const game=makeFreshGame(); game.campaign.ai.seedByTeam={pku:12345,thu:54321};
  const before=game.units.length;
  const kernel=createKernel(game,{navGrid,aiTeams:[team],serverOpening:"blitz",mutateInitialState:true,fixedStepMilliseconds:100});
  assert.equal(game.campaign.ai.difficultyByTeam?.[team],"standard");
  assert.ok(game.units.length>=before);
  kernel.dispatch({type:"set_time_scale",value:4});
  let attackers=0;
  while(game.campaign.elapsedHours<108) {
    kernel.advanceOnly(100);
    assert.ok(game.campaign.ai.nextStrategicAt[team]-game.campaign.elapsedHours<=4.01);
    attackers=Math.max(attackers,game.units.filter(u=>u.team===team&&u.targetSiteId!=null&&game.sites[u.targetSiteId]?.team!==team).length);
  }
  assert.ok(attackers>=10,`${team} blitz standard AI stayed idle for a day`);
  const restored=createKernel(kernel.snapshot().state,{navGrid,aiTeams:[team],mutateInitialState:true});
  assert.equal(restored.snapshot().state.campaign.serverOpening,"blitz");
}
console.log("PASS: remote event delivery/dedup; bounded interception and saved corridor; both standard blitz armies mobilize");

import assert from "node:assert/strict";
import { makeFreshGame } from "../src/game/create-game";
import { createKernel } from "../src/game/kernel";
import { spawnKernelUnits } from "../src/game/kernel/production";
import { dispatchPlayerRoutes } from "../src/game/kernel/player-dispatch";
import type { GameData, Stance, Team } from "../src/game/types";

function fixture(team: Team = "pku", count = 20, stance: Stance = "defend", ratio = .4) {
  const game = makeFreshGame(), site = game.sites[0], unit = game.units[0];
  game.sites = [0,1,2,3].map(id=>({...site,id,team:id===3?(team==="pku"?"thu":"pku"):team,
    name:`site${id}`,type:"teaching",stance,dispatchRatio:ratio,x:id*10,z:0,navX:id*10,navZ:0}));
  game.units = Array.from({length:count},(_,id)=>({...unit,id,team,siteId:0,x:0,z:0,tx:0,tz:0}));
  game.campaign.elapsedHours = 90;
  game.campaign.lastProductionCycle = 15;game.campaign.lastDiningCycle = 7;
  game.campaign.warUnlocked = true;
  const kernel = createKernel(game,{aiTeams:[],mutateInitialState:true});
  return {game,kernel,team};
}
const stationed = (game: GameData, siteId=0) => game.units.filter(u=>u.siteId===siteId && u.targetSiteId==null && !u.movementOrder);
function route(kernel: ReturnType<typeof createKernel>, team:Team, siteId=0,targetId=1) {
  kernel.dispatch({type:"configure_site",team,siteId,orderTarget:targetId});kernel.step(1);
}

{
  const {game,kernel,team}=fixture("pku",20,"defend",1);
  route(kernel,team);
  assert.equal(game.sites[0].dispatchRatio,.45,"displayed dispatch ratio exceeded the stance limit");
  assert.equal(stationed(game).length,11);
}

for(const team of ["pku","thu"] as const) {
  const {game,kernel}=fixture(team);
  route(kernel,team);
  assert.equal(stationed(game).length,12,"initial order ignored the defense reserve / ratio");
  kernel.run(1000,1);
  assert.equal(stationed(game).length,12,"frame scans drained the same reserves repeatedly");
  spawnKernelUnits(game,game.sites[0],team,1);
  kernel.step(1);
  assert.equal(stationed(game).length,15,"new soldiers did not dispatch immediately at the existing ratio");
  assert.ok(game.campaign.elapsedHours<91,"test accidentally waited for production");
  const snapshot=kernel.snapshot().state;
  const restored=createKernel(snapshot,{aiTeams:[],mutateInitialState:true});restored.run(1000,1);
  assert.equal(stationed(snapshot).length,15,"restoring a save redispatched the reserve");
  kernel.dispatch({type:"configure_site",team,siteId:0,orderTarget:1,displayName:"renamed"});kernel.step(1);
  assert.equal(stationed(game).length,15,"renaming/repeating an order creates new dispatch credit");
  kernel.dispatch({type:"configure_site",team,siteId:0,stance:"guard",dispatchRatio:.7});kernel.step(1);
  assert.equal(stationed(game).length,5,"loosening stance did not release a share of reserves");
  kernel.run(1000,1);assert.equal(stationed(game).length,5);
  kernel.dispatch({type:"configure_site",team,siteId:0,stance:"defend",dispatchRatio:.4});kernel.step(1);
  assert.equal(stationed(game).length,5,"tightening defense must not dispatch more reserves");
  kernel.dispatch({type:"mobilize",team,stance:"standby"});kernel.step(1);
  assert.equal(stationed(game).length,0,"mobilization did not update the automatic dispatch policy");
}

{
  const {game,kernel,team}=fixture("pku",4);
  route(kernel,team);assert.equal(stationed(game).length,4,"minimum defense garrison was drained");
  spawnKernelUnits(game,game.sites[0],team,1);kernel.step(1);
  assert.equal(stationed(game).length,6);
  kernel.run(1000,1);assert.equal(stationed(game).length,6);
}
{
  const {game,kernel,team}=fixture("pku",0,"standby",.5);
  route(kernel,team);
  const template=makeFreshGame().units[0];
  for(let id=0;id<10;id++) {
    game.units.push({...template,id,team,siteId:0,x:0,z:0,tx:0,tz:0});kernel.step(1);
  }
  assert.equal(stationed(game).length,5,"single arrivals must accumulate fractional quotas instead of rounding every soldier up");
}
{
  const {game,kernel,team}=fixture("pku",1,"standby",1);
  game.sites[1].type="camp";
  route(kernel,team,1,2);route(kernel,team,0,1);
  kernel.run(300,100);
  assert.ok(game.campaign.elapsedHours<96);
  assert.equal(game.units[0].siteId,1);
  assert.equal(game.units[0].targetSiteId,2,"arrival at a camp waited for the next six-hour cycle");
  assert.equal(game.units[0].movementOrder?.sourceSiteId,1);
}
{
  const {game,kernel,team}=fixture("pku",20);
  for(const unit of game.units) {unit.x=5;unit.tx=5;}
  route(kernel,team);assert.equal(game.units.filter(u=>u.targetSiteId!=null).length,0,"remote units were counted as a site's garrison");
  for(const unit of game.units) {unit.x=0;unit.tx=0;}
  kernel.step(1);assert.equal(stationed(game).length,12);
  kernel.dispatch({type:"configure_site",team,siteId:0,orderTarget:null});kernel.step(1);
  spawnKernelUnits(game,game.sites[0],team,1);kernel.step(1);
  assert.ok(game.units.every(u=>u.targetSiteId==null),"cancelled route resumed when new troops arrived");
}
{
  const {game,team}=fixture("pku",10,"standby",.5);
  game.sites[0].orderOwner="player";game.sites[0].orderTarget=1;
  let sent=0;
  dispatchPlayerRoutes(game,()=>0);
  assert.equal(game.sites[0].playerDispatch!.credit,5,"failed pathfinding consumed the budget");
  game.campaign.elapsedHours+=.1;
  dispatchPlayerRoutes(game,(_source,units)=>{sent+=units.length;for(const u of units)u.targetSiteId=1;return units.length;});
  assert.equal(sent,5);
  dispatchPlayerRoutes(game,()=>{throw Error("same troops were dispatched twice");});
}
{
  const {game,kernel,team}=fixture("pku",10,"standby",.5);
  for(const unit of game.units.slice(0,6)) {unit.transport="bus";unit.transportGroupId="bus-one";}
  route(kernel,team);
  assert.ok(game.units.slice(0,6).every(u=>u.targetSiteId==null),"bus passengers were split across orders");
}
{
  const {game}=fixture("pku",10,"standby",.4);
  game.sites[0].orderOwner="player";game.sites[0].orderTarget=1;
  dispatchPlayerRoutes(game,()=>0);
  game.units.splice(0,8);
  game.campaign.elapsedHours+=.1;
  dispatchPlayerRoutes(game,()=>0);
  assert.ok(Math.abs(game.sites[0].playerDispatch!.credit-.8)<1e-8,"dead garrison left extra dispatch credit behind");
}
console.log("PASS: immediate initial/new/arriving dispatch; stance reserves; stable fractional quotas; save/retry/cancel; camps; bus groups");

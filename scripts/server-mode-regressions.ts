import assert from "node:assert/strict";
import { makeFreshGame } from "../src/game/create-game";
import { createKernel } from "../src/game/kernel";
import { captureSite } from "../src/game/kernel/capture";
import { buildKernelNavGrid } from "../src/game/kernel/build-navigation";
import { osmRegions } from "../src/osm-map-data";
import { processKernelEvents } from "../src/game/kernel/events";

const navGrid = buildKernelNavGrid(osmRegions.main);
{
  const game=makeFreshGame(), kernel=createKernel(game,{aiTeams:[],mutateInitialState:true});
  kernel.networkFull();kernel.networkDelta();
  const [source,target]=game.sites.filter(s=>s.team==="pku");
  kernel.dispatch({type:"configure_site",team:"pku",siteId:source.id,orderTarget:target.id});kernel.step(1);
  kernel.networkFull(); // another player's join must not acknowledge state for everybody
  assert.ok(kernel.networkDelta().sites.some(s=>s.id===source.id && s.orderTarget===target.id),"a second player's full snapshot swallowed the first player's route update");
}
for (const opening of ["standard", "blitz"] as const) {
  const game = makeFreshGame(), kernel = createKernel(game,{navGrid,aiTeams:[],serverOpening:opening,mutateInitialState:true});
  assert.equal(game.campaign.elapsedHours,opening === "blitz" ? 84 : 0);
  assert.equal(game.campaign.warUnlocked,opening === "blitz");
  const before = new Map(game.units.map(u=>[u.id,[u.x,u.z]]));
  const original=kernel.networkFull().game;
  kernel.step(100);
  assert.equal(game.units.length,original.units.length,"skipped preparation must not grant retroactive production");
  for (const unit of game.units) {
    assert.deepEqual([unit.x,unit.z],before.get(unit.id),"uncommanded initial soldier moved");
    assert.deepEqual([unit.tx,unit.tz],[unit.x,unit.z]);
    assert.equal(unit.targetSiteId,undefined);
  }
  assert.deepEqual(kernel.battleStats().kills,{pku:0,thu:0});
  assert.deepEqual(kernel.battleStats().captures,{pku:0,thu:0});
}

for (const team of ["pku","thu"] as const) {
  const game=makeFreshGame(), enemy=team === "pku" ? "thu" : "pku", template=game.sites[0];
  game.sites=[
    {...template,id:0,team,type:"camp",name:"camp",x:0,z:0,navX:0,navZ:0,dispatchRatio:1},
    {...template,id:1,team,type:"teaching",name:"friend",x:5,z:0,navX:5,navZ:0},
    {...template,id:2,team:enemy,type:"teaching",name:"enemy",x:60,z:0,navX:60,navZ:0},
  ];
  const unit={...game.units[0],id:0,team,siteId:0,x:0,z:0,tx:0,tz:0};
  game.units=[unit];
  const kernel=createKernel(game,{aiTeams:[],mutateInitialState:true,serverOpening:"standard"});
  kernel.dispatch({type:"configure_site",team,siteId:0,orderTarget:1});kernel.step(1);
  assert.equal(unit.targetSiteId,1);
  const reinforcement={...unit,id:1,x:0,z:0,tx:0,tz:0,targetSiteId:undefined,movementOrder:undefined,path:undefined};
  game.units.push(reinforcement);
  game.campaign.elapsedHours=6;
  kernel.step(1);
  assert.equal(reinforcement.targetSiteId,1,"a later arrival at a human camp must follow the persistent line");
  assert.equal(game.sites[0].orderOwner,"player");
  kernel.dispatch({type:"configure_site",team,siteId:0,orderTarget:null});kernel.step(1);
  assert.equal(game.sites[0].orderTarget,undefined);

  const site=game.sites[2];
  captureSite(game,site,[],null,()=>{}); // no occupiers does not count
  assert.equal(game.campaign.battleStats!.captures[team],0);
  const attacker={...unit,id:2,team,siteId:1,targetSiteId:2};
  captureSite(game,site,[attacker],null,()=>{});
  assert.equal(game.campaign.battleStats!.captures[team],1);
  captureSite(game,site,[attacker],null,()=>{});
  assert.equal(game.campaign.battleStats!.captures[team],1,"holding a site is not a new capture");
  captureSite(game,site,[{...attacker,team:enemy}],null,()=>{});
  captureSite(game,site,[attacker],null,()=>{});
  assert.equal(game.campaign.battleStats!.captures[team],2,"recaptures must count");

  // External school arrivals used to erase the highest-x allied site's
  // player route after issuing their own one-off movement.
  for (const hour of [120,240,360]) {
    const eventGame=makeFreshGame();
    for (const source of eventGame.sites.filter(s=>s.team===team)) {
      source.orderTarget=eventGame.sites.find(s=>s.team!==team)!.id;
      source.orderOwner="player";
    }
    eventGame.units=eventGame.units.filter(u=>u.team!==team);
    const before=new Map(eventGame.sites.filter(s=>s.team===team).map(s=>[s.id,s.orderTarget]));
    eventGame.campaign.elapsedHours=hour;eventGame.campaign.warUnlocked=true;
    processKernelEvents(eventGame,{issueOrder:(_team,sourceId,targetId)=>{
      const source=eventGame.sites[sourceId];
      if(source.orderOwner==="player") return 0;
      source.orderTarget=targetId;return 1;
    }});
    for (const [id,target] of before) assert.equal(eventGame.sites[id].orderTarget,target,`event at ${hour}h erased a player route`);
  }
}
{
  const game=makeFreshGame(), template=game.sites[0], unit=game.units[0];
  game.sites=[{...template,id:0,team:"pku",type:"teaching",x:0,z:0,navX:0,navZ:0},
    {...template,id:1,team:"thu",type:"teaching",x:30,z:0,navX:30,navZ:0}];
  game.units=[{...unit,id:0,team:"pku",siteId:0,targetSiteId:1,x:30,z:0,tx:30,tz:0,hp:.001,strength:3},
    {...unit,id:1,team:"thu",siteId:1,x:30,z:0,tx:30,tz:0,hp:.001,strength:2}];
  const kernel=createKernel(game,{aiTeams:[],mutateInitialState:true,serverOpening:"blitz"});
  kernel.step(250);
  assert.deepEqual(kernel.battleStats().kills,{pku:2,thu:3},"kills must count people, not squad objects or HP damage");
  kernel.step(250);
  assert.deepEqual(kernel.battleStats().kills,{pku:2,thu:3},"dead soldiers scored twice");
}
console.log("PASS: stationary deployment; blitz opening; persistent camp reinforcements; event and join route preservation; kills and captures");

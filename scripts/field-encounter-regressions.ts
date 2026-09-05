import assert from "node:assert/strict";
import {makeFreshGame} from "../src/game/create-game";
import {createKernel} from "../src/game/kernel";
import {FieldEncounters} from "../src/game/kernel/encounters";
import {simulateKernelMovement} from "../src/game/kernel/movement";
import {KernelPathfinder, navIndex, type KernelNavGrid} from "../src/game/kernel/navigation";
import {createFieldContactFeed} from "../src/game/field-contact-feed";
import {CALENDAR_EVENTS} from "../src/campaign-content";
import {TACTICAL_EVENTS} from "../src/tactical-events";
import {EVENT_CARDS} from "../src/game/events/event-cards";

const contactOf = (game: ReturnType<typeof makeFreshGame>, id: number) => {
  const values = game.campaign.fieldEncounters!.unitStates;
  for (let i = 0; i + 3 < values.length; i += 4) if (values[i] === id) return values.slice(i, i + 4);
};

function fixture(pku=1,thu=1) {
  const game=makeFreshGame(),site=game.sites[0],unit=game.units[0],size=64*64;
  const grid:KernelNavGrid={cols:64,rows:64,cell:.7,minX:0,minZ:0,blocked:new Uint8Array(size),building:new Uint8Array(size),
    water:new Uint8Array(size),road:new Uint8Array(size).fill(1),elevation:new Float32Array(size),component:new Int32Array(size),mainComponent:0};
  game.sites=[{...site,id:0,name:'home pku',team:'pku',x:.35,z:14.35,navX:.35,navZ:14.35,type:'teaching'},
    {...site,id:1,name:'home thu',team:'thu',x:40.25,z:14.35,navX:40.25,navZ:14.35,type:'teaching'}];
  game.units=Array.from({length:pku+thu},(_,id)=>({...unit,id,team:id<pku?'pku':'thu',siteId:id<pku?0:1,
    x:14.35,z:14.35,tx:14.35,tz:14.35,hp:100,supply:100,morale:100,strength:1,targetSiteId:undefined,movementOrder:undefined}));
  game.campaign.elapsedHours=90;game.campaign.warUnlocked=true;game.campaign.lastProductionCycle=15;game.campaign.lastDiningCycle=7;
  game.campaign.statuses=[];game.campaign.decisions.completed=[];
  game.campaign.firedEvents=[...new Set([...Object.keys(EVENT_CARDS),...CALENDAR_EVENTS.map(e=>e.id),...TACTICAL_EVENTS.map(e=>e.id)])];
  game.campaign.fieldEncounters={version:1,tick:0,nextId:1,alerts:[],unitStates:[]};
  game.campaign.battleStats={kills:{pku:0,thu:0},captures:{pku:0,thu:0}};
  const encounters=new FieldEncounters(grid),dead=new Set<number>(),excluded=new Set<number>();
  const step=(hours:number)=>{game.campaign.elapsedHours=90+hours;encounters.step(game,excluded,dead);};
  return {game,grid,encounters,dead,excluded,step};
}

{
  const {game,step}=fixture(80,20); const seed=game.campaign.ai.seed;
  step(0);step(.05);assert.ok(game.units.every(u=>u.hp===100));step(.101);
  assert.ok(game.units.slice(0,80).every(u=>u.hp===99.5));
  assert.ok(game.units.slice(80).every(u=>u.hp===98));
  assert.equal(game.campaign.fieldEncounters!.alerts.length,1);
  assert.equal(game.campaign.ai.seed,seed);
  assert.ok(game.units.every(u=>u.supply===100&&u.morale===100&&!u.retreating));
  const hp=game.units.map(u=>u.hp);step(1);step(6);assert.deepEqual(game.units.map(u=>u.hp),hp);
  step(6.102);assert.equal(game.campaign.fieldEncounters!.alerts.length,2,'continuous confrontation must honor the 6-hour cooldown');
}
{
  const {game,grid,step}=fixture();game.units[0].x=14.69;game.units[1].x=14.71;
  step(0);game.units.forEach(u=>u.x+=.7);step(.05);step(.101);
  assert.equal(game.campaign.fieldEncounters!.alerts.length,1,'grid boundaries reset warning time');
  assert.notEqual(navIndex(grid,game.units[0].x,game.units[0].z),navIndex(grid,game.units[1].x,game.units[1].z));
}
{
  const {game,step}=fixture();step(0);game.units[1].x+=5;step(.05);step(.2);
  assert.ok(game.units.every(u=>u.hp===100),'fast pass was forcibly engaged');
  game.units[1].x=game.units[0].x;step(.21);assert.ok(game.units.every(u=>u.hp===100),'separation retained old warning time');
  step(.32);assert.ok(game.units.every(u=>u.hp<100));
}
for(const obstacle of ['wall','river','diagonal'] as const) {
  const {game,grid}=fixture();const cell=navIndex(grid,14.35,14.35);
  game.units[1].x+=obstacle==='diagonal'?.7:1.4;
  if(obstacle==='diagonal')game.units[1].z+=.7;
  else if(obstacle==='wall')grid.building[cell+1]=1;
  else {grid.water[cell+1]=1;grid.road[cell+1]=0;}
  const engine=new FieldEncounters(grid);
  engine.step(game,new Set(),new Set());game.campaign.elapsedHours+=.2;engine.step(game,new Set(),new Set());
  assert.equal(game.campaign.fieldEncounters!.alerts.length,0,obstacle);
}
{
  const {game,grid}=fixture();const cell=navIndex(grid,14.35,14.35);
  grid.water[cell]=1;grid.road[cell]=0;
  let engine=new FieldEncounters(grid);engine.step(game,new Set(),new Set());game.campaign.elapsedHours+=.2;engine.step(game,new Set(),new Set());
  assert.ok(game.units.every(u=>u.hp===100),'non-road water participated');
  grid.road[cell]=1;engine=new FieldEncounters(grid);engine.step(game,new Set(),new Set());game.campaign.elapsedHours+=.2;engine.step(game,new Set(),new Set());
  assert.equal(game.campaign.fieldEncounters!.alerts.length,1,'road crossing cannot encounter');
}
for(const kind of ['retreat','freeze','formal','prewar'] as const) {
  const {game,excluded,step}=fixture();
  if(kind==='retreat')game.units[0].retreating=true;
  if(kind==='freeze')game.campaign.freezeUntil.pku=100;
  if(kind==='formal')excluded.add(game.units[0].id);
  if(kind==='prewar')game.campaign.warUnlocked=false;
  step(0);step(.2);assert.equal(game.campaign.fieldEncounters!.alerts.length,0,kind);
}
{
  const {game,grid}=fixture();game.campaign.freezeUntil.pku=90.3;
  const kernel=createKernel(game,{navGrid:grid,aiTeams:[],mutateInitialState:true});
  for(let i=0;i<32;i++)kernel.advanceOnly(100);
  assert.equal(game.campaign.fieldEncounters!.alerts.length,1,'contact scan did not wake after a freeze expired');
}
{
  const {game,step,encounters}=fixture(1,2);
  game.units[1].x+=.7;game.units[2].x-=.7;
  step(0);step(.2);step(.4);
  assert.equal(game.campaign.fieldEncounters!.alerts.length,1,'transitive neighbor chain engaged twice');
  assert.equal(game.units.filter(u=>u.hp<100).length,2);
  assert.ok(encounters.stats.candidateChecks<=encounters.stats.groups*5);
}
{
  const {game,step,dead}=fixture(20,20);game.units.forEach(u=>u.hp=.1);
  step(0);step(.2);
  assert.equal(dead.size,2,'more than one casualty per side');
  for(const team of ['pku','thu'])assert.equal(game.units.filter(u=>u.team===team&&dead.has(u.id)).reduce((s,u)=>s+u.strength,0),1);
  assert.ok(game.units.filter(u=>!dead.has(u.id)).every(u=>u.hp===.1),'casualty cap healed a wounded unit');
}
{
  const {game,step,dead}=fixture();game.units.forEach(u=>{u.strength=3;u.hp=.1;});
  step(0);step(.2);assert.equal(dead.size,0);assert.ok(game.units.every(u=>u.strength===3&&u.hp===.1),'aggregate unit was split/healed');
}
{
  const {game,step}=fixture();game.units[0].transport='bike';game.units[0].transportModel='pku_bike';
  const stock=JSON.stringify(game.campaign.research.stockpile);
  step(0);step(.2);assert.equal(game.units[0].transport,'bike');assert.equal(game.units[0].transportModel,'pku_bike');
  assert.equal(JSON.stringify(game.campaign.research.stockpile),stock);
}
{
  const {game,step}=fixture();
  game.campaign.statuses.push({id:'local-defense',title:'test',team:'pku',until:100,attack:.5,movement:1,morale:1,production:1,defense:2,supplyUse:1,healing:1,riverMovement:1,unitIds:[0]});
  step(0);step(.2);assert.ok(game.units.every(u=>u.hp===99),'unit-scoped attack/defense modifiers were not applied');
}
{
  const {game,step}=fixture(3,3);
  game.units.slice(0,3).forEach((u,i)=>{u.transport='bus';u.transportGroupId='bus';u.x=14.35+i*.7;});
  step(0);step(.2);
  assert.equal(game.campaign.fieldEncounters!.alerts.length,1);
  const passengers=game.units.slice(0,3);
  assert.ok(passengers.every(u=>{const c=contactOf(game,u.id)!;return u.transportGroupId==='bus'&&c[3]===90.7&&c[2]===96.2;}));
}
{
  const {game,grid,step}=fixture();step(0);step(.2);
  const saved=JSON.parse(JSON.stringify(game));
  const restored=new FieldEncounters(grid);saved.campaign.elapsedHours=91;
  const hp=saved.units.map((u:any)=>u.hp);
  saved.units.forEach((u:any)=>{u.targetSiteId=undefined;u.movementOrder=undefined;u.x+=.7;});
  restored.step(saved,new Set(),new Set());assert.deepEqual(saved.units.map((u:any)=>u.hp),hp);
  assert.ok(saved.units.every((u:any)=>contactOf(saved,u.id)?.[2]===96.2));
}
{
  const {game,grid}=fixture(); const finder=new KernelPathfinder(grid);
  const unit=game.units[0];unit.tx=20.65;unit.tz=14.35;game.campaign.fieldEncounters!.unitStates=[unit.id,null,96,91];
  game.campaign.fieldEncounters!.activeSlowUntil=91;
  const normal=structuredClone(game);normal.campaign.fieldEncounters!.unitStates=[];normal.campaign.fieldEncounters!.activeSlowUntil=0;
  simulateKernelMovement(game,.1,1,finder,grid);simulateKernelMovement(normal,.1,1,finder,grid);
  assert.ok(Math.abs((unit.x-14.35)/(normal.units[0].x-14.35)-.85)<1e-9);
}
{
  const {game,grid}=fixture();game.units.forEach(u=>{u.targetSiteId=u.team==='pku'?1:0;});
  game.units[0].x=12.95;game.units[1].x=15.75;
  const kernel=createKernel(game,{navGrid:grid,aiTeams:[],mutateInitialState:true});
  const goals=game.units.map(u=>u.targetSiteId);
  for(let i=0;i<30;i++)kernel.advanceOnly(100);
  assert.equal(game.campaign.fieldEncounters!.alerts.length,1);
  assert.deepEqual(game.units.map(u=>u.targetSiteId),goals);
  assert.ok(game.units.every(u=>u.movementOrder?.goalSiteId===goals[u.id]));
  assert.ok(game.sites.every(s=>s.orderTarget==null),'encounter created a site order');
  assert.equal(game.campaign.battleAlerts.length,0);
}
{
  const {game,grid}=fixture();
  const kernel=createKernel(game,{navGrid:grid,aiTeams:[],mutateInitialState:true});
  kernel.networkFull();
  for(let i=0;i<12;i++)kernel.advanceOnly(100);
  const delta=kernel.networkDelta();
  assert.equal(delta.units.length,0,'HP-only field damage sent full unit records');
  assert.deepEqual(delta.unitHp,[[0,2,980]]);
}
{
  const {game,grid}=fixture();
  const kernel=createKernel(game,{navGrid:grid,aiTeams:[],mutateInitialState:true});
  for(let i=0;i<350;i++)kernel.advanceOnly(100);
  assert.equal(game.campaign.fieldEncounters!.alerts.length,2,'cached stationary groups missed the cooldown deadline');
  assert.equal(kernel.performanceProfile().fieldEncounters?.groups,2,'stationary groups rebuilt their spatial index');
}
{
  const {game,grid}=fixture(20,20);game.units.forEach(u=>u.hp=.1);
  const kernel=createKernel(game,{navGrid:grid,aiTeams:[],mutateInitialState:true});
  for(let i=0;i<12;i++)kernel.advanceOnly(100);
  assert.deepEqual(game.campaign.battleStats!.kills,{pku:1,thu:1});
  assert.deepEqual(game.deaths,{pku:1,thu:1});
  const liveIds=new Set(game.units.map(unit=>unit.id));
  const timers=game.campaign.fieldEncounters!.unitStates;
  for(let offset=0;offset<timers.length;offset+=4)assert.ok(liveIds.has(timers[offset]!),`dead timer ${timers[offset]} remained in save state`);
  for(let i=0;i<12;i++)kernel.advanceOnly(100);
  assert.deepEqual(game.campaign.battleStats!.kills,{pku:1,thu:1},'duplicate casualty credit');
}
{
  const {game,grid}=fixture();game.sites[0].x=game.sites[0].navX=14.35;
  const kernel=createKernel(game,{navGrid:grid,aiTeams:[],mutateInitialState:true});
  for(let i=0;i<12;i++)kernel.advanceOnly(100);
  assert.equal(game.campaign.fieldEncounters!.alerts.length,0,'home garrison joined a field encounter');
}
{
  const {game,grid}=fixture(4,1);game.sites[1].x=game.sites[1].navX=14.35;
  game.units.filter(u=>u.team==='pku').forEach(u=>u.targetSiteId=1);
  const kernel=createKernel(game,{navGrid:grid,aiTeams:[],mutateInitialState:true});
  for(let i=0;i<12;i++)kernel.advanceOnly(100);
  assert.equal(game.campaign.fieldEncounters!.alerts.length,0,'unhit formal participants received field damage');
}
{
  const {game,grid}=fixture();
  game.sites.push({...game.sites[1],id:2,name:'求真书院',type:'target',x:15.75,navX:15.75},
    {...game.sites[0],id:3,name:'北京大学图书馆',x:15.75,navX:15.75});
  game.campaign.firedEvents=game.campaign.firedEvents.filter(id=>!['qz_approach','pku_librarian'].includes(id));
  const kernel=createKernel(game,{navGrid:grid,aiTeams:[],mutateInitialState:true});
  for(let i=0;i<40;i++)kernel.advanceOnly(100);
  assert.ok(game.campaign.fieldEncounters!.alerts.length>0);
  assert.ok(!game.campaign.firedEvents.includes('qz_approach')&&!game.campaign.firedEvents.includes('pku_librarian'),'field contact activated a site event');
}
{
  const {game,grid}=fixture();delete game.campaign.fieldEncounters;
  const old=createKernel(game,{navGrid:grid,aiTeams:[]});assert.equal(old.snapshot().state.campaign.fieldEncounters,undefined);
  const fresh=createKernel(game,{navGrid:grid,aiTeams:[],fieldEncounters:'light-v1'});assert.equal(fresh.snapshot().state.campaign.fieldEncounters?.version,1);
  const restored=createKernel(fresh.snapshot().state,{navGrid:grid,aiTeams:[]});assert.equal(restored.snapshot().state.campaign.fieldEncounters?.version,1);
}
{
  const {game,step}=fixture();step(0);step(.2);const feed=createFieldContactFeed();
  assert.equal(feed(game.campaign).length,1);assert.equal(feed(structuredClone(game.campaign)).length,0);
  const delayed=createFieldContactFeed();game.campaign.elapsedHours+=2;assert.equal(delayed(game.campaign).length,0);
}
console.log('PASS: light contacts, reaction/fast pass, terrain, priorities, no chain, casualty cap, vehicle preservation, cooldown/save, original orders, event isolation and visual dedup');

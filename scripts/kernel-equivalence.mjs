// Differential audit against an immutable released bundle. Checks every frame,
// not just the ending score. Optional offline save stays outside the repository.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import vm from 'node:vm';
const [beforePath,afterPath,seedPath,savePath]=process.argv.slice(2);
if(!seedPath)throw Error('Usage: node kernel-equivalence.mjs before.js after.js kernel_seed.json.gz [offline-save.json]');
const versions=[beforePath,afterPath].map(path=>vm.runInNewContext(readFileSync(path,'utf8')+';QingbeiKernel'));
const {state:seed,navGrid}=JSON.parse(gunzipSync(readFileSync(seedPath)));
const same=(a,b,label)=>{
 const left=JSON.stringify(a),right=JSON.stringify(b);
 if(left===right)return;
 let offset=0;while(offset<left.length&&left[offset]===right[offset])offset++;
 assert.fail(`${label}: first difference at ${offset}: ${left.slice(Math.max(0,offset-50),offset+100)} / ${right.slice(Math.max(0,offset-50),offset+100)}`);
};
function pair(initial,options) {
 const games=versions.map(()=>structuredClone(initial));
 return {games,kernels:versions.map((v,i)=>v.createKernel(games[i],{navGrid,...options,mutateInitialState:true}))};
}
{
 const {games,kernels}=pair(seed,{aiTeams:[]});
 kernels.forEach(k=>k.networkFull());
 const fields={
  id:[999999,0],team:['thu','pku'],x:[0,.0049,.0051,-.0051],z:[.0049,.0051],tx:[1,1.0051],tz:[-1,-1.0051],
  hp:[30,30.049,30.051],supply:[10,10.049,10.051],strength:[2,3],siteId:[0,1],targetSiteId:[undefined,0,1],
  attackModifier:[undefined,1.0049,1.0051,NaN],moveModifier:[undefined,1.0051,NaN],morale:[undefined,40,40.051],
  retreating:[false,true],transportOutsidePenalty:[false,true],skin:[undefined,'ustc','fdu','unknown'],
  transport:[undefined,'bus','bike'],transportGroupId:[undefined,'','group'],transportModel:[undefined,'pku_yellow_bike'],
  movementOrder:[undefined,{team:'pku',purpose:'combat',goalSiteId:2,goalX:1.234,goalZ:-2.345},
    {team:'pku',purpose:'combat',goalSiteId:3,goalX:1.234,goalZ:-2.345},
    {team:'pku',purpose:'combat',goalSiteId:3,goalX:1.239,goalZ:-2.345},
    {team:'pku',purpose:'combat',goalSiteId:3,goalX:1.239,goalZ:-2.8},undefined],
 };
 for(const [field,values] of Object.entries(fields)) {
  const original=games.map(g=>structuredClone(g.units[0][field]));
  for(const value of values) {
   games.forEach(g=>{g.units[0][field]=structuredClone(value);});
   same(kernels[0].networkDelta(),kernels[1].networkDelta(),`wire field ${field}`);
   same(kernels[0].networkDelta(),kernels[1].networkDelta(),`repeated wire field ${field}`);
  }
  // A prior NaN must not force every later field to emit an update and mask a
  // missing comparison. Start each field from a clean wire baseline.
  games.forEach((g,i)=>{g.units[0][field]=original[i];});
  same(kernels[0].networkDelta(),kernels[1].networkDelta(),`reset wire field ${field}`);
 }
 games.forEach(g=>g.units.push({...g.units[1],id:888888}));
 same(kernels[0].networkDelta(),kernels[1].networkDelta(),'new unit');
 games.forEach(g=>g.units.splice(0,2));
 same(kernels[0].networkDelta(),kernels[1].networkDelta(),'removed units');
 console.log('PASS: every compact wire field, rounding boundaries, repeated updates, create/remove');
}
const cases=[['standard',seed,{aiTeams:['thu'],serverOpening:'standard'},16],['blitz',seed,{aiTeams:['thu'],serverOpening:'blitz'},4]];
if(savePath){const save=JSON.parse(readFileSync(savePath,'utf8'));cases.push(['late-save',save.state??save.State,{aiTeams:['thu']},4]);}
for(const [name,initial,options,speed] of cases) {
 let {games,kernels}=pair(initial,options);
 kernels.forEach(k=>{k.dispatch({type:'set_time_scale',value:speed});k.networkFull();});
 for(let frame=0;frame<360;frame++) {
  const current=games[0],sources=current.sites.filter(s=>s.team==='pku'&&!s.destroyed);
  const source=sources[frame%sources.length],target=current.sites[(frame*7+19)%current.sites.length];
  if(source&&target&&!target.destroyed&&frame%11===0) {
   const action={type:'configure_site',team:'pku',siteId:source.id,orderTarget:frame%33===0?null:target.id,
     stance:['defend','guard','standby'][frame%3],dispatchRatio:[.4,.7,1][frame%3]};
   kernels.forEach(k=>k.dispatch(structuredClone(action)));
  }
  if(frame%37===0) games.forEach(g=>{
   // Same-length in-place changes must invalidate any cached decision result.
   g.campaign.decisions.completed[0]=frame%74===0?'pku_garden_defense':'pku_haidian_routes';
  });
  if(frame%29===0) {
   const id=current.sites.find(s=>s.playerDispatch?.observedUnits.length)?.id;
   if(id!=null)games.forEach(g=>{
    const ledger=g.sites[id].playerDispatch;
    ledger.observedUnits.reverse();ledger.observedUnits[0][1]+=.25;
    ledger.credit+=.125;
    if(ledger.committedUnitIds.length)ledger.committedUnitIds[0]=999998;
   });
  }
  if(frame%43===0)games.forEach(g=>{
   const source=g.sites.find(s=>s.team==='pku'&&s.orderOwner==='player'&&!s.destroyed);
   const unit=g.units.find(u=>u.team==='pku'&&u.hp>0);
   if(source&&unit){unit.siteId=source.id;unit.x=source.navX??source.x;unit.z=source.navZ??source.z;unit.tx=unit.x;unit.tz=unit.z;unit.targetSiteId=undefined;unit.movementOrder=undefined;unit.path=undefined;unit.strength=1.25;}
  });
  if(frame===127)games.forEach(g=>{
   const ledger=g.sites.find(s=>s.playerDispatch)?.playerDispatch;
   if(ledger){ledger.observedUnits=null;ledger.committedUnitIds=null;}
  });
  const elapsed=[100,250,0,50][frame%4];
  kernels.forEach(k=>k.advanceOnly(elapsed));
  same(kernels[0].snapshot(),kernels[1].snapshot(),`${name} frame ${frame} state`);
  if(frame%2===0)same(kernels[0].networkDelta(),kernels[1].networkDelta(),`${name} frame ${frame} delta`);
  if(frame%67===0)same(kernels[0].networkFull(),kernels[1].networkFull(),`${name} frame ${frame} joining peer`);
  if(frame===179) {
   games=kernels.map(k=>JSON.parse(JSON.stringify(k.snapshot().state)));
   kernels=versions.map((v,i)=>v.createKernel(games[i],{navGrid,aiTeams:options.aiTeams,mutateInitialState:true}));
   kernels.forEach(k=>{k.dispatch({type:'set_time_scale',value:speed});k.networkFull();});
  }
 }
 console.log(`PASS: ${name}, 360 exact state frames + delta/full snapshots, in-place edits, orders and save/load`);
}

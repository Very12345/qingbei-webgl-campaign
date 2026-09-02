// Disposable local native kernel: no accounts, cookies or production data.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
vm.runInThisContext(readFileSync(new URL('./static/protocol.js',import.meta.url),'utf8'));
const base='http://127.0.0.1:17991',team=process.argv[2]||'pku';
const info=await fetch(base+'/api/info').then(r=>r.json());
const ws=new WebSocket(base.replace('http','ws')+'/ws?role=guest&room='+info.roomCode+'&team='+team);
let phase='boot',original,source,target,resolve,reject,sentOrders=0,ghostOrders=0;
const done=new Promise((a,b)=>{resolve=a;reject=b}), positions=new Map();
const bridge=QingbeiProtocol.createBridge({team,send:raw=>{const p=JSON.parse(JSON.parse(raw).data);if(p.type==='client_commands'){sentOrders++;if(p.intent!=='player')ghostOrders++;}ws.send(raw);}});
const relay=p=>bridge.outgoing(JSON.stringify({type:'relay',peerId:'host',data:JSON.stringify(p)}));
const timer=setTimeout(()=>reject(Error('authority regression timed out')),12000);
ws.onmessage=e=>{try{
 bridge.incoming(e.data);const w=JSON.parse(e.data);
 if(w.type==='ready'){relay({type:'hello',identity:{id:'authority-check',nickname:'authority-check',team,host:false}});return;}
 if(w.type!=='relay')return;const p=JSON.parse(w.data);
 if(p.type==='state'&&phase==='boot'){
  original=p.game.sites.filter(s=>s.team===team&&!s.destroyed);
  const old=original.map(s=>({id:s.id,stance:s.stance,dispatchRatio:s.dispatchRatio??.6,orderTarget:s.orderTarget??null,plannedOrderTarget:null}));
  for(let revision=1;revision<=40;revision++)relay({type:'client_commands',revision,sites:old,units:[]});
  assert.equal(sentOrders,0,'idle/render diffs reached the server');
  const stance=original[0].stance==='standby'?'guard':'standby',ratio=stance==='standby'?1:.7;
  relay({type:'client_action',action:{kind:'mobilize',stance}});
  relay({type:'client_commands',intent:'player',revision:1,sites:old.map(s=>({...s,stance,dispatchRatio:ratio})),units:[]});
  for(let revision=2;revision<=40;revision++)relay({type:'client_commands',revision,sites:old,units:[]});
  phase='mobilizing';globalThis.expected={stance,ratio};
  setTimeout(()=>relay({type:'hello',identity:{id:'authority-check',nickname:'authority-check',team,host:false}}),1000);
 }else if(p.type==='state'&&phase==='mobilizing'){
  const own=p.game.sites.filter(s=>s.team===team&&!s.destroyed);
  assert.ok(own.every(s=>s.stance===expected.stance&&s.dispatchRatio===expected.ratio),'old values overrode mobilization');
  source=own.find(s=>p.game.units.filter(u=>u.team===team&&u.siteId===s.id&&u.targetSiteId==null).length>=4);
  target=own.filter(s=>s.id!==source.id).sort((a,b)=>Math.hypot(a.x-source.x,a.z-source.z)-Math.hypot(b.x-source.x,b.z-source.z))[0];
  for(const u of p.game.units)if(u.team===team&&u.siteId===source.id)positions.set(u.id,[u.x,u.z]);
  phase='moving';relay({type:'client_commands',intent:'player',revision:2,sites:[{id:source.id,stance:source.stance,dispatchRatio:1,orderTarget:target.id,plannedOrderTarget:null}],units:[]});
 }else if(p.type==='state_delta'&&phase==='moving'){
  const moved=(p.units||[]).some(u=>Array.isArray(u)&&positions.has(u[0])&&u[10]===target.id&&Math.hypot(u[2]/100-positions.get(u[0])[0],u[3]/100-positions.get(u[0])[1])>.03);
  if(moved)resolve({team,idleOrdersSent:ghostOrders,mobilizedSites:original.length,mobilizationPersisted:true,routeMoved:true,explicitOrderBatches:sentOrders});
 }
}catch(e){reject(e)}};
try{console.log(JSON.stringify(await done));}finally{clearTimeout(timer);ws.close();}

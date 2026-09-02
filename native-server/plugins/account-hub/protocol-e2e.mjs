// Run against a disposable, unprotected local kernel (no user account involved).
// node protocol-e2e.mjs http://127.0.0.1:17991
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
vm.runInThisContext(readFileSync(new URL('./static/protocol.js',import.meta.url),'utf8'));
const base=process.argv[2] || 'http://127.0.0.1:17991';
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(base)) throw Error('Disposable localhost server required');
const info=await fetch(base+'/api/info').then(r=>r.json());
const socket=new WebSocket(base.replace('http:','ws:')+'/ws?role=guest&room='+info.roomCode+'&team=pku');
const relay=p=>JSON.stringify({type:'relay',peerId:'host',data:JSON.stringify(p)});
const bridge=QingbeiProtocol.createBridge({send:r=>socket.send(r)});
let phase='waiting', source, target, order, parts, baseline, moved=false, accepted=false;
let resolve,reject;
const done=new Promise((res,rej)=>{resolve=res;reject=rej});
const timer=setTimeout(()=>reject(Error('test timed out')),15000);
socket.onmessage=e=>{
  try {
    const wire=JSON.parse(e.data);
    if(wire.type==='ready'){socket.send(relay({type:'hello',identity:{id:'protocol-probe',nickname:'protocol-probe',team:'pku',host:false}}));return;}
    if(wire.type!=='relay')return;
    const p=JSON.parse(wire.data);
    if(p.type==='state'&&phase==='waiting'){
      const game=p.game;
      source=game.sites.find(s=>s.team==='pku'&&game.units.filter(u=>u.team==='pku'&&u.siteId===s.id&&u.targetSiteId==null).length>=4);
      // Friendly redeployment is legal even before the war unlocks.
      target=game.sites.filter(s=>s.team==='pku'&&s.id!==source.id&&!s.destroyed).sort((a,b)=>Math.hypot(a.x-source.x,a.z-source.z)-Math.hypot(b.x-source.x,b.z-source.z))[0];
      baseline=new Map(game.units.filter(u=>u.team==='pku'&&u.siteId===source.id).map(u=>[u.id,[u.x,u.z]]));
      order={type:'client_commands',intent:'player',revision:1,units:[],sites:[{id:source.id,stance:source.stance,dispatchRatio:1,orderTarget:target.id,plannedOrderTarget:null}],testPadding:'x'.repeat(30000)};
      const data=JSON.stringify(order),total=Math.ceil(data.length/12000);
      parts=Array.from({length:total},(_,index)=>relay({type:'network_chunk',transferId:'regression',index,total,data:data.slice(index*12000,(index+1)*12000)}));
      phase='unadapted'; parts.forEach(r=>socket.send(r));
      setTimeout(()=>{assert.equal(accepted,false,'old fragmented command unexpectedly worked');phase='adapted';parts.forEach(r=>bridge.outgoing(r));},1500);
    }
    if(p.type==='state_delta'){
      if((p.sites||[]).some(s=>s.id===source?.id&&s.orderTarget===target?.id))accepted=true;
      for(const u of p.units||[])if(Array.isArray(u)&&baseline?.has(u[0])){const before=baseline.get(u[0]);if(Math.hypot(u[2]/100-before[0],u[3]/100-before[1])>.02)moved=true;}
      if(phase==='adapted'&&accepted&&moved)resolve({unadapted:'ignored',adapted:'accepted',positionChanged:true,source:source.id,target:target.id,bytes:JSON.stringify(order).length});
    }
  }catch(err){reject(err);}
};
try{console.log(JSON.stringify(await done));}finally{clearTimeout(timer);socket.close();}

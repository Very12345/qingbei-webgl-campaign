import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

vm.runInThisContext(readFileSync(new URL('./static/protocol.js', import.meta.url), 'utf8'));
vm.runInThisContext(readFileSync(new URL('./static/lifecycle-client.js', import.meta.url), 'utf8'));
const relay = payload => JSON.stringify({type:'relay',peerId:'host',data:JSON.stringify(payload)});

test('old client default ratio is acknowledged only at the authoritative stance limit', () => {
  const bridge=QingbeiProtocol.createBridge({send:()=>{}});
  const command={id:1,stance:'defend',dispatchRatio:.6,orderTarget:2,plannedOrderTarget:null};
  bridge.outgoing(relay({type:'client_commands',intent:'player',revision:1,sites:[command],units:[]}));
  bridge.incoming(relay({type:'state_delta',sites:[{id:1,team:'pku',stance:'defend',dispatchRatio:.1,orderTarget:2}],units:[]}));
  assert.equal(bridge.pendingCommands.size,1);
  bridge.incoming(relay({type:'state_delta',sites:[{id:1,team:'pku',stance:'defend',dispatchRatio:.45,orderTarget:2}],units:[]}));
  assert.equal(bridge.pendingCommands.size,0);
});

test('large chunked orders become exactly one unchanged complete command', () => {
  const sent = [], bridge = QingbeiProtocol.createBridge({send:raw=>sent.push(raw)});
  const command = {type:'client_commands',intent:'player',revision:17,sites:[],units:Array.from({length:600},(_,id)=>({id,team:'pku',targetSiteId:4,tx:12,tz:9}))};
  const data = JSON.stringify(command), total = Math.ceil(data.length / 12000);
  assert.ok(total > 1);
  // Out-of-order and duplicate pieces must neither lose data nor send partial commands.
  const parts = Array.from({length:total},(_,index)=>relay({type:'network_chunk',transferId:'batch',index,total,data:data.slice(index*12000,(index+1)*12000)}));
  bridge.outgoing(parts[total-1]); bridge.outgoing(parts[total-1]);
  assert.equal(sent.length,0);
  parts.slice(0,-1).forEach(raw=>bridge.outgoing(raw));
  assert.equal(sent.length,1);
  assert.deepEqual(JSON.parse(JSON.parse(sent[0]).data),command);
});

test('confirmation matches the requested target, not any moving unit', () => {
  const bridge = QingbeiProtocol.createBridge({send:()=>{}});
  bridge.outgoing(relay({type:'client_commands',intent:'player',revision:1,sites:[],units:[{id:2,targetSiteId:7,tx:2,tz:3}]}));
  bridge.incoming(relay({type:'state_delta',units:[[2,0,0,0,200,300,1,1,1,1,4]],sites:[]}));
  assert.equal(bridge.pendingCommands.size,1);
  bridge.incoming(relay({type:'state_delta',units:[[2,0,0,0,200,300,1,1,1,1,7]],sites:[]}));
  assert.equal(bridge.pendingCommands.size,0);
});

test('malformed chunks are bounded and ordinary messages pass through', () => {
  const sent=[], errors=[], bridge=QingbeiProtocol.createBridge({send:r=>sent.push(r),notify:m=>errors.push(m)});
  bridge.outgoing(relay({type:'network_chunk',transferId:'x',total:999999,index:0,data:'x'}));
  assert.equal(sent.length,0); assert.equal(errors.length,1);
  const ping=relay({type:'ping',id:1}); bridge.outgoing(ping); assert.deepEqual(sent,[ping]);
});

test('render diffs cannot undo mobilization or create orders', () => {
  const sent=[], bridge=QingbeiProtocol.createBridge({send:r=>sent.push(r)});
  bridge.outgoing(relay({type:'client_action',action:{kind:'mobilize',stance:'standby'}}));
  for(let revision=1;revision<=100;revision++)bridge.outgoing(relay({type:'client_commands',revision,sites:[{id:1,stance:'defend',dispatchRatio:.6}],units:[{id:3,tx:1,tz:2}]}));
  assert.equal(sent.length,1);
  assert.equal(bridge.pendingCommands.size,0);
});

test('unchanged full-state orders do not need a new delta to confirm', () => {
  let clock=0;const notices=[], bridge=QingbeiProtocol.createBridge({send:()=>{},notify:m=>notices.push(m),now:()=>clock});
  const site={id:1,team:'pku',stance:'guard',dispatchRatio:.7,orderTarget:4};
  bridge.incoming(relay({type:'state',game:{sites:[site],units:[]}}));
  bridge.outgoing(relay({type:'client_commands',intent:'player',revision:1,sites:[{...site,plannedOrderTarget:null}],units:[]}));
  clock=9000;bridge.incoming(relay({type:'state_delta',sites:[],units:[]}));
  assert.equal(bridge.pendingCommands.size,0);assert.deepEqual(notices,[]);
});

test('opponent exit countdown, join and self-disconnect have distinct lifecycle UI',()=>{
  const state={participants:[{id:'peer',self:false,status:'disconnected',deadline:61000}]};
  assert.match(QingbeiLifecycle.message(state,11000).body,/50秒/);
  assert.equal(QingbeiLifecycle.message(state,11000).title,'对手已离线');
  state.participants[0].status='joining';
  assert.equal(QingbeiLifecycle.message(state,11000).title,'等待对手进入战场');
  state.participants[0].status='online';
  assert.equal(QingbeiLifecycle.message(state,11000),null);
  state.participants[0].self=true;state.participants[0].status='disconnected';
  assert.equal(QingbeiLifecycle.message(state,11000).title,'游戏连接已断开');
  assert.equal(QingbeiLifecycle.message({...state,completed:true},11000),null);
});

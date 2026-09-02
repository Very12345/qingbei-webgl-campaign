import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

vm.runInThisContext(readFileSync(new URL('./static/protocol.js', import.meta.url), 'utf8'));
const relay = payload => JSON.stringify({type:'relay',peerId:'host',data:JSON.stringify(payload)});

test('large chunked orders become exactly one unchanged complete command', () => {
  const sent = [], bridge = QingbeiProtocol.createBridge({send:raw=>sent.push(raw)});
  const command = {type:'client_commands',revision:17,sites:[],units:Array.from({length:600},(_,id)=>({id,team:'pku',targetSiteId:4,tx:12,tz:9}))};
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
  bridge.outgoing(relay({type:'client_commands',revision:1,sites:[],units:[{id:2,targetSiteId:7,tx:2,tz:3}]}));
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

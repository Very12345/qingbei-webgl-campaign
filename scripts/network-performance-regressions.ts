import assert from "node:assert/strict";
import {createKernel} from "../src/game/kernel";
import {makeFreshGame} from "../src/game/create-game";
import {statusModifiersFor} from "../src/game/kernel/modifiers";

const game=makeFreshGame();
const options={aiTeams:[] as [],serverOpening:"standard" as const,randomSeed:42};
const a=createKernel(game,options),b=createKernel(game,options);
a.networkFull();b.networkFull();
const snapshot=a.step(100);b.advanceOnly(100);
assert.deepEqual(b.snapshot(),snapshot,"snapshot-free stepping changed the simulation");
const delta=a.networkDelta(),encoded=JSON.parse(b.networkDeltaJSON());
assert.deepEqual(encoded,JSON.parse(JSON.stringify(delta)),"JSON transport fast path changed the payload");
assert.equal(delta.campaign,undefined,"elapsed time alone resent the entire campaign");

const source=game.sites.find(s=>s.team==='pku')!,target=game.sites.find(s=>s.team==='pku'&&s.id!==source.id)!;
b.dispatchMany([{type:'configure_site',team:'pku',siteId:source.id,orderTarget:target.id,stance:'standby'}],"client/7");
assert.deepEqual(b.drainCommandReceipts(),{tokens:[]},"queued command was reported processed too early");
b.advanceOnly(100);
assert.deepEqual(b.drainCommandReceipts(),{tokens:['client/7']});
assert.deepEqual(b.drainCommandReceipts(),{tokens:[]});
const state=b.networkFull();
assert.equal(state.game.sites[source.id].orderTarget,target.id);
assert.equal(state.game.sites[source.id].playerDispatch,undefined,"private dispatch ledger leaked to network");
assert.ok(b.snapshot().state.sites[source.id].playerDispatch,"save lost its dispatch ledger");
console.log('PASS: identical simulation; efficient campaign sync; JSON transport; processed receipts; private save ledger');
{
  const state=makeFreshGame();state.campaign.statuses=[{id:'s',title:'s',team:'pku',until:10,unitIds:[1,2],attack:2,movement:1,morale:1}];
  assert.equal(statusModifiersFor(state,'pku',1).attack,2);
  assert.equal(statusModifiersFor(state,'pku',3).attack,1);
  state.campaign.statuses[0].unitIds=[3,4];
  assert.equal(statusModifiersFor(state,'pku',1).attack,1);
  assert.equal(statusModifiersFor(state,'pku',3).attack,2);
  state.campaign.statuses[0].unitIds.push(5);
  assert.equal(statusModifiersFor(state,'pku',5).attack,2);
  state.campaign.elapsedHours=11;
  assert.equal(statusModifiersFor(state,'pku',3).attack,1);
}

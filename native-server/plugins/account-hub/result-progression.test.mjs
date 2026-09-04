import {test} from 'node:test';
import assert from 'node:assert/strict';
import './static/result-progression.js';
const {frames,show}=globalThis.QingbeiResultProgression;
test('authoritative level boundaries, rollover and no XP',()=>{
 const p={before:90,after:390,levels:[{level:1,start:0,next:100},{level:2,start:100,next:250},{level:3,start:250,next:500}]};
 assert.deepEqual(frames(p).map(s=>[s.level,s.from,s.to]),[[1,90,100],[2,0,150],[3,0,140]]);
 assert.equal(frames({...p,after:90}).at(0).to,90);
 assert.deepEqual(frames({...p,after:20}),[]);
 assert.equal(frames({before:999,after:1000,levels:[{level:10000,start:900,next:900}]}).at(0).size,0);
});
test('reduced motion renders final authoritative XP without animation',()=>{
 const parts=new Map();
 const element={isConnected:true,hidden:true,querySelector(key){if(!parts.has(key))parts.set(key,{style:{},attrs:{},setAttribute(k,v){this.attrs[k]=v}});return parts.get(key)}};
 show(element,{before:90,after:140,levels:[{level:1,start:0,next:100},{level:2,start:100,next:250}]},{reducedMotion:true});
 assert.equal(element.hidden,false);
 assert.equal(parts.get('[data-level]').textContent,'Lv.2');
 assert.equal(parts.get('[data-earned]').textContent,'+50 EXP');
 assert.equal(parts.get('[role="progressbar"]').attrs['aria-valuenow'],'40');
 assert.match(parts.get('[data-status]').textContent,/晋升 1 级/);
 show(element,undefined);assert.equal(element.hidden,true);
});
